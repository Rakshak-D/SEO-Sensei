"""Small repository guard for high-risk regressions used by local checks and CI."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (ROOT / "backend", ROOT / "frontend", ROOT / "tests", ROOT / "tools")
TEXT_SUFFIXES = {".py", ".js", ".html", ".css", ".json", ".toml", ".yml", ".yaml"}
SPECIAL_FILES = {"Dockerfile.api", "Dockerfile.dashboard", ".dockerignore", "compose.yaml", "compose.dev.yaml"}


def files() -> list[Path]:
    source_files = [
        path
        for root in SOURCE_ROOTS
        if root.exists()
        for path in root.rglob("*")
        if path.is_file() and (path.suffix in TEXT_SUFFIXES or path.name in SPECIAL_FILES)
    ]
    return source_files + [ROOT / name for name in SPECIAL_FILES if (ROOT / name).is_file()]


def main() -> int:
    failures: list[str] = []
    for path in files():
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT).as_posix()

        if path.parts and "frontend" in path.parts:
            for pattern, label in (
                (r"\b(eval|new\s+Function)\s*\(", "dynamic JavaScript execution"),
                (r"\b(innerHTML|insertAdjacentHTML|document\.write)\b", "unsafe DOM HTML sink"),
                (r"127\.0\.0\.1:8000|localhost:8000", "hard-coded API URL"),
                (r"AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}", "embedded credential"),
            ):
                if re.search(pattern, text, flags=re.IGNORECASE):
                    failures.append(f"{relative}: {label}")

        if relative == "backend/dashboard.py":
            for pattern, label in (
                (r"(?:from|import).*?(?:gemini|seo_crawler|SafeFetcher)", "dashboard bypasses service boundary"),
                (r"unsafe_allow_html\s*=\s*True", "unsafe Streamlit HTML rendering"),
                (
                    r"(?:requests|httpx|urllib|aiohttp)\.(?:get|request|urlopen)",
                    "dashboard performs direct network I/O",
                ),
            ):
                if re.search(pattern, text, flags=re.IGNORECASE):
                    failures.append(f"{relative}: {label}")

        if path.parts and "backend" in path.parts and "app" in path.parts and "ai" not in path.parts:
            if re.search(r"google\.generativeai|genai\.GenerativeModel", text):
                failures.append(f"{relative}: direct Gemini SDK usage outside backend/app/ai")

        if path.suffix == ".py" and re.search(
            r"(?:requests\.get|requests\.request|urllib\.request\.urlopen|aiohttp\.)", text
        ):
            failures.append(f"{relative}: direct outbound HTTP helper")

        if re.search(r"AIza[0-9A-Za-z_-]{20,}", text):
            failures.append(f"{relative}: possible Gemini credential")

        if path.name in SPECIAL_FILES:
            for pattern, label in (
                (r"COPY\s+\.env", "secret environment file copied into an image"),
                (
                    r"privileged:\s*true|network_mode:\s*host|/var/run/docker\.sock",
                    "unsafe container privilege/network setting",
                ),
                (
                    r"ENV\s+[^\n]*(?:API_ACCESS_TOKEN|GEMINI_API_KEY|DASHBOARD_API_ACCESS_TOKEN)",
                    "secret configured in an image layer",
                ),
            ):
                if re.search(pattern, text, flags=re.IGNORECASE):
                    failures.append(f"{relative}: {label}")

    for name in (".env", ".env.local", ".env.production"):
        if (ROOT / name).exists():
            failures.append(f"{name}: secret environment file exists in the workspace")

    if failures:
        print("Repository security checks failed:")
        for failure in sorted(set(failures)):
            print(f"- {failure}")
        return 1
    print("Repository security checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
