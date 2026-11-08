"""SEO-Sensei FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
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
    INVALID_REQUEST,
    REQUEST_TOO_LARGE,
    UPSTREAM_AI_UNAVAILABLE,
    api_error_for_fetch_failure,
    api_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from .ai.gemini import AIServiceError, GeminiService
from .ai.models import AIRecommendationState, AIRecommendationsResult
from .api.auth import require_auth
from .api.browser_auth import (
    BrowserAuthRuntime,
    BrowserNamespaceOriginMiddleware,
    router as browser_auth_router,
)
from .api.browser_analysis import MAX_ANALYSIS_BODY_BYTES, router as browser_analysis_router
from .api.observability import request_context
from .api.rate_limit import InMemoryRateLimiter, enforce_rate_limit, rate_limit_for
from .config import Settings, get_settings
from .logging_config import configure_logging
from .metrics import Metrics
from .schemas.requests import ArticleGenerationRequest, SEOBoostRequest, URLAnalysisRequest
from .schemas.responses import ArticleGenerationResponse, HealthResponse, SEOBoostResponse, URLAnalysisResponse
from .security.fetcher import SafeFetcher
from .security.browser_analysis_limits import BrowserAnalysisLimits
from .seo.models import SEOAnalysis


REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
REQUEST_BODY_REPLAY_CHUNK_BYTES = 64 * 1024
logger = logging.getLogger("seo_sensei.api")
settings: Settings = get_settings()
configure_logging(settings.log_level)
metrics = Metrics(settings.metrics_enabled)


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.metrics = metrics
    if settings.browser_auth_enabled:
        application.state.browser_auth = BrowserAuthRuntime.from_settings(settings)
        application.state.browser_analysis_limits = BrowserAnalysisLimits()
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
if settings.browser_auth_enabled:
    app.include_router(browser_auth_router)
    app.include_router(browser_analysis_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_credentials=settings.cors_allow_credentials and bool(settings.allowed_cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)

if settings.browser_auth_enabled:
    # This path-specific guard wraps global CORS so a legacy extension origin
    # cannot read browser session bootstrap data through credentialed CORS.
    app.add_middleware(
        BrowserNamespaceOriginMiddleware,
        allowed_origin=settings.browser_app_origin or "",
    )


class RequestContextMiddleware:
    """Attach a correlation ID and enforce bounded ASGI request bodies."""

    def __init__(
        self,
        app: ASGIApp,
        max_body_size: int,
        path_body_limits: dict[str, int] | None = None,
    ) -> None:
        self.app = app
        self.max_body_size = max_body_size
        self.path_body_limits = dict(path_body_limits or {})

    def _body_limit(self, path: str) -> int:
        route_limit = self.path_body_limits.get(path.rstrip("/"))
        return min(self.max_body_size, route_limit) if route_limit is not None else self.max_body_size

    @staticmethod
    def _declared_length(headers: dict[bytes, list[bytes]], limit: int) -> tuple[int | None, str | None]:
        lengths = headers.get(b"content-length", [])
        transfer_encodings = headers.get(b"transfer-encoding", [])
        if len(lengths) > 1 or len(transfer_encodings) > 1 or (lengths and transfer_encodings):
            return None, "invalid"
        if transfer_encodings:
            if transfer_encodings[0].strip().lower() != b"chunked":
                return None, "invalid"
        if not lengths:
            return None, None

        value = lengths[0].strip(b" \t")
        if not value or not value.isdigit():
            return None, "invalid"
        significant = value.lstrip(b"0") or b"0"
        limit_digits = str(limit).encode("ascii")
        if len(significant) > len(limit_digits):
            return None, "too_large"
        declared = int(significant)
        if declared > limit:
            return None, "too_large"
        return declared, None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers: dict[bytes, list[bytes]] = {}
        for name, value in scope.get("headers", []):
            headers.setdefault(name.lower(), []).append(value)
        supplied = headers.get(b"x-request-id", [b""])[-1].decode("ascii", errors="ignore")
        request_id = supplied if REQUEST_ID_RE.fullmatch(supplied) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        start = time.perf_counter()

        completed = False
        force_no_store = False

        async def send_with_headers(message: Message) -> None:
            nonlocal completed
            if message["type"] == "http.response.start":
                completed = True
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                if force_no_store or scope.get("path") not in {"/health", "/ready"}:
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
            body_limit = self._body_limit(scope.get("path", ""))
            declared_length, framing_error = self._declared_length(headers, body_limit)

            async def reject(status_code: int, code: str, message: str) -> None:
                nonlocal force_no_store
                force_no_store = True
                response = JSONResponse(
                    status_code=status_code,
                    content={
                        "error": {
                            "code": code,
                            "message": message,
                            "request_id": request_id,
                        }
                    },
                )
                await response(scope, receive, send_with_headers)

            if framing_error == "too_large":
                await reject(413, REQUEST_TOO_LARGE, "Request body is too large.")
                return
            if framing_error == "invalid":
                await reject(400, INVALID_REQUEST, "Request framing is invalid.")
                return

            chunks: list[bytes] = []
            replay_buffer = bytearray()
            actual_length = 0
            while True:
                message = await receive()
                message_type = message.get("type")
                if message_type == "http.disconnect":
                    # A disconnected caller cannot receive a response, and no downstream
                    # route work should begin with an incomplete request body.
                    return
                if message_type != "http.request":
                    await reject(400, INVALID_REQUEST, "Request body framing is invalid.")
                    return

                chunk = message.get("body", b"")
                more_body = message.get("more_body", False)
                if not isinstance(chunk, bytes) or not isinstance(more_body, bool):
                    await reject(400, INVALID_REQUEST, "Request body framing is invalid.")
                    return
                if len(chunk) > body_limit - actual_length:
                    await reject(413, REQUEST_TOO_LARGE, "Request body is too large.")
                    return
                actual_length += len(chunk)
                offset = 0
                while offset < len(chunk):
                    append_length = min(REQUEST_BODY_REPLAY_CHUNK_BYTES - len(replay_buffer), len(chunk) - offset)
                    replay_buffer.extend(memoryview(chunk)[offset : offset + append_length])
                    offset += append_length
                    if len(replay_buffer) == REQUEST_BODY_REPLAY_CHUNK_BYTES:
                        chunks.append(bytes(replay_buffer))
                        replay_buffer.clear()
                if not more_body:
                    break

            if declared_length is not None and actual_length != declared_length:
                await reject(400, INVALID_REQUEST, "Request framing is invalid.")
                return
            if replay_buffer:
                chunks.append(bytes(replay_buffer))

            # Replay bounded, coalesced chunks. ASGI chunk boundaries are transport
            # details; the byte stream and final-body marker remain unchanged.
            replay_index = 0

            async def replay_receive() -> Message:
                nonlocal replay_index
                if replay_index < len(chunks):
                    current = replay_index
                    replay_index += 1
                    return {
                        "type": "http.request",
                        "body": chunks[current],
                        "more_body": replay_index < len(chunks),
                    }
                if not chunks and replay_index == 0:
                    replay_index = 1
                    return {"type": "http.request", "body": b"", "more_body": False}
                return await receive()

            await self.app(scope, replay_receive, send_with_headers)
        except asyncio.CancelledError:
            raise
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


app.add_middleware(
    RequestContextMiddleware,
    max_body_size=settings.max_request_body_size_bytes,
    path_body_limits={"/api/browser/v1/analyse-url": MAX_ANALYSIS_BODY_BYTES},
)
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
            fetch_error = scraped_data.get("fetch_error") if isinstance(scraped_data, dict) else None
            raise api_error_for_fetch_failure(fetch_error)

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
            fetch_error = scraped_data.get("fetch_error") if isinstance(scraped_data, dict) else None
            raise api_error_for_fetch_failure(fetch_error)
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
