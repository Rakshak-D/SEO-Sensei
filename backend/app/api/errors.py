"""Stable API error contract and exception types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ..schemas.responses import ErrorDetail, ErrorResponse


@dataclass(frozen=True)
class APIError(Exception):
    code: str
    message: str
    status_code: int


INVALID_REQUEST = "invalid_request"
INVALID_URL = "invalid_url"
UNSUPPORTED_URL = "unsupported_url"
RESOURCE_UNAVAILABLE = "resource_unavailable"
UPSTREAM_AI_UNAVAILABLE = "upstream_ai_unavailable"
RATE_LIMITED = "rate_limited"
INTERNAL_SERVER_ERROR = "internal_server_error"

ERROR_STATUS_CODES = {
    INVALID_REQUEST: 422,
    INVALID_URL: 422,
    UNSUPPORTED_URL: 422,
    RESOURCE_UNAVAILABLE: 502,
    UPSTREAM_AI_UNAVAILABLE: 503,
    RATE_LIMITED: 429,
    INTERNAL_SERVER_ERROR: 500,
}


def error_payload(request: Request, code: str, message: str) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", "unknown")
    return ErrorResponse(error=ErrorDetail(code=code, message=message, request_id=request_id)).model_dump()


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=error_payload(request, exc.code, exc.message))


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_payload(request, INVALID_REQUEST, "The request payload is invalid."),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=error_payload(request, INTERNAL_SERVER_ERROR, "An unexpected server error occurred."),
    )
