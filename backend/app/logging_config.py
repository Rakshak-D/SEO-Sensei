"""Central logging setup for API and service logs."""

from __future__ import annotations

import logging
import sys


LOG_FORMAT = "%(asctime)s %(levelname)s request_id=%(request_id)s endpoint=%(endpoint)s %(message)s"


class RequestContextFilter(logging.Filter):
    """Ensure request fields exist on every formatted log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        if not hasattr(record, "endpoint"):
            record.endpoint = "-"
        return True


def configure_logging() -> None:
    """Configure concise, parseable application logging once."""

    root = logging.getLogger()
    if getattr(root, "_seo_sensei_configured", False):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(RequestContextFilter())
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root._seo_sensei_configured = True  # type: ignore[attr-defined]
