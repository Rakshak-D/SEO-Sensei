"""Compatibility entrypoint for existing ``uvicorn main:app`` usage."""

try:
    from app.main import app
except ModuleNotFoundError:
    from backend.app.main import app

__all__ = ["app"]
