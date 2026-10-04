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
