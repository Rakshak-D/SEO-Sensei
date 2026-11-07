"""Disposable local API runner with a deterministic, non-network fetch transport."""

from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import uvicorn
from argon2 import PasswordHasher, Type
from fastapi import FastAPI

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from controlled_fetcher import ControlledSafeFetcher  # noqa: E402


def install_test_account() -> None:
    username = os.environ["PHASE2D_TEST_USERNAME"]
    password = os.environ["PHASE2D_TEST_PASSWORD"]
    if not username or len(password) < 24:
        raise RuntimeError("The disposable integration account is not configured.")
    hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=1, type=Type.ID)
    account_file = Path(os.environ["BROWSER_AUTH_ACCOUNTS_FILE"])
    account_file.write_text(
        json.dumps({"version": 1, "users": [{"username": username, "password_hash": hasher.hash(password)}]}),
        encoding="utf-8",
    )
    account_file.chmod(0o600)


install_test_account()

from backend.app.main import app  # noqa: E402

real_lifespan = app.router.lifespan_context


@asynccontextmanager
async def integration_lifespan(application: FastAPI) -> AsyncIterator[None]:
    async with real_lifespan(application):
        production_fetcher = application.state.safe_fetcher
        application.state.safe_fetcher = ControlledSafeFetcher()
        try:
            yield
        finally:
            application.state.safe_fetcher = production_fetcher


app.router.lifespan_context = integration_lifespan

if __name__ == "__main__":
    bind_host = os.environ.get("PHASE2D_BIND_HOST", "0.0.0.0")
    uvicorn.run(app, host=bind_host, port=8000, proxy_headers=False, access_log=False)
