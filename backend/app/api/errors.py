"""Stable API error contract and exception types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import logging

from ..security.errors import FetchErrorCode
from ..schemas.responses import ErrorDetail, ErrorResponse


logger = logging.getLogger("seo_sensei.errors")


@dataclass(frozen=True)
class APIError(Exception):
    code: str
    message: str
    status_code: int
    headers: dict[str, str] | None = None


INVALID_REQUEST = "invalid_request"
REQUEST_TOO_LARGE = "request_too_large"
UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
INVALID_URL = "invalid_url"
UNSUPPORTED_URL = "unsupported_url"
DESTINATION_BLOCKED = "destination_blocked"
RESOURCE_UNAVAILABLE = "resource_unavailable"
UPSTREAM_AI_UNAVAILABLE = "upstream_ai_unavailable"
RATE_LIMITED = "rate_limited"
AUTH_REQUIRED = "auth_required"
AUTH_INVALID = "auth_invalid"
INTERNAL_SERVER_ERROR = "internal_server_error"

ERROR_STATUS_CODES = {
    INVALID_REQUEST: 422,
    REQUEST_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    INVALID_URL: 422,
    UNSUPPORTED_URL: 422,
    DESTINATION_BLOCKED: 422,
    RESOURCE_UNAVAILABLE: 502,
    UPSTREAM_AI_UNAVAILABLE: 503,
    RATE_LIMITED: 429,
    AUTH_REQUIRED: 401,
    AUTH_INVALID: 401,
    INTERNAL_SERVER_ERROR: 500,
}

_FETCH_FAILURES_TO_PUBLIC: dict[FetchErrorCode, tuple[str, str, int]] = {
    FetchErrorCode.INVALID_URL: (INVALID_URL, "The requested URL is invalid.", 422),
    FetchErrorCode.CREDENTIALS_NOT_ALLOWED: (INVALID_URL, "The requested URL is invalid.", 422),
    FetchErrorCode.UNSUPPORTED_SCHEME: (UNSUPPORTED_URL, "The requested URL is not supported.", 422),
    FetchErrorCode.BLOCKED_DESTINATION: (
        DESTINATION_BLOCKED,
        "The requested destination is not permitted.",
        422,
    ),
    FetchErrorCode.UNSAFE_REDIRECT: (
        DESTINATION_BLOCKED,
        "The requested destination is not permitted.",
        422,
    ),
}


def api_error_for_fetch_failure(fetch_error: object) -> APIError:
    """Map known safe-fetch categories to sanitized, stable public API errors."""

    if not isinstance(fetch_error, str):
        category = None
    else:
        try:
            category = FetchErrorCode(fetch_error)
        except ValueError:
            category = None

    public_error = _FETCH_FAILURES_TO_PUBLIC.get(category) if category is not None else None
    if public_error is None:
        return APIError(RESOURCE_UNAVAILABLE, "The requested page could not be analyzed.", 502)

    code, message, status_code = public_error
    return APIError(code, message, status_code)


def error_payload(request: Request, code: str, message: str) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", "unknown")
    return ErrorResponse(error=ErrorDetail(code=code, message=message, request_id=request_id)).model_dump()


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    logger.warning(
        "api_error",
        extra={
            "request_id": getattr(request.state, "request_id", "-"),
            "endpoint": request.url.path,
            "method": request.method,
            "status": exc.status_code,
            "error_code": exc.code,
        },
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(request, exc.code, exc.message),
        headers=exc.headers,
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.warning(
        "request_validation_failed",
        extra={
            "request_id": getattr(request.state, "request_id", "-"),
            "endpoint": request.url.path,
            "method": request.method,
            "status": 422,
            "error_code": INVALID_REQUEST,
        },
    )
    return JSONResponse(
        status_code=422,
        content=error_payload(request, INVALID_REQUEST, "The request payload is invalid."),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_request_error",
        extra={
            "request_id": getattr(request.state, "request_id", "-"),
            "endpoint": request.url.path,
            "method": request.method,
            "status": 500,
            "error_code": INTERNAL_SERVER_ERROR,
        },
    )
    return JSONResponse(
        status_code=500,
        content=error_payload(request, INTERNAL_SERVER_ERROR, "An unexpected server error occurred."),
    )
