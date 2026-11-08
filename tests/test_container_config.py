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
    assert "caddy:" in compose
    assert "caddy_data:" in compose
    caddy_section = compose[compose.index("  caddy:") : compose.index("  api:")]
    assert "env_file" not in caddy_section
    assert "API_ACCESS_TOKEN" not in caddy_section
    assert "API_BASE_URL: http://api:8000" in compose
    assert "expose:" in compose
    assert '"${API_HOST_BIND:-127.0.0.1}:${API_HOST_PORT:-8000}:8000"' in dev
    assert "healthcheck:" in compose
    assert "condition: service_healthy" in compose
    assert "privileged: true" not in compose
    assert "network_mode: host" not in compose
    assert "/var/run/docker.sock" not in compose
    assert '"80:80"' in compose and '"443:443"' in compose


def test_container_configuration_does_not_bake_secrets() -> None:
    for name in ("Dockerfile.api", "Dockerfile.dashboard", "compose.yaml", "compose.dev.yaml"):
        contents = text(name)
        assert "COPY .env" not in contents
        assert "AIza" not in contents
        assert "replace-with" not in contents


def test_caddy_routes_the_spa_and_browser_api_separately_without_credentials() -> None:
    caddy = text("Caddyfile")
    assert "{$APP_DOMAIN}" in caddy
    assert "{$API_DOMAIN}" in caddy
    assert "root * /srv" in caddy
    assert "try_files {path} /index.html" in caddy
    assert "request_body" in caddy and "max_size 8KB" in caddy
    assert caddy.count("reverse_proxy api:8000") == 2
    assert 'respond "Not found." 404' in caddy
    assert "dashboard:8501" not in caddy
    assert "Authorization delete" in caddy
    assert "X-CSRF-Token delete" in caddy
    assert "delete token" in caddy
    assert "token delete" not in caddy
    assert "Bearer" not in caddy


def test_browser_session_namespace_is_private_on_the_api_host() -> None:
    caddy = text("Caddyfile")
    api_site = caddy[caddy.index("{$API_DOMAIN}") :]
    deny = api_site.index("@browser_api path /api/browser/v1*")
    deny_handler = api_site.index('respond "Not found." 404', deny)
    upstream = api_site.index("reverse_proxy api:8000", deny)
    assert deny < deny_handler < upstream


def test_browser_auth_is_opt_in_and_uses_an_external_read_only_account_file() -> None:
    compose = text("compose.yaml")
    auth_overlay = text("compose.browser-auth.yaml")
    assert "BROWSER_AUTH_ENABLED: ${BROWSER_AUTH_ENABLED:-false}" in compose
    assert "BROWSER_AUTH_ACCOUNTS_FILE" not in compose
    assert 'BROWSER_AUTH_ENABLED: "true"' in auth_overlay
    assert "/run/secrets/browser-users.json" in auth_overlay
    assert "read_only: true" in auth_overlay


def test_local_https_harness_is_loopback_only_and_uses_a_fake_fetcher() -> None:
    compose = text("compose.integration.yaml")
    caddy = text("Caddyfile.integration")
    dockerignore = text(".dockerignore")
    assert '"127.0.0.1:8443:8443"' in compose
    assert "PHASE2D_TEST_PASSWORD" in compose
    assert "ports:" not in compose.split("  caddy:", 1)[0]
    assert "172.31.0.2/32" in compose
    assert "ipv4_address: 172.31.0.3" in compose.split("  caddy:", 1)[0]
    assert "ipv4_address: 172.31.0.2" in compose.split("  caddy:", 1)[1]
    assert "tls internal" in caddy
    assert "ControlledSafeFetcher" in text("tests/integration/phase2d_server.py")
    assert "\ntests\n" in f"\n{dockerignore}"


def test_static_web_image_does_not_include_test_or_secret_material() -> None:
    dockerfile = text("Dockerfile.web")
    dockerignore = text(".dockerignore")
    assert "node:24.14.0-alpine3.22" in dockerfile
    assert "npm ci" in dockerfile
    assert "npm run build" in dockerfile
    assert "caddy:2.10.2-alpine" in dockerfile
    for entry in (".env", "tests", "web/review", "web/e2e", "web/node_modules", "**/*.key"):
        assert entry in dockerignore
