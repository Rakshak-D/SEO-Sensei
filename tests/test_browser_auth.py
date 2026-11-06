from __future__ import annotations

import hashlib
import importlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from argon2 import PasswordHasher, Type
from fastapi.testclient import TestClient

from backend.app.api.browser_auth import LoginAttemptLimiter, PasswordVerifier
from backend.app.config import ConfigurationError, Settings
from backend.app.security.browser_accounts import load_accounts
from backend.app.security.browser_sessions import BrowserSessionStore, SessionCapacityError
import tools.provision_browser_user as provisioner
from tools.provision_browser_user import ProvisioningError, provision_user


ORIGIN = "https://app.example.test"
USERNAME = "alice"
PASSWORD = "a test-only password that is long enough"
BEARER_TOKEN = "test-browser-auth-bearer-token"
SESSION_URL = "/api/browser/v1/session"
LOGIN_URL = f"{SESSION_URL}/login"
LOGOUT_URL = f"{SESSION_URL}/logout"
COOKIE = "__Host-seo_sensei_session"


@pytest.fixture(scope="module")
def account_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("browser-auth") / "accounts.json"
    hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    verifier = hasher.hash(PASSWORD)
    path.write_text(json.dumps({"version": 1, "users": [{"username": USERNAME, "password_hash": verifier}]}))
    if os.name == "posix":
        path.chmod(0o600)
    return path


def _reload_main(monkeypatch: pytest.MonkeyPatch, account_path: Path | None, *, enabled: bool = True):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", BEARER_TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("TRUSTED_PROXY_NETWORKS", "")
    monkeypatch.setenv("BROWSER_AUTH_ENABLED", "true" if enabled else "false")
    if account_path is None:
        monkeypatch.delenv("BROWSER_AUTH_ACCOUNTS_FILE", raising=False)
    else:
        monkeypatch.setenv("BROWSER_AUTH_ACCOUNTS_FILE", str(account_path))
    monkeypatch.setenv("BROWSER_APP_ORIGIN", ORIGIN)
    import backend.app.config as config

    config.get_settings.cache_clear()
    import backend.app.main as main

    return importlib.reload(main)


@pytest.fixture()
def browser_client(monkeypatch: pytest.MonkeyPatch, account_file: Path):
    main = _reload_main(monkeypatch, account_file)
    with TestClient(main.app, base_url=ORIGIN) as client:
        yield client


def _login(
    client: TestClient,
    username: str = USERNAME,
    password: str = PASSWORD,
    *,
    origin: str | None = ORIGIN,
):
    headers = {"Content-Type": "application/json"}
    if origin is not None:
        headers["Origin"] = origin
    return client.post(LOGIN_URL, json={"username": username, "password": password}, headers=headers)


def test_browser_auth_is_disabled_by_default_and_needs_no_browser_secrets() -> None:
    settings = Settings.from_environment({"APP_ENV": "test", "BROWSER_AUTH_ENABLED": "false"})
    assert settings.browser_auth_enabled is False
    assert settings.browser_auth_accounts_file is None
    assert settings.browser_app_origin is None


def test_disabled_application_does_not_mount_browser_auth_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    main = _reload_main(monkeypatch, None, enabled=False)
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
        assert client.get(SESSION_URL).status_code == 404
        assert client.post(LOGIN_URL, json={"username": USERNAME, "password": PASSWORD}).status_code == 404


def test_enabled_configuration_requires_account_source_and_exact_origin() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment({"APP_ENV": "production", "BROWSER_AUTH_ENABLED": "true"})


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://app.example.test/",
        "https://app.example.test:443",
        "http://app.example.test",
        "https://user@app.example.test",
        "https://app.example.test?next=/",
    ],
)
def test_enabled_configuration_rejects_malformed_or_insecure_origins(tmp_path: Path, origin: str) -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "BROWSER_AUTH_ENABLED": "true",
                "BROWSER_AUTH_ACCOUNTS_FILE": str(tmp_path / "accounts.json"),
                "BROWSER_APP_ORIGIN": origin,
            }
        )


def test_browser_auth_requires_https_even_for_local_development(tmp_path: Path) -> None:
    common = {
        "APP_ENV": "development",
        "BROWSER_AUTH_ENABLED": "true",
        "BROWSER_AUTH_ACCOUNTS_FILE": str(tmp_path / "accounts.json"),
    }
    assert Settings.from_environment({**common, "BROWSER_APP_ORIGIN": "https://localhost:5173"}).browser_auth_enabled
    with pytest.raises(ConfigurationError):
        Settings.from_environment({**common, "BROWSER_APP_ORIGIN": "http://localhost:5173"})


def test_session_settings_are_bounded_and_consistent(tmp_path: Path) -> None:
    common = {
        "APP_ENV": "test",
        "BROWSER_AUTH_ENABLED": "true",
        "BROWSER_AUTH_ACCOUNTS_FILE": str(tmp_path / "accounts.json"),
        "BROWSER_APP_ORIGIN": ORIGIN,
    }
    with pytest.raises(ConfigurationError):
        Settings.from_environment({**common, "BROWSER_SESSION_CAPACITY": "65"})
    with pytest.raises(ConfigurationError):
        Settings.from_environment(
            {
                **common,
                "BROWSER_SESSION_IDLE_TIMEOUT_SECONDS": "1800",
                "BROWSER_SESSION_ABSOLUTE_LIFETIME_SECONDS": "900",
            }
        )


def test_successful_login_bootstrap_and_cookie_contract(browser_client: TestClient) -> None:
    response = _login(browser_client, username="ALICE")
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "user": {"username": USERNAME}}
    cookie_header = response.headers["set-cookie"]
    lowered = cookie_header.lower()
    assert cookie_header.startswith(f"{COOKIE}=")
    assert "secure" in lowered
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/" in lowered
    assert "max-age=28800" in lowered
    assert "domain=" not in lowered
    assert response.headers.get("cache-control", "").startswith("no-store")
    session_id = browser_client.cookies.get(COOKIE)
    assert session_id and len(session_id) == 43
    assert session_id not in response.text

    bootstrap = browser_client.get(SESSION_URL)
    assert bootstrap.status_code == 200
    assert bootstrap.headers.get("cache-control", "").startswith("no-store")
    assert bootstrap.headers.get("x-request-id")
    assert bootstrap.json()["authenticated"] is True
    assert bootstrap.json()["user"] == {"username": USERNAME}
    csrf_token = bootstrap.json()["csrf_token"]
    assert len(csrf_token) == 43
    assert session_id not in bootstrap.text
    assert BEARER_TOKEN not in bootstrap.text

    runtime = browser_client.app.state.browser_auth
    expected_key = hashlib.sha256(session_id.encode("ascii")).digest()
    assert expected_key in runtime.sessions._sessions
    assert session_id.encode("ascii") not in runtime.sessions._sessions


def test_login_rejects_wrong_and_unknown_accounts_generically(browser_client: TestClient) -> None:
    wrong = _login(browser_client, password="incorrect test password value")
    unknown = _login(browser_client, username="nobody", password="incorrect test password value")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"] == "auth_invalid"
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]


def test_login_requires_exact_non_null_origin(browser_client: TestClient) -> None:
    rejected = [
        _login(browser_client, origin=None),
        _login(browser_client, origin="null"),
        _login(browser_client, origin="https://attacker.example"),
        _login(browser_client, origin="http://app.example.test"),
        _login(browser_client, origin="https://app.example.test:8443"),
        _login(browser_client, origin="https://app.example.test.evil"),
    ]
    assert all(response.status_code == 403 for response in rejected)
    assert all(response.json()["error"]["code"] == "origin_rejected" for response in rejected)
    non_ascii_origin = browser_client.post(
        LOGIN_URL,
        content=b'{"username":"alice","password":"test"}',
        headers=[("Origin", b"https://app.example.test\xe9"), ("Content-Type", "application/json")],
    )
    assert non_ascii_origin.status_code == 403


def test_browser_auth_rejects_plain_http_even_with_spoofed_forwarded_proto(
    monkeypatch: pytest.MonkeyPatch, account_file: Path
) -> None:
    main = _reload_main(monkeypatch, account_file)
    with TestClient(main.app, base_url="http://app.example.test") as client:
        response = client.post(
            LOGIN_URL,
            json={"username": USERNAME, "password": PASSWORD},
            headers={"Origin": ORIGIN, "X-Forwarded-Proto": "https"},
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_rejected"


def test_login_body_is_bounded(browser_client: TestClient) -> None:
    response = browser_client.post(
        LOGIN_URL,
        content=b" " * 4_097,
        headers={"Origin": ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "invalid_request"

    too_long_password = browser_client.post(
        LOGIN_URL,
        json={"username": USERNAME, "password": "p" * 1_025},
        headers={"Origin": ORIGIN},
    )
    assert too_long_password.status_code == 422


def test_login_handles_escaped_surrogate_username_without_server_error(browser_client: TestClient) -> None:
    response = browser_client.post(
        LOGIN_URL,
        content=b'{"username":"\\ud800","password":"a test-only password that is long enough"}',
        headers={"Origin": ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_login_rate_limits_per_account_ip_and_global(browser_client: TestClient) -> None:
    for _ in range(5):
        assert _login(browser_client, password="incorrect test password value").status_code == 401
    limited = _login(browser_client, password="incorrect test password value")
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1

    now = [0.0]
    limiter = LoginAttemptLimiter(clock=lambda: now[0])
    for attempt in range(30):
        decision = limiter.check(f"192.0.2.{attempt + 1}", f"user-{attempt}")
        assert decision.allowed is True
    assert limiter.check("192.0.2.99", "user-30").allowed is False
    now[0] = 60.0
    assert limiter.check("192.0.2.99", "user-30").allowed is True


def test_successful_login_attempts_count_toward_rate_limit(browser_client: TestClient) -> None:
    for _ in range(5):
        assert _login(browser_client).status_code == 200
    limited = _login(browser_client)
    assert limited.status_code == 429
    assert limited.headers.get("retry-after")


def test_login_limiter_is_bounded_and_fails_closed() -> None:
    limiter = LoginAttemptLimiter(max_keys=2)
    assert limiter.check("192.0.2.1", "alice").allowed is True
    denied = limiter.check("192.0.2.1", "bob")
    assert denied.allowed is False
    assert denied.retry_after >= 1
    assert len(limiter._events) == 2


def test_login_limiter_enforces_ip_and_account_limits_independently() -> None:
    by_account = LoginAttemptLimiter(global_limit=100)
    for index in range(5):
        assert by_account.check(f"192.0.2.{index + 1}", "alice").allowed is True
    assert by_account.check("192.0.2.99", "alice").allowed is False

    by_ip = LoginAttemptLimiter(global_limit=100)
    for index in range(5):
        assert by_ip.check("192.0.2.1", f"user-{index}").allowed is True
    assert by_ip.check("192.0.2.1", "a-new-user").allowed is False


def test_password_verification_concurrency_is_non_queuing() -> None:
    verifier = PasswordVerifier(PasswordHasher(), max_concurrency=2)
    assert verifier.acquire() is True
    assert verifier.acquire() is True
    assert verifier.acquire() is False
    verifier.release()
    assert verifier.acquire() is True
    verifier.release()
    verifier.release()


def test_login_returns_busy_when_argon_slots_are_full(browser_client: TestClient) -> None:
    verifier = browser_client.app.state.browser_auth.password_verifier
    assert verifier.acquire() and verifier.acquire()
    try:
        response = _login(browser_client)
    finally:
        verifier.release()
        verifier.release()
    assert response.status_code == 429
    assert response.headers["retry-after"] == "1"


def test_successful_login_rotates_an_existing_session(browser_client: TestClient) -> None:
    first = _login(browser_client)
    first_id = browser_client.cookies.get(COOKIE)
    assert first.status_code == 200 and first_id
    second = _login(browser_client)
    second_id = browser_client.cookies.get(COOKIE)
    assert second.status_code == 200 and second_id and second_id != first_id
    old_session = browser_client.get(SESSION_URL, headers={"Cookie": f"{COOKIE}={first_id}"})
    assert old_session.status_code == 401
    assert browser_client.get(SESSION_URL).status_code == 200


def test_attacker_chosen_cookie_is_not_adopted(browser_client: TestClient) -> None:
    chosen = "A" * 43
    response = browser_client.post(
        LOGIN_URL,
        json={"username": USERNAME, "password": PASSWORD},
        headers={"Origin": ORIGIN, "Cookie": f"{COOKIE}={chosen}"},
    )
    assert response.status_code == 200
    fresh = browser_client.cookies.get(COOKIE)
    assert fresh and fresh != chosen
    assert browser_client.get(SESSION_URL, headers={"Cookie": f"{COOKIE}={chosen}"}).status_code == 401


def test_invalid_malformed_and_revoked_sessions_are_rejected(browser_client: TestClient) -> None:
    assert browser_client.get(SESSION_URL).status_code == 401
    assert browser_client.get(SESSION_URL, headers={"Cookie": f"{COOKIE}=malformed"}).status_code == 401
    assert browser_client.get(SESSION_URL, headers={"Cookie": f"{COOKIE}={'A' * 43}"}).status_code == 401
    response = _login(browser_client)
    assert response.status_code == 200
    csrf = browser_client.get(SESSION_URL).json()["csrf_token"]
    logout = browser_client.post(LOGOUT_URL, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert logout.status_code == 200
    assert browser_client.get(SESSION_URL).status_code == 401


def test_session_idle_expiry_occurs_at_exact_boundary() -> None:
    now = [100.0]
    store = BrowserSessionStore(capacity=2, idle_timeout_seconds=10, absolute_lifetime_seconds=30, clock=lambda: now[0])
    session_id, record = store.create(USERNAME)
    assert store.get(session_id) == record
    now[0] = 109.999
    assert store.get(session_id) is not None
    now[0] = 110.0
    assert store.get(session_id) is None


def test_session_absolute_expiry_occurs_at_exact_boundary() -> None:
    now = [0.0]
    store = BrowserSessionStore(capacity=2, idle_timeout_seconds=10, absolute_lifetime_seconds=30, clock=lambda: now[0])
    session_id, _ = store.create(USERNAME)
    for timestamp in (9.0, 18.0, 27.0, 29.0):
        now[0] = timestamp
        assert store.get(session_id, touch=True) is not None
    now[0] = 30.0
    assert store.get(session_id, touch=True) is None


def test_session_capacity_rejects_without_evicting_active_session() -> None:
    now = [0.0]
    store = BrowserSessionStore(capacity=1, idle_timeout_seconds=10, absolute_lifetime_seconds=30, clock=lambda: now[0])
    first_id, first = store.create(USERNAME)
    with pytest.raises(SessionCapacityError):
        store.create("bob")
    assert store.get(first_id) == first
    assert len(store) == 1


def test_concurrent_session_creation_never_exceeds_capacity() -> None:
    capacity = 8
    store = BrowserSessionStore(capacity=capacity)

    def create(index: int) -> bool:
        try:
            store.create(f"user-{index}")
            return True
        except SessionCapacityError:
            return False

    with ThreadPoolExecutor(max_workers=32) as executor:
        created = list(executor.map(create, range(32)))
    assert sum(created) == capacity
    assert len(store) == capacity


def test_session_endpoint_does_not_touch_idle_deadline(browser_client: TestClient) -> None:
    assert _login(browser_client).status_code == 200
    session_id = browser_client.cookies.get(COOKIE)
    runtime = browser_client.app.state.browser_auth
    stored = runtime.sessions.get(session_id)
    assert stored is not None
    before = stored.last_activity_at
    assert browser_client.get(SESSION_URL).status_code == 200
    after = runtime.sessions.get(session_id)
    assert after is not None and after.last_activity_at == before


def test_logout_requires_origin_and_synchronizer_csrf(browser_client: TestClient) -> None:
    assert _login(browser_client).status_code == 200
    csrf = browser_client.get(SESSION_URL).json()["csrf_token"]
    for headers in (
        {"X-CSRF-Token": csrf},
        {"Origin": ORIGIN},
        {"Origin": ORIGIN, "X-CSRF-Token": "wrong"},
    ):
        response = browser_client.post(LOGOUT_URL, headers=headers)
        assert response.status_code == 403
    non_ascii_token = browser_client.post(LOGOUT_URL, headers=[("Origin", ORIGIN), ("X-CSRF-Token", b"\xe9")])
    assert non_ascii_token.status_code == 403
    assert browser_client.get(SESSION_URL).status_code == 200

    success = browser_client.post(LOGOUT_URL, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert success.status_code == 200
    assert success.json() == {"authenticated": False}
    cleared = success.headers["set-cookie"].lower()
    assert f"{COOKIE.lower()}=" in cleared
    assert "max-age=0" in cleared
    assert "secure" in cleared and "httponly" in cleared and "samesite=lax" in cleared and "path=/" in cleared
    assert "domain=" not in cleared


def test_get_logout_does_not_exist_as_a_state_changing_route(browser_client: TestClient) -> None:
    assert _login(browser_client).status_code == 200
    csrf = browser_client.get(SESSION_URL).json()["csrf_token"]
    response = browser_client.get(LOGOUT_URL, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 405
    assert browser_client.head(LOGOUT_URL, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf}).status_code == 405
    assert browser_client.get(SESSION_URL).status_code == 200


def test_session_capacity_exhaustion_does_not_evict_existing_cookie(browser_client: TestClient) -> None:
    assert _login(browser_client).status_code == 200
    first_id = browser_client.cookies.get(COOKIE)
    runtime = browser_client.app.state.browser_auth
    runtime.sessions._capacity = 1
    browser_client.cookies.clear()
    denied = _login(browser_client)
    assert denied.status_code == 429
    assert browser_client.get(SESSION_URL, headers={"Cookie": f"{COOKIE}={first_id}"}).status_code == 200


def test_forwarded_ip_headers_are_ignored_from_untrusted_direct_client(browser_client: TestClient) -> None:
    response = _login(
        browser_client,
        password="incorrect test password value",
    )
    assert response.status_code == 401
    response = browser_client.post(
        LOGIN_URL,
        json={"username": "bob", "password": "incorrect test password value"},
        headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.42"},
    )
    assert response.status_code == 401
    limiter = browser_client.app.state.browser_auth.login_limiter
    assert "ip:testclient" in limiter._events
    assert "ip:203.0.113.42" not in limiter._events


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/analyse-url", {"url": "https://example.com/"}),
        ("/generate-article", {"topic": "test topic", "keywords": [], "tone": "professional"}),
        ("/boost-seo", {"url": "https://example.com/"}),
    ],
)
def test_browser_session_does_not_authenticate_legacy_bearer_routes(
    browser_client: TestClient, path: str, payload: dict[str, object]
) -> None:
    assert _login(browser_client).status_code == 200
    response = browser_client.post(path, json=payload)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_required"


def test_legacy_bearer_does_not_authenticate_browser_session(browser_client: TestClient) -> None:
    response = browser_client.get(SESSION_URL, headers={"Authorization": f"Bearer {BEARER_TOKEN}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_required"
    assert BEARER_TOKEN not in response.text


def test_enabled_auth_preserves_health_and_readiness(browser_client: TestClient) -> None:
    assert browser_client.get("/health").status_code == 200
    readiness = browser_client.get("/ready")
    assert readiness.status_code == 200
    assert readiness.json()["status"] == "ok"


def test_auth_responses_and_logs_do_not_expose_secrets(
    browser_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    password = "test-password-must-not-appear"
    caplog.set_level("INFO")
    response = _login(browser_client, username="unknown-account", password=password)
    assert response.status_code == 401
    assert password not in response.text and password not in caplog.text
    assert BEARER_TOKEN not in response.text and BEARER_TOKEN not in caplog.text
    assert browser_client.get(SESSION_URL).status_code == 401


def test_account_file_is_validated_at_startup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    malformed = tmp_path / "bad-accounts.json"
    malformed.write_text("not-json")
    main = _reload_main(monkeypatch, malformed)
    with pytest.raises(ConfigurationError):
        with TestClient(main.app, base_url=ORIGIN):
            pass


def test_account_loader_rejects_invalid_hash_and_repository_paths(tmp_path: Path) -> None:
    malformed = tmp_path / "invalid-hash.json"
    malformed.write_text(
        json.dumps({"version": 1, "users": [{"username": USERNAME, "password_hash": "not-a-verifier"}]})
    )
    with pytest.raises(ConfigurationError):
        load_accounts(str(malformed))

    repository_file = Path(__file__).resolve().parents[1] / "backend" / "app" / "config.py"
    with pytest.raises(ConfigurationError, match="outside the repository"):
        load_accounts(str(repository_file))


@pytest.mark.skipif(os.name != "posix", reason="POSIX account-file mode check")
def test_account_loader_requires_owner_read_permission(account_file: Path) -> None:
    original_mode = account_file.stat().st_mode & 0o777
    account_file.chmod(original_mode & ~0o400)
    try:
        # Some POSIX users cannot open the file at all after this chmod; the
        # loader must fail closed whether the OS or the explicit mode check
        # reports the unreadable source first.
        with pytest.raises(ConfigurationError):
            load_accounts(str(account_file))
    finally:
        account_file.chmod(original_mode)


def test_operator_provisioning_writes_only_hashes_and_preserves_existing_users(tmp_path: Path) -> None:
    path = tmp_path / "browser-accounts.json"
    provision_user("Alice", PASSWORD, path)
    provision_user("bob", "another sufficiently long test-only password", path)
    encoded = path.read_text(encoding="utf-8")
    document = json.loads(encoded)
    assert PASSWORD not in encoded
    assert document["version"] == 1
    assert [user["username"] for user in document["users"]] == ["alice", "bob"]
    assert document["users"][0]["password_hash"].startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert set(load_accounts(str(path))) == {"alice", "bob"}
    if os.name == "posix":
        assert path.stat().st_mode & 0o777 == 0o600


def test_operator_provisioner_rejects_repo_path_duplicate_short_password_and_stale_lock(tmp_path: Path) -> None:
    repository_file = Path(__file__).resolve().parents[1] / "backend" / "app" / "config.py"
    with pytest.raises(ProvisioningError, match="outside the repository"):
        provision_user(USERNAME, PASSWORD, repository_file)
    assert repository_file.is_file()

    path = tmp_path / "accounts.json"
    provision_user(USERNAME, PASSWORD, path)
    with pytest.raises(ProvisioningError, match="already provisioned"):
        provision_user(USERNAME, PASSWORD, path)
    with pytest.raises(ProvisioningError, match="15"):
        provision_user("bob", "too-short", path)

    stale_lock = path.with_name(f".{path.name}.lock")
    stale_lock.write_text("operator-owned lock", encoding="utf-8")
    with pytest.raises(ProvisioningError, match="lock file"):
        provision_user("charlie", PASSWORD, path)
    assert stale_lock.read_text(encoding="utf-8") == "operator-owned lock"


def test_provisioning_cli_prompts_for_password_and_never_prints_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    password = "cli-only test password that is long enough"
    prompts = iter([password, password])
    monkeypatch.setattr(provisioner.getpass, "getpass", lambda _prompt: next(prompts))
    monkeypatch.setattr(
        provisioner.sys,
        "argv",
        ["provision_browser_user.py", "cli-user", "--accounts-file", str(tmp_path / "accounts.json")],
    )
    assert provisioner.main() == 0
    output = capsys.readouterr()
    assert password not in output.out and password not in output.err
    assert "cli-user" in output.out


def test_login_uses_no_outbound_fetch_or_ai_request(
    browser_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fetcher = browser_client.app.state.safe_fetcher
    called = False

    async def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("login must not fetch external pages")

    monkeypatch.setattr(fetcher, "fetch_url", fail_if_called)
    assert _login(browser_client).status_code == 200
    assert called is False
    assert browser_client.app.state.gemini_service is None
