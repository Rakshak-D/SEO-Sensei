from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import parse_qs

import httpx
import pytest

from backend.app.config import ConfigurationError, Settings
from backend.app.security.guest_identity import GuestSessionCapacityError, GuestSessionStore
from backend.app.security.guest_limits import GuestAnalysisLimits, GuestLimitExceeded
from backend.app.security.turnstile import (
    ReplayRegistryFull,
    TurnstileReplayGuard,
    TurnstileUnavailable,
    TurnstileVerifier,
)


ORIGIN = "https://app.example.test"
TURNSTILE_SECRET = "test-only-turnstile-server-secret"
TURNSTILE_TOKEN = "test-only-turnstile-response-token"
SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _settings(**overrides: str) -> Settings:
    values = {
        "APP_ENV": "test",
        "API_ACCESS_TOKEN": "test-only-operator-token",
        "GUEST_AUDITS_ENABLED": "true",
        "GUEST_APP_ORIGIN": ORIGIN,
        "GUEST_TURNSTILE_TEST_MODE": "true",
        **overrides,
    }
    return Settings.from_environment(values)


def _assert_not_present(value: str, text: str, message: str) -> None:
    if value in text:
        raise AssertionError(message)


def test_guest_audits_are_disabled_by_default() -> None:
    settings = Settings.from_environment({"APP_ENV": "test", "API_ACCESS_TOKEN": "test-only-token"})

    assert settings.guest_audits_enabled is False
    assert settings.guest_app_origin is None
    assert settings.guest_turnstile_secret_key is None


def test_production_guest_configuration_requires_https_turnstile_and_topology_gate() -> None:
    common = {
        "APP_ENV": "production",
        "API_ACCESS_TOKEN": "test-only-token",
        "GUEST_AUDITS_ENABLED": "true",
        "GUEST_APP_ORIGIN": ORIGIN,
        "GUEST_TURNSTILE_SITEKEY": "public-site-key",
        "GUEST_TURNSTILE_SECRET_KEY": TURNSTILE_SECRET,
        "GUEST_TURNSTILE_EXPECTED_HOSTNAME": "app.example.test",
        "GUEST_TURNSTILE_ACTION": "guest_analysis",
        "GUEST_TURNSTILE_TEST_MODE": "false",
    }

    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(common)

    production = Settings.from_environment({**common, "GUEST_PROCESS_LOCAL_LIMITS_CONFIRMED": "true"})
    assert production.guest_audits_enabled is True
    assert production.guest_turnstile_test_mode is False
    _assert_not_present(TURNSTILE_SECRET, repr(production), "Turnstile secret is visible in settings repr")

    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(
            {
                **common,
                "GUEST_PROCESS_LOCAL_LIMITS_CONFIRMED": "true",
                "WEB_CONCURRENCY": "2",
            }
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"GUEST_APP_ORIGIN": "http://app.example.test"},
        {"GUEST_APP_ORIGIN": "https://app.example.test/"},
        {"GUEST_APP_ORIGIN": "https://user@app.example.test"},
        {"GUEST_APP_ORIGIN": "https://app.example.test:443"},
        {"GUEST_APP_ORIGIN": "https://*.example.test"},
    ],
)
def test_guest_configuration_rejects_noncanonical_origins(overrides: dict[str, str]) -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        _settings(**overrides)


def test_turnstile_test_mode_is_forbidden_in_production() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "API_ACCESS_TOKEN": "test-only-token",
                "GUEST_AUDITS_ENABLED": "true",
                "GUEST_APP_ORIGIN": ORIGIN,
                "GUEST_TURNSTILE_TEST_MODE": "true",
            }
        )


def test_guest_turnstile_rejects_blank_server_secret() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(
            {
                "APP_ENV": "test",
                "API_ACCESS_TOKEN": "test-only-token",
                "GUEST_AUDITS_ENABLED": "true",
                "GUEST_APP_ORIGIN": ORIGIN,
                "GUEST_TURNSTILE_SITEKEY": "test-sitekey",
                "GUEST_TURNSTILE_SECRET_KEY": "   ",
                "GUEST_TURNSTILE_EXPECTED_HOSTNAME": "app.example.test",
                "GUEST_TURNSTILE_ACTION": "guest_analysis",
            }
        )


def test_development_test_mode_requires_a_loopback_application_origin() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment(
            {
                "APP_ENV": "development",
                "GUEST_AUDITS_ENABLED": "true",
                "GUEST_APP_ORIGIN": ORIGIN,
                "GUEST_TURNSTILE_TEST_MODE": "true",
            }
        )

    assert Settings.from_environment(
        {
            "APP_ENV": "development",
            "GUEST_AUDITS_ENABLED": "true",
            "GUEST_APP_ORIGIN": "https://localhost:5173",
            "GUEST_TURNSTILE_TEST_MODE": "true",
        }
    ).guest_turnstile_test_mode


def test_guest_quota_configuration_is_bounded_and_consistent() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        _settings(GUEST_SESSION_CAPACITY="10001")
    with pytest.raises(ConfigurationError, match="invalid"):
        _settings(GUEST_GLOBAL_AUDITS_PER_DAY="50001")
    with pytest.raises(ConfigurationError, match="invalid"):
        _settings(GUEST_AUDIT_CONCURRENT_PER_VISITOR="0")


def test_guest_session_cookie_is_opaque_and_csrf_is_session_bound() -> None:
    sessions = GuestSessionStore(capacity=2, lifetime_seconds=3_600)
    cookie, session = sessions.create()
    csrf = sessions.csrf_token(cookie)

    assert len(cookie) == 43
    assert len(session.visitor_id) == 64
    assert session.visitor_id != cookie
    assert isinstance(csrf, str) and len(csrf) >= 40
    assert sessions.get(cookie) == session
    assert sessions.verify_csrf(cookie, csrf)
    assert not sessions.verify_csrf(cookie, "wrong-csrf-token")
    _assert_not_present(cookie, repr(sessions._sessions), "Raw guest cookie was retained in session storage")
    _assert_not_present(csrf, repr(sessions._sessions), "Raw CSRF value was retained in session storage")


def test_guest_session_store_rejects_invalid_tampered_and_expired_values() -> None:
    now = [10.0]
    sessions = GuestSessionStore(capacity=2, lifetime_seconds=60, clock=lambda: now[0])
    cookie, _ = sessions.create()

    assert sessions.get(None) is None
    assert sessions.get("short") is None
    assert sessions.get(cookie[:-1] + ("A" if cookie[-1] != "A" else "B")) is None
    now[0] += 60.0
    assert sessions.get(cookie) is None
    assert len(sessions) == 0


def test_guest_session_capacity_does_not_evict_an_existing_session() -> None:
    sessions = GuestSessionStore(capacity=1, lifetime_seconds=3_600)
    cookie, session = sessions.create()

    with pytest.raises(GuestSessionCapacityError):
        sessions.create()

    assert sessions.get(cookie) == session
    assert len(sessions) == 1


def test_guest_limits_are_independent_per_visitor_and_per_ip() -> None:
    limits = GuestAnalysisLimits(
        visitor_per_minute=5,
        visitor_per_hour=10,
        ip_per_minute=1,
        ip_per_hour=10,
        global_per_minute=10,
        global_per_hour=20,
        global_daily=20,
    )

    first = limits.admit_audit("visitor-a", "198.51.100.1")
    first.commit()
    first.release()

    with pytest.raises(GuestLimitExceeded):
        limits.admit_audit("visitor-b", "198.51.100.1")

    other_ip = limits.admit_audit("visitor-b", "198.51.100.2")
    other_ip.commit()
    other_ip.release()


def test_guest_limits_use_injected_clock_and_retry_after() -> None:
    now = [0.0]
    limits = GuestAnalysisLimits(
        visitor_per_minute=1,
        visitor_per_hour=2,
        ip_per_minute=5,
        ip_per_hour=10,
        global_per_minute=5,
        global_per_hour=10,
        global_daily=10,
        clock=lambda: now[0],
    )
    lease = limits.admit_audit("visitor", "198.51.100.1")
    lease.commit()
    lease.release()

    with pytest.raises(GuestLimitExceeded) as captured:
        limits.admit_audit("visitor", "198.51.100.1")
    assert captured.value.retry_after == 60

    now[0] = 60.0
    recovered = limits.admit_audit("visitor", "198.51.100.1")
    recovered.commit()
    recovered.release()


def test_uncommitted_guest_audit_reservation_rolls_back_and_committed_budget_remains() -> None:
    limits = GuestAnalysisLimits(
        visitor_per_minute=1,
        visitor_per_hour=2,
        ip_per_minute=3,
        ip_per_hour=5,
        global_per_minute=3,
        global_per_hour=5,
        global_daily=5,
    )

    verification_rejected = limits.admit_audit("visitor-a", "198.51.100.1")
    verification_rejected.release()
    accepted = limits.admit_audit("visitor-a", "198.51.100.1")
    accepted.commit()
    accepted.release()
    with pytest.raises(GuestLimitExceeded):
        limits.admit_audit("visitor-a", "198.51.100.1")


def test_guest_bootstrap_and_bot_attempts_have_separate_ip_budgets() -> None:
    now = [0.0]
    limits = GuestAnalysisLimits(
        bootstrap_per_minute=1,
        bootstrap_per_hour=2,
        bot_attempts_per_minute=1,
        bot_attempts_per_hour=2,
        clock=lambda: now[0],
    )

    limits.admit_bootstrap("198.51.100.1")
    with pytest.raises(GuestLimitExceeded):
        limits.admit_bootstrap("198.51.100.1")
    limits.admit_bot_attempt("198.51.100.1")
    with pytest.raises(GuestLimitExceeded):
        limits.admit_bot_attempt("198.51.100.1")


def test_guest_global_daily_budget_and_concurrency_fail_closed() -> None:
    limits = GuestAnalysisLimits(
        visitor_per_minute=10,
        visitor_per_hour=20,
        ip_per_minute=10,
        ip_per_hour=20,
        global_per_minute=1,
        global_per_hour=1,
        global_daily=1,
        max_global_concurrent=1,
        max_visitor_concurrent=1,
    )
    first = limits.admit_audit("visitor-a", "198.51.100.1")
    with pytest.raises(GuestLimitExceeded):
        limits.admit_audit("visitor-b", "198.51.100.2")
    assert limits.active_total == 1
    first.commit()
    first.release()
    assert limits.active_total == 0
    with pytest.raises(GuestLimitExceeded):
        limits.admit_audit("visitor-b", "198.51.100.2")


def test_guest_admission_is_atomic_under_concurrent_calls() -> None:
    limits = GuestAnalysisLimits(
        visitor_per_minute=20,
        visitor_per_hour=20,
        ip_per_minute=20,
        ip_per_hour=20,
        global_per_minute=20,
        global_per_hour=20,
        global_daily=20,
        max_global_concurrent=1,
    )
    barrier = Barrier(8)

    def attempt(index: int):
        barrier.wait()
        try:
            return limits.admit_audit(f"visitor-{index}", f"ip-{index}")
        except GuestLimitExceeded:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        leases = list(pool.map(attempt, range(8)))

    admitted = [lease for lease in leases if lease is not None]
    assert len(admitted) == 1
    assert limits.active_total == 1
    admitted[0].release()
    assert limits.active_total == 0


def test_guest_limiter_key_capacity_is_bounded() -> None:
    limits = GuestAnalysisLimits(
        max_visitor_keys=1,
        max_ip_keys=1,
        clock=lambda: 0.0,
    )
    limits.admit_bootstrap("ip-a")
    with pytest.raises(GuestLimitExceeded):
        limits.admit_bootstrap("ip-b")


def test_turnstile_replay_guard_hashes_tokens_and_expires_entries() -> None:
    now = [0.0]
    guard = TurnstileReplayGuard(ttl_seconds=300, max_entries=2, clock=lambda: now[0])

    assert guard.claim(TURNSTILE_TOKEN)
    assert not guard.claim(TURNSTILE_TOKEN)
    _assert_not_present(TURNSTILE_TOKEN, repr(guard._used), "Raw challenge token was retained in replay guard")
    now[0] = 301.0
    assert guard.claim(TURNSTILE_TOKEN)


def test_turnstile_replay_guard_capacity_fails_closed() -> None:
    guard = TurnstileReplayGuard(ttl_seconds=300, max_entries=1, clock=lambda: 0.0)
    assert guard.claim("challenge-one")
    with pytest.raises(ReplayRegistryFull):
        guard.claim("challenge-two")


def _verifier(
    handler,
    *,
    secret: str = TURNSTILE_SECRET,
    expected_hostname: str = "app.example.test",
    expected_action: str = "guest_analysis",
) -> TurnstileVerifier:
    return TurnstileVerifier(
        secret,
        expected_hostname=expected_hostname,
        expected_action=expected_action,
        transport=httpx.MockTransport(handler),
    )


def test_turnstile_server_verification_uses_fixed_endpoint_and_checks_host_action() -> None:
    captured: dict[str, object] = {}

    def provider(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = parse_qs(request.content.decode("ascii"))
        return httpx.Response(
            200,
            json={"success": True, "hostname": "app.example.test", "action": "guest_analysis"},
        )

    verifier = _verifier(provider)
    try:
        assert asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())

    assert captured["url"] == SITEVERIFY_URL
    body = captured["body"]
    if not isinstance(body, dict) or set(body) != {"secret", "response"} or "remoteip" in body:
        raise AssertionError("Siteverify request fields were incomplete")


@pytest.mark.parametrize(
    "response",
    [
        {"success": False, "hostname": "app.example.test", "action": "guest_analysis"},
        {"success": True, "hostname": "attacker.example", "action": "guest_analysis"},
        {"success": True, "hostname": "app.example.test", "action": "other_action"},
        {"success": "true", "hostname": "app.example.test", "action": "guest_analysis"},
    ],
)
def test_turnstile_rejects_failed_or_mismatched_siteverify_results(response: dict[str, object]) -> None:
    verifier = _verifier(lambda _request: httpx.Response(200, json=response))
    try:
        assert not asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())


@pytest.mark.parametrize(
    "provider_response",
    [
        httpx.Response(503, json={"success": False}),
        httpx.Response(200, content=b"not-json"),
        httpx.Response(200, content=b"x" * 16_385, headers={"Content-Type": "application/json"}),
        httpx.Response(
            200,
            content=b'{"success":true,"success":false}',
            headers={"Content-Type": "application/json"},
        ),
    ],
)
def test_turnstile_provider_errors_are_bounded_and_sanitized(provider_response: httpx.Response) -> None:
    verifier = _verifier(lambda _request: provider_response)
    try:
        with pytest.raises(TurnstileUnavailable):
            asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())


def test_turnstile_network_timeout_fails_closed() -> None:
    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("provider timeout")

    verifier = _verifier(timeout)
    try:
        with pytest.raises(TurnstileUnavailable):
            asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())


def test_turnstile_rejects_compressed_siteverify_response() -> None:
    class CompressedStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"untrusted compressed response"

        async def aclose(self) -> None:
            return None

    verifier = _verifier(
        lambda _request: httpx.Response(
            200,
            headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
            stream=CompressedStream(),
        )
    )
    try:
        with pytest.raises(TurnstileUnavailable):
            asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())


def test_turnstile_total_verification_deadline_fails_closed() -> None:
    class HangingStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b"{}"

        async def aclose(self) -> None:
            return None

    verifier = _verifier(
        lambda _request: httpx.Response(
            200,
            headers={"Content-Type": "application/json"},
            stream=HangingStream(),
        )
    )
    verifier._timeout_seconds = 0.01
    try:
        with pytest.raises(TurnstileUnavailable):
            asyncio.run(verifier.verify(TURNSTILE_TOKEN))
    finally:
        asyncio.run(verifier.aclose())
