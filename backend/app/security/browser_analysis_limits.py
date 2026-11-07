"""Bounded, process-local admission limits for browser URL analysis."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable


WINDOW_MINUTE_SECONDS = 60.0
WINDOW_HOUR_SECONDS = 3_600.0
MAX_USER_KEYS = 64
MAX_CLIENT_IP_KEYS = 4_096


@dataclass(frozen=True, slots=True, eq=False)
class _Event:
    timestamp: float


class BrowserAnalysisLimitExceeded(RuntimeError):
    """A bounded account, client, process or concurrency budget was exhausted."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, min(3_600, retry_after))
        super().__init__("Browser analysis capacity is temporarily unavailable.")


@dataclass(slots=True)
class BrowserAnalysisLease:
    """One admitted work slot; release is safe on success, error or cancellation."""

    _owner: BrowserAnalysisLimits = field(repr=False)
    _username: str = field(repr=False)
    _client_ip: str = field(repr=False)
    _event: _Event = field(repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    def release(self) -> None:
        """Release concurrency while retaining the consumed request budget."""

        self._owner._finish(self, rollback=False)

    def cancel(self) -> None:
        """Release a reservation that was not allowed to start work."""

        self._owner._finish(self, rollback=True)

    def __enter__(self) -> BrowserAnalysisLease:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.release()


class BrowserAnalysisLimits:
    """Atomic sliding-window budgets and bounded non-queuing concurrency slots.

    Limits are process-local. A multi-worker or multi-instance deployment needs
    an explicitly reviewed shared coordination mechanism.
    """

    def __init__(
        self,
        *,
        user_per_minute: int = 6,
        user_per_hour: int = 30,
        ip_per_minute: int = 12,
        ip_per_hour: int = 60,
        global_per_minute: int = 30,
        global_per_hour: int = 150,
        max_global_concurrent: int = 2,
        max_user_concurrent: int = 1,
        max_user_keys: int = MAX_USER_KEYS,
        max_client_ip_keys: int = MAX_CLIENT_IP_KEYS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        limits = (
            user_per_minute,
            user_per_hour,
            ip_per_minute,
            ip_per_hour,
            global_per_minute,
            global_per_hour,
            max_global_concurrent,
            max_user_concurrent,
            max_user_keys,
            max_client_ip_keys,
        )
        if any(value < 1 for value in limits):
            raise ValueError("Browser analysis limits must be positive.")
        self._user_limits = (user_per_minute, user_per_hour)
        self._ip_limits = (ip_per_minute, ip_per_hour)
        self._global_limits = (global_per_minute, global_per_hour)
        self._max_global_concurrent = max_global_concurrent
        self._max_user_concurrent = max_user_concurrent
        self._max_user_keys = max_user_keys
        self._max_client_ip_keys = max_client_ip_keys
        self._clock = clock
        self._user_events: dict[str, deque[_Event]] = {}
        self._ip_events: dict[str, deque[_Event]] = {}
        self._global_events: deque[_Event] = deque()
        self._active_users: dict[str, int] = {}
        self._active_total = 0
        self._lock = threading.Lock()

    def admit(self, username: str, client_ip: str) -> BrowserAnalysisLease:
        """Atomically consume budgets and reserve a work slot, or fail fast."""

        now = self._clock()
        with self._lock:
            self._purge(now)
            if self._active_total >= self._max_global_concurrent:
                raise BrowserAnalysisLimitExceeded(1)
            if self._active_users.get(username, 0) >= self._max_user_concurrent:
                raise BrowserAnalysisLimitExceeded(1)
            if username not in self._user_events and len(self._user_events) >= self._max_user_keys:
                raise BrowserAnalysisLimitExceeded(60)
            if client_ip not in self._ip_events and len(self._ip_events) >= self._max_client_ip_keys:
                raise BrowserAnalysisLimitExceeded(60)

            user_events = self._user_events.get(username, deque())
            ip_events = self._ip_events.get(client_ip, deque())
            retry_after = max(
                self._window_retry(user_events, now, self._user_limits),
                self._window_retry(ip_events, now, self._ip_limits),
                self._window_retry(self._global_events, now, self._global_limits),
            )
            if retry_after:
                raise BrowserAnalysisLimitExceeded(retry_after)

            event = _Event(now)
            self._user_events.setdefault(username, deque()).append(event)
            self._ip_events.setdefault(client_ip, deque()).append(event)
            self._global_events.append(event)
            self._active_users[username] = self._active_users.get(username, 0) + 1
            self._active_total += 1
            return BrowserAnalysisLease(self, username, client_ip, event)

    @property
    def active_total(self) -> int:
        with self._lock:
            return self._active_total

    def active_for_user(self, username: str) -> int:
        with self._lock:
            return self._active_users.get(username, 0)

    @property
    def tracked_user_keys(self) -> int:
        with self._lock:
            self._purge(self._clock())
            return len(self._user_events)

    @property
    def tracked_client_ip_keys(self) -> int:
        with self._lock:
            self._purge(self._clock())
            return len(self._ip_events)

    def _finish(self, lease: BrowserAnalysisLease, *, rollback: bool) -> None:
        with self._lock:
            if lease._closed:
                return
            lease._closed = True
            user_active = self._active_users.get(lease._username, 0)
            if user_active <= 1:
                self._active_users.pop(lease._username, None)
            else:
                self._active_users[lease._username] = user_active - 1
            self._active_total = max(0, self._active_total - 1)
            if rollback:
                self._remove_event(self._user_events, lease._username, lease._event)
                self._remove_event(self._ip_events, lease._client_ip, lease._event)
                try:
                    self._global_events.remove(lease._event)
                except ValueError:
                    pass

    @staticmethod
    def _remove_event(events_by_key: dict[str, deque[_Event]], key: str, event: _Event) -> None:
        events = events_by_key.get(key)
        if events is None:
            return
        try:
            events.remove(event)
        except ValueError:
            return
        if not events:
            del events_by_key[key]

    @staticmethod
    def _window_retry(events: deque[_Event], now: float, limits: tuple[int, int]) -> int:
        minute_limit, hour_limit = limits
        minute_events = [event for event in events if event.timestamp > now - WINDOW_MINUTE_SECONDS]
        retry_values: list[int] = []
        if len(minute_events) >= minute_limit:
            retry_values.append(max(1, math.ceil(minute_events[0].timestamp + WINDOW_MINUTE_SECONDS - now)))
        hour_events = [event for event in events if event.timestamp > now - WINDOW_HOUR_SECONDS]
        if len(hour_events) >= hour_limit:
            retry_values.append(max(1, math.ceil(hour_events[0].timestamp + WINDOW_HOUR_SECONDS - now)))
        return max(retry_values, default=0)

    def _purge(self, now: float) -> None:
        cutoff = now - WINDOW_HOUR_SECONDS
        while self._global_events and self._global_events[0].timestamp <= cutoff:
            self._global_events.popleft()
        for key, events in list(self._user_events.items()):
            while events and events[0].timestamp <= cutoff:
                events.popleft()
            if not events:
                del self._user_events[key]
        for key, events in list(self._ip_events.items()):
            while events and events[0].timestamp <= cutoff:
                events.popleft()
            if not events:
                del self._ip_events[key]
