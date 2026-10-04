from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def text(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def test_api_image_uses_non_root_uvicorn_and_runtime_dependencies_only() -> None:
    dockerfile = text("Dockerfile.api")
    assert "FROM python:3.11.11-slim-bookworm" in dockerfile
    assert "COPY requirements-common.txt requirements-api.txt" in dockerfile
    assert "requirements-dev.txt" not in dockerfile
    assert "USER seo-sensei" in dockerfile
    assert "backend.app.main:app" in dockerfile
    assert "--host 0.0.0.0" in dockerfile
    assert "--reload" not in dockerfile


def test_dashboard_image_uses_non_root_streamlit_and_runtime_dependencies_only() -> None:
    dockerfile = text("Dockerfile.dashboard")
    assert "FROM python:3.11.11-slim-bookworm" in dockerfile
    assert "COPY requirements-common.txt requirements-dashboard.txt" in dockerfile
    assert "requirements-dev.txt" not in dockerfile
    assert "USER seo-sensei" in dockerfile
    assert "streamlit run backend/dashboard.py" in dockerfile
    assert "--server.address 0.0.0.0" in dockerfile
    assert "--server.headless true" in dockerfile


def test_compose_keeps_api_private_and_uses_service_dns_for_dashboard() -> None:
    compose = text("compose.yaml")
    dev = text("compose.dev.yaml")
    assert "api:" in compose and "dashboard:" in compose
    assert "API_BASE_URL: http://api:8000" in compose
    assert "expose:" in compose
    assert '"${API_HOST_BIND:-127.0.0.1}:${API_HOST_PORT:-8000}:8000"' in dev
    assert "healthcheck:" in compose
    assert "condition: service_healthy" in compose
    assert "privileged: true" not in compose
    assert "network_mode: host" not in compose
    assert "/var/run/docker.sock" not in compose


def test_container_configuration_does_not_bake_secrets() -> None:
    for name in ("Dockerfile.api", "Dockerfile.dashboard", "compose.yaml", "compose.dev.yaml"):
        contents = text(name)
        assert "COPY .env" not in contents
        assert "AIza" not in contents
        assert "replace-with" not in contents
