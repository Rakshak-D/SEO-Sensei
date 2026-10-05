from __future__ import annotations

import asyncio
import importlib

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.logging_config import StructuredFormatter
from backend.app.metrics import Metrics
from backend.app.security.fetcher import SafeFetcher


@pytest.fixture()
def observability_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", "observability-test-token")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("APP_VERSION", "test-build-42")
    monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "http://localhost:8501")

    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


def test_health_is_cheap_and_does_not_report_ai_state(observability_client: TestClient) -> None:
    response = observability_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "SEO-Sensei API",
        "environment": "test",
        "version": "test-build-42",
    }
    assert "GEMINI_API_KEY" not in response.text


def test_readiness_is_local_and_succeeds_after_startup(observability_client: TestClient) -> None:
    response = observability_client.get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "test-build-42"


def test_metrics_use_bounded_low_cardinality_keys() -> None:
    metrics = Metrics()
    metrics.increment("requests_total", "analysis")
    metrics.increment("requests_total", "user-entered-hostname")

    assert metrics.snapshot() == {"requests_total:analysis": 1, "requests_total": 1}


def test_structured_formatter_omits_sensitive_and_unbounded_fields() -> None:
    import logging

    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request_complete",
        args=(),
        exc_info=None,
    )
    record.request_id = "safe-id"
    record.endpoint = "/health"
    record.status = 200
    record.authorization = "Bearer should-not-appear"
    rendered = StructuredFormatter().format(record)

    assert "safe-id" in rendered
    assert "authorization" not in rendered.lower()
    assert "should-not-appear" not in rendered


def test_new_operational_settings_have_safe_defaults() -> None:
    settings = Settings.from_environment({"APP_ENV": "test"})

    assert settings.app_version == "1.0.0"
    assert settings.log_level == "INFO"
    assert settings.metrics_enabled is True
    assert settings.graceful_shutdown_timeout_seconds == 10


def test_safe_fetcher_records_bounded_transport_signal_without_url_content() -> None:
    settings = Settings.from_environment({"APP_ENV": "test"})
    metrics = Metrics()
    fetcher = SafeFetcher(settings, metrics=metrics)
    try:
        result = asyncio.run(fetcher.fetch_url("ftp://example.test/"))
    finally:
        asyncio.run(fetcher.aclose())

    assert result.error is not None
    assert metrics.snapshot()["fetch_requests_total:fetch"] == 1
