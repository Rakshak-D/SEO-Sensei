"""Bounded Cloudflare Turnstile Siteverify integration."""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
import time
from collections.abc import Callable
from json import JSONDecodeError

import httpx


SITEVERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_SITEVERIFY_RESPONSE_BYTES = 16_384
TOKEN_TTL_SECONDS = 300.0


class TurnstileUnavailable(RuntimeError):
    """The fixed verification provider could not be checked safely."""


class ReplayRegistryFull(RuntimeError):
    """The bounded replay registry is full and cannot safely accept a token."""


class TurnstileReplayGuard:
    """Retain only short-lived hashes of consumed challenge tokens."""

    def __init__(
        self,
        *,
        ttl_seconds: float = TOKEN_TTL_SECONDS,
        max_entries: int = 4_096,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if ttl_seconds <= 0 or max_entries < 1:
            raise ValueError("Replay guard settings must be positive.")
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._used: dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, token: str) -> bool:
        """Atomically consume a token digest; return false for a replay."""

        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = self._clock()
        with self._lock:
            self._purge(now)
            if digest in self._used:
                return False
            if len(self._used) >= self._max_entries:
                raise ReplayRegistryFull("Challenge verification capacity is unavailable.")
            self._used[digest] = now
            return True

    def _purge(self, now: float) -> None:
        expired = [key for key, timestamp in self._used.items() if timestamp <= now - self._ttl_seconds]
        for key in expired:
            self._used.pop(key, None)


class TurnstileVerifier:
    """Check challenge tokens only at Cloudflare's fixed Siteverify endpoint."""

    def __init__(
        self,
        secret: str,
        *,
        expected_hostname: str,
        expected_action: str,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = 3.0,
    ) -> None:
        if not secret or not expected_hostname or not expected_action:
            raise ValueError("Turnstile verifier configuration is incomplete.")
        if not 0 < timeout_seconds <= 10:
            raise ValueError("Turnstile timeout is outside the allowed range.")
        self._secret = secret
        self._expected_hostname = expected_hostname
        self._expected_action = expected_action
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def verify(self, token: str) -> bool:
        """Return true only for a bounded success matching host and action."""

        if not isinstance(token, str) or not token or len(token) > 2_048:
            return False
        try:
            async with asyncio.timeout(self._timeout_seconds):
                async with self._client.stream(
                    "POST",
                    SITEVERIFY_ENDPOINT,
                    data={"secret": self._secret, "response": token},
                    headers={"Accept": "application/json", "Accept-Encoding": "identity"},
                ) as response:
                    if (
                        response.status_code != 200
                        or response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                        != "application/json"
                        or response.headers.get("content-encoding", "identity").strip().lower() not in {"", "identity"}
                    ):
                        raise TurnstileUnavailable("Challenge verification is unavailable.")
                    payload = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(payload) + len(chunk) > MAX_SITEVERIFY_RESPONSE_BYTES:
                            raise TurnstileUnavailable("Challenge verification is unavailable.")
                        payload.extend(chunk)
        except TurnstileUnavailable:
            raise
        except Exception:
            # Deliberately discard provider and transport exception text; it may
            # contain request details and is never useful in a public response.
            raise TurnstileUnavailable("Challenge verification is unavailable.") from None

        try:
            result = json.loads(bytes(payload), object_pairs_hook=_unique_object)
        except (JSONDecodeError, UnicodeDecodeError, ValueError, RecursionError):
            raise TurnstileUnavailable("Challenge verification is unavailable.") from None

        return (
            isinstance(result, dict)
            and result.get("success") is True
            and result.get("hostname") == self._expected_hostname
            and result.get("action") == self._expected_action
        )

    async def aclose(self) -> None:
        await self._client.aclose()


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate provider response key.")
        value[key] = item
    return value
