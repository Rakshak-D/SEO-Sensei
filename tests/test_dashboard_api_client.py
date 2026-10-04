from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

from backend.app.client.api_client import DashboardAPIClient, DashboardAPIError
from backend.app.schemas.requests import ArticleGenerationRequest
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import FetchMetadata


def analysis_json() -> dict:
    html = "<html lang='en'><head><title>Dashboard fixture title</title></head><body><h1>Fixture</h1></body></html>"
    fetch = FetchMetadata(
        requested_url="https://example.com/",
        final_url="https://example.com/",
        status_code=200,
        content_type="text/html",
        content_length=len(html),
        bytes_read=len(html),
        redirect_count=0,
        elapsed_time=0.1,
    )
    return {**analyze_html(html, fetch.final_url, fetch).model_dump(mode="json"), "ai_recommendations": None}


def client(handler) -> DashboardAPIClient:
    return DashboardAPIClient(
        "https://api.example.test",
        "dashboard-token",
        transport=httpx.MockTransport(handler),
    )


def test_successful_analysis_is_typed_and_authenticated() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer dashboard-token"
        assert request.headers["x-request-id"]
        return httpx.Response(200, json=analysis_json())

    result = client(handler).analyze_url("https://example.com/")
    assert result.deterministic_score.overall_score >= 0


def test_health_does_not_require_dashboard_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        return httpx.Response(200, json={"status": "ok", "environment": "test"})

    assert client(handler).health().status == "ok"


@pytest.mark.parametrize(
    ("status", "code", "headers"),
    [
        (401, "auth_invalid", {}),
        (403, "api_error", {}),
        (429, "rate_limited", {"retry-after": "12"}),
        (502, "resource_unavailable", {}),
    ],
)
def test_api_errors_are_typed_and_sanitized(status: int, code: str, headers: dict[str, str]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={"error": {"code": code, "message": "Safe message", "request_id": "req-123"}},
            headers=headers,
        )

    with pytest.raises(DashboardAPIError) as exc:
        client(handler).analyze_url("https://example.com/")
    assert exc.value.code == code
    assert exc.value.message == "Safe message"
    assert exc.value.request_id == "req-123"
    if status == 429:
        assert exc.value.retry_after == 12


def test_malformed_response_and_timeout_are_controlled() -> None:
    with pytest.raises(DashboardAPIError) as malformed:
        client(lambda request: httpx.Response(200, text="not-json")).analyze_url("https://example.com/")
    assert malformed.value.code == "malformed_response"

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider details must not escape")

    with pytest.raises(DashboardAPIError) as timed_out:
        client(timeout).health()
    assert timed_out.value.code == "timeout"
    assert "provider details" not in str(timed_out.value)


def test_client_validates_inputs_before_http() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    with pytest.raises(ValidationError):
        client(handler).analyze_url("ftp://internal.test")
    with pytest.raises(ValidationError):
        client(handler).generate_article(ArticleGenerationRequest(topic="", keywords=[], tone="professional"))
    assert calls == 0


def test_client_configuration_never_accepts_empty_token() -> None:
    with pytest.raises(DashboardAPIError) as exc:
        DashboardAPIClient("https://api.example.test", "")
    assert exc.value.code == "configuration_error"
