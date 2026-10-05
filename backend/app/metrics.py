"""Small, bounded in-process operational counters.

Metrics are intentionally process-local and use a fixed set of low-cardinality
operation names. They are diagnostic signals, not a replacement for a shared
metrics backend.
"""

from __future__ import annotations

from collections import Counter
from threading import Lock


_ALLOWED_OPERATIONS = frozenset({"request", "fetch", "ai", "article", "boost", "analysis", "rate_limit"})


class Metrics:
    """Thread-safe counters with no user-controlled labels or values."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._counters: Counter[str] = Counter()
        self._lock = Lock()

    def increment(self, name: str, operation: str | None = None) -> None:
        if not self.enabled:
            return
        safe_operation = operation if operation in _ALLOWED_OPERATIONS else None
        key = f"{name}:{safe_operation}" if safe_operation else name
        with self._lock:
            self._counters[key] += 1

    def snapshot(self) -> dict[str, int]:
        if not self.enabled:
            return {}
        with self._lock:
            return dict(self._counters)
