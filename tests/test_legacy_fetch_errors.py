from __future__ import annotations

import importlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.security.errors import FetchErrorCode
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import FetchMetadata


TOKEN = "legacy-fetch-contract-test-token"
ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
URL = "https://example.test/page?source=fixture"
REQUEST_ID = "legacy-fetch-contract-1"

FETCH_FAILURE_CASES = [
    (FetchErrorCode.INVALID_URL.value, 422, "invalid_url", "The requested URL is invalid."),
    (FetchErrorCode.CREDENTIALS_NOT_ALLOWED.value, 422, "invalid_url", "The requested URL is invalid."),
    (FetchErrorCode.UNSUPPORTED_SCHEME.value, 422, "unsupported_url", "The requested URL is not supported."),
    (
        FetchErrorCode.BLOCKED_DESTINATION.value,
        422,
        "destination_blocked",
        "The requested destination is not permitted.",
    ),
    (
        FetchErrorCode.UNSAFE_REDIRECT.value,
        422,
        "destination_blocked",
        "The requested destination is not permitted.",
    ),
    (
        FetchErrorCode.DNS_RESOLUTION_FAILED.value,
        502,
        "resource_unavailable",
        "The requested page could not be analyzed.",
    ),
    (FetchErrorCode.CONNECTION_FAILED.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (FetchErrorCode.CONNECTION_TIMEOUT.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (FetchErrorCode.READ_TIMEOUT.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (FetchErrorCode.OVERALL_TIMEOUT.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (
        FetchErrorCode.REDIRECT_LIMIT_EXCEEDED.value,
        502,
        "resource_unavailable",
        "The requested page could not be analyzed.",
    ),
    (
        FetchErrorCode.UNSUPPORTED_CONTENT_TYPE.value,
        502,
        "resource_unavailable",
        "The requested page could not be analyzed.",
    ),
    (FetchErrorCode.RESPONSE_TOO_LARGE.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (FetchErrorCode.HTTP_ERROR.value, 502, "resource_unavailable", "The requested page could not be analyzed."),
    (
        FetchErrorCode.UNEXPECTED_FETCH_ERROR.value,
        502,
        "resource_unavailable",
        "The requested page could not be analyzed.",
    ),
]


class FakeGeminiService:
    def __init__(self) -> None:
        self.boost_calls = 0

    async def generate_boost(self, analysis, *, request_id: str | None = None) -> dict[str, str]:
        self.boost_calls += 1
        return {"suggested_description": "A clear description for the analyzed page."}

    async def aclose(self) -> None:
        return None


@pytest.fixture()
def legacy_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("BROWSER_AUTH_ENABLED", "false")
    monkeypatch.setenv("ALLOWED_CORS_ORIGINS", ORIGIN)
    monkeypatch.setenv("ANALYSIS_RATE_LIMIT_PER_MINUTE", "100")
    monkeypatch.setenv("ANALYSIS_RATE_LIMIT_PER_HOUR", "1000")
    monkeypatch.setenv("BOOST_RATE_LIMIT_PER_MINUTE", "100")
    monkeypatch.setenv("BOOST_RATE_LIMIT_PER_HOUR", "1000")
    get_settings.cache_clear()
    import backend.app.main as main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        client.app.state.gemini_service = FakeGeminiService()
        yield client
    get_settings.cache_clear()


def _install_analysis_result(monkeypatch: pytest.MonkeyPatch, result: object) -> list[str]:
    import backend.seo_crawler as crawler

    calls: list[str] = []

    async def fake_analysis(url: str, *, fetcher=None, request_id: str | None = None):
        calls.append(url)
        return result

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    return calls


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}", "X-Request-ID": REQUEST_ID}


def _request(client: TestClient, path: str, *, headers: dict[str, str] | None = None):
    payload = {"url": URL}
    return client.post(path, json=payload, headers=_auth_headers() if headers is None else headers)


@pytest.mark.parametrize("path", ["/analyse-url", "/boost-seo"])
@pytest.mark.parametrize(("fetch_error", "status", "code", "message"), FETCH_FAILURE_CASES)
def test_legacy_routes_share_the_complete_fetch_error_contract(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    fetch_error: str,
    status: int,
    code: str,
    message: str,
) -> None:
    calls = _install_analysis_result(monkeypatch, {"status": "failed", "fetch_error": fetch_error})

    response = _request(legacy_client, path)

    assert calls == [URL]
    assert response.status_code == status
    assert response.json().keys() == {"error"}
    error = response.json()["error"]
    assert error == {"code": code, "message": message, "request_id": REQUEST_ID}
    assert set(error) == {"code", "message", "request_id"}
    assert response.headers["x-request-id"] == REQUEST_ID
    assert response.headers["cache-control"] == "no-store"
    if path == "/boost-seo":
        assert legacy_client.app.state.gemini_service.boost_calls == 0


MALFORMED_FAILURE_RESULTS = [
    {"status": "failed"},
    {"status": "failed", "fetch_error": None},
    {"status": "failed", "fetch_error": "unknown_policy_like_failure"},
    {"status": "failed", "fetch_error": ["blocked_destination"]},
    {
        "status": "failed",
        "fetch_error": {"category": "blocked_destination", "resolver": "169.254.169.254"},
    },
    None,
    {},
]


@pytest.mark.parametrize("path", ["/analyse-url", "/boost-seo"])
@pytest.mark.parametrize("result", MALFORMED_FAILURE_RESULTS)
def test_malformed_or_unknown_failure_metadata_defaults_to_remote_unavailable(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    result: object,
) -> None:
    _install_analysis_result(monkeypatch, result)

    response = _request(legacy_client, path)

    assert response.status_code == 502
    assert response.json()["error"] == {
        "code": "resource_unavailable",
        "message": "The requested page could not be analyzed.",
        "request_id": REQUEST_ID,
    }
    assert "169.254.169.254" not in response.text


@pytest.mark.parametrize("path", ["/analyse-url", "/boost-seo"])
def test_client_cannot_select_internal_fetch_error_category(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    calls = _install_analysis_result(monkeypatch, {"status": "failed", "fetch_error": "blocked_destination"})
    payload = {"url": URL, "fetch_error": "blocked_destination"}

    response = legacy_client.post(path, json=payload, headers=_auth_headers())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert calls == []


@pytest.mark.parametrize("path", ["/analyse-url", "/boost-seo"])
def test_error_mapping_does_not_log_private_fetch_metadata(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    path: str,
) -> None:
    caplog.set_level("INFO")
    private_detail = "resolver returned 169.254.169.254 private-query-secret"
    result = {"status": "failed", "fetch_error": private_detail}
    _install_analysis_result(monkeypatch, result)

    response = _request(legacy_client, path)

    assert response.status_code == 502
    assert private_detail not in response.text
    assert "169.254.169.254" not in caplog.text
    assert "private-query-secret" not in caplog.text
    assert TOKEN not in response.text
    assert TOKEN not in caplog.text


def test_extension_origin_preflight_remains_allowed(legacy_client: TestClient) -> None:
    response = legacy_client.options(
        "/analyse-url",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,x-request-id",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN


def _successful_analysis(url: str) -> dict[str, Any]:
    html = "<html lang='en'><head><title>Stable API result</title></head><body><h1>Example</h1></body></html>"
    fetch = FetchMetadata(
        requested_url=url,
        final_url=url,
        status_code=200,
        content_type="text/html",
        content_length=len(html),
        bytes_read=len(html),
        redirect_count=0,
        elapsed_time=0.01,
    )
    return {"status": "success", **analyze_html(html, url, fetch).model_dump(mode="json")}


def test_successful_legacy_analysis_response_contract_is_unchanged(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _install_analysis_result(monkeypatch, _successful_analysis("https://example.test/page/"))

    response = _request(legacy_client, "/analyse-url")

    assert response.status_code == 200
    assert calls == [URL]
    assert response.json()["final_url"] == "https://example.test/page/"
    assert isinstance(response.json()["deterministic_score"]["overall_score"], int)
    assert "status" not in response.json()
    assert "html" not in response.json()


def test_successful_boost_response_contract_is_unchanged(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_analysis_result(monkeypatch, _successful_analysis("https://example.test/page/"))

    response = _request(legacy_client, "/boost-seo")

    assert response.status_code == 200
    assert response.json() == {"suggested_description": "A clear description for the analyzed page."}
    assert legacy_client.app.state.gemini_service.boost_calls == 1


def test_missing_gemini_configuration_remains_an_ai_error_before_fetch(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _install_analysis_result(monkeypatch, {"status": "failed", "fetch_error": "blocked_destination"})
    legacy_client.app.state.gemini_service = None

    response = _request(legacy_client, "/boost-seo")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_ai_unavailable"
    assert calls == []


@pytest.mark.parametrize("path", ["/analyse-url", "/boost-seo"])
def test_legacy_routes_still_require_the_bearer_token(
    legacy_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    calls = _install_analysis_result(monkeypatch, {"status": "failed", "fetch_error": "blocked_destination"})
    cases = [
        ({}, "auth_required"),
        ({"Authorization": "Bearer wrong-token"}, "auth_invalid"),
        ({"Cookie": "__Host-seo_sensei_session=not-a-browser-session"}, "auth_required"),
    ]

    for headers, expected_code in cases:
        response = _request(legacy_client, path, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == expected_code

    assert calls == []
