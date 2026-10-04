"""Reusable bearer-token authentication for protected API operations."""

from __future__ import annotations

import hashlib
import secrets

from fastapi import Header, Request

from .errors import APIError, AUTH_INVALID, AUTH_REQUIRED


def _identity(token: str) -> str:
    """Return a non-reversible identifier suitable for in-memory bookkeeping."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


async def require_auth(request: Request, authorization: str | None = Header(default=None)) -> None:
    """Require the configured bearer token without logging or exposing it."""

    expected = getattr(request.app.state, "settings").api_access_token
    supplied = ""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            supplied = parts[1].strip()

    configured = expected or "__missing_api_access_token__"
    valid = bool(expected) and bool(supplied) and secrets.compare_digest(supplied, configured)
    if not valid:
        code = AUTH_REQUIRED if not authorization else AUTH_INVALID
        message = "Authentication is required." if code == AUTH_REQUIRED else "Authentication credentials are invalid."
        raise APIError(code, message, 401, headers={"WWW-Authenticate": "Bearer"})

    request.state.auth_identity = _identity(supplied)
