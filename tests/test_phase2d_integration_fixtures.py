"""Test-only integration responses exercise the unchanged deterministic analyzer."""

from __future__ import annotations

import anyio

from backend.app.security.errors import FetchErrorCode
from backend.seo_crawler import get_full_seo_analysis_for_url
from tests.integration.controlled_fetcher import ControlledSafeFetcher


def test_controlled_analyzer_documents_cover_noindex_all_pass_and_warnings() -> None:
    async def exercise() -> None:
        fetcher = ControlledSafeFetcher()
        noindex = await get_full_seo_analysis_for_url("https://phase2d.test/pages/noindex", fetcher=fetcher)
        assert noindex["status"] == "success"
        assert any(check["id"] == "robots_directives" and check["status"] == "fail" for check in noindex["checks"])

        all_pass = await get_full_seo_analysis_for_url("https://phase2d.test/pages/all-pass", fetcher=fetcher)
        assert all_pass["status"] == "success"
        statuses = {check["status"] for check in all_pass["checks"]}
        assert statuses <= {"pass", "not_applicable"}
        assert not any(check["status"] == "fail" for check in all_pass["checks"])
        assert len(all_pass["checks"]) == 23

        warnings = await get_full_seo_analysis_for_url("https://phase2d.test/pages/warnings", fetcher=fetcher)
        assert warnings["status"] == "success"
        assert any(check["status"] == "warning" for check in warnings["checks"])
        assert not any(check["status"] == "fail" for check in warnings["checks"])

    anyio.run(exercise)


def test_controlled_fetch_failure_is_local_and_deterministic() -> None:
    async def exercise() -> None:
        result = await ControlledSafeFetcher().fetch_url("https://phase2d.test/pages/unavailable")
        assert result.error is FetchErrorCode.CONNECTION_TIMEOUT

    anyio.run(exercise)
