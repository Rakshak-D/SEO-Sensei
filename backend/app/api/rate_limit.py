"""Single-instance, bounded in-memory rate limiting."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

from fastapi import Request

from ..config import Settings
from .errors import APIError, RATE_LIMITED
from .proxy import client_ip as proxy_client_ip


@dataclass(frozen=True)
class RateLimitRule:
    per_minute: int
    per_hour: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0


class InMemoryRateLimiter:
    """Thread-safe fixed-window limiter with bounded key storage.

    This limiter intentionally provides process-local protection only. A
    multi-instance deployment needs a shared store in a later phase.
    """

    def __init__(self, settings: Settings, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._max_keys = settings.rate_limit_max_keys
        self._rules = {
            "analysis": RateLimitRule(settings.analysis_rate_limit_per_minute, settings.analysis_rate_limit_per_hour),
            "ai": RateLimitRule(settings.ai_rate_limit_per_minute, settings.ai_rate_limit_per_hour),
            "article": RateLimitRule(settings.article_rate_limit_per_minute, settings.article_rate_limit_per_hour),
            "boost": RateLimitRule(settings.boost_rate_limit_per_minute, settings.boost_rate_limit_per_hour),
        }
        self._events: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, identity: str, client_ip: str, operation: str) -> RateLimitDecision:
        rule = self._rules[operation]
        now = self._clock()
        limits = ((60.0, rule.per_minute), (3600.0, rule.per_hour))
        keys = ((f"token:{identity}", operation), (f"ip:{client_ip}", operation))

        with self._lock:
            self._purge(now)
            if any(key not in self._events for key in keys) and len(self._events) + 2 > self._max_keys:
                return RateLimitDecision(False, 60)

            retry_after = 0
            for key in keys:
                events = self._events.setdefault(key, deque())
                for window, limit in limits:
                    count = sum(1 for timestamp in events if timestamp > now - window)
                    if count >= limit:
                        oldest = next((timestamp for timestamp in events if timestamp > now - window), now)
                        retry_after = max(retry_after, math.ceil(oldest + window - now))
            if retry_after:
                return RateLimitDecision(False, max(1, retry_after))

            for key in keys:
                self._events[key].append(now)
            return RateLimitDecision(True)

    def _purge(self, now: float) -> None:
        for key, events in list(self._events.items()):
            while events and events[0] <= now - 3600.0:
                events.popleft()
            if not events:
                del self._events[key]


def client_ip(request: Request) -> str:
    """Resolve client identity using only explicitly trusted proxy headers."""

    settings: Settings = request.app.state.settings
    return proxy_client_ip(request, tuple(settings.trusted_proxy_networks))


async def enforce_rate_limit(request: Request, operation: str) -> None:
    limiter: InMemoryRateLimiter = request.app.state.rate_limiter
    decision = limiter.check(request.state.auth_identity, client_ip(request), operation)
    if not decision.allowed:
        request_id = getattr(request.state, "request_id", "-")
        import logging

        logging.getLogger("seo_sensei.rate_limit").warning(
            "rate_limit_exceeded operation=%s request_id=%s",
            operation,
            request_id,
        )
        raise APIError(
            RATE_LIMITED,
            "Request rate limit exceeded. Please try again later.",
            429,
            headers={"Retry-After": str(decision.retry_after)},
        )


def rate_limit_for(operation: str):
    async def dependency(request: Request) -> None:
        await enforce_rate_limit(request, operation)

    return dependency
