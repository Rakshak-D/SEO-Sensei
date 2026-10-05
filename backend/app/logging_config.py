"""Central logging setup for API and service logs."""

from __future__ import annotations

import logging
import json
import sys
from datetime import datetime, timezone


class RequestContextFilter(logging.Filter):
    """Ensure request fields exist on every formatted log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        if not hasattr(record, "endpoint"):
            record.endpoint = "-"
        return True


class StructuredFormatter(logging.Formatter):
    """Serialize safe log fields as one JSON object per line."""

    _fields = (
        "request_id",
        "endpoint",
        "route",
        "method",
        "status",
        "duration_ms",
        "bytes_read",
        "redirect_count",
        "error_code",
        "operation",
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in self._fields:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception_type"] = record.exc_info[0].__name__ if record.exc_info[0] else "Exception"
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_logging(level: str = "INFO") -> None:
    """Configure concise machine-readable application logging once."""

    root = logging.getLogger()
    if getattr(root, "_seo_sensei_configured", False):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    handler.addFilter(RequestContextFilter())
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root._seo_sensei_configured = True  # type: ignore[attr-defined]
