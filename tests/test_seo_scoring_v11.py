from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.config import Settings
from backend.app.seo.rules import CATEGORY_WEIGHTS, CHECK_POLICIES, Effort, Impact
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import CheckStatus, FetchMetadata, SEOAnalysis


def analyze(
    html: str,
    redirect_count: int = 0,
    status_code: int = 200,
    url: str = "https://example.test/page/",
):
    size = len(html.encode("utf-8"))
    fetch = FetchMetadata(
        requested_url=url,
        final_url=url,
        status_code=status_code,
        content_type="text/html",
        content_length=size,
        bytes_read=size,
        redirect_count=redirect_count,
        elapsed_time=0.25,
    )
    return analyze_html(html, url, fetch)


def check(result, check_id: str):
    return next(item for item in result.checks if item.id == check_id)


def all_pass_html() -> str:
    body = " ".join(["Useful page content helps visitors understand this service."] * 70)
    return (
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Practical guide to choosing a local service</title>"
        '<meta name="description" content="A useful guide that explains the available service options and what visitors can expect before they choose.">'
        '<link rel="canonical" href="https://example.test/page/">'
        '<meta property="og:title" content="Service guide">'
        '<meta property="og:description" content="Learn about this service">'
        '<meta property="og:image" content="https://example.test/share.png">'
        '<meta property="og:url" content="https://example.test/page/">'
        '<meta name="twitter:card" content="summary">'
        '<meta name="twitter:title" content="Service guide">'
        '<script type="application/ld+json">{"@type":"WebPage"}</script>'
        "</head><body><h1>Choosing a local service</h1><h2>What to expect</h2>"
        f'<p>{body}</p><a href="/related/">Read the related guide</a></body></html>'
    )


def test_empty_alt_is_not_counted_as_missing_or_failed_by_itself() -> None:
    result = analyze('<html><body><img src="/ornament.svg" alt="" role="presentation"></body></html>')

    assert result.deterministic_score.version == "1.1"
    assert result.images.total == 1
    assert result.images.with_alt == 1  # Legacy count: an alt attribute is present.
    assert result.images.missing_alt == 0
    assert result.images.empty_alt == 1
    assert result.images.nonempty_alt == 0
    assert result.images.empty_alt_intent_unknown == 1
    assert result.images.alt_coverage_percent == 100.0  # Preserved legacy meaning.
    assert check(result, "image_alt").status == CheckStatus.PASS
    assert check(result, "image_alt").points == 10
    assert check(result, "image_alt").is_actionable is False
    assert check(result, "image_alt").optional_note


def test_image_alt_counts_distinguish_absent_empty_and_nonempty_attributes() -> None:
    result = analyze(
        '<html><body><img src="/one.svg" alt="Panel controls">'
        '<img src="/two.svg" alt=""><img src="/three.svg"></body></html>'
    )

    assert result.images.total == 3
    assert result.images.with_alt == 2
    assert result.images.missing_alt == 1
    assert result.images.empty_alt == 1
    assert result.images.nonempty_alt == 1
    assert result.images.empty_alt_intent_unknown == 1
    assert result.images.alt_coverage_percent == 66.67
    assert check(result, "image_alt").is_actionable is True
    assert check(result, "image_alt").fix_snippet is None


def test_no_images_and_descriptive_alt_have_explicit_neutral_counts() -> None:
    no_images = analyze("<html><body><p>A page with no image elements.</p></body></html>")
    descriptive = analyze('<html><body><img src="/diagram.svg" alt="Solar panel wiring diagram"></body></html>')

    assert no_images.images.total == 0
    assert no_images.images.with_alt == 0
    assert no_images.images.missing_alt == 0
    assert no_images.images.empty_alt == 0
    assert no_images.images.nonempty_alt == 0
    assert no_images.images.empty_alt_intent_unknown == 0
    assert check(no_images, "image_alt").status == CheckStatus.NOT_APPLICABLE
    assert descriptive.images.total == 1
    assert descriptive.images.with_alt == 1
    assert descriptive.images.nonempty_alt == 1
    assert descriptive.images.empty_alt == 0
    assert check(descriptive, "image_alt").status == CheckStatus.PASS


def test_older_analysis_payloads_still_validate_with_new_optional_fields() -> None:
    result = analyze(Path("tests/fixtures/basic.html").read_text(encoding="utf-8"))
    payload = result.model_dump(mode="python")
    payload.pop("findings_summary")
    payload["images"].pop("nonempty_alt")
    payload["images"].pop("empty_alt_intent_unknown")
    new_check_fields = {
        "impact",
        "effort",
        "finding_title",
        "finding_reason",
        "fix_snippet",
        "snippet_requires_review",
        "is_actionable",
        "optional_note",
        "exclusion_reason",
        "anatomy_part",
    }
    for check_payload in payload["checks"]:
        for field in new_check_fields:
            check_payload.pop(field)

    compatible = SEOAnalysis.model_validate(payload)

    assert compatible.requested_url == result.requested_url
    assert compatible.checks[0].title == result.checks[0].title
    assert compatible.findings_summary is None
    assert compatible.images.with_alt == result.images.with_alt


def test_ruleset_covers_every_check_and_every_impact_and_effort_level() -> None:
    result = analyze(Path("tests/fixtures/basic.html").read_text(encoding="utf-8"))

    expected_ids = {
        "retrieval_success",
        "http_status",
        "https",
        "content_type",
        "redirects",
        "fetch_duration",
        "robots_directives",
        "title",
        "meta_description",
        "canonical",
        "h1_structure",
        "heading_hierarchy",
        "visible_text",
        "internal_links",
        "anchor_text",
        "link_relationships",
        "image_alt",
        "json_ld",
        "open_graph",
        "twitter_metadata",
        "html_lang",
        "viewport",
        "charset",
    }
    assert set(CHECK_POLICIES) == expected_ids
    assert {item.id for item in result.checks} == expected_ids
    assert len(result.checks) == 23
    assert sum(CATEGORY_WEIGHTS.values()) == 100
    cases = [case for policy in CHECK_POLICIES.values() for case in policy.cases]
    assert set(Impact) == {case.impact for case in cases if case.impact is not None}
    assert set(Effort) == {case.effort for case in cases if case.effort is not None}


def test_findings_summary_reconciles_counts_and_explains_exclusions() -> None:
    result = analyze(Path("tests/fixtures/basic.html").read_text(encoding="utf-8"))
    summary = result.findings_summary
    raw_total = summary.raw_passes + summary.raw_warnings + summary.raw_failures + summary.raw_not_applicable

    assert raw_total == len(result.checks) == 23
    assert summary.raw_passes == sum(item.status == CheckStatus.PASS for item in result.checks)
    assert summary.raw_warnings == sum(item.status == CheckStatus.WARNING for item in result.checks)
    assert summary.raw_failures == sum(item.status == CheckStatus.FAIL for item in result.checks)
    assert summary.raw_not_applicable == sum(item.status == CheckStatus.NOT_APPLICABLE for item in result.checks)
    assert summary.actionable_count == sum(item.is_actionable for item in result.checks)
    assert summary.optional_note_count == sum(bool(item.optional_note) for item in result.checks)
    assert sum(summary.by_impact.model_dump().values()) == summary.actionable_count
    assert set(summary.prioritized_check_ids) == {item.id for item in result.checks if item.is_actionable}
    assert len(summary.prioritized_check_ids) == summary.actionable_count
    assert all(
        item.finding_title and item.finding_reason and item.impact and item.effort
        for item in result.checks
        if item.is_actionable
    )
    assert all(
        item.exclusion_reason
        for item in result.checks
        if item.status in {CheckStatus.WARNING, CheckStatus.FAIL} and not item.is_actionable
    )
    assert summary.raw_not_applicable >= 1
    assert check(result, "json_ld").is_actionable is False
    assert check(result, "json_ld").optional_note


def test_verdicts_are_plain_language_and_handle_blocking_high_small_and_zero_cases() -> None:
    clean = all_pass_html()
    blocking = analyze(clean.replace("<head>", '<head><meta name="robots" content="noindex, follow">'))
    high = analyze(
        clean.replace(
            '<meta name="description" content="A useful guide that explains the available service options and what visitors can expect before they choose.">',
            "",
        )
    )
    small = analyze(clean.replace("Practical guide to choosing a local service", "Guide"))
    zero = analyze(clean.replace('<script type="application/ld+json">{"@type":"WebPage"}</script>', ""))

    assert blocking.findings_summary.verdict == "This page tells search engines not to index it."
    assert high.findings_summary.verdict.startswith("1 fix. ")
    assert "missing page description" in high.findings_summary.verdict.lower()
    assert small.findings_summary.verdict == "1 small fix."
    assert zero.findings_summary.verdict == "Nothing to fix in these checks."
    assert zero.findings_summary.actionable_count == 0
    assert zero.findings_summary.optional_note_count == 1
    assert check(zero, "json_ld").exclusion_reason


def test_priority_order_and_verdict_distinguish_northstar_from_weak_input() -> None:
    weak = analyze(Path("tests/fixtures/weak.html").read_text(encoding="utf-8"))
    northstar = analyze(Path("web/public/fixtures/northstar-solar.html").read_text(encoding="utf-8"))

    assert len(weak.findings_summary.prioritized_check_ids) >= 3
    assert weak.findings_summary.verdict != northstar.findings_summary.verdict
    assert northstar.findings_summary.verdict == "This page tells search engines not to index it."
    assert check(northstar, "robots_directives").impact == Impact.BLOCKING
    nofollow = analyze(all_pass_html().replace("<head>", '<head><meta name="robots" content="nofollow">'))
    assert nofollow.findings_summary.verdict != "This page tells search engines not to index it."
    assert check(nofollow, "robots_directives").impact == Impact.MEDIUM


def test_repeated_analysis_is_identical_and_legacy_fields_remain_available() -> None:
    html = all_pass_html().replace("Practical guide", "A very useful practical guide")
    first = analyze(html)
    second = analyze(html)

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.deterministic_score.version == "1.1"
    assert first.checks[0].title == "HTML retrieval succeeded"
    assert first.checks[0].recommendation
    assert "with_alt" in first.images.model_dump()
    assert "alt_coverage_percent" in first.images.model_dump()


def test_v11_preserves_all_version_10_fixture_scores_and_check_statuses() -> None:
    samples = {
        "basic.html": {
            "score": 84,
            "statuses": (14, 7, 0, 2),
            "categories": (30, 16, 13, 5, 10, 3, 2, 5),
            "warning_ids": {
                "title",
                "meta_description",
                "visible_text",
                "internal_links",
                "json_ld",
                "open_graph",
                "twitter_metadata",
            },
            "fail_ids": set(),
            "na_ids": {"link_relationships", "image_alt"},
        },
        "hostile.html": {
            "score": 67,
            "statuses": (9, 10, 2, 2),
            "categories": (30, 8, 7, 5, 10, 3, 2, 2),
            "warning_ids": {
                "title",
                "canonical",
                "visible_text",
                "internal_links",
                "json_ld",
                "open_graph",
                "twitter_metadata",
                "html_lang",
                "viewport",
                "charset",
            },
            "fail_ids": {"meta_description", "h1_structure"},
            "na_ids": {"link_relationships", "image_alt"},
        },
        "weak.html": {
            "score": 55,
            "statuses": (8, 11, 3, 1),
            "categories": (30, 7, 7, 3.75, 0, 3, 2, 2),
            "warning_ids": {
                "title",
                "canonical",
                "visible_text",
                "internal_links",
                "anchor_text",
                "json_ld",
                "open_graph",
                "twitter_metadata",
                "html_lang",
                "viewport",
                "charset",
            },
            "fail_ids": {"meta_description", "h1_structure", "image_alt"},
            "na_ids": {"link_relationships"},
        },
    }
    for name, expected in samples.items():
        result = analyze(Path("tests/fixtures", name).read_text(encoding="utf-8"))
        summary = result.findings_summary
        assert result.deterministic_score.version == "1.1"
        assert result.deterministic_score.overall_score == expected["score"]
        assert (
            summary.raw_passes,
            summary.raw_warnings,
            summary.raw_failures,
            summary.raw_not_applicable,
        ) == expected["statuses"]
        assert tuple(item.points_earned for item in result.deterministic_score.categories) == expected["categories"]
        assert {item.id for item in result.checks if item.status == CheckStatus.WARNING} == expected["warning_ids"]
        assert {item.id for item in result.checks if item.status == CheckStatus.FAIL} == expected["fail_ids"]
        assert {item.id for item in result.checks if item.status == CheckStatus.NOT_APPLICABLE} == expected["na_ids"]
        assert len(result.checks) == 23

    northstar = analyze(Path("web/public/fixtures/northstar-solar.html").read_text(encoding="utf-8"))
    assert northstar.deterministic_score.overall_score == 90
    assert len(northstar.checks) == 23
    assert {item.id for item in northstar.checks if item.status == CheckStatus.FAIL} == {"robots_directives"}
    assert {item.id for item in northstar.checks if item.status == CheckStatus.WARNING} == {
        "canonical",
        "visible_text",
        "open_graph",
        "twitter_metadata",
    }


def test_finding_reasons_use_singular_and_plural_grammar() -> None:
    single_title = analyze("<html><head><title>x</title></head><body></body></html>")
    multiple_anchors = analyze('<html><body><a href="/one"></a><a href="/two"></a></body></html>')

    title = check(single_title, "title")
    anchor = check(multiple_anchors, "anchor_text")
    assert "1 character." in title.finding_reason
    assert "1 characters" not in title.finding_reason
    assert "2 links have" in anchor.finding_reason
    assert "link(s)" not in anchor.finding_reason


def test_observed_evidence_uses_readable_count_grammar() -> None:
    result = analyze(
        '<html><head><title>x</title><meta name="description" content="y"></head>'
        '<body><h1>x</h1><img src="/one.svg" alt="Panel">'
        '<a href="/one">One</a><a href="https://other.test/">Other</a>'
        '<script type="application/ld+json">{broken}</script></body></html>',
        redirect_count=1,
    )
    by_id = {item.id: item for item in result.checks}

    assert by_id["redirects"].evidence.observed.startswith("Observed 1 redirect;")
    assert by_id["title"].evidence.observed == "Title length is 1 character."
    assert by_id["meta_description"].evidence.observed == "Description length is 1 character."
    assert by_id["h1_structure"].evidence.observed == "H1 headings: 1; empty headings: 0."
    assert by_id["internal_links"].evidence.observed == "Found 1 internal link and 1 external link."
    assert by_id["image_alt"].evidence.observed == (
        "Images with non-empty alt text: 1/1; empty alt attributes: 0; missing alt attributes: 0."
    )
    assert by_id["json_ld"].finding_reason == "One JSON-LD block in the fetched HTML could not be parsed."


@pytest.mark.parametrize(
    ("json_ld_markup", "expected_score", "expected_status", "expected_reason", "expected_optional"),
    [
        (
            '<script type="application/ld+json">{"@type":"WebPage"}</script>',
            100,
            CheckStatus.PASS,
            None,
            False,
        ),
        (
            '<script type="application/ld+json">{broken}</script>',
            95,
            CheckStatus.FAIL,
            "One JSON-LD block in the fetched HTML could not be parsed.",
            False,
        ),
        (
            '<script type="application/ld+json">{broken}</script><script type="application/ld+json">not json</script>',
            95,
            CheckStatus.FAIL,
            "Two JSON-LD blocks in the fetched HTML could not be parsed.",
            False,
        ),
        (
            '<script type="application/ld+json">{broken}</script>'
            '<script type="application/ld+json">not json</script>'
            '<script type="application/ld+json">?</script>',
            95,
            CheckStatus.FAIL,
            "3 JSON-LD blocks in the fetched HTML could not be parsed.",
            False,
        ),
        (
            '<script type="application/ld+json">{"@type":"WebPage"}</script>'
            '<script type="application/ld+json">{"@type":"Article"}</script>',
            100,
            CheckStatus.PASS,
            None,
            False,
        ),
        (
            '<script type="application/ld+json">{"@type":"WebPage"}</script>'
            '<script type="application/ld+json">{broken}</script>',
            95,
            CheckStatus.FAIL,
            "One JSON-LD block in the fetched HTML could not be parsed.",
            False,
        ),
        ("", 98, CheckStatus.WARNING, None, True),
    ],
    ids=(
        "zero-malformed",
        "one-malformed",
        "two-malformed",
        "many-malformed",
        "multiple-valid",
        "mixed",
        "optional-absent",
    ),
)
def test_json_ld_finding_grammar_preserves_v11_analysis(
    json_ld_markup: str,
    expected_score: int,
    expected_status: CheckStatus,
    expected_reason: str | None,
    expected_optional: bool,
) -> None:
    original_markup = '<script type="application/ld+json">{"@type":"WebPage"}</script>'
    html = all_pass_html().replace(original_markup, json_ld_markup)
    result = analyze(html)
    json_ld = check(result, "json_ld")

    assert result.deterministic_score.version == "1.1"
    assert result.deterministic_score.overall_score == expected_score
    assert tuple(item.id for item in result.checks) == tuple(item.id for item in analyze(all_pass_html()).checks)
    assert json_ld.status == expected_status
    assert json_ld.finding_reason == expected_reason
    assert json_ld.impact == (Impact.MEDIUM if expected_reason else None)
    assert json_ld.effort == (Effort.MODERATE if expected_reason else None)
    assert json_ld.is_actionable is (expected_reason is not None)
    assert (json_ld.optional_note is not None) is expected_optional
    assert result.findings_summary.prioritized_check_ids == (["json_ld"] if expected_reason else [])
    assert result.findings_summary.actionable_count == (1 if expected_reason else 0)
    assert all(
        (before.id, before.status, before.points, before.impact, before.effort, before.is_actionable)
        == (after.id, after.status, after.points, after.impact, after.effort, after.is_actionable)
        for before, after in zip(analyze(all_pass_html()).checks, result.checks, strict=True)
        if before.id != "json_ld"
    )


def test_final_non_2xx_http_status_is_blocking_without_changing_score_status() -> None:
    for status_code in (200, 204):
        result = analyze(all_pass_html(), status_code=status_code)
        http_check = check(result, "http_status")

        assert http_check.status == CheckStatus.PASS
        assert http_check.is_actionable is False
        assert http_check.impact is None
        assert http_check.points == 5

    for status_code in (301, 302, 307, 404, 500):
        result = analyze(all_pass_html(), status_code=status_code)
        http_check = check(result, "http_status")

        assert http_check.status == (CheckStatus.WARNING if status_code < 400 else CheckStatus.FAIL)
        assert http_check.is_actionable is True
        assert http_check.impact == Impact.BLOCKING
        assert http_check.points == (3 if status_code < 400 else 0)
        assert result.findings_summary.verdict == "The page returned an unsuccessful HTTP response."

    redirected_success = analyze(all_pass_html(), redirect_count=1, status_code=200)
    assert check(redirected_success, "http_status").is_actionable is False
    assert check(redirected_success, "redirects").impact == Impact.LOW
    assert all(item.impact != Impact.BLOCKING for item in redirected_success.checks)


def test_redirect_priority_uses_count_without_changing_effort_or_http_status() -> None:
    counts = sorted({0, 1, 2, 3, Settings().max_redirects, 10})
    for redirect_count in counts:
        result = analyze(all_pass_html(), redirect_count=redirect_count)
        redirect_check = check(result, "redirects")

        if redirect_count == 0:
            assert redirect_check.status == CheckStatus.PASS
            assert redirect_check.is_actionable is False
            assert redirect_check.impact is None
        else:
            expected_impact = Impact.HIGH if redirect_count >= 3 else Impact.LOW
            assert redirect_check.status == CheckStatus.WARNING
            assert redirect_check.is_actionable is True
            assert redirect_check.impact == expected_impact
            assert redirect_check.effort == Effort.QUICK
        assert check(result, "http_status").is_actionable is False

    long_chain = analyze(all_pass_html(), redirect_count=3)
    assert long_chain.findings_summary.prioritized_check_ids[0] == "redirects"
    assert long_chain.findings_summary.verdict == "1 fix. The long redirect chain matters most."


def test_visible_word_boundaries_set_review_priority_but_not_score_points() -> None:
    expected = {
        0: (CheckStatus.FAIL, Impact.HIGH, 0),
        1: (CheckStatus.WARNING, Impact.HIGH, 3),
        99: (CheckStatus.WARNING, Impact.HIGH, 3),
        100: (CheckStatus.WARNING, Impact.MEDIUM, 4),
        299: (CheckStatus.WARNING, Impact.MEDIUM, 4),
        300: (CheckStatus.PASS, None, 5),
    }

    for word_count, (status, impact, points) in expected.items():
        words = " ".join("word" for _ in range(word_count))
        result = analyze(f"<html><body><p>{words}</p></body></html>")
        text_check = check(result, "visible_text")

        assert result.lexical_signals.visible_word_count == word_count
        assert text_check.status == status
        assert text_check.points == points
        assert text_check.impact == impact
        assert text_check.is_actionable is (word_count < 300)
        if 0 < word_count < 300:
            assert "may be appropriate for its purpose" in text_check.finding_reason
            assert "rank" not in text_check.finding_reason.lower()


def test_priority_order_uses_impact_effort_and_original_check_order() -> None:
    html = (
        '<html><head><meta name="robots" content="noindex"><title>T</title>'
        "</head><body><h2>Section</h2><p>word</p>"
        '<a href="/related"></a><img src="/chart.svg"></body></html>'
    )
    result = analyze(html, redirect_count=1, url="http://example.test/page/")

    assert result.findings_summary.prioritized_check_ids == [
        "robots_directives",
        "meta_description",
        "h1_structure",
        "https",
        "visible_text",
        "title",
        "anchor_text",
        "html_lang",
        "viewport",
        "canonical",
        "image_alt",
        "redirects",
        "open_graph",
        "twitter_metadata",
        "charset",
    ]


def test_multiple_blocking_findings_select_one_stable_plain_verdict() -> None:
    html = all_pass_html().replace("<head>", '<head><meta name="robots" content="noindex">')
    first = analyze(html, status_code=404)
    second = analyze(html, status_code=404)

    assert first.findings_summary.prioritized_check_ids[:3] == [
        "robots_directives",
        "http_status",
        "retrieval_success",
    ]
    assert first.findings_summary.verdict == "This page tells search engines not to index it."
    assert second.findings_summary.verdict == first.findings_summary.verdict
