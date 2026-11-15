"""Generate deterministic SEOAnalysis JSON from the repository's test HTML."""

from __future__ import annotations

import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend.app.seo.engine import analyze_html  # noqa: E402
from backend.app.seo.models import FetchMetadata  # noqa: E402


class SourceNotes(HTMLParser):
    """Capture only image attributes and source line numbers for the offline proof."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "img":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        self.images.append(
            {
                "src": values.get("src", ""),
                "has_alt_attribute": "alt" in values,
                "line": self.getpos()[0],
            }
        )


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def build_analysis(name: str, body: bytes, *, noindex: bool = False) -> dict[str, Any]:
    suffix = "?condition=noindex" if noindex else ""
    url = f"https://example.test/{name}{suffix}"
    metadata = FetchMetadata(
        requested_url=url,
        final_url=url,
        status_code=200,
        content_type="text/html",
        content_length=len(body),
        bytes_read=len(body),
        redirect_count=0,
        elapsed_time=0.25,
        x_robots_tag="noindex" if noindex else None,
    )
    analysis = analyze_html(body.decode("utf-8"), url, metadata)
    return analysis.model_dump(mode="json")


def main() -> None:
    source_notes: dict[str, Any] = {
        "note": "Supplementary source inspection for this offline proof only. SEOAnalysis does not return per-element attributes or line numbers.",
        "samples": {},
    }
    for name in ("weak", "basic"):
        source_path = ROOT / "tests" / "fixtures" / f"{name}.html"
        body = source_path.read_bytes()
        html = body.decode("utf-8")
        parser = SourceNotes()
        parser.feed(html)
        source_notes["samples"][name] = {
            "source_path": source_path.relative_to(ROOT).as_posix(),
            "images": parser.images,
        }
        write_json(OUTPUT / f"audit-{name}.json", build_analysis(name, body))
        if name == "weak":
            write_json(OUTPUT / "audit-noindex-test.json", build_analysis(name, body, noindex=True))
    write_json(OUTPUT / "offline-source-notes.json", source_notes)


if __name__ == "__main__":
    main()
