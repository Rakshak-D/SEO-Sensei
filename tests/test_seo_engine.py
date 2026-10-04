from __future__ import annotations

from backend.app.seo.engine import analyze_html
from backend.app.seo.models import CheckStatus, FetchMetadata


def fetch(**overrides) -> FetchMetadata:
    values = {
        "requested_url": "https://example.com/",
        "final_url": "https://example.com/",
        "status_code": 200,
        "content_type": "text/html",
        "content_length": 500,
        "bytes_read": 500,
        "redirect_count": 0,
        "elapsed_time": 0.2,
    }
    values.update(overrides)
    return FetchMetadata(**values)


def check(result, check_id: str):
    return next(item for item in result.checks if item.id == check_id)


def test_metadata_and_transport_checks_are_deterministic() -> None:
    html = """<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>
    <title>A useful title for a documented page</title>
    <meta name='description' content='A useful description that is long enough to be meaningful for this test page.'>
    <link rel='canonical' href='/guide'><meta name='robots' content='index, follow'>
    </head><body><h1>Guide</h1><h2>Details</h2><p>Content about a useful guide for visitors.</p></body></html>"""
    result = analyze_html(html, "https://example.com/guide", fetch())
    again = analyze_html(html, "https://example.com/guide", fetch())
    assert result.deterministic_score == again.deterministic_score
    assert result.metadata.title == "A useful title for a documented page"
    assert result.metadata.canonical_relationship == "relative"
    assert check(result, "title").status == CheckStatus.PASS
    assert check(result, "https").status == CheckStatus.PASS


def test_missing_short_and_long_metadata_is_reported() -> None:
    short = analyze_html(
        "<html><head><title>x</title><meta name='description' content='x'></head></html>",
        "https://example.com",
        fetch(),
    )
    assert check(short, "title").status == CheckStatus.WARNING
    assert check(short, "meta_description").status == CheckStatus.WARNING
    missing = analyze_html("<html><body></body></html>", "https://example.com", fetch())
    assert check(missing, "title").status == CheckStatus.FAIL
    assert check(missing, "meta_description").status == CheckStatus.FAIL
    long_page = analyze_html(
        f"<title>{'T' * 70}</title><meta name='description' content={'D' * 180!r}>",
        "https://example.com",
        fetch(),
    )
    assert check(long_page, "title").status == CheckStatus.WARNING
    assert check(long_page, "meta_description").status == CheckStatus.WARNING


def test_headings_images_links_and_social_signals() -> None:
    html = """<html><head><meta property='og:title' content='OG'><meta name='twitter:card' content='summary'>
    <link rel='alternate' hreflang='en-US' href='/en'><link rel='alternate' hreflang='bad_value' href='/bad'>
    </head><body><h1></h1><h3>Skipped</h3><img src='/a.png' alt='A'><img src='/b.png' alt=''>
    <a href='/inside'>Read this</a><a href='https://other.test' rel='nofollow sponsored ugc'></a></body></html>"""
    result = analyze_html(html, "https://example.com/", fetch())
    assert result.headings.empty_heading_count == 1
    assert result.headings.hierarchy_jumps == ["h1 to h3"]
    assert result.images.missing_alt == 0
    assert result.images.empty_alt == 1
    assert result.links.internal == 1
    assert result.links.external == 1
    assert result.links.empty_anchors == 1
    assert (result.links.nofollow, result.links.sponsored, result.links.ugc) == (1, 1, 1)
    assert len(result.hreflang.links) == 1
    assert result.hreflang.malformed_count == 1


def test_structured_data_robots_text_and_mixed_content() -> None:
    html = """<html><head><meta name='robots' content='noindex, nofollow'><script type='application/ld+json'>{"@type":"Article"}</script>
    <script type='application/ld+json'>{bad}</script></head><body><p>alpha alpha alpha useful content.</p>
    <img src='http://cdn.test/image.png'></body></html>"""
    result = analyze_html(html, "https://example.com/", fetch(x_robots_tag="noarchive"))
    assert set(result.metadata.robots_directives) == {"noindex", "nofollow", "noarchive"}
    assert result.structured_data.valid_blocks == 1
    assert result.structured_data.malformed_blocks == 1
    assert result.structured_data.types == ["Article"]
    assert result.lexical_signals.visible_word_count >= 4
    assert result.lexical_signals.frequent_terms[0].term == "alpha"
    assert result.metadata.mixed_content_reference_count == 1


def test_canonical_variants_and_score_bounds() -> None:
    malformed = analyze_html("<link rel='canonical' href='javascript:alert(1)'>", "https://example.com", fetch())
    assert malformed.metadata.canonical_relationship == "malformed"
    other = analyze_html("<link rel='canonical' href='https://other.test/page'>", "https://example.com", fetch())
    assert other.metadata.canonical_relationship == "valid_other_host"
    empty = analyze_html("", "https://example.com", fetch())
    assert 0 <= empty.deterministic_score.overall_score <= 100
    assert "meta_keywords" not in empty.model_dump()
    assert "suggested_keywords" not in empty.model_dump()
