"""SEO-Sensei FastAPI application entrypoint."""

from __future__ import annotations

import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .api.errors import (
    APIError,
    INTERNAL_SERVER_ERROR,
    INVALID_URL,
    RESOURCE_UNAVAILABLE,
    UNSUPPORTED_URL,
    UPSTREAM_AI_UNAVAILABLE,
    api_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from .ai.gemini import AIServiceError, GeminiService
from .ai.models import AIRecommendationState, AIRecommendationsResult
from .api.auth import require_auth
from .api.observability import request_context
from .api.rate_limit import InMemoryRateLimiter, enforce_rate_limit, rate_limit_for
from .config import Settings, get_settings
from .logging_config import configure_logging
from .metrics import Metrics
from .schemas.requests import ArticleGenerationRequest, SEOBoostRequest, URLAnalysisRequest
from .schemas.responses import ArticleGenerationResponse, HealthResponse, SEOBoostResponse, URLAnalysisResponse
from .security.fetcher import SafeFetcher
from .seo.models import SEOAnalysis


REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
logger = logging.getLogger("seo_sensei.api")
settings: Settings = get_settings()
configure_logging(settings.log_level)
metrics = Metrics(settings.metrics_enabled)


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.metrics = metrics
    application.state.safe_fetcher = SafeFetcher(settings, metrics=metrics)
    application.state.rate_limiter = InMemoryRateLimiter(settings)
    application.state.gemini_service = None
    if settings.gemini_api_key:
        try:
            application.state.gemini_service = GeminiService(settings, metrics=metrics)
        except AIServiceError:
            logger.warning("gemini_service_not_available_at_startup", extra={"endpoint": "startup"})
    try:
        yield
    finally:
        await application.state.safe_fetcher.aclose()
        gemini_service = getattr(application.state, "gemini_service", None)
        if gemini_service is not None:
            await gemini_service.aclose()


app = FastAPI(
    title="SEO-Sensei API",
    version="1.0.0",
    description="URL SEO analysis and AI-assisted recommendations.",
    lifespan=lifespan,
)
app.state.settings = settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_credentials=settings.cors_allow_credentials and bool(settings.allowed_cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


class RequestContextMiddleware:
    """Attach a bounded correlation ID and enforce the configured body hint."""

    def __init__(self, app: ASGIApp, max_body_size: int) -> None:
        self.app = app
        self.max_body_size = max_body_size

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        supplied = headers.get(b"x-request-id", b"").decode("ascii", errors="ignore")
        request_id = supplied if REQUEST_ID_RE.fullmatch(supplied) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        content_length = headers.get(b"content-length")
        if content_length:
            try:
                too_large = int(content_length) > self.max_body_size
            except ValueError:
                too_large = True
            if too_large:
                response = JSONResponse(
                    status_code=413,
                    content={
                        "error": {
                            "code": "invalid_request",
                            "message": "Request body is too large.",
                            "request_id": request_id,
                        }
                    },
                    headers={"X-Request-ID": request_id},
                )
                await response(scope, receive, send)
                return

        start = time.perf_counter()

        completed = False

        async def send_with_headers(message: Message) -> None:
            nonlocal completed
            if message["type"] == "http.response.start":
                completed = True
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                if scope.get("path") not in {"/health", "/ready"}:
                    response_headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": response_headers}
                logger.info(
                    "request_complete",
                    extra={
                        "request_id": request_id,
                        "endpoint": scope.get("path", "-"),
                        "route": scope.get("path", "-"),
                        "method": scope.get("method", "-"),
                        "status": message["status"],
                        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                    },
                )
                record_metric_from_scope(scope, "http_requests_total", "request")
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except BaseException:
            if not completed:
                logger.exception(
                    "request_failed_before_response",
                    extra={
                        "request_id": request_id,
                        "endpoint": scope.get("path", "-"),
                        "method": scope.get("method", "-"),
                        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                    },
                )
            raise


app.add_middleware(RequestContextMiddleware, max_body_size=settings.max_request_body_size_bytes)
app.add_exception_handler(APIError, api_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(Exception, unhandled_error_handler)


def record_metric_from_scope(scope: Scope, name: str, operation: str | None = None) -> None:
    metrics.increment(name, operation)


def _service_or_error(request: Request) -> GeminiService:
    service = getattr(request.app.state, "gemini_service", None)
    if service is None:
        raise APIError(UPSTREAM_AI_UNAVAILABLE, "AI analysis is not configured.", 503)
    return service


def _log_context(request: Request, endpoint: str) -> dict[str, str]:
    return request_context(request, endpoint)


@app.get("/", response_model=dict[str, str])
async def read_root() -> dict[str, str]:
    return {"message": "SEO-Sensei API is running."}


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", environment=settings.environment, version=settings.app_version)


@app.get("/ready", response_model=HealthResponse)
async def ready(request: Request) -> HealthResponse:
    """Cheap process readiness check; it performs no external I/O."""

    is_ready = getattr(request.app.state, "safe_fetcher", None) is not None
    return HealthResponse(
        status="ok" if is_ready else "not_ready",
        environment=settings.environment,
        version=settings.app_version,
    )


@app.post(
    "/analyse-url",
    response_model=URLAnalysisResponse,
    dependencies=[Depends(require_auth), Depends(rate_limit_for("analysis"))],
)
async def post_url(payload: URLAnalysisRequest, request: Request) -> URLAnalysisResponse:
    url_received = str(payload.url)
    if len(url_received) > settings.max_url_length:
        raise APIError(INVALID_URL, "The URL is too long.", 422)

    try:
        if payload.include_ai_recommendations:
            await enforce_rate_limit(request, "ai")
        try:
            from ..seo_crawler import get_full_seo_analysis_for_url
        except ImportError:
            from seo_crawler import get_full_seo_analysis_for_url
        scraped_data = await get_full_seo_analysis_for_url(
            url_received,
            fetcher=request.app.state.safe_fetcher,
        )
        if not scraped_data or scraped_data.get("status") == "failed":
            fetch_error = scraped_data.get("fetch_error") if scraped_data else None
            if fetch_error in {"invalid_url", "credentials_not_allowed"}:
                raise APIError(INVALID_URL, "The requested URL is invalid.", 422)
            if fetch_error in {"unsupported_scheme", "unsafe_redirect"}:
                raise APIError(UNSUPPORTED_URL, "The requested URL is not supported.", 422)
            raise APIError(RESOURCE_UNAVAILABLE, "The requested page could not be analyzed.", 502)

        analysis_data = {key: value for key, value in scraped_data.items() if key != "status"}
        analysis = SEOAnalysis.model_validate(analysis_data)
        ai_recommendations: AIRecommendationsResult | None = None
        if payload.include_ai_recommendations:
            if getattr(request.app.state, "gemini_service", None) is None:
                ai_recommendations = AIRecommendationsResult(
                    state=AIRecommendationState.CONFIGURATION_ERROR,
                    message="AI recommendations are not configured. Deterministic findings remain available.",
                )
            else:
                try:
                    ai_recommendations = await request.app.state.gemini_service.recommendations(
                        analysis,
                        request_id=getattr(request.state, "request_id", None),
                    )
                except Exception:
                    logger.warning("ai_recommendations_failed", extra=_log_context(request, "/analyse-url"))
                    ai_recommendations = AIRecommendationsResult(
                        state=AIRecommendationState.UNAVAILABLE,
                        message="AI recommendations are temporarily unavailable. Deterministic findings remain available.",
                    )
        return URLAnalysisResponse.model_validate(
            {**analysis.model_dump(mode="json"), "ai_recommendations": ai_recommendations}
        )
    except APIError:
        raise
    except Exception:
        logger.exception("url_analysis_failed", extra=_log_context(request, "/analyse-url"))
        raise APIError(INTERNAL_SERVER_ERROR, "The URL could not be analyzed.", 500)


@app.post(
    "/generate-article",
    response_model=ArticleGenerationResponse,
    dependencies=[Depends(require_auth), Depends(rate_limit_for("article"))],
)
async def generate_article(payload: ArticleGenerationRequest, request: Request) -> ArticleGenerationResponse:
    try:
        result = await _service_or_error(request).generate_article(
            payload,
            request_id=getattr(request.state, "request_id", None),
        )
        return ArticleGenerationResponse.model_validate(result)
    except AIServiceError:
        raise APIError(UPSTREAM_AI_UNAVAILABLE, "Article generation is temporarily unavailable.", 503)
    except APIError:
        raise
    except Exception:
        logger.exception("article_generation_failed", extra=_log_context(request, "/generate-article"))
        raise APIError(INTERNAL_SERVER_ERROR, "The article could not be generated.", 500)


@app.post(
    "/boost-seo",
    response_model=SEOBoostResponse,
    dependencies=[Depends(require_auth), Depends(rate_limit_for("boost"))],
)
async def post_boost_seo(payload: SEOBoostRequest, request: Request) -> SEOBoostResponse:
    try:
        ai_service = _service_or_error(request)
        try:
            from ..seo_crawler import get_full_seo_analysis_for_url
        except ImportError:
            from seo_crawler import get_full_seo_analysis_for_url
        scraped_data = await get_full_seo_analysis_for_url(str(payload.url), fetcher=request.app.state.safe_fetcher)
        if not scraped_data or scraped_data.get("status") == "failed":
            raise APIError(RESOURCE_UNAVAILABLE, "The requested page could not be analyzed.", 502)
        analysis = SEOAnalysis.model_validate({key: value for key, value in scraped_data.items() if key != "status"})
        result = await ai_service.generate_boost(
            analysis,
            request_id=getattr(request.state, "request_id", None),
        )
        return SEOBoostResponse.model_validate(result)
    except AIServiceError:
        raise APIError(UPSTREAM_AI_UNAVAILABLE, "SEO boost suggestions are temporarily unavailable.", 503)
    except APIError:
        raise
    except Exception:
        logger.exception("seo_boost_failed", extra=_log_context(request, "/boost-seo"))
        raise APIError(INTERNAL_SERVER_ERROR, "SEO boost suggestions could not be generated.", 500)
