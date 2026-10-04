"""Compatibility orchestration around the safe fetcher and pure SEO engine."""

from __future__ import annotations

try:
    from .app.config import get_settings
    from .app.security.fetcher import FetchResult, SafeFetcher
    from .app.seo.engine import analyze_html
    from .app.seo.models import FetchMetadata, SEOAnalysis
except ImportError:
    from app.config import get_settings
    from app.security.fetcher import FetchResult, SafeFetcher
    from app.seo.engine import analyze_html
    from app.seo.models import FetchMetadata, SEOAnalysis


_default_fetcher: SafeFetcher | None = None


def _get_default_fetcher() -> SafeFetcher:
    global _default_fetcher
    if _default_fetcher is None:
        _default_fetcher = SafeFetcher(get_settings())
    return _default_fetcher


async def fetch_html(url: str, fetcher: SafeFetcher | None = None) -> FetchResult:
    """Fetch bounded, policy-approved HTML through the single safe transport."""

    return await (fetcher or _get_default_fetcher()).fetch_url(url)


async def get_full_seo_analysis_for_url(
    url: str,
    fetcher: SafeFetcher | None = None,
) -> dict:
    """Fetch a page safely and return its deterministic SEO analysis."""

    fetch_result = await fetch_html(url, fetcher=fetcher)
    if not fetch_result.succeeded:
        return {
            "status": "failed",
            "status_code": fetch_result.status_code or 0,
            "fetch_error": fetch_result.error.value if fetch_result.error else "unexpected_fetch_error",
        }

    final_url = fetch_result.final_url or fetch_result.requested_url
    fetch_metadata = FetchMetadata(
        requested_url=fetch_result.requested_url,
        final_url=final_url,
        status_code=fetch_result.status_code or 0,
        content_type=fetch_result.content_type or "",
        content_length=fetch_result.content_length,
        bytes_read=fetch_result.bytes_read,
        redirect_count=fetch_result.redirect_count,
        elapsed_time=fetch_result.elapsed_time,
        x_robots_tag=fetch_result.x_robots_tag,
    )
    analysis: SEOAnalysis = analyze_html(fetch_result.body or "", final_url, fetch_metadata)
    return {"status": "success", **analysis.model_dump(mode="json")}
