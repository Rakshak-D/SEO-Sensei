"""Opt-in, anonymous and tightly bounded deterministic SEO audits."""

from __future__ import annotations

import asyncio
import json
import ipaddress
import logging
import secrets
import time
from json import JSONDecodeError
from urllib.parse import urlsplit
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.requests import ClientDisconnect
from starlette.types import ASGIApp, Receive, Scope, Send

from ..api.errors import (
    APIError,
    BOT_VERIFICATION_FAILED,
    BOT_VERIFICATION_UNAVAILABLE,
    CSRF_REJECTED,
    GUEST_CAPACITY_UNAVAILABLE,
    GUEST_SESSION_REQUIRED,
    INTERNAL_SERVER_ERROR,
    INVALID_REQUEST,
    RATE_LIMITED,
    RESOURCE_UNAVAILABLE,
    REQUEST_TOO_LARGE,
    UNSUPPORTED_MEDIA_TYPE,
    api_error_for_fetch_failure,
)
from ..api.proxy import client_ip, request_host, request_scheme
from ..config import Settings
from ..schemas.requests import GuestURLAnalysisRequest
from ..schemas.responses import ErrorResponse
from ..security.errors import FetchError
from ..security.guest_identity import GuestSession, GuestSessionCapacityError, GuestSessionStore
from ..security.guest_limits import GuestAnalysisLimits, GuestAuditLease, GuestLimitExceeded
from ..security.turnstile import ReplayRegistryFull, TurnstileUnavailable
from ..security.url_policy import classify_ip, validate_url
from ..seo.models import SEOAnalysis
from ...seo_crawler import get_full_seo_analysis_for_url


logger = logging.getLogger("seo_sensei.guest_analysis")
router = APIRouter(prefix="/api/guest/v1", tags=["guest-analysis"])
GUEST_ANALYSIS_BODY_BYTES = 4_096
GUEST_COOKIE_NAME = "__Host-seo_sensei_guest"
CSRF_HEADER_NAME = "X-CSRF-Token"


class DuplicateJSONKeyError(ValueError):
    """Raised when a request object contains duplicate JSON keys."""


class GuestNamespaceOriginMiddleware:
    """Prevent the global legacy CORS allowlist from exposing guest routes."""

    def __init__(self, app: ASGIApp, allowed_origin: str) -> None:
        self.app = app
        self.allowed_origin = allowed_origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope.get("type") != "http" or not path.startswith("/api/guest/v1"):
            await self.app(scope, receive, send)
            return

        origin_values = [value for name, value in scope.get("headers", []) if name.lower() == b"origin"]
        allowed = len(origin_values) <= 1 and (
            not origin_values or secrets.compare_digest(origin_values[0], self.allowed_origin.encode("ascii"))
        )
        if not allowed:
            state = scope.get("state", {})
            request_id = state.get("request_id", "unknown")
            response = JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "origin_rejected",
                        "message": "The request origin is not allowed.",
                        "request_id": request_id,
                    }
                },
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJSONKeyError
        result[key] = value
    return result


async def _read_bounded_json(request: Request) -> bytes:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise APIError(UNSUPPORTED_MEDIA_TYPE, "A JSON analysis request is required.", 415)

    body = bytearray()
    try:
        async for chunk in request.stream():
            if len(body) + len(chunk) > GUEST_ANALYSIS_BODY_BYTES:
                raise APIError(REQUEST_TOO_LARGE, "The analysis request is too large.", 413)
            body.extend(chunk)
    except ClientDisconnect as exc:
        raise APIError(INVALID_REQUEST, "The analysis request body is incomplete.", 400) from exc
    return bytes(body)


def _parse_payload(body: bytes) -> tuple[GuestURLAnalysisRequest, object | None]:
    try:
        value = json.loads(body, object_pairs_hook=_unique_json_object)
    except (JSONDecodeError, UnicodeDecodeError, DuplicateJSONKeyError, RecursionError):
        raise APIError(INVALID_REQUEST, "The analysis request JSON is invalid.", 400) from None
    if not isinstance(value, dict) or set(value) - {"url", "challenge_token"}:
        raise APIError(INVALID_REQUEST, "The analysis request payload is invalid.", 422)
    try:
        payload = GuestURLAnalysisRequest.model_validate({"url": value.get("url")})
    except ValidationError:
        raise APIError(INVALID_REQUEST, "The analysis request payload is invalid.", 422) from None
    return payload, value.get("challenge_token")


def _validate_challenge_token(value: object | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise APIError(INVALID_REQUEST, "The analysis request payload is invalid.", 422)
    token = value.strip()
    if not token or len(token) > 2_048:
        raise APIError(INVALID_REQUEST, "The analysis request payload is invalid.", 422)
    return token


def _require_secure_host_origin(request: Request, *, origin_required: bool) -> None:
    settings: Settings = request.app.state.settings
    trusted = tuple(settings.trusted_proxy_networks)
    if request_scheme(request, trusted) != "https":
        raise APIError("origin_rejected", "HTTPS is required for guest audits.", 403)

    configured = settings.guest_app_origin
    if not configured:
        raise APIError("origin_rejected", "Guest audits are unavailable.", 403)
    expected_authority = urlsplit(configured).netloc
    supplied_host = request_host(request, trusted)
    actual_hosts = request.headers.getlist("host")
    if len(actual_hosts) != 1 or not supplied_host or "," in supplied_host:
        raise APIError("origin_rejected", "The request host is not allowed.", 403)
    try:
        supplied_authority = supplied_host.lower().encode("ascii")
    except UnicodeEncodeError:
        supplied_authority = b""
    if not secrets.compare_digest(supplied_authority, expected_authority.lower().encode("ascii")):
        raise APIError("origin_rejected", "The request host is not allowed.", 403)

    origins = request.headers.getlist("origin")
    if len(origins) > 1 or (origin_required and len(origins) != 1):
        raise APIError("origin_rejected", "The request origin is not allowed.", 403)
    if origins:
        try:
            matches = secrets.compare_digest(origins[0].encode("ascii"), configured.encode("ascii"))
        except UnicodeEncodeError:
            matches = False
        if not matches:
            raise APIError("origin_rejected", "The request origin is not allowed.", 403)


def _guest_cookie(request: Request) -> str | None:
    values = request.headers.getlist("cookie")
    if len(values) > 1:
        return None
    found: list[str] = []
    for item in values:
        for part in item.split(";"):
            name, separator, value = part.strip().partition("=")
            if separator and name == GUEST_COOKIE_NAME:
                found.append(value)
    return found[0] if len(found) == 1 else None


def _require_csrf(request: Request, sessions: GuestSessionStore, cookie: str) -> None:
    tokens = request.headers.getlist(CSRF_HEADER_NAME.lower())
    if len(tokens) != 1 or not sessions.verify_csrf(cookie, tokens[0]):
        raise APIError(CSRF_REJECTED, "The request could not be verified.", 403)


def _limited(exc: GuestLimitExceeded) -> APIError:
    return APIError(
        RATE_LIMITED,
        "Guest audit capacity is temporarily unavailable. Try again shortly.",
        429,
        headers={"Retry-After": str(exc.retry_after)},
    )


def _analysis_errors() -> dict[int | str, dict[str, Any]]:
    return {status: {"model": ErrorResponse} for status in (400, 401, 403, 408, 413, 415, 422, 429, 502, 503, 500)}


@router.get("/session")
async def guest_session(request: Request, response: Response) -> dict[str, Any]:
    """Create or recover a short-lived anonymous identity for later CSRF use."""

    _require_secure_host_origin(request, origin_required=False)
    settings: Settings = request.app.state.settings
    address = client_ip(request, tuple(settings.trusted_proxy_networks))
    limits: GuestAnalysisLimits = request.app.state.guest_analysis_limits
    try:
        limits.admit_bootstrap(address)
    except GuestLimitExceeded as exc:
        raise _limited(exc) from None

    sessions: GuestSessionStore = request.app.state.guest_sessions
    existing_cookie = _guest_cookie(request)
    session = sessions.get(existing_cookie)
    cookie: str | None = existing_cookie
    if session is None:
        try:
            cookie, session = sessions.create()
        except GuestSessionCapacityError:
            raise APIError(
                GUEST_CAPACITY_UNAVAILABLE,
                "Guest sessions are temporarily unavailable.",
                503,
                headers={"Retry-After": "60"},
            ) from None
        max_age = sessions.lifetime_seconds
        should_set_cookie = True
    else:
        cookie = existing_cookie
        max_age = max(1, int(session.expires_at - time.time()))
        should_set_cookie = False

    if cookie is None:
        raise APIError(GUEST_SESSION_REQUIRED, "A valid guest session is required.", 401)
    csrf_token = sessions.csrf_token(cookie)
    challenge_required = not settings.guest_turnstile_test_mode
    turnstile_action = settings.guest_turnstile_action if challenge_required else None
    if should_set_cookie:
        response.set_cookie(
            GUEST_COOKIE_NAME,
            cookie,
            max_age=max_age,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )
        return {
            "csrf_token": csrf_token,
            "expires_in": max_age,
            "bot_check_required": challenge_required,
            "turnstile_sitekey": settings.guest_turnstile_sitekey if challenge_required else None,
            "turnstile_action": turnstile_action,
        }

    return {
        "csrf_token": csrf_token,
        "expires_in": max_age,
        "bot_check_required": challenge_required,
        "turnstile_sitekey": settings.guest_turnstile_sitekey if challenge_required else None,
        "turnstile_action": turnstile_action,
    }


@router.post(
    "/analyse-url",
    response_model=SEOAnalysis,
    responses=_analysis_errors(),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": GuestURLAnalysisRequest.model_json_schema()}},
        }
    },
)
async def analyse_guest_url(request: Request) -> SEOAnalysis:
    """Perform one deterministic audit behind guest-session and abuse controls."""

    _require_secure_host_origin(request, origin_required=True)
    sessions: GuestSessionStore = request.app.state.guest_sessions
    cookie = _guest_cookie(request)
    session: GuestSession | None = sessions.get(cookie)
    if session is None or cookie is None:
        raise APIError(GUEST_SESSION_REQUIRED, "A valid guest session is required.", 401)
    _require_csrf(request, sessions, cookie)

    settings: Settings = request.app.state.settings
    limits: GuestAnalysisLimits = request.app.state.guest_analysis_limits
    address = client_ip(request, tuple(settings.trusted_proxy_networks))
    if not settings.guest_turnstile_test_mode:
        try:
            limits.admit_bot_attempt(address)
        except GuestLimitExceeded as exc:
            raise _limited(exc) from None

    payload, raw_challenge_token = _parse_payload(await _read_bounded_json(request))
    try:
        validated_url = validate_url(payload.url, settings)
        # Literal destinations can be rejected without DNS. Hostname resolution
        # and all redirects remain exclusively in SafeFetcher.
        try:
            ipaddress.ip_address(validated_url.hostname)
        except ValueError:
            pass
        else:
            classify_ip(validated_url.hostname)
    except FetchError as exc:
        raise api_error_for_fetch_failure(exc.code) from None

    try:
        lease: GuestAuditLease = limits.admit_audit(session.visitor_id, address)
    except GuestLimitExceeded as exc:
        raise _limited(exc) from None

    try:
        token: str | None = None
        token = _validate_challenge_token(raw_challenge_token)
        if not settings.guest_turnstile_test_mode:
            if token is None:
                raise APIError(BOT_VERIFICATION_FAILED, "Complete the bot check and try again.", 403)
            replay_guard = request.app.state.guest_turnstile_replay_guard
            try:
                if not replay_guard.claim(token):
                    raise APIError(BOT_VERIFICATION_FAILED, "Complete a fresh bot check and try again.", 403)
            except ReplayRegistryFull:
                raise APIError(
                    BOT_VERIFICATION_UNAVAILABLE,
                    "Bot verification is temporarily unavailable.",
                    503,
                    headers={"Retry-After": "30"},
                ) from None

            verifier = getattr(request.app.state, "guest_turnstile_verifier", None)
            if verifier is None:
                raise APIError(
                    BOT_VERIFICATION_UNAVAILABLE,
                    "Bot verification is temporarily unavailable.",
                    503,
                    headers={"Retry-After": "30"},
                )
            try:
                verified = await verifier.verify(token)
            except TurnstileUnavailable:
                raise APIError(
                    BOT_VERIFICATION_UNAVAILABLE,
                    "Bot verification is temporarily unavailable.",
                    503,
                    headers={"Retry-After": "30"},
                ) from None
            if not verified:
                raise APIError(BOT_VERIFICATION_FAILED, "Complete the bot check and try again.", 403)

        lease.commit()
        try:
            async with asyncio.timeout(settings.guest_analysis_timeout_seconds):
                result = await get_full_seo_analysis_for_url(
                    validated_url.url,
                    fetcher=request.app.state.safe_fetcher,
                    request_id=getattr(request.state, "request_id", None),
                )
        except TimeoutError:
            raise APIError(RESOURCE_UNAVAILABLE, "The requested page could not be analyzed.", 502) from None
        except Exception:
            logger.error(
                "guest_analysis_pipeline_failed",
                extra={
                    "request_id": getattr(request.state, "request_id", "-"),
                    "endpoint": "/api/guest/v1/analyse-url",
                },
            )
            raise APIError(INTERNAL_SERVER_ERROR, "The URL could not be analyzed.", 500) from None

        if not isinstance(result, dict) or result.get("status") != "success":
            raw_code = result.get("fetch_error") if isinstance(result, dict) else None
            raise api_error_for_fetch_failure(raw_code)
        analysis_data = {key: value for key, value in result.items() if key != "status"}
        try:
            analysis = SEOAnalysis.model_validate(analysis_data)
        except (ValidationError, TypeError, ValueError):
            logger.error(
                "guest_analysis_contract_invalid",
                extra={
                    "request_id": getattr(request.state, "request_id", "-"),
                    "endpoint": "/api/guest/v1/analyse-url",
                },
            )
            raise APIError(INTERNAL_SERVER_ERROR, "The URL could not be analyzed.", 500) from None

        response_size = len(analysis.model_dump_json().encode("utf-8"))
        if response_size > settings.guest_response_size_bytes:
            raise APIError(RESOURCE_UNAVAILABLE, "The requested page could not be analyzed.", 502)
        return analysis
    finally:
        lease.release()


def guest_runtime(settings: Settings) -> tuple[GuestSessionStore, GuestAnalysisLimits]:
    """Construct the in-process state only when guest routes are enabled."""

    return (
        GuestSessionStore(
            capacity=settings.guest_session_capacity,
            lifetime_seconds=settings.guest_session_lifetime_seconds,
        ),
        GuestAnalysisLimits.from_settings(settings),
    )
