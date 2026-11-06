"""Restricted, separately authenticated browser-session endpoints."""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

import anyio
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ..api.errors import APIError, AUTH_INVALID, AUTH_REQUIRED, INVALID_REQUEST, RATE_LIMITED
from ..api.proxy import client_ip as trusted_client_ip, request_scheme as trusted_request_scheme
from ..config import ConfigurationError, Settings
from ..security.browser_accounts import Account, load_accounts, normalize_username
from ..security.browser_sessions import BrowserSession, BrowserSessionStore, SessionCapacityError


router = APIRouter(prefix="/api/browser/v1/session", tags=["browser-auth"])

SESSION_COOKIE_NAME = "__Host-seo_sensei_session"
CSRF_HEADER_NAME = "X-CSRF-Token"
ORIGIN_REJECTED = "origin_rejected"
CSRF_REJECTED = "csrf_rejected"
MAX_LOGIN_BODY_BYTES = 4_096
MAX_LOGIN_KEYS = 4_096
LOGIN_WINDOW_SECONDS = 60.0
LOGIN_PER_IP = 5
LOGIN_PER_ACCOUNT = 5
LOGIN_GLOBAL = 30
MAX_PASSWORD_VERIFICATIONS = 2


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1_024)


@dataclass(frozen=True, slots=True)
class LoginLimitDecision:
    allowed: bool
    retry_after: int = 0


class LoginAttemptLimiter:
    """Bounded sliding-window account, trusted-IP, and process-wide limiter."""

    def __init__(
        self,
        *,
        max_keys: int = MAX_LOGIN_KEYS,
        per_ip: int = LOGIN_PER_IP,
        per_account: int = LOGIN_PER_ACCOUNT,
        global_limit: int = LOGIN_GLOBAL,
        window_seconds: float = LOGIN_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_keys = max_keys
        self._per_ip = per_ip
        self._per_account = per_account
        self._global_limit = global_limit
        self._window = window_seconds
        self._clock = clock
        self._events: dict[str, deque[float]] = {}
        self._global_events: deque[float] = deque()
        self._lock = threading.Lock()

    def check(self, client_ip: str, normalized_identifier: str) -> LoginLimitDecision:
        now = self._clock()
        account_digest = hashlib.sha256(normalized_identifier.encode("utf-8")).hexdigest()
        keys = (f"ip:{client_ip}", f"account:{account_digest}")

        with self._lock:
            self._purge(now)
            global_retry = self._retry_after(self._global_events, now, self._global_limit)
            if global_retry:
                return LoginLimitDecision(False, global_retry)

            missing = sum(key not in self._events for key in keys)
            if len(self._events) + missing > self._max_keys:
                return LoginLimitDecision(False, max(1, int(self._window)))

            # Every syntactically valid credential attempt counts process-wide,
            # including attempts denied by an IP or account-specific limit.
            self._global_events.append(now)
            limits = ((keys[0], self._per_ip), (keys[1], self._per_account))
            retries = [self._retry_after(self._events.get(key, deque()), now, limit) for key, limit in limits]
            retry_after = max(retries, default=0)
            if retry_after:
                return LoginLimitDecision(False, retry_after)

            for key, _ in limits:
                self._events.setdefault(key, deque()).append(now)
            return LoginLimitDecision(True)

    def _purge(self, now: float) -> None:
        cutoff = now - self._window
        while self._global_events and self._global_events[0] <= cutoff:
            self._global_events.popleft()
        for key, events in list(self._events.items()):
            while events and events[0] <= cutoff:
                events.popleft()
            if not events:
                del self._events[key]

    def _retry_after(self, events: deque[float], now: float, limit: int) -> int:
        if len(events) < limit:
            return 0
        return max(1, int(events[0] + self._window - now + 0.999999))


class PasswordVerifier:
    """Argon2id verifier with a non-queuing process-wide concurrency bound."""

    def __init__(self, hasher: PasswordHasher, max_concurrency: int = MAX_PASSWORD_VERIFICATIONS) -> None:
        self.hasher = hasher
        self._slots = threading.BoundedSemaphore(max_concurrency)

    def acquire(self) -> bool:
        return self._slots.acquire(blocking=False)

    def release(self) -> None:
        self._slots.release()

    def verify(self, encoded_hash: str, password: str) -> bool:
        try:
            return self.hasher.verify(encoded_hash, password)
        except VerifyMismatchError:
            return False
        except (InvalidHashError, VerificationError):
            # Account-file verifiers are validated at startup. A damaged value
            # fails closed without returning or logging its contents.
            return False


class BrowserAuthRuntime:
    """Process-lifetime browser-auth dependencies, constructed only when enabled."""

    def __init__(self, settings: Settings, accounts: dict[str, Account]) -> None:
        self.settings = settings
        self.accounts = accounts
        self.sessions = BrowserSessionStore(
            capacity=settings.browser_session_capacity,
            idle_timeout_seconds=settings.browser_session_idle_timeout_seconds,
            absolute_lifetime_seconds=settings.browser_session_absolute_lifetime_seconds,
        )
        self.login_limiter = LoginAttemptLimiter()
        hasher = PasswordHasher(
            time_cost=2,
            memory_cost=19_456,
            parallelism=1,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )
        self.password_verifier = PasswordVerifier(hasher)
        self.dummy_password_hash = hasher.hash(secrets.token_urlsafe(32))

    @classmethod
    def from_settings(cls, settings: Settings) -> "BrowserAuthRuntime":
        if not settings.browser_auth_enabled or not settings.browser_auth_accounts_file:
            raise ConfigurationError("Browser authentication configuration is incomplete.")
        accounts = load_accounts(settings.browser_auth_accounts_file)
        return cls(settings, accounts)


@dataclass(frozen=True, slots=True)
class BrowserSessionPrincipal:
    """Verified in-process browser identity for one request."""

    runtime: BrowserAuthRuntime
    session_id: str
    session: BrowserSession


def browser_origin_is_allowed(request: Request) -> bool:
    """Return whether exactly one Origin header matches the configured app."""

    configured = request.app.state.settings.browser_app_origin
    origins = request.headers.getlist("origin")
    if not configured or len(origins) != 1:
        return False
    supplied = origins[0].encode("utf-8", errors="surrogatepass")
    expected = configured.encode("ascii")
    return secrets.compare_digest(supplied, expected)


def require_browser_secure_transport(request: Request) -> None:
    settings: Settings = request.app.state.settings
    scheme = trusted_request_scheme(request, tuple(settings.trusted_proxy_networks))
    if scheme != "https":
        raise APIError(ORIGIN_REJECTED, "HTTPS is required for browser sessions.", 403)


def require_browser_origin(request: Request) -> None:
    if not browser_origin_is_allowed(request):
        raise APIError(ORIGIN_REJECTED, "The request origin is not allowed.", 403)


def require_browser_session(request: Request) -> BrowserSessionPrincipal:
    """Verify the opaque session cookie without refreshing idle activity."""

    runtime: BrowserAuthRuntime = request.app.state.browser_auth
    session_id = _session_cookie_value(request)
    session = runtime.sessions.get(session_id, touch=False)
    if session is None or session_id is None:
        raise APIError(AUTH_REQUIRED, "A valid browser session is required.", 401)
    return BrowserSessionPrincipal(runtime, session_id, session)


def require_browser_csrf(request: Request, session: BrowserSession) -> None:
    """Verify the session-bound synchronizer token on a state-changing request."""

    tokens = request.headers.getlist(CSRF_HEADER_NAME.lower())
    valid = len(tokens) == 1 and secrets.compare_digest(
        tokens[0].encode("utf-8", errors="surrogatepass"),
        session.csrf_token.encode("ascii"),
    )
    if not valid:
        raise APIError(CSRF_REJECTED, "The request could not be verified.", 403)


async def _read_bounded_login_payload(request: Request) -> LoginPayload:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise APIError(INVALID_REQUEST, "A JSON login payload is required.", 422)

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_LOGIN_BODY_BYTES:
                raise APIError(INVALID_REQUEST, "The login request is too large.", 413)
        except ValueError as exc:
            raise APIError(INVALID_REQUEST, "The login request is invalid.", 400) from exc

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_LOGIN_BODY_BYTES:
            raise APIError(INVALID_REQUEST, "The login request is too large.", 413)
        body.extend(chunk)
    try:
        payload = LoginPayload.model_validate_json(body)
    except ValidationError as exc:
        raise APIError(INVALID_REQUEST, "The login payload is invalid.", 422) from exc
    try:
        payload.password.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise APIError(INVALID_REQUEST, "The login payload is invalid.", 422) from exc
    return payload


def _normalized_login_identifier(username: str) -> str:
    normalized = normalize_username(username)
    # An invalid identifier still receives generic credential handling and an
    # account-key rate-limit entry. Its source length is bounded by the schema.
    try:
        normalized.encode("utf-8")
    except UnicodeEncodeError:
        return f"invalid:{hashlib.sha256(username.encode('utf-8', errors='surrogatepass')).hexdigest()}"
    return normalized[:128]


async def _verify_password(runtime: BrowserAuthRuntime, encoded_hash: str, password: str) -> bool:
    if not runtime.password_verifier.acquire():
        raise APIError(
            RATE_LIMITED,
            "Authentication is temporarily busy. Please try again shortly.",
            429,
            headers={"Retry-After": "1"},
        )
    try:
        return await anyio.to_thread.run_sync(runtime.password_verifier.verify, encoded_hash, password)
    finally:
        runtime.password_verifier.release()


def _session_cookie_value(request: Request) -> str | None:
    value = request.cookies.get(SESSION_COOKIE_NAME)
    return value if value and len(value) <= 64 else None


class BrowserNamespaceOriginMiddleware:
    """Keep legacy CORS allowlists from exposing browser-session responses."""

    def __init__(self, app: ASGIApp, allowed_origin: str) -> None:
        self.app = app
        self.allowed_origin = allowed_origin.encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope.get("type") == "http" and (path == "/api/browser/v1" or path.startswith("/api/browser/v1/")):
            origins = [value for key, value in scope.get("headers", []) if key.lower() == b"origin"]
            if origins and (len(origins) != 1 or not secrets.compare_digest(origins[0], self.allowed_origin)):
                state = scope.get("state", {})
                request_id = state.get("request_id", "unknown")
                response = JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": ORIGIN_REJECTED,
                            "message": "The request origin is not allowed.",
                            "request_id": request_id,
                        }
                    },
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


@router.post("/login")
async def login(request: Request) -> JSONResponse:
    require_browser_secure_transport(request)
    require_browser_origin(request)
    payload = await _read_bounded_login_payload(request)
    username = _normalized_login_identifier(payload.username)
    client_address = trusted_client_ip(request, tuple(request.app.state.settings.trusted_proxy_networks))
    runtime: BrowserAuthRuntime = request.app.state.browser_auth
    limit = runtime.login_limiter.check(client_address, username)
    if not limit.allowed:
        raise APIError(
            RATE_LIMITED,
            "Too many sign-in attempts. Please try again later.",
            429,
            headers={"Retry-After": str(limit.retry_after)},
        )

    account = runtime.accounts.get(username)
    encoded_hash = account.password_hash if account is not None else runtime.dummy_password_hash
    verified = await _verify_password(runtime, encoded_hash, payload.password)
    if account is None or not verified:
        raise APIError(AUTH_INVALID, "The username or password is incorrect.", 401)

    old_session_id = _session_cookie_value(request)
    try:
        session_id, _ = runtime.sessions.create(username, replacing_session_id=old_session_id)
    except SessionCapacityError as exc:
        raise APIError(
            RATE_LIMITED,
            "No browser session capacity is currently available.",
            429,
            headers={"Retry-After": "60"},
        ) from exc

    response = {"authenticated": True, "user": {"username": username}}
    result = JSONResponse(response, headers={"Cache-Control": "no-store"})
    result.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        max_age=runtime.settings.browser_session_absolute_lifetime_seconds,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    return result


@router.get("")
async def session(request: Request) -> dict[str, object]:
    require_browser_secure_transport(request)
    current = require_browser_session(request).session
    return {
        "authenticated": True,
        "user": {"username": current.username},
        "csrf_token": current.csrf_token,
    }


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    require_browser_secure_transport(request)
    require_browser_origin(request)
    principal = require_browser_session(request)
    require_browser_csrf(request, principal.session)
    if not principal.runtime.sessions.revoke(principal.session_id):
        raise APIError(AUTH_REQUIRED, "A valid browser session is required.", 401)

    response = JSONResponse({"authenticated": False}, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    return response
