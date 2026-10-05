from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
FRONTEND = ROOT / "frontend"


def test_manifest_uses_minimum_extension_permissions_and_options_page() -> None:
    manifest = json.loads((FRONTEND / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["permissions"] == ["activeTab", "storage"]
    assert "<all_urls>" not in manifest["permissions"]
    assert manifest["options_page"] == "options.html"
    assert "content_security_policy" in manifest


def test_extension_has_no_embedded_server_token_or_unsafe_rendering() -> None:
    source = "\n".join(path.read_text(encoding="utf-8") for path in FRONTEND.glob("*.js"))
    source += (FRONTEND / "popup.html").read_text(encoding="utf-8")
    assert "unsafe_allow_html" not in source
    assert "innerHTML" not in source
    assert "insertAdjacentHTML" not in source
    assert "document.write" not in source
    assert "new Function" not in source
    assert "eval(" not in source
    assert "http://127.0.0.1:8000" not in source
    assert "http://localhost:8000" not in source
    assert '"api-key"' not in source.lower()


def test_extension_only_calls_relative_api_paths() -> None:
    source = (FRONTEND / "api-client.js").read_text(encoding="utf-8")
    assert '"/analyse-url"' in source
    assert '"/boost-seo"' in source
    assert '"/health"' in source
    assert "tab.url +" not in source
    assert "fetch(tab.url" not in source


def test_extension_json_posts_set_content_type_without_changing_health_get() -> None:
    source = (FRONTEND / "api-client.js").read_text(encoding="utf-8")

    assert 'headers["Content-Type"] = "application/json"' in source
    assert "body: options.body ? JSON.stringify(options.body) : undefined" in source
    assert 'requestJson("/analyse-url", { method: "POST", body:' in source
    assert 'requestJson("/boost-seo", { method: "POST", body:' in source
    assert 'requestJson("/health", { authenticated: false })' in source
    assert '"Accept": "application/json"' in source
    assert '"X-Request-ID": requestId' in source
    assert 'headers.Authorization = `Bearer ${config.token || ""}`' in source
    assert "?token=" not in source
