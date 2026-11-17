from __future__ import annotations

import importlib
import asyncio
import json
import logging
import os
from pathlib import Path
import pytest
import httpx
from argon2 import PasswordHasher, Type
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.security.errors import FetchErrorCode
from backend.app.security.fetcher import FetchResult
from backend.app.seo.models import SEOAnalysis


ORIGIN = "https://app.example.test"
GUEST_SESSION_PATH = "/api/guest/v1/session"
GUEST_ANALYSIS_PATH = "/api/guest/v1/analyse-url"
COOKIE_NAME = "__Host-seo_sensei_guest"
BROWSER_COOKIE_NAME = "__Host-seo_sensei_session"
CSRF_HEADER = "X-CSRF-Token"
SAMPLE_URL = "https://example.test/guides/solar/?private=guest-audit-test"
TURNSTILE_SECRET = "guest-test-server-secret-not-for-output"
TURNSTILE_TOKEN = "guest-test-challenge-token-not-for-output"
HTML = b"""<!doctype html><html lang="en"><head>
<title>Solar installation guide</title><meta name="description" content="Plan a solar installation.">
<link rel="canonical" href="https://example.test/guides/solar/">
</head><body><h1>Solar installation guide</h1><p>Choose a system and plan an installation.</p>
<img src="panel.jpg" alt="Solar panel"><a href="/contact">Contact</a></body></html>"""


def _assert_absent(value: str, text: str, message: str) -> None:
    if value and value in text:
        raise AssertionError(message)


class FakeSafeFetcher:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.failure: FetchErrorCode | None = None
        self.exception: Exception | None = None

    async def fetch_url(self, url: str, *, request_id: str | None = None) -> FetchResult:
        del request_id
        self.calls.append(url)
        if self.exception is not None:
            raise self.exception
        if self.failure is not None:
            return FetchResult(requested_url=url, error=self.failure)
        return FetchResult(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            content_length=len(HTML),
            bytes_read=len(HTML),
            elapsed_time=0.01,
            body=HTML.decode("utf-8"),
        )

    async def aclose(self) -> None:
        return None


class FakeTurnstileVerifier:
    def __init__(self, *, valid: bool = True, unavailable: bool = False) -> None:
        self.valid = valid
        self.unavailable = unavailable
        self.calls = 0

    async def verify(self, token: str) -> bool:
        del token
        self.calls += 1
        if self.unavailable:
            from backend.app.security.turnstile import TurnstileUnavailable

            raise TurnstileUnavailable from None
        return self.valid

    async def aclose(self) -> None:
        return None


class AsyncChunks(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk

    async def aclose(self) -> None:
        return None


def _load_main(
    monkeypatch: pytest.MonkeyPatch,
    *,
    enabled: bool = True,
    test_mode: bool = True,
    browser_auth: bool = False,
    accounts_file: Path | None = None,
    settings: dict[str, str] | None = None,
):
    env = {
        "APP_ENV": "test",
        "API_ACCESS_TOKEN": "guest-test-operator-token",
        "GEMINI_API_KEY": "",
        "BROWSER_AUTH_ENABLED": "true" if browser_auth else "false",
        "GUEST_AUDITS_ENABLED": "true" if enabled else "false",
        "GUEST_APP_ORIGIN": ORIGIN,
        "GUEST_TURNSTILE_TEST_MODE": "true" if test_mode else "false",
        "GUEST_TURNSTILE_SITEKEY": "guest-test-public-sitekey",
        "GUEST_TURNSTILE_SECRET_KEY": TURNSTILE_SECRET,
        "GUEST_TURNSTILE_EXPECTED_HOSTNAME": "app.example.test",
        "GUEST_TURNSTILE_ACTION": "guest_analysis",
        "ALLOWED_CORS_ORIGINS": "chrome-extension://test-extension-id",
        "CORS_ALLOW_CREDENTIALS": "true",
        "TRUSTED_PROXY_NETWORKS": "",
    }
    if accounts_file is not None:
        env["BROWSER_AUTH_ACCOUNTS_FILE"] = str(accounts_file)
        env["BROWSER_APP_ORIGIN"] = ORIGIN
    else:
        monkeypatch.delenv("BROWSER_AUTH_ACCOUNTS_FILE", raising=False)
        monkeypatch.delenv("BROWSER_APP_ORIGIN", raising=False)
    env.update(settings or {})
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    import backend.app.main as main

    return importlib.reload(main)


@pytest.fixture()
def guest_client(monkeypatch: pytest.MonkeyPatch):
    main = _load_main(monkeypatch)
    with TestClient(main.app, base_url=ORIGIN) as client:
        fetcher = FakeSafeFetcher()
        client.app.state.safe_fetcher = fetcher
        yield client, fetcher
    get_settings.cache_clear()


def _bootstrap(client: TestClient, *, origin: str | None = None):
    headers = {} if origin is None else {"Origin": origin}
    return client.get(GUEST_SESSION_PATH, headers=headers)


def _post_headers(bootstrap_response, *, origin: str | None = ORIGIN, csrf: bool = True) -> dict[str, str]:
    response_body = bootstrap_response.json()
    csrf_value = response_body.get("csrf_token")
    headers = {"Content-Type": "application/json"}
    if origin is not None:
        headers["Origin"] = origin
    if csrf and isinstance(csrf_value, str):
        headers[CSRF_HEADER] = csrf_value
    return headers


def _error(response, *, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "request_id"}
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == response.headers.get("x-request-id")
    assert response.headers.get("cache-control") == "no-store"


def _asgi_scope(client, headers: list[tuple[bytes, bytes]]) -> dict[str, object]:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": GUEST_SESSION_PATH,
        "raw_path": GUEST_SESSION_PATH.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"app.example.test"), *headers],
        "client": ("testclient", 50_000),
        "server": ("app.example.test", 443),
        "state": {},
        "app": client.app,
    }


async def _run_guest_middleware(client, receive, headers: list[tuple[bytes, bytes]]) -> list[dict[str, object]]:
    import backend.app.main as main

    middleware = main.RequestContextMiddleware(
        client.app,
        max_body_size=main.settings.max_request_body_size_bytes,
        path_body_limits=main.path_body_limits,
        path_receive_timeouts=main.path_receive_timeouts,
    )
    messages: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    await middleware(_asgi_scope(client, headers), receive, send)
    return messages


def _assert_asgi_error(messages: list[dict[str, object]], *, status: int, code: str) -> None:
    start = next(message for message in messages if message["type"] == "http.response.start")
    assert start["status"] == status
    response_headers = dict(start["headers"])
    assert response_headers[b"cache-control"] == b"no-store"
    assert response_headers[b"x-request-id"]
    body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
    error = json.loads(body)["error"]
    assert set(error) == {"code", "message", "request_id"}
    assert error["code"] == code
    assert error["request_id"] == response_headers[b"x-request-id"].decode("ascii")


def _bootstrap_admission_count(limits) -> int:
    return sum(len(record.bootstrap) for record in limits._ip_records.values())


def test_guest_routes_are_absent_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    main = _load_main(monkeypatch, enabled=False)
    with TestClient(main.app, base_url=ORIGIN) as client:
        assert client.get(GUEST_SESSION_PATH).status_code == 404
        assert client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}).status_code == 404
        paths = client.get("/openapi.json").json()["paths"]
        assert GUEST_SESSION_PATH not in paths
        assert GUEST_ANALYSIS_PATH not in paths
    get_settings.cache_clear()


def test_guest_bootstrap_sets_secure_host_cookie_and_returns_minimum_data(guest_client) -> None:
    client, _fetcher = guest_client
    response = _bootstrap(client)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"csrf_token", "expires_in", "bot_check_required", "turnstile_sitekey"}
    assert body["bot_check_required"] is False
    assert body["turnstile_sitekey"] is None
    assert body["expires_in"] == 3_600
    csrf = body["csrf_token"]
    if not isinstance(csrf, str) or not csrf:
        raise AssertionError("Guest bootstrap omitted the synchronizer value")
    set_cookie = response.headers.get("set-cookie", "").lower()
    for attribute in ("secure", "httponly", "samesite=lax", "path=/"):
        if attribute not in set_cookie:
            raise AssertionError("Guest cookie is missing a required security attribute")
    if "domain=" in set_cookie:
        raise AssertionError("Guest cookie must be host-only")
    if not set_cookie.startswith(f"{COOKIE_NAME.lower()}="):
        raise AssertionError("Guest cookie does not use the host-prefix name")
    _assert_absent(TURNSTILE_SECRET, response.text, "Server-held challenge secret appeared in bootstrap response")
    assert response.headers.get("cache-control") == "no-store"
    assert response.headers.get("x-request-id")


def test_repeated_bootstrap_recovers_the_same_identity_and_csrf(guest_client) -> None:
    client, _fetcher = guest_client
    first = _bootstrap(client)
    first_csrf = first.json().get("csrf_token")
    initial_session_count = len(client.app.state.guest_sessions)
    second = _bootstrap(client)
    second_csrf = second.json().get("csrf_token")

    assert first.status_code == second.status_code == 200
    assert isinstance(first_csrf, str) and bool(first_csrf)
    if first_csrf != second_csrf:
        raise AssertionError("Repeated bootstrap changed the live session context")
    assert len(client.cookies) == 1
    assert len(client.app.state.guest_sessions) == initial_session_count == 1


def test_guest_bootstrap_body_policy_is_zero_bytes_with_a_finite_deadline(guest_client) -> None:
    client, _fetcher = guest_client
    import backend.app.main as main

    assert main.path_body_limits.get(GUEST_SESSION_PATH) == 0
    assert (
        main.path_receive_timeouts.get(GUEST_SESSION_PATH)
        == client.app.state.settings.guest_request_body_timeout_seconds
    )


def test_guest_bootstrap_accepts_explicit_zero_content_length(guest_client) -> None:
    client, _fetcher = guest_client
    response = client.get(GUEST_SESSION_PATH, headers={"Content-Length": "0"})

    assert response.status_code == 200
    assert len(client.app.state.guest_sessions) == 1


def test_guest_bootstrap_positive_content_length_is_rejected_before_receive_or_admission(guest_client) -> None:
    client, _fetcher = guest_client
    receive_called = False
    session_count = len(client.app.state.guest_sessions)
    bootstrap_count = _bootstrap_admission_count(client.app.state.guest_analysis_limits)

    async def receive() -> dict[str, object]:
        nonlocal receive_called
        receive_called = True
        raise AssertionError("Positive bootstrap Content-Length must be rejected before receive")

    messages = asyncio.run(_run_guest_middleware(client, receive, [(b"content-length", b"1")]))

    _assert_asgi_error(messages, status=413, code="request_too_large")
    assert not receive_called
    assert len(client.app.state.guest_sessions) == session_count
    assert _bootstrap_admission_count(client.app.state.guest_analysis_limits) == bootstrap_count


def test_guest_bootstrap_rejects_streamed_nonempty_body_before_session_creation(guest_client) -> None:
    client, _fetcher = guest_client

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"x", "more_body": False}

    messages = asyncio.run(_run_guest_middleware(client, receive, []))

    _assert_asgi_error(messages, status=413, code="request_too_large")
    assert len(client.app.state.guest_sessions) == 0
    assert _bootstrap_admission_count(client.app.state.guest_analysis_limits) == 0


def test_guest_bootstrap_rejects_malformed_or_conflicting_framing_before_receive(guest_client) -> None:
    client, _fetcher = guest_client
    malformed_headers = (
        [(b"content-length", b"not-a-number")],
        [(b"content-length", b"0"), (b"content-length", b"0")],
        [(b"content-length", b"0"), (b"transfer-encoding", b"chunked")],
    )
    for headers in malformed_headers:
        receive_called = False

        async def receive() -> dict[str, object]:
            nonlocal receive_called
            receive_called = True
            raise AssertionError("Malformed framing must be rejected before receive")

        messages = asyncio.run(_run_guest_middleware(client, receive, headers))
        _assert_asgi_error(messages, status=400, code="invalid_request")
        assert not receive_called
    assert len(client.app.state.guest_sessions) == 0
    assert _bootstrap_admission_count(client.app.state.guest_analysis_limits) == 0


def test_guest_bootstrap_incomplete_chunked_body_times_out_without_admission(monkeypatch: pytest.MonkeyPatch) -> None:
    main = _load_main(monkeypatch, settings={"GUEST_REQUEST_BODY_TIMEOUT_SECONDS": "0.01"})
    with TestClient(main.app, base_url=ORIGIN) as client:
        receive_calls = 0
        receive_cancelled = False

        async def receive() -> dict[str, object]:
            nonlocal receive_calls, receive_cancelled
            receive_calls += 1
            if receive_calls == 1:
                return {"type": "http.request", "body": b"", "more_body": True}
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                receive_cancelled = True
                raise
            raise AssertionError("An incomplete bootstrap stream unexpectedly completed")

        messages = asyncio.run(
            asyncio.wait_for(
                _run_guest_middleware(client, receive, [(b"transfer-encoding", b"chunked")]),
                timeout=0.2,
            )
        )

        _assert_asgi_error(messages, status=408, code="request_timeout")
        assert receive_calls == 2
        assert receive_cancelled
        assert len(client.app.state.guest_sessions) == 0
        assert _bootstrap_admission_count(client.app.state.guest_analysis_limits) == 0
    get_settings.cache_clear()


def test_bootstrap_rejects_cross_origin_and_wrong_host_before_creating_session(guest_client) -> None:
    client, _fetcher = guest_client
    response = _bootstrap(client, origin="https://attacker.example")
    _error(response, status=403, code="origin_rejected")
    assert len(client.cookies) == 0

    wrong_host = client.get(GUEST_SESSION_PATH, headers={"Host": "api.example.test"})
    _error(wrong_host, status=403, code="origin_rejected")
    assert len(client.cookies) == 0


def test_bootstrap_attempts_are_rate_limited_per_ip(guest_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _fetcher = guest_client
    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        bootstrap_per_minute=1
    )

    first = _bootstrap(client)
    second = _bootstrap(client)

    assert first.status_code == 200
    _error(second, status=429, code="rate_limited")
    assert second.headers.get("retry-after") == "60"
    assert len(client.app.state.guest_sessions) == 1
    del monkeypatch


def test_guest_analysis_requires_guest_session_and_bound_csrf(guest_client) -> None:
    client, fetcher = guest_client

    _error(
        client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers={"Origin": ORIGIN}),
        status=401,
        code="guest_session_required",
    )
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap, csrf=False)
    _error(
        client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers), status=403, code="csrf_rejected"
    )

    headers[CSRF_HEADER] = "wrong-value"
    _error(
        client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers), status=403, code="csrf_rejected"
    )
    assert fetcher.calls == []


@pytest.mark.parametrize(
    "origin",
    [None, "https://attacker.example"],
)
def test_guest_analysis_requires_exact_origin(guest_client, origin: str | None) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap, origin=origin)

    _error(
        client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers), status=403, code="origin_rejected"
    )
    assert fetcher.calls == []


def test_guest_analysis_rejects_untrusted_forwarded_https_spoof(monkeypatch: pytest.MonkeyPatch) -> None:
    main = _load_main(monkeypatch)
    with TestClient(main.app, base_url="http://app.example.test") as client:
        response = client.get(
            GUEST_SESSION_PATH,
            headers={"Origin": ORIGIN, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "app.example.test"},
        )
        _error(response, status=403, code="origin_rejected")
        assert len(client.cookies) == 0
    get_settings.cache_clear()


def test_guest_analysis_returns_validated_deterministic_v11_result_without_bearer_or_gemini(guest_client) -> None:
    client, fetcher = guest_client

    class GeminiMustNotRun:
        async def recommendations(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("Guest analysis invoked Gemini")

        async def aclose(self) -> None:
            return None

    client.app.state.gemini_service = GeminiMustNotRun()
    bootstrap = _bootstrap(client)
    response = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL},
        headers=_post_headers(bootstrap),
    )

    assert response.status_code == 200
    analysis = SEOAnalysis.model_validate(response.json())
    assert analysis.deterministic_score.version == "1.1"
    assert len(analysis.checks) == 23
    assert fetcher.calls == [SAMPLE_URL]
    if "authorization" in response.request.headers:
        raise AssertionError("Guest analysis unexpectedly sent an Authorization header")
    assert response.headers.get("cache-control") == "no-store"
    assert response.headers.get("x-request-id")


@pytest.mark.parametrize(
    ("url", "status", "code"),
    [
        ("https://127.0.0.1/", 422, "destination_blocked"),
        ("https://user:password@example.test/", 422, "invalid_url"),
        ("file:///etc/passwd", 422, "unsupported_url"),
    ],
)
def test_guest_url_policy_rejects_unsafe_urls_before_fetch(guest_client, url: str, status: int, code: str) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    response = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": url},
        headers=_post_headers(bootstrap),
    )

    _error(response, status=status, code=code)
    assert fetcher.calls == []


@pytest.mark.parametrize(
    ("fetch_error", "status", "code"),
    [
        (FetchErrorCode.UNSAFE_REDIRECT, 422, "destination_blocked"),
        (FetchErrorCode.DNS_RESOLUTION_FAILED, 502, "resource_unavailable"),
    ],
)
def test_guest_fetch_error_contract_does_not_overstate_policy_blocks(
    guest_client,
    fetch_error: FetchErrorCode,
    status: int,
    code: str,
) -> None:
    client, fetcher = guest_client
    fetcher.failure = fetch_error
    bootstrap = _bootstrap(client)
    response = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL},
        headers=_post_headers(bootstrap),
    )

    _error(response, status=status, code=code)
    assert len(fetcher.calls) == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"url": SAMPLE_URL, "include_ai_recommendations": True},
        {"url": SAMPLE_URL, "api_key": "secret"},
        {"url": SAMPLE_URL, "unexpected": "field"},
        {"challenge_token": "token-without-url"},
        {"url": SAMPLE_URL, "challenge_token": 42},
    ],
)
def test_guest_request_rejects_ai_credentials_and_extra_fields(guest_client, payload: dict[str, object]) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    response = client.post(GUEST_ANALYSIS_PATH, json=payload, headers=_post_headers(bootstrap))

    _error(response, status=422, code="invalid_request")
    assert fetcher.calls == []


def test_guest_body_rejects_duplicate_json_keys_and_oversized_stream(guest_client) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    duplicate = json.dumps({"url": SAMPLE_URL})[:-1] + ',"url":"https://other.example/"}'
    duplicate_response = client.post(GUEST_ANALYSIS_PATH, content=duplicate, headers=headers)
    _error(duplicate_response, status=400, code="invalid_request")

    oversized_response = client.post(
        GUEST_ANALYSIS_PATH,
        content=b"{" + b" " * 4_096,
        headers=headers,
    )
    _error(oversized_response, status=413, code="request_too_large")
    assert fetcher.calls == []


def test_guest_body_rejects_chunked_stream_over_limit_before_fetch(guest_client) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    headers.pop("Content-Type")
    headers["Content-Type"] = "application/json"

    async def send() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url=ORIGIN,
            cookies={COOKIE_NAME: client.cookies.get(COOKIE_NAME)},
        ) as async_client:
            return await async_client.post(
                GUEST_ANALYSIS_PATH,
                headers=headers,
                content=AsyncChunks([b"{" + b" " * 2_048, b" " * 2_048 + b"}"]),
            )

    response = asyncio.run(send())
    _error(response, status=413, code="request_too_large")
    assert fetcher.calls == []


def test_guest_body_requires_json_media_type(guest_client) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    headers["Content-Type"] = "text/plain"
    response = client.post(GUEST_ANALYSIS_PATH, content=SAMPLE_URL, headers=headers)

    _error(response, status=415, code="unsupported_media_type")
    assert fetcher.calls == []


def test_guest_body_receive_deadline_rejects_before_invoking_the_route(monkeypatch: pytest.MonkeyPatch) -> None:
    main = _load_main(monkeypatch, settings={"GUEST_REQUEST_BODY_TIMEOUT_SECONDS": "0.01"})
    route_called = False
    sent: list[dict[str, object]] = []

    async def route(_scope, _receive, _send) -> None:
        nonlocal route_called
        route_called = True

    async def stalled_receive() -> dict[str, object]:
        await asyncio.Event().wait()
        return {"type": "http.request", "body": b"", "more_body": False}

    async def capture_send(message: dict[str, object]) -> None:
        sent.append(message)

    middleware = main.RequestContextMiddleware(
        route,
        max_body_size=4_096,
        path_body_limits={GUEST_ANALYSIS_PATH: 4_096},
        path_receive_timeouts={GUEST_ANALYSIS_PATH: main.settings.guest_request_body_timeout_seconds},
    )
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": GUEST_ANALYSIS_PATH,
        "raw_path": GUEST_ANALYSIS_PATH.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "state": {},
    }
    asyncio.run(middleware(scope, stalled_receive, capture_send))

    assert not route_called
    start = next(message for message in sent if message["type"] == "http.response.start")
    assert start["status"] == 408
    headers = dict(start["headers"])
    assert headers[b"cache-control"] == b"no-store"
    assert b"x-request-id" in headers
    body = next(message["body"] for message in sent if message["type"] == "http.response.body")
    error = json.loads(body)["error"]
    assert set(error) == {"code", "message", "request_id"}
    assert error["code"] == "request_timeout"
    assert error["request_id"] == headers[b"x-request-id"].decode("ascii")


def test_guest_analysis_limits_per_visitor_and_shared_ip_before_fetch(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        visitor_per_minute=1,
        ip_per_minute=5,
    )
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    assert client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers).status_code == 200

    limited = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL},
        headers={**headers, "X-Forwarded-For": "203.0.113.99"},
    )
    _error(limited, status=429, code="rate_limited")
    assert limited.headers.get("retry-after")
    assert len(fetcher.calls) == 1


def test_cookie_rotation_does_not_bypass_ip_or_global_daily_limit(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        visitor_per_minute=5,
        ip_per_minute=1,
        global_per_hour=10,
        global_daily=10,
    )
    first = _bootstrap(client)
    headers = _post_headers(first)
    assert client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers).status_code == 200

    client.cookies.clear()
    second = _bootstrap(client)
    second_headers = _post_headers(second)
    limited = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=second_headers)
    _error(limited, status=429, code="rate_limited")
    assert len(fetcher.calls) == 1


def test_global_concurrency_rejection_happens_before_page_fetch(guest_client) -> None:
    client, fetcher = guest_client
    limits = client.app.state.guest_analysis_limits.with_overrides(max_global_concurrent=1)
    client.app.state.guest_analysis_limits = limits
    held = limits.admit_audit("other-visitor", "testclient")
    bootstrap = _bootstrap(client)

    limited = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL},
        headers=_post_headers(bootstrap),
    )
    _error(limited, status=429, code="rate_limited")
    assert fetcher.calls == []
    held.release()


def test_guest_bot_validation_missing_invalid_replay_and_outage_never_fetch(guest_client) -> None:
    client, fetcher = guest_client
    # Production-like verification settings are enabled, while the provider itself is injected.
    # The verifier is replaced only in this isolated test process; the production branch remains mandatory.
    settings = client.app.state.settings.model_copy(
        update={
            "guest_turnstile_test_mode": False,
            "guest_turnstile_sitekey": "guest-test-public-sitekey",
            "guest_turnstile_secret_key": "guest-test-server-secret",
            "guest_turnstile_expected_hostname": "app.example.test",
            "guest_turnstile_action": "guest_analysis",
        }
    )
    client.app.state.settings = settings
    verifier = FakeTurnstileVerifier(valid=False)
    client.app.state.guest_turnstile_verifier = verifier
    bootstrap = _bootstrap(client)
    assert bootstrap.json()["bot_check_required"] is True
    assert bootstrap.json()["turnstile_sitekey"] == "guest-test-public-sitekey"
    headers = _post_headers(bootstrap)

    missing = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)
    _error(missing, status=403, code="bot_verification_failed")

    rejected = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": TURNSTILE_TOKEN},
        headers=headers,
    )
    _error(rejected, status=403, code="bot_verification_failed")

    replayed = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": TURNSTILE_TOKEN},
        headers=headers,
    )
    _error(replayed, status=403, code="bot_verification_failed")
    assert verifier.calls == 1
    assert fetcher.calls == []

    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        bot_attempts_per_minute=20
    )
    client.app.state.guest_turnstile_verifier = FakeTurnstileVerifier(unavailable=True)
    outage = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": "another-test-only-token"},
        headers=headers,
    )
    _error(outage, status=503, code="bot_verification_unavailable")
    assert fetcher.calls == []


def test_guest_bot_verification_success_allows_one_deterministic_fetch(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.settings = client.app.state.settings.model_copy(update={"guest_turnstile_test_mode": False})
    verifier = FakeTurnstileVerifier(valid=True)
    client.app.state.guest_turnstile_verifier = verifier
    bootstrap = _bootstrap(client)
    response = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": TURNSTILE_TOKEN},
        headers=_post_headers(bootstrap),
    )

    assert response.status_code == 200
    assert verifier.calls == 1
    assert fetcher.calls == [SAMPLE_URL]


def test_guest_bot_attempt_budget_is_enforced_before_body_validation_or_fetch(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.settings = client.app.state.settings.model_copy(update={"guest_turnstile_test_mode": False})
    verifier = FakeTurnstileVerifier(valid=True)
    client.app.state.guest_turnstile_verifier = verifier
    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        bot_attempts_per_minute=1
    )
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)

    first = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)
    _error(first, status=403, code="bot_verification_failed")
    second = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": TURNSTILE_TOKEN},
        headers=headers,
    )
    _error(second, status=429, code="rate_limited")
    assert second.headers.get("retry-after") == "60"
    assert verifier.calls == 0
    assert fetcher.calls == []


def test_guest_analysis_timeout_is_bounded_and_releases_slot(guest_client) -> None:
    client, _fetcher = guest_client
    started = asyncio.Event()

    class HangingFetcher(FakeSafeFetcher):
        async def fetch_url(self, url: str, *, request_id: str | None = None) -> FetchResult:
            self.calls.append(url)
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("Timed-out fetch unexpectedly resumed")

    hanging = HangingFetcher()
    client.app.state.safe_fetcher = hanging
    client.app.state.settings = client.app.state.settings.model_copy(update={"guest_analysis_timeout_seconds": 0.01})
    bootstrap = _bootstrap(client)
    csrf = bootstrap.json()["csrf_token"]
    cookie = client.cookies.get(COOKIE_NAME)
    assert isinstance(cookie, str)
    headers = {"Origin": ORIGIN, "Content-Type": "application/json", CSRF_HEADER: csrf}

    async def send() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url=ORIGIN,
            cookies={COOKIE_NAME: cookie},
        ) as async_client:
            return await async_client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)

    response = asyncio.run(send())
    _error(response, status=502, code="resource_unavailable")
    assert started.is_set()
    assert client.app.state.guest_analysis_limits.active_total == 0


def test_guest_response_size_limit_is_applied_after_safe_analysis(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.settings = client.app.state.settings.model_copy(update={"guest_response_size_bytes": 1_024})
    bootstrap = _bootstrap(client)
    response = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL},
        headers=_post_headers(bootstrap),
    )

    _error(response, status=502, code="resource_unavailable")
    assert len(fetcher.calls) == 1
    assert client.app.state.guest_analysis_limits.active_total == 0


def test_guest_challenge_token_is_bounded_before_provider_request(guest_client) -> None:
    client, fetcher = guest_client
    client.app.state.settings = client.app.state.settings.model_copy(update={"guest_turnstile_test_mode": False})
    client.app.state.guest_turnstile_verifier = FakeTurnstileVerifier()
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)

    oversized = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": SAMPLE_URL, "challenge_token": "x" * 2_049},
        headers=headers,
    )
    _error(oversized, status=422, code="invalid_request")
    assert client.app.state.guest_turnstile_verifier.calls == 0
    assert fetcher.calls == []


def test_guest_fetch_failure_is_sanitized_and_releases_concurrency(
    guest_client, caplog: pytest.LogCaptureFixture
) -> None:
    client, fetcher = guest_client
    client.app.state.guest_analysis_limits = client.app.state.guest_analysis_limits.with_overrides(
        max_global_concurrent=1,
        max_visitor_concurrent=1,
    )
    fetcher.exception = RuntimeError(f"private failure for {SAMPLE_URL}")
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    caplog.set_level(logging.INFO)

    failed = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)
    _error(failed, status=500, code="internal_server_error")
    _assert_absent(SAMPLE_URL, caplog.text, "Audited URL appeared in application logs")

    fetcher.exception = None
    succeeded = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)
    assert succeeded.status_code == 200
    assert client.app.state.guest_analysis_limits.active_total == 0


def test_guest_cancellation_releases_concurrency_slot(guest_client) -> None:
    client, fetcher = guest_client
    started = asyncio.Event()

    class BlockingFetcher(FakeSafeFetcher):
        async def fetch_url(self, url: str, *, request_id: str | None = None) -> FetchResult:
            self.calls.append(url)
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("Cancelled fetch unexpectedly resumed")

    blocking = BlockingFetcher()
    client.app.state.safe_fetcher = blocking
    bootstrap = _bootstrap(client)
    csrf = bootstrap.json()["csrf_token"]
    cookie = client.cookies.get(COOKIE_NAME)
    assert isinstance(cookie, str)
    headers = {"Origin": ORIGIN, "Content-Type": "application/json", CSRF_HEADER: csrf}

    async def cancel_request() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url=ORIGIN,
            cookies={COOKIE_NAME: cookie},
        ) as async_client:
            task = asyncio.create_task(
                async_client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)
            )
            await asyncio.wait_for(started.wait(), timeout=2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(cancel_request())
    assert blocking.calls == [SAMPLE_URL]
    assert client.app.state.guest_analysis_limits.active_total == 0


def test_guest_logs_and_public_errors_exclude_url_cookie_csrf_and_provider_secrets(
    guest_client,
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, fetcher = guest_client
    caplog.set_level(logging.INFO)
    bootstrap = _bootstrap(client)
    csrf = bootstrap.json()["csrf_token"]
    cookie = client.cookies.get(COOKIE_NAME)
    if not isinstance(cookie, str) or not cookie:
        raise AssertionError("Guest cookie was not set")
    denied = client.post(
        GUEST_ANALYSIS_PATH,
        json={"url": "https://127.0.0.1/private?do-not-log=secret"},
        headers=_post_headers(bootstrap),
    )

    _error(denied, status=422, code="destination_blocked")
    for private_value in (SAMPLE_URL, cookie, csrf, TURNSTILE_SECRET, TURNSTILE_TOKEN):
        _assert_absent(private_value, caplog.text, "Sensitive guest request value appeared in logs")
        _assert_absent(private_value, denied.text, "Sensitive guest request value appeared in error response")
    _assert_absent(TURNSTILE_SECRET, bootstrap.text, "Provider secret appeared in public session response")
    assert fetcher.calls == []


def test_guest_cors_namespace_rejects_configured_extension_origin(guest_client) -> None:
    client, _fetcher = guest_client
    response = client.options(
        GUEST_ANALYSIS_PATH,
        headers={
            "Origin": "chrome-extension://test-extension-id",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )

    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_guest_session_cookie_does_not_authenticate_legacy_or_browser_routes(guest_client) -> None:
    client, _fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)

    legacy = client.post("/analyse-url", json={"url": SAMPLE_URL}, headers=headers)
    assert legacy.status_code == 401
    browser = client.get("/api/browser/v1/session", headers={"Origin": ORIGIN})
    assert browser.status_code == 404


def test_browser_cookie_alone_does_not_authenticate_guest_route(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    password = "guest isolation test password"
    hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    account_file = tmp_path / "accounts.json"
    account_file.write_text(
        json.dumps({"version": 1, "users": [{"username": "alice", "password_hash": hasher.hash(password)}]}),
        encoding="utf-8",
    )
    if os.name == "posix":
        account_file.chmod(0o600)
    main = _load_main(monkeypatch, browser_auth=True, accounts_file=account_file)
    with TestClient(main.app, base_url=ORIGIN) as client:
        login = client.post(
            "/api/browser/v1/session/login",
            json={"username": "alice", "password": password},
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        )
        assert login.status_code == 200
        response = client.post(
            GUEST_ANALYSIS_PATH,
            json={"url": SAMPLE_URL},
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        )
        _error(response, status=401, code="guest_session_required")
    get_settings.cache_clear()


def test_guest_session_bootstrap_is_process_local_and_does_not_store_audit_data(guest_client) -> None:
    client, fetcher = guest_client
    bootstrap = _bootstrap(client)
    headers = _post_headers(bootstrap)
    response = client.post(GUEST_ANALYSIS_PATH, json={"url": SAMPLE_URL}, headers=headers)

    assert response.status_code == 200
    runtime_repr = repr(client.app.state.guest_sessions._sessions)
    limits_repr = repr(client.app.state.guest_analysis_limits.__dict__)
    _assert_absent(SAMPLE_URL, runtime_repr, "Guest session storage retained the audited URL")
    _assert_absent(SAMPLE_URL, limits_repr, "Guest limiter retained the audited URL")
    assert len(fetcher.calls) == 1
