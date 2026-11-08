from __future__ import annotations

import json
import shutil
import subprocess
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


def test_extension_api_client_surfaces_destination_blocked_envelope_safely() -> None:
    node = shutil.which("node")
    assert node is not None, "Node.js is required by the repository's extension validation job."
    api_path = json.dumps(str(FRONTEND / "api-client.js"))
    script = f"""
globalThis.chrome = {{
  storage: {{ local: {{ get: async (key) => ({{ [key]: {{ baseUrl: "https://api.example.test", token: "extension-contract-test-token" }} }}) }} }},
  permissions: {{ contains: async () => true }},
  tabs: {{ query: async () => [] }}
}};
globalThis.fetch = async (url, options) => {{
  if (url !== "https://api.example.test/boost-seo" || options.headers.Authorization !== "Bearer extension-contract-test-token") {{
    throw new Error("unexpected mock request");
  }}
  return {{
    ok: false,
    status: 422,
    headers: {{ get: (name) => name.toLowerCase() === "x-request-id" ? "extension-contract-request" : null }},
    json: async () => ({{ error: {{
      code: "destination_blocked",
      message: "The requested destination is not permitted.",
      request_id: "extension-contract-request"
    }} }})
  }};
}};
require({api_path});
globalThis.SeoSenseiApi.boost("https://page.example.test/").then(
  () => {{ throw new Error("expected API error"); }},
  (error) => process.stdout.write(JSON.stringify({{
    name: error.name,
    code: error.code,
    status: error.status,
    message: error.message,
    requestId: error.requestId,
    retryAfter: error.retryAfter
  }}))
);
"""
    completed = subprocess.run([node, "-e", script], check=True, capture_output=True, text=True)
    result = json.loads(completed.stdout)
    assert result == {
        "name": "ExtensionApiError",
        "code": "destination_blocked",
        "status": 422,
        "message": "The requested destination is not permitted.",
        "requestId": "extension-contract-request",
        "retryAfter": None,
    }

    popup = (FRONTEND / "popup.js").read_text(encoding="utf-8")
    assert '$("errorMessage").textContent = error.message' in popup
    assert '$("errorRequestId").textContent' in popup
