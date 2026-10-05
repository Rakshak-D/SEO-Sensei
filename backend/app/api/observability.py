"""Helpers for request-scoped operational logging and counters."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request


def request_context(request: Request, endpoint: str | None = None) -> dict[str, Any]:
    """Return bounded request context without headers, bodies, or URLs."""

    return {
        "request_id": getattr(request.state, "request_id", "-"),
        "endpoint": endpoint or request.url.path,
        "method": request.method,
    }


def record_metric(request: Request, name: str, operation: str | None = None) -> None:
    metrics = getattr(request.app.state, "metrics", None)
    if metrics is not None:
        metrics.increment(name, operation)


def log_event(logger: logging.Logger, level: int, message: str, request: Request, **fields: Any) -> None:
    context = request_context(request)
    context.update(fields)
    logger.log(level, message, extra=context)
