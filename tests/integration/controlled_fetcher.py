"""Local HTML responses used by the Phase 2D HTTPS integration harness."""

from __future__ import annotations

from urllib.parse import urlsplit

from backend.app.security.errors import FetchErrorCode
from backend.app.security.fetcher import FetchResult


def all_pass_document() -> str:
    words = " ".join(
        [
            "A solar project plan should describe household energy use, roof conditions, equipment options, and installation schedules."
        ]
        * 35
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Field Guide to Solar Planning and Home Energy Use</title>
<meta name="description" content="A practical field guide to planning a home solar project, comparing equipment, and preparing clear questions for a qualified installer.">
<link rel="canonical" href="https://phase2d.test/pages/all-pass">
<meta property="og:title" content="Solar planning field guide"><meta property="og:description" content="Plan a home solar project."><meta property="og:image" content="https://phase2d.test/solar.jpg"><meta property="og:url" content="https://phase2d.test/pages/all-pass">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="Solar planning field guide"><meta name="twitter:description" content="Plan a home solar project."><meta name="twitter:image" content="https://phase2d.test/solar.jpg">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"WebPage","name":"Solar planning field guide"}}</script>
</head><body><h1>Planning a home solar project</h1><h2>Compare the available systems</h2>
<p>{words}</p><a href="/about">About this guide</a><img src="/solar.jpg" alt="Solar panels on a home roof">
</body></html>"""


WARNING_DOCUMENT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solar notes</title><meta name="description" content="Short project notes for a home solar installation.">
</head><body><h1>Solar project notes</h1><p>Compare installation plans and ask a qualified installer about equipment, permitting, and maintenance.</p></body></html>"""

NOINDEX_DOCUMENT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home Solar Project Planning Guide for Owners</title>
<meta name="description" content="A concise guide to planning a home solar project and preparing questions for a qualified local installer.">
<meta name="robots" content="noindex, follow"><link rel="canonical" href="https://phase2d.test/pages/noindex">
</head><body><h1>Plan a home solar project</h1><p>Review your roof, energy use, budget, and local requirements before selecting equipment. Ask a qualified installer about permits, warranties, and maintenance.</p>
<a href="/planning">Planning resources</a></body></html>"""


class ControlledSafeFetcher:
    """Return local static HTML to the real analyzer without opening sockets."""

    async def fetch_url(self, url: str, request_id: str | None = None) -> FetchResult:
        parsed = urlsplit(url)
        if parsed.hostname != "phase2d.test":
            return FetchResult(requested_url=url, error=FetchErrorCode.BLOCKED_DESTINATION)
        if parsed.path == "/pages/unavailable":
            return FetchResult(requested_url=url, error=FetchErrorCode.CONNECTION_TIMEOUT)
        body = (
            all_pass_document()
            if parsed.path == "/pages/all-pass"
            else WARNING_DOCUMENT
            if parsed.path == "/pages/warnings"
            else NOINDEX_DOCUMENT
        )
        length = len(body.encode("utf-8"))
        return FetchResult(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            content_length=length,
            bytes_read=length,
            elapsed_time=0.125,
            body=body,
        )

    async def aclose(self) -> None:
        return None
