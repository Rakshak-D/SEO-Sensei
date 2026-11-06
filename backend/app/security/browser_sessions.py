"""Bounded, process-local storage for opaque browser sessions."""

from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from dataclasses import dataclass, replace
from typing import Callable


_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


@dataclass(frozen=True, slots=True)
class BrowserSession:
    username: str
    created_at: float
    last_activity_at: float
    absolute_expires_at: float
    csrf_token: str


class SessionCapacityError(RuntimeError):
    """Raised when a new session would exceed the configured process bound."""


class BrowserSessionStore:
    """Thread-safe in-memory sessions keyed only by a digest of the cookie ID.

    Sessions are intentionally process-local. Restarting the API invalidates all
    browser sessions; multiple workers or instances are unsupported.
    """

    def __init__(
        self,
        *,
        capacity: int = 64,
        idle_timeout_seconds: int = 1_800,
        absolute_lifetime_seconds: int = 28_800,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if capacity < 1 or capacity > 64:
            raise ValueError("Session capacity must be between 1 and 64.")
        if idle_timeout_seconds < 1 or absolute_lifetime_seconds < idle_timeout_seconds:
            raise ValueError("Session timeout settings are invalid.")
        self._capacity = capacity
        self._idle_timeout = idle_timeout_seconds
        self._absolute_lifetime = absolute_lifetime_seconds
        self._clock = clock
        self._sessions: dict[bytes, BrowserSession] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _key(session_id: str | None) -> bytes | None:
        if not session_id or not _SESSION_ID_PATTERN.fullmatch(session_id):
            return None
        return hashlib.sha256(session_id.encode("ascii")).digest()

    def create(self, username: str, replacing_session_id: str | None = None) -> tuple[str, BrowserSession]:
        """Create a fresh session, revoking a valid replaced cookie atomically."""

        now = self._clock()
        session_id = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        key = self._key(session_id)
        assert key is not None
        record = BrowserSession(
            username=username,
            created_at=now,
            last_activity_at=now,
            absolute_expires_at=now + self._absolute_lifetime,
            csrf_token=csrf_token,
        )

        with self._lock:
            self._purge_expired(now)
            replaced_key = self._key(replacing_session_id)
            if replaced_key is not None:
                self._sessions.pop(replaced_key, None)
            if len(self._sessions) >= self._capacity:
                raise SessionCapacityError
            self._sessions[key] = record
        return session_id, record

    def get(self, session_id: str | None, *, touch: bool = False) -> BrowserSession | None:
        """Return a live session, optionally refreshing its idle deadline."""

        key = self._key(session_id)
        if key is None:
            return None
        now = self._clock()
        with self._lock:
            self._purge_expired(now)
            record = self._sessions.get(key)
            if record is None:
                return None
            if touch:
                record = replace(record, last_activity_at=now)
                self._sessions[key] = record
            return record

    def revoke(self, session_id: str | None) -> bool:
        """Revoke a session by cookie value without retaining that value."""

        key = self._key(session_id)
        if key is None:
            return False
        with self._lock:
            self._purge_expired(self._clock())
            return self._sessions.pop(key, None) is not None

    def __len__(self) -> int:
        with self._lock:
            self._purge_expired(self._clock())
            return len(self._sessions)

    def _purge_expired(self, now: float) -> None:
        expired = [
            key
            for key, record in self._sessions.items()
            if now >= record.absolute_expires_at or now >= record.last_activity_at + self._idle_timeout
        ]
        for key in expired:
            del self._sessions[key]
