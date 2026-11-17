"""Bounded, process-local anonymous guest sessions."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable


class GuestSessionCapacityError(RuntimeError):
    """The guest-session registry is full of unexpired identities."""


@dataclass(frozen=True, slots=True)
class GuestSession:
    """Minimal server-side guest session state; contains no submitted audit data."""

    visitor_id: str
    expires_at: float


class GuestSessionStore:
    """Store only digests of random cookie values in a bounded registry."""

    def __init__(
        self,
        *,
        capacity: int = 2_048,
        lifetime_seconds: int = 3_600,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if capacity < 1 or lifetime_seconds < 1:
            raise ValueError("Guest session settings must be positive.")
        self._capacity = capacity
        self._lifetime_seconds = lifetime_seconds
        self._clock = clock
        self._csrf_key = secrets.token_bytes(32)
        self._sessions: dict[str, GuestSession] = {}
        self._lock = threading.Lock()

    def create(self) -> tuple[str, GuestSession]:
        """Issue a new opaque browser cookie and its pseudonymous limiter key."""

        cookie = secrets.token_urlsafe(32)
        digest = self._digest(cookie)
        now = self._clock()
        with self._lock:
            self._purge(now)
            if len(self._sessions) >= self._capacity:
                raise GuestSessionCapacityError("Guest session capacity is unavailable.")
            session = GuestSession(visitor_id=digest, expires_at=now + self._lifetime_seconds)
            self._sessions[digest] = session
        return cookie, session

    def get(self, cookie: str | None) -> GuestSession | None:
        """Look up a well-formed cookie without refreshing its fixed lifetime."""

        if not self._valid_cookie(cookie):
            return None
        assert cookie is not None
        digest = self._digest(cookie)
        now = self._clock()
        with self._lock:
            self._purge(now)
            session = self._sessions.get(digest)
            if session is None or not hmac.compare_digest(session.visitor_id, digest):
                return None
            return session

    def csrf_token(self, cookie: str) -> str:
        """Derive a session-bound synchronizer value without storing it."""

        if self.get(cookie) is None:
            raise ValueError("A live guest session is required.")
        digest = hmac.new(self._csrf_key, cookie.encode("ascii"), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    def verify_csrf(self, cookie: str | None, supplied: str | None) -> bool:
        if not isinstance(supplied, str) or not supplied or not self._valid_cookie(cookie):
            return False
        assert cookie is not None
        try:
            expected = self.csrf_token(cookie)
        except ValueError:
            return False
        return hmac.compare_digest(expected.encode("ascii"), supplied.encode("utf-8", errors="surrogatepass"))

    @property
    def lifetime_seconds(self) -> int:
        return self._lifetime_seconds

    def __len__(self) -> int:
        with self._lock:
            self._purge(self._clock())
            return len(self._sessions)

    @staticmethod
    def _valid_cookie(cookie: str | None) -> bool:
        if not isinstance(cookie, str) or len(cookie) != 43:
            return False
        try:
            decoded = base64.b64decode(cookie + "=", altchars=b"-_", validate=True)
        except (ValueError, binascii.Error):
            return False
        return len(decoded) == 32

    @staticmethod
    def _digest(cookie: str) -> str:
        return hashlib.sha256(cookie.encode("ascii")).hexdigest()

    def _purge(self, now: float) -> None:
        expired = [key for key, session in self._sessions.items() if session.expires_at <= now]
        for key in expired:
            self._sessions.pop(key, None)
