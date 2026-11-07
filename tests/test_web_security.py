from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_browser_source_uses_same_origin_and_contains_no_server_credentials() -> None:
    source_files = tuple((ROOT / "web" / "src").rglob("*.ts")) + tuple((ROOT / "web" / "src").rglob("*.tsx"))
    combined = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
    assert 'credentials: "same-origin"' in combined
    assert "Authorization" not in combined
    assert "API_ACCESS_TOKEN" not in combined
    assert "GEMINI_API_KEY" not in combined
    assert "dangerouslySetInnerHTML" not in combined
    assert (
        re.search(
            r"https?://(?!northstar\.example|phase2d\.test|site\.example|example\.org|example\.test|not-contacted\.example)[^\s\"']+",
            combined,
        )
        is None
    )


def test_web_error_handling_never_falls_back_to_fixture_after_live_failure() -> None:
    source = (ROOT / "web" / "src" / "app" / "App.tsx").read_text(encoding="utf-8")
    assert "loadLocalFixture()" in source
    assert 'route.source === "demo"' in source
    assert 'const liveReport: AnalysisReport = { source: "live", analysis };' in source
    assert "setReport(liveReport)" in source
