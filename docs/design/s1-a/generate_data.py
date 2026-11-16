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


def build_analysis(
    name: str,
    body: bytes,
    *,
    noindex: bool = False,
    requested_url: str | None = None,
) -> dict[str, Any]:
    suffix = "?condition=noindex" if noindex else ""
    url = requested_url or f"https://example.test/{name}{suffix}"
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

    northstar_path = OUTPUT / "northstar-solar-r2.html"
    northstar_body = northstar_path.read_bytes()
    northstar_html = northstar_body.decode("utf-8")
    northstar_parser = SourceNotes()
    northstar_parser.feed(northstar_html)
    source_notes["samples"]["northstar"] = {
        "source_path": northstar_path.relative_to(ROOT).as_posix(),
        "source_kind": "fictional local Northstar Solar page derived from web/public/fixtures/northstar-solar.html",
        "edits": [
            "Removed the existing robots noindex meta directive so this sample is not accidentally blocking.",
            "Removed the meta description to create an actual missing-description finding.",
            "Removed the html lang attribute to create an actual language-declaration finding.",
            "Removed the informative image alt attribute to create an actual image-alt finding.",
            "Added a practical paragraph about comparing household loads, roof conditions, equipment, warranties, and written estimates.",
        ],
        "images": northstar_parser.images,
    }
    write_json(
        OUTPUT / "audit-northstar.json",
        build_analysis(
            "northstar",
            northstar_body,
            requested_url="https://northstar.example/guides/home-solar/",
        ),
    )
    write_json(OUTPUT / "offline-source-notes.json", source_notes)


if __name__ == "__main__":
    main()
