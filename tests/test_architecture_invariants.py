from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_dashboard_uses_only_the_api_client_boundary() -> None:
    source = read("backend/dashboard.py")
    assert "DashboardAPIClient" in source
    assert "SafeFetcher" not in source
    assert "seo_crawler" not in source
    assert "GeminiService" not in source
    assert "unsafe_allow_html=True" not in source


def test_extension_has_no_server_secret_or_dynamic_html_execution() -> None:
    for relative in ("frontend/popup.js", "frontend/api-client.js", "frontend/options.js"):
        source = read(relative)
        assert "innerHTML" not in source
        assert "insertAdjacentHTML" not in source
        assert "eval(" not in source
        assert "new Function" not in source
        assert re.search(r"Bearer\s+[A-Za-z0-9._-]{16,}", source) is None
        assert "127.0.0.1:8000" not in source
        assert "localhost:8000" not in source


def test_deterministic_engine_has_no_ai_dependency() -> None:
    source = read("backend/app/seo/engine.py")
    assert "Gemini" not in source
    assert "google.generativeai" not in source


def test_protected_work_routes_declare_auth_and_rate_limit_dependencies() -> None:
    source = read("backend/app/main.py")
    for route in ("/analyse-url", "/generate-article", "/boost-seo"):
        start = source.index(f'"{route}"')
        section = source[start : source.index("async def", start)]
        assert "Depends(require_auth)" in section
        assert "Depends(rate_limit_for" in section
