"""Backward-compatible import for the bounded Gemini service.

New application code must import ``backend.app.ai.gemini`` directly. This
module intentionally contains no SDK calls or response parsing.
"""

from __future__ import annotations

try:
    from ..app.ai.gemini import AIServiceError, AIServiceErrorCode, GeminiService
except ImportError:
    from app.ai.gemini import AIServiceError, AIServiceErrorCode, GeminiService


__all__ = ["AIServiceError", "AIServiceErrorCode", "GeminiService"]
