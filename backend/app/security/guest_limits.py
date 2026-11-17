"""Atomic, bounded, process-local admission budgets for anonymous audits."""

from __future__ import annotations

import hashlib
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from ..config import Settings

MINUTE_SECONDS = 60.0
HOUR_SECONDS = 3_600.0
DAY_SECONDS = 86_400.0


class GuestLimitExceeded(RuntimeError):
    """A guest admission budget or no-queue concurrency slot was exhausted."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, min(86_400, retry_after))
        super().__init__("Guest audit capacity is temporarily unavailable.")


@dataclass(frozen=True, slots=True, eq=False)
class _Event:
    timestamp: float


@dataclass(slots=True)
class _IPEvents:
    audits: deque[_Event] = field(default_factory=deque)
    bootstrap: deque[_Event] = field(default_factory=deque)
    bot_attempts: deque[_Event] = field(default_factory=deque)


@dataclass(slots=True)
class GuestAuditLease:
    """One admission reservation; rollback before verification, retain after commit."""

    _owner: GuestAnalysisLimits = field(repr=False)
    _visitor_key: str = field(repr=False)
    _ip_key: str = field(repr=False)
    _event: _Event = field(repr=False)
    _committed: bool = field(default=False, init=False, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    def commit(self) -> None:
        self._owner._commit(self)

    def release(self) -> None:
        self._owner._release(self)

    def __enter__(self) -> GuestAuditLease:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.release()


class GuestAnalysisLimits:
    """Bounded sliding windows and atomic non-queuing guest concurrency.

    State is process-local. Production use requires a single worker and
    replica, or a separately reviewed shared limiter before enabling traffic.
    Keys are hashed before retention so raw IP/cookie-derived IDs are not kept.
    """

    def __init__(
        self,
        *,
        visitor_per_minute: int = 2,
        visitor_per_hour: int = 8,
        ip_per_minute: int = 5,
        ip_per_hour: int = 20,
        global_per_minute: int = 8,
        global_per_hour: int = 60,
        global_daily: int = 250,
        max_global_concurrent: int = 2,
        max_visitor_concurrent: int = 1,
        bootstrap_per_minute: int = 20,
        bootstrap_per_hour: int = 120,
        bot_attempts_per_minute: int = 5,
        bot_attempts_per_hour: int = 30,
        max_visitor_keys: int = 2_048,
        max_ip_keys: int = 1_024,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        values = (
            visitor_per_minute,
            visitor_per_hour,
            ip_per_minute,
            ip_per_hour,
            global_per_minute,
            global_per_hour,
            global_daily,
            max_global_concurrent,
            max_visitor_concurrent,
            bootstrap_per_minute,
            bootstrap_per_hour,
            bot_attempts_per_minute,
            bot_attempts_per_hour,
            max_visitor_keys,
            max_ip_keys,
        )
        if any(value < 1 for value in values):
            raise ValueError("Guest rate limits and capacities must be positive.")
        if (
            visitor_per_minute > visitor_per_hour
            or ip_per_minute > ip_per_hour
            or global_per_minute > global_per_hour
            or global_per_hour > global_daily
            or bootstrap_per_minute > bootstrap_per_hour
            or bot_attempts_per_minute > bot_attempts_per_hour
        ):
            raise ValueError("Guest minute and hour limits must be consistent.")

        self._options = {
            "visitor_per_minute": visitor_per_minute,
            "visitor_per_hour": visitor_per_hour,
            "ip_per_minute": ip_per_minute,
            "ip_per_hour": ip_per_hour,
            "global_per_minute": global_per_minute,
            "global_per_hour": global_per_hour,
            "global_daily": global_daily,
            "max_global_concurrent": max_global_concurrent,
            "max_visitor_concurrent": max_visitor_concurrent,
            "bootstrap_per_minute": bootstrap_per_minute,
            "bootstrap_per_hour": bootstrap_per_hour,
            "bot_attempts_per_minute": bot_attempts_per_minute,
            "bot_attempts_per_hour": bot_attempts_per_hour,
            "max_visitor_keys": max_visitor_keys,
            "max_ip_keys": max_ip_keys,
        }
        self._clock = clock
        self._visitors: dict[str, deque[_Event]] = {}
        self._ip_records: dict[str, _IPEvents] = {}
        self._global_events: deque[_Event] = deque()
        self._active_visitors: dict[str, int] = {}
        self._active_total = 0
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings) -> GuestAnalysisLimits:
        return cls(
            visitor_per_minute=settings.guest_audits_per_visitor_per_minute,
            visitor_per_hour=settings.guest_audits_per_visitor_per_hour,
            ip_per_minute=settings.guest_audits_per_ip_per_minute,
            ip_per_hour=settings.guest_audits_per_ip_per_hour,
            global_per_minute=settings.guest_audits_global_per_minute,
            global_per_hour=settings.guest_audits_global_per_hour,
            global_daily=settings.guest_global_audits_per_day,
            max_global_concurrent=settings.guest_audit_max_concurrent,
            max_visitor_concurrent=settings.guest_audit_concurrent_per_visitor,
            bootstrap_per_minute=settings.guest_bootstrap_per_minute,
            bootstrap_per_hour=settings.guest_bootstrap_per_hour,
            bot_attempts_per_minute=settings.guest_bot_attempts_per_minute,
            bot_attempts_per_hour=settings.guest_bot_attempts_per_hour,
            max_visitor_keys=settings.guest_session_max_keys,
            max_ip_keys=settings.guest_ip_max_keys,
        )

    def with_overrides(self, **overrides: int) -> GuestAnalysisLimits:
        options = {**self._options, **overrides}
        return GuestAnalysisLimits(**options, clock=self._clock)

    def admit_bootstrap(self, client_ip: str) -> None:
        now = self._clock()
        ip_key = self._key("ip", client_ip)
        with self._lock:
            self._purge(now)
            record = self._get_ip_record(ip_key)
            retry = self._window_retry(
                record.bootstrap, now, self._options["bootstrap_per_minute"], self._options["bootstrap_per_hour"]
            )
            if retry:
                raise GuestLimitExceeded(retry)
            record.bootstrap.append(_Event(now))

    def admit_bot_attempt(self, client_ip: str) -> None:
        now = self._clock()
        ip_key = self._key("ip", client_ip)
        with self._lock:
            self._purge(now)
            record = self._get_ip_record(ip_key)
            retry = self._window_retry(
                record.bot_attempts,
                now,
                self._options["bot_attempts_per_minute"],
                self._options["bot_attempts_per_hour"],
            )
            if retry:
                raise GuestLimitExceeded(retry)
            record.bot_attempts.append(_Event(now))

    def admit_audit(self, visitor_id: str, client_ip: str) -> GuestAuditLease:
        now = self._clock()
        visitor_key = self._key("visitor", visitor_id)
        ip_key = self._key("ip", client_ip)
        with self._lock:
            self._purge(now)
            if visitor_key not in self._visitors and len(self._visitors) >= self._options["max_visitor_keys"]:
                raise GuestLimitExceeded(60)
            if ip_key not in self._ip_records and len(self._ip_records) >= self._options["max_ip_keys"]:
                raise GuestLimitExceeded(60)
            if self._active_total >= self._options["max_global_concurrent"]:
                raise GuestLimitExceeded(1)
            if self._active_visitors.get(visitor_key, 0) >= self._options["max_visitor_concurrent"]:
                raise GuestLimitExceeded(1)

            visitor_events = self._visitors.get(visitor_key, deque())
            ip_events = self._ip_records.get(ip_key, _IPEvents()).audits
            retry = max(
                self._window_retry(
                    visitor_events,
                    now,
                    self._options["visitor_per_minute"],
                    self._options["visitor_per_hour"],
                ),
                self._window_retry(ip_events, now, self._options["ip_per_minute"], self._options["ip_per_hour"]),
                self._window_retry(
                    self._global_events,
                    now,
                    self._options["global_per_minute"],
                    self._options["global_per_hour"],
                ),
                self._daily_retry(now),
            )
            if retry:
                raise GuestLimitExceeded(retry)

            event = _Event(now)
            self._visitors.setdefault(visitor_key, deque()).append(event)
            self._ip_records.setdefault(ip_key, _IPEvents()).audits.append(event)
            self._global_events.append(event)
            self._active_visitors[visitor_key] = self._active_visitors.get(visitor_key, 0) + 1
            self._active_total += 1
            return GuestAuditLease(self, visitor_key, ip_key, event)

    @property
    def active_total(self) -> int:
        with self._lock:
            return self._active_total

    def _get_ip_record(self, key: str) -> _IPEvents:
        record = self._ip_records.get(key)
        if record is None:
            if len(self._ip_records) >= self._options["max_ip_keys"]:
                raise GuestLimitExceeded(60)
            record = _IPEvents()
            self._ip_records[key] = record
        return record

    def _commit(self, lease: GuestAuditLease) -> None:
        with self._lock:
            if not lease._closed:
                lease._committed = True

    def _release(self, lease: GuestAuditLease) -> None:
        with self._lock:
            if lease._closed:
                return
            lease._closed = True
            active = self._active_visitors.get(lease._visitor_key, 0)
            if active <= 1:
                self._active_visitors.pop(lease._visitor_key, None)
            else:
                self._active_visitors[lease._visitor_key] = active - 1
            self._active_total = max(0, self._active_total - 1)
            if not lease._committed:
                self._remove(self._visitors, lease._visitor_key, lease._event)
                ip_record = self._ip_records.get(lease._ip_key)
                if ip_record is not None:
                    self._remove_from_deque(ip_record.audits, lease._event)
                    self._remove_empty_ip_record(lease._ip_key, ip_record)
                self._remove_from_deque(self._global_events, lease._event)

    def _daily_retry(self, now: float) -> int:
        limit = self._options["global_daily"]
        if len(self._global_events) < limit:
            return 0
        return max(1, math.ceil(self._global_events[0].timestamp + DAY_SECONDS - now))

    @staticmethod
    def _window_retry(events: deque[_Event], now: float, per_minute: int, per_hour: int) -> int:
        minute = [event for event in events if event.timestamp > now - MINUTE_SECONDS]
        hour = [event for event in events if event.timestamp > now - HOUR_SECONDS]
        retry = []
        if len(minute) >= per_minute:
            retry.append(math.ceil(minute[0].timestamp + MINUTE_SECONDS - now))
        if len(hour) >= per_hour:
            retry.append(math.ceil(hour[0].timestamp + HOUR_SECONDS - now))
        return max(1, max(retry)) if retry else 0

    def _purge(self, now: float) -> None:
        while self._global_events and self._global_events[0].timestamp <= now - DAY_SECONDS:
            self._global_events.popleft()

        for key, events in list(self._visitors.items()):
            self._purge_deque(events, now - HOUR_SECONDS)
            if not events and not self._active_visitors.get(key):
                del self._visitors[key]

        for key, record in list(self._ip_records.items()):
            self._purge_deque(record.audits, now - HOUR_SECONDS)
            self._purge_deque(record.bootstrap, now - HOUR_SECONDS)
            self._purge_deque(record.bot_attempts, now - HOUR_SECONDS)
            self._remove_empty_ip_record(key, record)

    @staticmethod
    def _purge_deque(events: deque[_Event], cutoff: float) -> None:
        while events and events[0].timestamp <= cutoff:
            events.popleft()

    @classmethod
    def _remove(cls, mapping: dict[str, deque[_Event]], key: str, event: _Event) -> None:
        events = mapping.get(key)
        if events is None:
            return
        cls._remove_from_deque(events, event)
        if not events:
            mapping.pop(key, None)

    @staticmethod
    def _remove_from_deque(events: deque[_Event], event: _Event) -> None:
        try:
            events.remove(event)
        except ValueError:
            pass

    def _remove_empty_ip_record(self, key: str, record: _IPEvents) -> None:
        if not record.audits and not record.bootstrap and not record.bot_attempts:
            self._ip_records.pop(key, None)

    @staticmethod
    def _key(namespace: str, value: str) -> str:
        return hashlib.sha256(f"{namespace}\0{value}".encode("utf-8", errors="replace")).hexdigest()
