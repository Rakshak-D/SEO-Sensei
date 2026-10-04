from __future__ import annotations

import importlib
import threading

import pytest
from fastapi.testclient import TestClient

from backend.app.api.rate_limit import InMemoryRateLimiter
from backend.app.config import ConfigurationError, Settings
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import FetchMetadata


TOKEN = "test-auth-token"


@pytest.fixture()
def protected_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("API_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://dashboard.example")
    monkeypatch.setenv("ANALYSIS_RATE_LIMIT_PER_MINUTE", "1")
    monkeypatch.setenv("ANALYSIS_RATE_LIMIT_PER_HOUR", "10")
    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


def _analysis_payload(url: str = "https://example.com/") -> dict:
    body = "<html lang='en'><head><title>Bounded page title for tests</title></head><body><h1>Page</h1></body></html>"
    fetch = FetchMetadata(
        requested_url=url,
        final_url=url,
        status_code=200,
        content_type="text/html",
        content_length=len(body),
        bytes_read=len(body),
        redirect_count=0,
        elapsed_time=0.1,
    )
    return {"status": "success", **analyze_html(body, url, fetch).model_dump(mode="json")}


def test_health_is_public_but_analysis_requires_bearer(
    protected_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert protected_client.get("/health").status_code == 200
    called = False

    async def should_not_run(*args, **kwargs):
        nonlocal called
        called = True
        return _analysis_payload()

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", should_not_run)
    response = protected_client.post("/analyse-url", json={"url": "https://example.com/"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_required"
    assert response.headers["x-request-id"]
    assert called is False


@pytest.mark.parametrize(
    "authorization,code",
    [("Basic abc", "auth_invalid"), ("Bearer wrong", "auth_invalid"), ("", "auth_required")],
)
def test_invalid_bearer_credentials_are_rejected(protected_client: TestClient, authorization: str, code: str) -> None:
    headers = {"Authorization": authorization} if authorization else {}
    response = protected_client.post("/analyse-url", json={"url": "https://example.com/"}, headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == code
    assert TOKEN not in response.text


def test_query_string_token_is_not_accepted(protected_client: TestClient) -> None:
    response = protected_client.post(f"/analyse-url?token={TOKEN}", json={"url": "https://example.com/"})
    assert response.status_code == 401


def test_authentication_failure_does_not_log_token(
    protected_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("INFO")
    secret = "never-log-this-token"
    response = protected_client.post(
        "/generate-article",
        json={"topic": "bounded topic", "keywords": [], "tone": "professional"},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert response.status_code == 401
    assert secret not in caplog.text
    assert secret not in response.text


def test_correct_token_reaches_crawler(protected_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    async def fake_analysis(*args, **kwargs):
        nonlocal called
        called = True
        return _analysis_payload()

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    response = protected_client.post(
        "/analyse-url",
        json={"url": "https://example.com/"},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 200
    assert called is True


def test_rate_limit_rejects_before_crawler_and_returns_retry_after(
    protected_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    async def fake_analysis(*args, **kwargs):
        nonlocal calls
        calls += 1
        return _analysis_payload()

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    first = protected_client.post("/analyse-url", json={"url": "https://example.com/"}, headers=headers)
    second = protected_client.post("/analyse-url", json={"url": "https://example.com/"}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"
    assert int(second.headers["retry-after"]) >= 1
    assert calls == 1


def test_limiter_expiry_and_concurrent_bookkeeping() -> None:
    now = [0.0]
    config = Settings.from_environment(
        {
            "APP_ENV": "test",
            "API_ACCESS_TOKEN": TOKEN,
            "ANALYSIS_RATE_LIMIT_PER_MINUTE": "2",
            "ANALYSIS_RATE_LIMIT_PER_HOUR": "10",
        }
    )
    limiter = InMemoryRateLimiter(config, clock=lambda: now[0])
    results = []

    def take_slot() -> None:
        results.append(limiter.check("identity", "127.0.0.1", "analysis").allowed)

    threads = [threading.Thread(target=take_slot) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sum(results) == 2
    now[0] = 61.0
    assert limiter.check("identity", "127.0.0.1", "analysis").allowed is True


def test_cors_allows_authorization_for_configured_origin(protected_client: TestClient) -> None:
    response = protected_client.options(
        "/analyse-url",
        headers={
            "Origin": "https://dashboard.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://dashboard.example"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_wildcard_cors_is_rejected_by_configuration() -> None:
    with pytest.raises(ConfigurationError, match="Wildcard CORS"):
        Settings.from_environment({"APP_ENV": "test", "ALLOWED_CORS_ORIGINS": "*"})
