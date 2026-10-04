"""Internal fetch failure categories with safe public-facing messages."""

from __future__ import annotations

from enum import StrEnum


class FetchErrorCode(StrEnum):
    INVALID_URL = "invalid_url"
    UNSUPPORTED_SCHEME = "unsupported_scheme"
    CREDENTIALS_NOT_ALLOWED = "credentials_not_allowed"
    BLOCKED_DESTINATION = "blocked_destination"
    DNS_RESOLUTION_FAILED = "dns_resolution_failed"
    CONNECTION_FAILED = "connection_failed"
    CONNECTION_TIMEOUT = "connection_timeout"
    READ_TIMEOUT = "read_timeout"
    OVERALL_TIMEOUT = "overall_timeout"
    REDIRECT_LIMIT_EXCEEDED = "redirect_limit_exceeded"
    UNSAFE_REDIRECT = "unsafe_redirect"
    UNSUPPORTED_CONTENT_TYPE = "unsupported_content_type"
    RESPONSE_TOO_LARGE = "response_too_large"
    HTTP_ERROR = "http_error"
    UNEXPECTED_FETCH_ERROR = "unexpected_fetch_error"


class FetchError(Exception):
    """An internal safe-fetch failure with no sensitive details for clients."""

    def __init__(self, code: FetchErrorCode, message: str) -> None:
        self.code = code
        self.safe_message = message
        super().__init__(message)
