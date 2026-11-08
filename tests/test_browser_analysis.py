from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import pytest
from argon2 import PasswordHasher, Type
from fastapi.testclient import TestClient

from backend.app.security.browser_analysis_limits import (
    BrowserAnalysisLimitExceeded,
    BrowserAnalysisLimits,
)
from backend.app.security.errors import FetchErrorCode
from backend.app.security.fetcher import FetchResult
from backend.app.seo.models import SEOAnalysis


ORIGIN = "https://app.example.test"
EXTENSION_ORIGIN = "chrome-extension://test-extension-id"
ANALYSE_URL = "/api/browser/v1/analyse-url"
SESSION_URL = "/api/browser/v1/session"
COOKIE_NAME = "__Host-seo_sensei_session"
USERNAME = "alice"
PASSWORD = "browser-analysis test password"
BEARER_TOKEN = "browser-analysis-test-bearer"
SAMPLE_URL = "https://example.test/guides/solar/?source=fixture"
HTML = b"""<!doctype html><html lang="en"><head>
<title>Solar installation guide</title><meta name="description" content="Plan a solar installation.">
<link rel="canonical" href="https://example.test/guides/solar/">
</head><body><h1>Solar installation guide</h1><p>Choose a system and plan an installation.</p>
<img src="panel.jpg" alt="Solar panel"></body></html>"""


@pytest.fixture(scope="module")
def accounts_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("browser-analysis") / "accounts.json"
    hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    path.write_text(
        json.dumps({"version": 1, "users": [{"username": USERNAME, "password_hash": hasher.hash(PASSWORD)}]}),
        encoding="utf-8",
    )
    if os.name == "posix":
        path.chmod(0o600)
    return path


class FakeSafeFetcher:
    """Offline fetcher double; the production orchestration and SEO engine still run."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []
        self.error: FetchErrorCode | None = None
        self.raise_error: Exception | None = None
        self.closed = False

    async def fetch_url(self, url: str, *, request_id: str | None = None) -> FetchResult:
        self.calls.append((url, request_id))
        if self.raise_error is not None:
            raise self.raise_error
        if self.error is not None:
            return FetchResult(requested_url=url, error=self.error)
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
        self.closed = True


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
    account_file: Path,
    *,
    max_url_length: int = 2_048,
    trusted_proxy_networks: str = "",
):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", BEARER_TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("BROWSER_AUTH_ENABLED", "true")
    monkeypatch.setenv("BROWSER_AUTH_ACCOUNTS_FILE", str(account_file))
    monkeypatch.setenv("BROWSER_APP_ORIGIN", ORIGIN)
    monkeypatch.setenv("ALLOWED_CORS_ORIGINS", f"https://legacy.example,{EXTENSION_ORIGIN}")
    monkeypatch.setenv("CORS_ALLOW_CREDENTIALS", "true")
    monkeypatch.setenv("TRUSTED_PROXY_NETWORKS", trusted_proxy_networks)
    monkeypatch.setenv("MAX_URL_LENGTH", str(max_url_length))

    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    return importlib.reload(main)


@pytest.fixture()
def analysis_harness(monkeypatch: pytest.MonkeyPatch, accounts_file: Path):
    main = _load_main(monkeypatch, accounts_file)
    with TestClient(main.app, base_url=ORIGIN) as client:
        runtime = client.app.state.browser_auth
        session_id, session = runtime.sessions.create(USERNAME)
        fetcher = FakeSafeFetcher()
        client.app.state.safe_fetcher = fetcher
        headers = {
            "Origin": ORIGIN,
            "Cookie": f"{COOKIE_NAME}={session_id}",
            "X-CSRF-Token": session.csrf_token,
            "Content-Type": "application/json",
        }
        yield client, runtime, fetcher, headers, session_id, session


def _post(client: TestClient, headers: dict[str, str], payload: object | None = None, *, content: bytes | None = None):
    if content is None:
        return client.post(ANALYSE_URL, json=payload, headers=headers)
    return client.post(ANALYSE_URL, content=content, headers=headers)


def _chunked_post(client: TestClient, headers: dict[str, str], chunks: list[bytes]) -> httpx.Response:
    async def send() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url=ORIGIN,
        ) as async_client:
            return await async_client.post(ANALYSE_URL, headers=headers, content=AsyncChunks(chunks))

    return asyncio.run(send())


def test_browser_analysis_route_is_absent_when_authentication_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", BEARER_TOKEN)
    monkeypatch.setenv("BROWSER_AUTH_ENABLED", "false")
    monkeypatch.delenv("BROWSER_AUTH_ACCOUNTS_FILE", raising=False)
    monkeypatch.delenv("BROWSER_APP_ORIGIN", raising=False)
    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        assert client.post(ANALYSE_URL, json={"url": SAMPLE_URL}).status_code == 404
        assert ANALYSE_URL not in client.get("/openapi.json").json()["paths"]


def test_openapi_exposes_url_only_request_and_seo_analysis_response(analysis_harness) -> None:
    client = analysis_harness[0]
    operation = client.get("/openapi.json").json()["paths"][ANALYSE_URL]["post"]
    body_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert body_schema["additionalProperties"] is False
    assert body_schema["required"] == ["url"]
    assert body_schema["properties"]["url"]["maxLength"] == 2_048
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SEOAnalysis")


def test_valid_session_and_csrf_returns_deterministic_typed_result_without_ai(analysis_harness) -> None:
    client, _, fetcher, headers, _, _ = analysis_harness

    class GeminiMustNotRun:
        async def recommendations(self, *args: object, **kwargs: object) -> None:
            raise AssertionError("Gemini must never be called by browser analysis")

        async def aclose(self) -> None:
            return None

    client.app.state.gemini_service = GeminiMustNotRun()
    first = _post(client, headers, {"url": SAMPLE_URL})
    second = _post(client, headers, {"url": SAMPLE_URL})

    assert first.status_code == second.status_code == 200
    parsed = SEOAnalysis.model_validate(first.json())
    assert parsed.requested_url == SAMPLE_URL
    assert parsed.metadata.title == "Solar installation guide"
    assert parsed.checks
    assert "ai_recommendations" not in first.json()
    assert first.json() == second.json()
    assert len(fetcher.calls) == 2


def test_request_id_is_forwarded_to_the_existing_analysis_pipeline(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    headers = {**headers, "X-Request-ID": "browser-analysis-id-1"}
    response = _post(client, headers, {"url": SAMPLE_URL})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "browser-analysis-id-1"
    assert fetcher.calls == [(SAMPLE_URL, "browser-analysis-id-1")]


@pytest.mark.parametrize(
    ("extra_headers", "expected_code"),
    [
        ({"Origin": "https://attacker.example"}, "origin_rejected"),
        ({"Origin": "null"}, "origin_rejected"),
        ({"Origin": "http://app.example.test"}, "origin_rejected"),
        ({"Origin": "https://app.example.test:444"}, "origin_rejected"),
        ({"Origin": "https://app.example.test.evil"}, "origin_rejected"),
        ({"Origin": EXTENSION_ORIGIN}, "origin_rejected"),
        ({"X-CSRF-Token": "wrong-token"}, "csrf_rejected"),
        ({"X-CSRF-Token": ""}, "csrf_rejected"),
    ],
)
def test_analysis_rejects_wrong_origin_or_csrf_before_fetch(
    analysis_harness, extra_headers: dict[str, str], expected_code: str
) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    response = _post(client, {**headers, **extra_headers}, {"url": SAMPLE_URL})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == expected_code
    assert fetcher.calls == []


def test_missing_origin_and_duplicate_origin_are_rejected(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    no_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    response = _post(client, no_origin, {"url": SAMPLE_URL})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_rejected"

    duplicate = client.build_request(
        "POST",
        ANALYSE_URL,
        json={"url": SAMPLE_URL},
        headers=[
            ("Origin", ORIGIN),
            ("Origin", ORIGIN),
            ("Cookie", headers["Cookie"]),
            ("X-CSRF-Token", headers["X-CSRF-Token"]),
        ],
    )
    duplicate_response = client.send(duplicate)
    assert duplicate_response.status_code == 403
    assert duplicate_response.json()["error"]["code"] == "origin_rejected"
    assert fetcher.calls == []


def test_anonymous_expired_and_revoked_sessions_are_rejected(analysis_harness) -> None:
    client, runtime, fetcher, headers, session_id, _ = analysis_harness
    anonymous = client.post(ANALYSE_URL, json={"url": SAMPLE_URL}, headers={"Origin": ORIGIN})
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "auth_required"

    assert runtime.sessions.revoke(session_id)
    revoked = _post(client, headers, {"url": SAMPLE_URL})
    assert revoked.status_code == 401
    assert revoked.json()["error"]["code"] == "auth_required"
    assert fetcher.calls == []


def test_browser_session_does_not_authenticate_legacy_routes_and_bearer_does_not_authenticate_browser(
    analysis_harness,
) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    legacy_analysis = client.post("/analyse-url", json={"url": SAMPLE_URL}, headers=headers)
    legacy_article = client.post(
        "/generate-article",
        json={"topic": "Solar", "keywords": [], "tone": "professional"},
        headers=headers,
    )
    legacy_boost = client.post("/boost-seo", json={"url": SAMPLE_URL}, headers=headers)
    assert [legacy_analysis.status_code, legacy_article.status_code, legacy_boost.status_code] == [401, 401, 401]

    bearer_only = client.post(
        ANALYSE_URL,
        json={"url": SAMPLE_URL},
        headers={"Origin": ORIGIN, "Authorization": f"Bearer {BEARER_TOKEN}", "X-CSRF-Token": "unused"},
    )
    assert bearer_only.status_code == 401
    assert bearer_only.json()["error"]["code"] == "auth_required"
    assert fetcher.calls == []


def test_health_readiness_and_legacy_bearer_contract_remain_available(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200
    legacy = client.post(
        "/analyse-url",
        json={"url": SAMPLE_URL, "include_ai_recommendations": False},
        headers={"Authorization": f"Bearer {BEARER_TOKEN}"},
    )
    assert legacy.status_code == 200
    assert fetcher.calls == [(SAMPLE_URL, None)]


@pytest.mark.parametrize(
    ("payload", "status", "code"),
    [
        ({"url": SAMPLE_URL, "include_ai_recommendations": True}, 422, "invalid_request"),
        ({"url": "ftp://example.test/file"}, 422, "unsupported_url"),
        ({"url": "not a URL"}, 422, "invalid_url"),
        ({"url": "https://user:password@example.test/"}, 422, "invalid_url"),
        ({"url": "https://example.test/" + "x" * 2_050}, 422, "invalid_request"),
    ],
)
def test_url_validation_is_strict_and_does_not_call_fetcher(analysis_harness, payload, status: int, code: str) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    response = _post(client, headers, payload)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert fetcher.calls == []


def test_configured_url_length_is_enforced_by_existing_url_policy(
    monkeypatch: pytest.MonkeyPatch, accounts_file: Path
) -> None:
    main = _load_main(monkeypatch, accounts_file, max_url_length=256)
    with TestClient(main.app, base_url=ORIGIN) as client:
        runtime = client.app.state.browser_auth
        sid, session = runtime.sessions.create(USERNAME)
        fetcher = FakeSafeFetcher()
        client.app.state.safe_fetcher = fetcher
        headers = {
            "Origin": ORIGIN,
            "Cookie": f"{COOKIE_NAME}={sid}",
            "X-CSRF-Token": session.csrf_token,
        }
        url = "https://example.test/" + "a" * 280
        response = client.post(ANALYSE_URL, json={"url": url}, headers=headers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_url"
    assert fetcher.calls == []


def test_malformed_json_is_bounded_and_sanitized(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    response = _post(client, headers, content=b'{"url":')
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    duplicate = _post(client, headers, content=b'{"url":"https://example.test/","url":"https://evil.test/"}')
    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "invalid_request"
    assert fetcher.calls == []


def test_unsupported_content_type_and_declared_oversize_have_stable_errors(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    no_type = {key: value for key, value in headers.items() if key.lower() != "content-type"}
    wrong_type = _post(client, {**no_type, "Content-Type": "text/plain"}, content=b'{"url":"https://example.test/"}')
    assert wrong_type.status_code == 415
    assert wrong_type.json()["error"]["code"] == "unsupported_media_type"

    oversized = _post(client, headers, content=b" " * 4_097)
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "request_too_large"
    assert fetcher.calls == []


def test_global_declared_size_guard_preserves_browser_analysis_error_code(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    request = client.build_request(
        "POST",
        ANALYSE_URL,
        content=b'{"url":"https://example.test/"}',
        headers=[
            ("Origin", ORIGIN),
            ("Cookie", headers["Cookie"]),
            ("X-CSRF-Token", headers["X-CSRF-Token"]),
            ("Content-Type", "application/json"),
            ("Content-Length", "1000001"),
        ],
    )
    response = client.send(request)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert fetcher.calls == []


def test_body_size_limit_accepts_exact_4k_and_rejects_false_content_lengths(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    body = json.dumps({"url": SAMPLE_URL}, separators=(",", ":")).encode()
    exact = body + b" " * (4_096 - len(body))
    response = _post(client, headers, content=exact)
    assert response.status_code == 200
    assert fetcher.calls
    fetcher.calls.clear()

    too_small_length = client.post(
        ANALYSE_URL,
        content=body,
        headers={**headers, "Content-Length": str(len(body) - 1)},
    )
    too_large_length = client.post(
        ANALYSE_URL,
        content=body,
        headers={**headers, "Content-Length": str(len(body) + 1)},
    )
    assert too_small_length.status_code == too_large_length.status_code == 400
    assert too_small_length.json()["error"]["code"] == "invalid_request"
    assert too_large_length.json()["error"]["code"] == "invalid_request"
    assert fetcher.calls == []


def test_missing_content_length_and_chunked_uploads_are_counted_from_stream(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    body = json.dumps({"url": SAMPLE_URL}, separators=(",", ":")).encode()
    response = _chunked_post(client, headers, [body[:8], body[8:]])
    assert response.status_code == 200
    assert len(fetcher.calls) == 1

    fetcher.calls.clear()
    oversized = _chunked_post(client, headers, [b" " * 3_000, b" " * 1_097])
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "request_too_large"
    assert fetcher.calls == []


def test_invalid_framing_is_rejected(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    duplicate_length = client.build_request(
        "POST",
        ANALYSE_URL,
        content=b'{"url":"https://example.test/"}',
        headers=[
            ("Origin", ORIGIN),
            ("Cookie", headers["Cookie"]),
            ("X-CSRF-Token", headers["X-CSRF-Token"]),
            ("Content-Type", "application/json"),
            ("Content-Length", "10"),
            ("Content-Length", "20"),
        ],
    )
    response = client.send(duplicate_length)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert fetcher.calls == []


@pytest.mark.parametrize(
    ("fetch_code", "status", "public_code", "public_message"),
    [
        (FetchErrorCode.INVALID_URL, 422, "invalid_url", "The requested URL is invalid."),
        (FetchErrorCode.CREDENTIALS_NOT_ALLOWED, 422, "invalid_url", "The requested URL is invalid."),
        (FetchErrorCode.UNSUPPORTED_SCHEME, 422, "unsupported_url", "The requested URL is not supported."),
        (
            FetchErrorCode.BLOCKED_DESTINATION,
            422,
            "destination_blocked",
            "The requested destination is not permitted.",
        ),
        (
            FetchErrorCode.UNSAFE_REDIRECT,
            422,
            "destination_blocked",
            "The requested destination is not permitted.",
        ),
        (
            FetchErrorCode.DNS_RESOLUTION_FAILED,
            502,
            "resource_unavailable",
            "The requested page could not be analyzed.",
        ),
        (FetchErrorCode.CONNECTION_FAILED, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (FetchErrorCode.CONNECTION_TIMEOUT, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (FetchErrorCode.READ_TIMEOUT, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (FetchErrorCode.OVERALL_TIMEOUT, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (
            FetchErrorCode.REDIRECT_LIMIT_EXCEEDED,
            502,
            "resource_unavailable",
            "The requested page could not be analyzed.",
        ),
        (
            FetchErrorCode.UNSUPPORTED_CONTENT_TYPE,
            502,
            "resource_unavailable",
            "The requested page could not be analyzed.",
        ),
        (FetchErrorCode.RESPONSE_TOO_LARGE, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (FetchErrorCode.HTTP_ERROR, 502, "resource_unavailable", "The requested page could not be analyzed."),
        (
            FetchErrorCode.UNEXPECTED_FETCH_ERROR,
            502,
            "resource_unavailable",
            "The requested page could not be analyzed.",
        ),
    ],
)
def test_fetch_failures_map_to_safe_stable_errors(
    analysis_harness,
    fetch_code: FetchErrorCode,
    status: int,
    public_code: str,
    public_message: str,
) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    fetcher.error = fetch_code
    response = _post(client, headers, {"url": SAMPLE_URL})
    assert response.status_code == status
    assert response.json()["error"]["code"] == public_code
    assert response.json()["error"]["message"] == public_message
    assert SAMPLE_URL not in response.text


def test_malformed_analysis_contract_returns_safe_server_error(
    analysis_harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.app.api.browser_analysis as browser_analysis

    async def malformed_result(*args: object, **kwargs: object) -> dict[str, Any]:
        return {"status": "success", "not_a_schema_field": "secret analyzer detail"}

    monkeypatch.setattr(browser_analysis, "get_full_seo_analysis_for_url", malformed_result)
    client, _, fetcher, headers, *_ = analysis_harness
    response = _post(client, headers, {"url": SAMPLE_URL})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_server_error"
    assert "secret analyzer detail" not in response.text
    assert fetcher.calls == []


def test_pipeline_exception_does_not_log_url_or_secret_values(
    analysis_harness, caplog: pytest.LogCaptureFixture
) -> None:
    client, _, fetcher, headers, session_id, session = analysis_harness
    private_url = "https://example.test/path?private=query-value"
    fetcher.raise_error = RuntimeError(f"secret failure at {private_url}")
    caplog.set_level(logging.INFO)
    response = _post(client, headers, {"url": private_url})
    text = caplog.text
    assert response.status_code == 500
    assert private_url not in text
    assert "query-value" not in text
    assert session_id not in text
    assert session.csrf_token not in text
    assert BEARER_TOKEN not in text


def test_analysis_limits_enforce_user_ip_global_windows_and_retry_after() -> None:
    now = [100.0]
    per_user = BrowserAnalysisLimits(
        user_per_minute=2,
        user_per_hour=10,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    for _ in range(2):
        per_user.admit(USERNAME, "192.0.2.1").release()
    with pytest.raises(BrowserAnalysisLimitExceeded) as user_rejected:
        per_user.admit(USERNAME, "192.0.2.2")
    assert user_rejected.value.retry_after >= 1

    per_ip = BrowserAnalysisLimits(
        user_per_minute=10,
        user_per_hour=20,
        ip_per_minute=2,
        ip_per_hour=10,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    for user in ("alice", "bob"):
        per_ip.admit(user, "192.0.2.3").release()
    with pytest.raises(BrowserAnalysisLimitExceeded):
        per_ip.admit("carol", "192.0.2.3")

    global_limiter = BrowserAnalysisLimits(
        user_per_minute=10,
        user_per_hour=20,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=2,
        global_per_hour=10,
        clock=lambda: now[0],
    )
    for index in range(2):
        global_limiter.admit(f"user-{index}", f"192.0.2.{index + 10}").release()
    with pytest.raises(BrowserAnalysisLimitExceeded):
        global_limiter.admit("another-user", "192.0.2.20")
    now[0] = 160.0
    assert global_limiter.admit("another-user", "192.0.2.20")


def test_retry_after_when_only_minute_quota_is_exhausted_and_rejected_request_is_not_counted() -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(
        user_per_minute=1,
        user_per_hour=2,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    limits.admit(USERNAME, "192.0.2.1").release()

    now[0] = 1.0
    with pytest.raises(BrowserAnalysisLimitExceeded) as rejected:
        limits.admit(USERNAME, "192.0.2.1")
    assert rejected.value.retry_after == 59

    # The t=1 rejection did not consume another event: the t=0 event expires
    # from the minute window exactly at t=60, while the hourly quota has room.
    now[0] = 60.0
    limits.admit(USERNAME, "192.0.2.1").release()


def test_retry_after_when_only_hour_quota_is_exhausted() -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(
        user_per_minute=10,
        user_per_hour=1,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    limits.admit(USERNAME, "192.0.2.1").release()

    now[0] = 61.0
    with pytest.raises(BrowserAnalysisLimitExceeded) as rejected:
        limits.admit(USERNAME, "192.0.2.1")
    assert rejected.value.retry_after == 3_539


def test_both_windows_use_the_longer_retry_and_admit_at_exact_hour_boundary() -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(
        user_per_minute=1,
        user_per_hour=1,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    limits.admit(USERNAME, "192.0.2.1").release()

    now[0] = 1.0
    with pytest.raises(BrowserAnalysisLimitExceeded) as rejected:
        limits.admit(USERNAME, "192.0.2.1")
    assert rejected.value.retry_after == 3_599

    now[0] = 3_600.0
    limits.admit(USERNAME, "192.0.2.1").release()


@pytest.mark.parametrize(
    ("overrides", "first_identity", "second_identity"),
    [
        (
            {"user_per_minute": 1, "user_per_hour": 10},
            ("alice", "192.0.2.1"),
            ("alice", "192.0.2.2"),
        ),
        (
            {"ip_per_minute": 1, "ip_per_hour": 10},
            ("alice", "192.0.2.1"),
            ("bob", "192.0.2.1"),
        ),
        (
            {"global_per_minute": 1, "global_per_hour": 10},
            ("alice", "192.0.2.1"),
            ("bob", "192.0.2.2"),
        ),
    ],
)
def test_retry_after_is_reported_for_user_ip_and_global_quota_identities(
    overrides: dict[str, int], first_identity: tuple[str, str], second_identity: tuple[str, str]
) -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(**overrides, clock=lambda: now[0])
    limits.admit(*first_identity).release()

    now[0] = 1.0
    with pytest.raises(BrowserAnalysisLimitExceeded) as rejected:
        limits.admit(*second_identity)
    assert rejected.value.retry_after == 59


def test_retry_after_uses_maximum_across_user_ip_and_global_windows() -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(
        user_per_minute=10,
        user_per_hour=1,
        ip_per_minute=1,
        ip_per_hour=10,
        global_per_minute=1,
        global_per_hour=10,
        clock=lambda: now[0],
    )
    limits.admit("alice", "192.0.2.1").release()

    # At t=100 the minute window is clear globally, so another user and IP
    # can consume a new event. That event then exhausts the IP and global
    # minute windows while Alice's earlier event still exhausts her hour.
    now[0] = 100.0
    limits.admit("bob", "192.0.2.2").release()
    now[0] = 101.0
    with pytest.raises(BrowserAnalysisLimitExceeded) as rejected:
        limits.admit("alice", "192.0.2.2")
    assert rejected.value.retry_after == 3_499


def test_analysis_api_returns_computed_retry_after_and_recovers_at_hour_boundary(analysis_harness) -> None:
    client, _, fetcher, headers, *_ = analysis_harness
    now = [0.0]
    client.app.state.browser_analysis_limits = BrowserAnalysisLimits(
        user_per_minute=1,
        user_per_hour=1,
        clock=lambda: now[0],
    )

    first = _post(client, headers, {"url": SAMPLE_URL})
    assert first.status_code == 200

    now[0] = 1.0
    rejected = _post(client, headers, {"url": SAMPLE_URL})
    assert rejected.status_code == 429
    assert rejected.json()["error"]["code"] == "rate_limited"
    assert rejected.headers["retry-after"] == "3599"
    assert len(fetcher.calls) == 1

    now[0] = 3_600.0
    recovered = _post(client, headers, {"url": SAMPLE_URL})
    assert recovered.status_code == 200
    assert len(fetcher.calls) == 2


def test_hourly_budget_and_bounded_identity_storage() -> None:
    now = [0.0]
    limits = BrowserAnalysisLimits(
        user_per_minute=10,
        user_per_hour=2,
        ip_per_minute=10,
        ip_per_hour=10,
        global_per_minute=10,
        global_per_hour=10,
        max_user_keys=1,
        max_client_ip_keys=1,
        clock=lambda: now[0],
    )
    limits.admit(USERNAME, "192.0.2.1").release()
    limits.admit(USERNAME, "192.0.2.1").release()
    with pytest.raises(BrowserAnalysisLimitExceeded) as hourly:
        limits.admit(USERNAME, "192.0.2.1")
    assert hourly.value.retry_after == 3_600
    with pytest.raises(BrowserAnalysisLimitExceeded):
        limits.admit("bob", "192.0.2.2")
    assert limits.tracked_user_keys == limits.tracked_client_ip_keys == 1
    now[0] = 3_601.0
    limits.admit("bob", "192.0.2.2").release()
    assert limits.tracked_user_keys == limits.tracked_client_ip_keys == 1


def test_concurrency_admission_is_atomic_and_never_queues() -> None:
    limits = BrowserAnalysisLimits(
        user_per_minute=100,
        user_per_hour=200,
        ip_per_minute=100,
        ip_per_hour=200,
        global_per_minute=100,
        global_per_hour=200,
        max_global_concurrent=2,
        max_user_concurrent=1,
    )
    start = threading.Barrier(16)

    def reserve(index: int):
        start.wait()
        try:
            return limits.admit(f"user-{index}", f"192.0.2.{index + 1}")
        except BrowserAnalysisLimitExceeded:
            return None

    with ThreadPoolExecutor(max_workers=16) as pool:
        leases = list(pool.map(reserve, range(16)))
    admitted = [lease for lease in leases if lease is not None]
    assert len(admitted) == limits.active_total == 2
    for lease in admitted:
        lease.release()
    assert limits.active_total == 0


def test_same_user_concurrency_and_lease_release_on_exception_or_cancellation() -> None:
    limits = BrowserAnalysisLimits(
        user_per_minute=20,
        user_per_hour=40,
        ip_per_minute=20,
        ip_per_hour=40,
        global_per_minute=20,
        global_per_hour=40,
    )
    with pytest.raises(BrowserAnalysisLimitExceeded):
        with limits.admit(USERNAME, "192.0.2.1"):
            limits.admit(USERNAME, "192.0.2.2")
            raise AssertionError("the second same-user reservation should be denied")
    assert limits.active_total == 0

    started = asyncio.Event()

    async def cancellable_work() -> None:
        with limits.admit("bob", "192.0.2.3"):
            started.set()
            await asyncio.Future()

    async def cancel_work() -> None:
        task = asyncio.create_task(cancellable_work())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_work())
    assert limits.active_total == 0


def test_cancelled_before_work_rolls_back_budget_reservation() -> None:
    limits = BrowserAnalysisLimits(
        user_per_minute=1,
        user_per_hour=1,
        ip_per_minute=1,
        ip_per_hour=1,
        global_per_minute=1,
        global_per_hour=1,
    )
    lease = limits.admit(USERNAME, "192.0.2.1")
    lease.cancel()
    lease.release()
    assert limits.active_total == 0
    assert limits.admit(USERNAME, "192.0.2.1")


def test_session_activity_refreshes_only_after_admission_and_never_extends_absolute_expiry(
    analysis_harness,
) -> None:
    client, runtime, fetcher, headers, session_id, session = analysis_harness
    now = [session.last_activity_at]
    runtime.sessions._clock = lambda: now[0]
    runtime.sessions._idle_timeout = 60
    runtime.sessions._absolute_lifetime = 300
    now[0] += 59.0
    success = _post(client, headers, {"url": SAMPLE_URL})
    assert success.status_code == 200
    refreshed = runtime.sessions.get(session_id)
    assert refreshed is not None and refreshed.last_activity_at == now[0]
    absolute_expiry = refreshed.absolute_expires_at
    assert absolute_expiry == session.absolute_expires_at
    now[0] = absolute_expiry
    expired = _post(client, headers, {"url": SAMPLE_URL})
    assert expired.status_code == 401
    assert len(fetcher.calls) == 1


def test_invalid_input_csrf_and_quota_denials_do_not_refresh_session(analysis_harness) -> None:
    client, runtime, _, headers, session_id, session = analysis_harness
    now = [session.last_activity_at + 10]
    runtime.sessions._clock = lambda: now[0]
    runtime.sessions._idle_timeout = 60
    runtime.sessions._absolute_lifetime = 300
    invalid = _post(client, headers, {"url": "ftp://example.test/file"})
    assert invalid.status_code == 422
    assert runtime.sessions.get(session_id).last_activity_at == session.last_activity_at

    bad_csrf = _post(client, {**headers, "X-CSRF-Token": "bad"}, {"url": SAMPLE_URL})
    assert bad_csrf.status_code == 403
    assert runtime.sessions.get(session_id).last_activity_at == session.last_activity_at

    limits = BrowserAnalysisLimits(
        user_per_minute=1,
        user_per_hour=10,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=10,
        global_per_hour=20,
        clock=lambda: now[0],
    )
    client.app.state.browser_analysis_limits = limits
    first = _post(client, headers, {"url": SAMPLE_URL})
    assert first.status_code == 200
    refreshed = runtime.sessions.get(session_id)
    assert refreshed is not None and refreshed.last_activity_at == now[0]
    now[0] += 10
    limited = _post(client, headers, {"url": SAMPLE_URL})
    assert limited.status_code == 429
    assert runtime.sessions.get(session_id).last_activity_at == refreshed.last_activity_at
    assert len(client.app.state.safe_fetcher.calls) == 1


def test_capacity_denial_does_not_refresh_session(analysis_harness) -> None:
    client, runtime, fetcher, headers, session_id, session = analysis_harness
    now = [session.last_activity_at + 10]
    runtime.sessions._clock = lambda: now[0]
    runtime.sessions._idle_timeout = 60
    runtime.sessions._absolute_lifetime = 300
    limits = BrowserAnalysisLimits(max_global_concurrent=1)
    occupying_lease = limits.admit("other-user", "192.0.2.2")
    client.app.state.browser_analysis_limits = limits
    response = _post(client, headers, {"url": SAMPLE_URL})
    occupying_lease.release()
    assert response.status_code == 429
    assert runtime.sessions.get(session_id).last_activity_at == session.last_activity_at
    assert fetcher.calls == []


def test_session_expiry_race_rolls_back_admission_without_resurrection(analysis_harness) -> None:
    client, runtime, fetcher, headers, session_id, session = analysis_harness
    now = [session.last_activity_at]
    runtime.sessions._clock = lambda: now[0]
    runtime.sessions._idle_timeout = 60
    runtime.sessions._absolute_lifetime = 300
    limits = BrowserAnalysisLimits()
    original_admit = limits.admit

    def expire_after_admission(username: str, address: str):
        lease = original_admit(username, address)
        now[0] = session.last_activity_at + 60
        return lease

    limits.admit = expire_after_admission  # type: ignore[method-assign]
    client.app.state.browser_analysis_limits = limits
    response = _post(client, headers, {"url": SAMPLE_URL})
    assert response.status_code == 401
    assert runtime.sessions.get(session_id) is None
    assert limits.active_total == 0
    assert fetcher.calls == []


def test_untrusted_forwarded_headers_cannot_spoof_https_or_origin(
    monkeypatch: pytest.MonkeyPatch, accounts_file: Path
) -> None:
    main = _load_main(monkeypatch, accounts_file)
    with TestClient(main.app, base_url="http://app.example.test") as client:
        response = client.post(
            ANALYSE_URL,
            json={"url": SAMPLE_URL},
            headers={
                "Origin": ORIGIN,
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "app.example.test",
                "X-Forwarded-For": "203.0.113.10",
            },
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_rejected"


def test_authenticated_request_accepts_https_from_a_trusted_simulated_proxy(
    monkeypatch: pytest.MonkeyPatch, accounts_file: Path
) -> None:
    main = _load_main(monkeypatch, accounts_file, trusted_proxy_networks="10.0.0.2/32")

    class SimulatedProxy:
        def __init__(self, app) -> None:
            self.app = app

        async def __call__(self, scope, receive, send) -> None:
            if scope["type"] == "http":
                scope = {**scope, "client": ("10.0.0.2", 443)}
            await self.app(scope, receive, send)

    with TestClient(SimulatedProxy(main.app), base_url="http://app.example.test") as client:
        runtime = main.app.state.browser_auth
        session_id, session = runtime.sessions.create(USERNAME)
        fake = FakeSafeFetcher()
        main.app.state.safe_fetcher = fake
        response = client.post(
            ANALYSE_URL,
            json={"url": SAMPLE_URL},
            headers={
                "Origin": ORIGIN,
                "Cookie": f"{COOKIE_NAME}={session_id}",
                "X-CSRF-Token": session.csrf_token,
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "app.example.test",
            },
        )
    assert response.status_code == 200
    assert len(fake.calls) == 1


def test_legacy_extension_cors_cannot_read_session_data(analysis_harness) -> None:
    client, _, _, headers, *_ = analysis_harness
    bootstrap = client.get(SESSION_URL, headers={"Origin": EXTENSION_ORIGIN, "Cookie": headers["Cookie"]})
    assert bootstrap.status_code == 403
    assert bootstrap.json()["error"]["code"] == "origin_rejected"
    assert "access-control-allow-origin" not in bootstrap.headers

    preflight = client.options(
        ANALYSE_URL,
        headers={
            "Origin": EXTENSION_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )
    assert preflight.status_code == 403
    assert "access-control-allow-origin" not in preflight.headers


def test_legacy_extension_bearer_cors_contract_remains_available(analysis_harness) -> None:
    client, _, fetcher, *_ = analysis_harness
    preflight = client.options(
        "/analyse-url",
        headers={
            "Origin": EXTENSION_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == EXTENSION_ORIGIN

    response = client.post(
        "/analyse-url",
        json={"url": SAMPLE_URL, "include_ai_recommendations": False},
        headers={"Origin": EXTENSION_ORIGIN, "Authorization": f"Bearer {BEARER_TOKEN}"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == EXTENSION_ORIGIN
    assert fetcher.calls == [(SAMPLE_URL, None)]


def test_browser_auth_bootstrap_and_logout_contract_still_works(analysis_harness) -> None:
    client, runtime, _, headers, session_id, _ = analysis_harness
    bootstrap = client.get(SESSION_URL, headers={"Cookie": headers["Cookie"]})
    assert bootstrap.status_code == 200
    assert bootstrap.headers["cache-control"].startswith("no-store")
    assert bootstrap.json()["user"]["username"] == USERNAME
    logout = client.post(
        f"{SESSION_URL}/logout",
        headers={
            "Origin": ORIGIN,
            "Cookie": headers["Cookie"],
            "X-CSRF-Token": headers["X-CSRF-Token"],
        },
    )
    assert logout.status_code == 200
    assert runtime.sessions.get(session_id) is None
