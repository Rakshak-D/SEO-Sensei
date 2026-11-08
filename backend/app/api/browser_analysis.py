"""Protected deterministic URL analysis for authenticated browser sessions."""

from __future__ import annotations

import json
import logging
from json import JSONDecodeError
from typing import Any

from fastapi import APIRouter, Request
from pydantic import ValidationError
from starlette.requests import ClientDisconnect

from ..api.browser_auth import (
    BrowserSessionPrincipal,
    require_browser_csrf,
    require_browser_origin,
    require_browser_secure_transport,
    require_browser_session,
)
from ..api.errors import (
    APIError,
    AUTH_REQUIRED,
    INTERNAL_SERVER_ERROR,
    INVALID_REQUEST,
    RATE_LIMITED,
    REQUEST_TOO_LARGE,
    UNSUPPORTED_MEDIA_TYPE,
    api_error_for_fetch_failure,
)
from ..api.proxy import client_ip
from ..config import Settings
from ..schemas.requests import BrowserURLAnalysisRequest
from ..schemas.responses import ErrorResponse
from ..security.browser_analysis_limits import BrowserAnalysisLimitExceeded, BrowserAnalysisLimits
from ..security.errors import FetchError, FetchErrorCode
from ..security.url_policy import validate_url
from ..seo.models import SEOAnalysis
from ...seo_crawler import get_full_seo_analysis_for_url


logger = logging.getLogger("seo_sensei.browser_analysis")
router = APIRouter(prefix="/api/browser/v1", tags=["browser-analysis"])
MAX_ANALYSIS_BODY_BYTES = 4_096


class DuplicateJSONKeyError(ValueError):
    """Raised when a JSON object repeats a key and would be ambiguous."""


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJSONKeyError
        result[key] = value
    return result


def _content_length(request: Request) -> int | None:
    values = request.headers.getlist("content-length")
    transfer_encoding = request.headers.getlist("transfer-encoding")
    if len(values) > 1 or (values and transfer_encoding):
        raise APIError(INVALID_REQUEST, "The request framing is invalid.", 400)
    if not values:
        if transfer_encoding and (len(transfer_encoding) != 1 or transfer_encoding[0].strip().lower() != "chunked"):
            raise APIError(INVALID_REQUEST, "The request framing is invalid.", 400)
        return None
    value = values[0]
    if not value.isascii() or not value.isdecimal() or len(value) > 10:
        raise APIError(INVALID_REQUEST, "The request framing is invalid.", 400)
    return int(value)


async def _read_bounded_json(request: Request) -> bytes:
    declared_length = _content_length(request)
    if declared_length is not None and declared_length > MAX_ANALYSIS_BODY_BYTES:
        raise APIError(REQUEST_TOO_LARGE, "The analysis request is too large.", 413)

    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise APIError(UNSUPPORTED_MEDIA_TYPE, "A JSON analysis request is required.", 415)

    body = bytearray()
    try:
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_ANALYSIS_BODY_BYTES:
                raise APIError(REQUEST_TOO_LARGE, "The analysis request is too large.", 413)
            body.extend(chunk)
    except ClientDisconnect as exc:
        raise APIError(INVALID_REQUEST, "The analysis request body is incomplete.", 400) from exc

    if declared_length is not None and len(body) != declared_length:
        raise APIError(INVALID_REQUEST, "The request framing is invalid.", 400)
    return bytes(body)


def _parse_request_body(body: bytes) -> BrowserURLAnalysisRequest:
    try:
        value = json.loads(body, object_pairs_hook=_object_without_duplicate_keys)
    except (JSONDecodeError, UnicodeDecodeError, DuplicateJSONKeyError, RecursionError) as exc:
        raise APIError(INVALID_REQUEST, "The analysis request JSON is invalid.", 400) from exc
    try:
        return BrowserURLAnalysisRequest.model_validate(value)
    except ValidationError as exc:
        raise APIError(INVALID_REQUEST, "The analysis request payload is invalid.", 422) from exc


def _raise_url_error(error: FetchError) -> None:
    raise api_error_for_fetch_failure(error.code) from error


def _analysis_error_responses() -> dict[int | str, dict[str, Any]]:
    return {status: {"model": ErrorResponse} for status in (400, 401, 403, 413, 415, 422, 429, 502, 500)}


@router.post(
    "/analyse-url",
    response_model=SEOAnalysis,
    responses=_analysis_error_responses(),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": BrowserURLAnalysisRequest.model_json_schema()}},
        }
    },
)
async def analyse_url(request: Request) -> SEOAnalysis:
    """Fetch and analyze one URL through the established deterministic pipeline."""

    require_browser_secure_transport(request)
    require_browser_origin(request)
    principal: BrowserSessionPrincipal = require_browser_session(request)
    require_browser_csrf(request, principal.session)

    body = await _read_bounded_json(request)
    payload = _parse_request_body(body)
    settings: Settings = request.app.state.settings
    try:
        validated = validate_url(payload.url, settings)
    except FetchError as exc:
        _raise_url_error(exc)

    limits: BrowserAnalysisLimits = request.app.state.browser_analysis_limits
    address = client_ip(request, tuple(settings.trusted_proxy_networks))
    try:
        lease = limits.admit(principal.session.username, address)
    except BrowserAnalysisLimitExceeded as exc:
        raise APIError(
            RATE_LIMITED,
            "Browser analysis capacity is temporarily unavailable.",
            429,
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    try:
        refreshed = principal.runtime.sessions.refresh_if_live(principal.session_id, principal.session)
        if refreshed is None:
            lease.cancel()
            raise APIError(AUTH_REQUIRED, "A valid browser session is required.", 401)

        try:
            result = await get_full_seo_analysis_for_url(
                validated.url,
                fetcher=request.app.state.safe_fetcher,
                request_id=getattr(request.state, "request_id", None),
            )
        except Exception as exc:
            logger.error(
                "browser_analysis_pipeline_failed",
                extra={
                    "request_id": getattr(request.state, "request_id", "-"),
                    "endpoint": "/api/browser/v1/analyse-url",
                },
            )
            raise APIError(INTERNAL_SERVER_ERROR, "The URL could not be analyzed.", 500) from exc

        if not isinstance(result, dict) or result.get("status") != "success":
            raw_code = result.get("fetch_error") if isinstance(result, dict) else None
            try:
                fetch_code = (
                    FetchErrorCode(raw_code) if isinstance(raw_code, str) else FetchErrorCode.UNEXPECTED_FETCH_ERROR
                )
            except (TypeError, ValueError):
                fetch_code = FetchErrorCode.UNEXPECTED_FETCH_ERROR
            _raise_url_error(FetchError(fetch_code, "The requested page could not be analyzed."))

        analysis_data = {key: value for key, value in result.items() if key != "status"}
        try:
            return SEOAnalysis.model_validate(analysis_data)
        except (ValidationError, TypeError, ValueError) as exc:
            logger.error(
                "browser_analysis_contract_invalid",
                extra={
                    "request_id": getattr(request.state, "request_id", "-"),
                    "endpoint": "/api/browser/v1/analyse-url",
                },
            )
            raise APIError(INTERNAL_SERVER_ERROR, "The URL could not be analyzed.", 500) from exc
    finally:
        lease.release()
