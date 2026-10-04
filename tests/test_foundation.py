"""Foundation tests that do not require a Gemini API call or key."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.schemas.requests import ArticleGenerationRequest, URLAnalysisRequest
from backend.app.schemas.responses import ErrorResponse
from backend.app.seo.models import SEOScore
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import FetchMetadata


def test_valid_configuration_loading() -> None:
    settings = Settings.from_environment(
        {
            "APP_ENV": "test",
            "GEMINI_API_KEY": "test-only-key",
            "ALLOWED_CORS_ORIGINS": "http://localhost:8501, chrome-extension://test",
            "MAX_URL_LENGTH": "2048",
        }
    )

    assert settings.environment == "test"
    assert settings.gemini_api_key == "test-only-key"
    assert settings.allowed_cors_origins == ["http://localhost:8501", "chrome-extension://test"]


def test_production_configuration_allows_optional_gemini() -> None:
    settings = Settings.from_environment({"APP_ENV": "production", "GEMINI_API_KEY": ""})
    assert settings.gemini_api_key is None


def test_url_schema_accepts_http_and_https() -> None:
    assert str(URLAnalysisRequest(url="https://example.com").url) == "https://example.com/"
    assert str(URLAnalysisRequest(url="http://example.com/path").url) == "http://example.com/path"


def test_url_schema_rejects_unsupported_scheme_and_length() -> None:
    with pytest.raises(ValidationError):
        URLAnalysisRequest(url="ftp://example.com")
    with pytest.raises(ValidationError):
        URLAnalysisRequest(url="https://example.com/" + ("a" * 2_100))


def test_article_request_constraints() -> None:
    valid = ArticleGenerationRequest(topic="SEO testing", keywords=["seo", "testing"], tone="professional")
    assert valid.tone == "professional"

    with pytest.raises(ValidationError):
        ArticleGenerationRequest(topic="", keywords=[], tone="professional")
    with pytest.raises(ValidationError):
        ArticleGenerationRequest(topic="valid topic", keywords=[str(i) for i in range(21)], tone="professional")
    with pytest.raises(ValidationError):
        ArticleGenerationRequest(topic="valid topic", keywords=["x" * 81], tone="professional")


@pytest.mark.parametrize("score", [0, 100])
def test_score_boundaries_are_valid(score: int) -> None:
    result = SEOScore(overall_score=score, points_earned=score, categories=[])
    assert result.overall_score == score


@pytest.mark.parametrize("score", [-1, 101])
def test_score_outside_range_is_rejected(score: int) -> None:
    with pytest.raises(ValidationError):
        SEOScore(overall_score=score, points_earned=score, categories=[])


def test_error_response_structure_and_request_id() -> None:
    from backend.app.api.errors import error_payload

    class State:
        request_id = "req-test-123"

    class Request:
        state = State()

    payload = error_payload(Request(), "invalid_request", "Safe message")
    parsed = ErrorResponse.model_validate(payload)
    assert parsed.error.code == "invalid_request"
    assert parsed.error.request_id == "req-test-123"


@pytest.fixture()
def api_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "http://localhost:8501")

    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


def test_request_id_is_present_on_success_and_validation_error(api_client: TestClient) -> None:
    response = api_client.get("/health")
    assert response.status_code == 200
    assert response.headers["x-request-id"]

    invalid = api_client.post("/generate-article", json={})
    assert invalid.status_code == 422
    assert invalid.headers["x-request-id"]
    assert invalid.json()["error"]["code"] == "invalid_request"


def test_cors_uses_configured_origin_without_wildcard(api_client: TestClient) -> None:
    allowed = api_client.options(
        "/health",
        headers={
            "Origin": "http://localhost:8501",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:8501"
    assert allowed.headers["access-control-allow-origin"] != "*"


def test_unconfigured_ai_returns_safe_public_error(api_client: TestClient) -> None:
    response = api_client.post(
        "/generate-article",
        json={"topic": "SEO foundations", "keywords": ["seo"], "tone": "professional"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_ai_unavailable"
    assert "Traceback" not in response.text
    assert "GEMINI_API_KEY" not in response.text

    boost = api_client.post("/boost-seo", json={"url": "https://example.com/"})
    assert boost.status_code == 503
    assert boost.json()["error"]["code"] == "upstream_ai_unavailable"
    assert "example.com" not in boost.text


def test_analysis_api_returns_deterministic_contract_without_gemini(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    html = "<html lang='en'><head><title>Stable title for analysis</title></head><body><h1>Stable page</h1></body></html>"

    async def fake_analysis(url: str, fetcher=None):
        metadata = FetchMetadata(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            content_length=len(html),
            bytes_read=len(html),
            redirect_count=0,
            elapsed_time=0.1,
        )
        return {"status": "success", **analyze_html(html, url, metadata).model_dump(mode="json")}

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    first = api_client.post("/analyse-url", json={"url": "https://example.com/"})
    second = api_client.post("/analyse-url", json={"url": "https://example.com/"})
    assert first.status_code == second.status_code == 200
    assert first.json()["deterministic_score"] == second.json()["deterministic_score"]
    assert "html" not in first.json()
    assert "meta_keywords" not in first.json()

    with_ai = api_client.post(
        "/analyse-url",
        json={"url": "https://example.com/", "include_ai_recommendations": True},
    )
    assert with_ai.status_code == 200
    assert with_ai.json()["ai_recommendations"]["state"] == "configuration_error"
    assert with_ai.json()["deterministic_score"] == first.json()["deterministic_score"]
