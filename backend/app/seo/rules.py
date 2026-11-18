"""Authoritative deterministic scoring and finding policy for SEO v1.1."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


SCORING_VERSION = "1.1"

CATEGORY_WEIGHTS: dict[str, float] = {
    "technical_indexability": 30.0,
    "metadata": 20.0,
    "headings_content_structure": 15.0,
    "links": 10.0,
    "images": 10.0,
    "structured_data": 5.0,
    "social_metadata": 5.0,
    "html_signals": 5.0,
}

TITLE_SHORT = 30
TITLE_LONG = 60
DESCRIPTION_SHORT = 50
DESCRIPTION_LONG = 160
VISIBLE_WORD_WARNING = 100
VISIBLE_WORD_PASS = 300


class Impact(StrEnum):
    BLOCKING = "blocking"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Effort(StrEnum):
    QUICK = "quick"
    MODERATE = "moderate"
    LARGER_JOB = "larger_job"


class AnatomyPart(StrEnum):
    PAGE = "page"
    TITLE = "title"
    DESCRIPTION = "description"
    HEADING = "heading"
    CONTENT = "content"
    IMAGE = "image"
    LINKS = "links"
    TECHNICAL = "technical"
    SHARING = "sharing"
    STRUCTURED_DATA = "structured_data"


@dataclass(frozen=True)
class Predicate:
    """Small declarative condition evaluated against analyzer facts."""

    field: str
    operator: str
    value: object


@dataclass(frozen=True)
class RuleCase:
    """One ordered finding decision, with an optional condition override."""

    when: tuple[Predicate, ...] | None
    actionable: bool = False
    impact: Impact | None = None
    effort: Effort | None = None
    anatomy_part: AnatomyPart | None = None
    finding_title: str | None = None
    finding_reason: str | None = None
    optional_note: str | None = None
    exclusion_reason: str | None = None
    fix_snippet: str | None = None
    snippet_requires_review: bool = False
    verdict_focus: str | None = None
    blocking_verdict: str | None = None


@dataclass(frozen=True)
class FindingPolicy:
    """Ordered, inspectable cases for one stable check identifier."""

    check_id: str
    cases: tuple[RuleCase, ...]


def _p(field: str, operator: str, value: object) -> Predicate:
    return Predicate(field, operator, value)


def _action(
    when: tuple[Predicate, ...],
    title: str,
    reason: str,
    impact: Impact,
    effort: Effort,
    anatomy_part: AnatomyPart,
    *,
    fix_snippet: str | None = None,
    snippet_requires_review: bool = False,
    verdict_focus: str | None = None,
    blocking_verdict: str | None = None,
) -> RuleCase:
    return RuleCase(
        when=when,
        actionable=True,
        impact=impact,
        effort=effort,
        anatomy_part=anatomy_part,
        finding_title=title,
        finding_reason=reason,
        fix_snippet=fix_snippet,
        snippet_requires_review=snippet_requires_review,
        verdict_focus=verdict_focus,
        blocking_verdict=blocking_verdict,
    )


def _optional(
    when: tuple[Predicate, ...],
    note: str,
    reason: str,
) -> RuleCase:
    return RuleCase(when=when, optional_note=note, exclusion_reason=reason)


_PROBLEM = _p("status", "in", ("warning", "fail"))
_WARNING = _p("status", "eq", "warning")
_FAIL = _p("status", "eq", "fail")
_IDLE = RuleCase(when=None)


CHECK_POLICIES: dict[str, FindingPolicy] = {
    "retrieval_success": FindingPolicy(
        "retrieval_success",
        (
            _action(
                (_FAIL,),
                "Restore page access",
                "The analysis could not retrieve usable page HTML.",
                Impact.BLOCKING,
                Effort.LARGER_JOB,
                AnatomyPart.PAGE,
                verdict_focus="The page could not be retrieved",
                blocking_verdict="The page could not be retrieved successfully.",
            ),
            _IDLE,
        ),
    ),
    "http_status": FindingPolicy(
        "http_status",
        (
            _action(
                (_PROBLEM,),
                "Check the page response",
                "The final response was HTTP {status_code}, not a 2xx response. Review the response and intended destination.",
                Impact.BLOCKING,
                Effort.MODERATE,
                AnatomyPart.TECHNICAL,
                verdict_focus="The unsuccessful page response",
                blocking_verdict="The page returned an unsuccessful HTTP response.",
            ),
            _IDLE,
        ),
    ),
    "https": FindingPolicy(
        "https",
        (
            _action(
                (_WARNING,),
                "Serve the page over HTTPS",
                "The analyzed page URL uses an unencrypted HTTP connection.",
                Impact.HIGH,
                Effort.MODERATE,
                AnatomyPart.TECHNICAL,
                verdict_focus="The page uses an unencrypted connection",
            ),
            _IDLE,
        ),
    ),
    "content_type": FindingPolicy(
        "content_type",
        (
            _action(
                (_FAIL,),
                "Serve a page format this checker can read",
                "The response was not served as supported HTML.",
                Impact.BLOCKING,
                Effort.LARGER_JOB,
                AnatomyPart.PAGE,
                verdict_focus="The page response is not supported HTML",
                blocking_verdict="The page did not return a supported HTML document.",
            ),
            _IDLE,
        ),
    ),
    "redirects": FindingPolicy(
        "redirects",
        (
            _action(
                (_p("redirect_count", "gt", 2), _WARNING),
                "Shorten the redirect chain",
                "A longer redirect path was observed before the final page response. Where practical, point links directly to the final URL.",
                Impact.HIGH,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
                verdict_focus="The long redirect chain",
            ),
            _action(
                (_WARNING,),
                "Review the redirect path",
                "The URL passed through a redirect before the final response. Where practical, point links directly to the final URL.",
                Impact.LOW,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
            ),
            _IDLE,
        ),
    ),
    "fetch_duration": FindingPolicy(
        "fetch_duration",
        (
            _optional(
                (_WARNING,),
                "One page fetch took longer than the analyzer's observation threshold.",
                "A single fetch duration does not establish ongoing site speed or identify its cause.",
            ),
            _IDLE,
        ),
    ),
    "robots_directives": FindingPolicy(
        "robots_directives",
        (
            _action(
                (_p("robots_noindex", "eq", True),),
                "Review the noindex directive",
                "The fetched HTML or response headers include a noindex directive. Confirm that the page is intentionally marked this way; this observation does not establish current index status.",
                Impact.BLOCKING,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
                verdict_focus="The page's noindex directive",
                blocking_verdict="This page tells search engines not to index it.",
            ),
            _action(
                (_WARNING,),
                "Review the page's crawl directives",
                "A restrictive robots directive was observed. Check that it matches the page's intended crawling and link behavior.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
            ),
            _IDLE,
        ),
    ),
    "title": FindingPolicy(
        "title",
        (
            _action(
                (_p("title_missing", "eq", True),),
                "Write a page title",
                "No title text was found in the fetched HTML.",
                Impact.HIGH,
                Effort.QUICK,
                AnatomyPart.TITLE,
                fix_snippet="<title>[Write a clear title that describes this page]</title>",
                snippet_requires_review=True,
                verdict_focus="The missing page title",
            ),
            _action(
                (_p("title_length", "lt", TITLE_SHORT), _WARNING),
                "Make the page title more descriptive",
                "The title has {title_length_count}. Check that it clearly identifies this page; this length check does not predict search presentation.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.TITLE,
                verdict_focus="The very short page title",
            ),
            _action(
                (_p("title_length", "gt", TITLE_LONG), _WARNING),
                "Review the page title for repetition",
                "The title has {title_length_count}. Keep wording clear and useful; this length check does not predict search presentation.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.TITLE,
                verdict_focus="The page title's wording",
            ),
            _IDLE,
        ),
    ),
    "meta_description": FindingPolicy(
        "meta_description",
        (
            _action(
                (_p("description_missing", "eq", True),),
                "Add a page description",
                "No meta description was found in the fetched HTML.",
                Impact.HIGH,
                Effort.QUICK,
                AnatomyPart.DESCRIPTION,
                fix_snippet='<meta name="description" content="[Write an accurate summary of this page]">',
                snippet_requires_review=True,
                verdict_focus="The missing page description",
            ),
            _action(
                (_p("description_length", "lt", DESCRIPTION_SHORT), _WARNING),
                "Make the page description more useful",
                "The description has {description_length_count}. Check that it accurately summarizes the page; this length check does not predict search presentation.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.DESCRIPTION,
            ),
            _action(
                (_p("description_length", "gt", DESCRIPTION_LONG), _WARNING),
                "Review the page description for repetition",
                "The description has {description_length_count}. Keep it accurate and useful; this length check does not predict search presentation.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.DESCRIPTION,
            ),
            _IDLE,
        ),
    ),
    "canonical": FindingPolicy(
        "canonical",
        (
            _action(
                (_p("canonical_relationship", "eq", "malformed"), _FAIL),
                "Correct the canonical URL",
                "The canonical link could not be parsed as an HTTP or HTTPS URL.",
                Impact.HIGH,
                Effort.MODERATE,
                AnatomyPart.TECHNICAL,
                verdict_focus="The malformed canonical URL",
            ),
            _action(
                (_PROBLEM,),
                "Review the canonical URL",
                "The observed canonical relationship is {canonical_relationship}. Confirm that the canonical URL identifies the page intended by the site owner.",
                Impact.MEDIUM,
                Effort.MODERATE,
                AnatomyPart.TECHNICAL,
                fix_snippet='<link rel="canonical" href="{final_url}">',
                snippet_requires_review=True,
            ),
            _IDLE,
        ),
    ),
    "h1_structure": FindingPolicy(
        "h1_structure",
        (
            _action(
                (_p("h1_count", "eq", 0), _FAIL),
                "Add one main heading (H1)",
                "No H1 heading was found in the fetched HTML.",
                Impact.HIGH,
                Effort.QUICK,
                AnatomyPart.HEADING,
                fix_snippet="<h1>[Describe the main purpose of this page]</h1>",
                snippet_requires_review=True,
                verdict_focus="The missing main heading",
            ),
            _action(
                (_p("empty_heading_count", "gt", 0), _FAIL),
                "Give empty headings useful text",
                "One or more heading elements contain no text in the fetched HTML.",
                Impact.HIGH,
                Effort.QUICK,
                AnatomyPart.HEADING,
                verdict_focus="The empty page heading",
            ),
            _action(
                (_p("h1_count", "gt", 1), _WARNING),
                "Choose one main heading",
                "The fetched HTML contains {h1_count} H1 headings. Review their structure and make the page's main topic clear.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.HEADING,
            ),
            _IDLE,
        ),
    ),
    "heading_hierarchy": FindingPolicy(
        "heading_hierarchy",
        (
            _action(
                (_WARNING,),
                "Put headings in a clear order",
                "The fetched headings skip one or more levels: {hierarchy_jumps}.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.HEADING,
            ),
            _IDLE,
        ),
    ),
    "visible_text": FindingPolicy(
        "visible_text",
        (
            _action(
                (_p("visible_word_count", "eq", 0), _FAIL),
                "Add useful page context",
                "No visible page text was found in the fetched HTML.",
                Impact.HIGH,
                Effort.LARGER_JOB,
                AnatomyPart.CONTENT,
                verdict_focus="The page has no visible text",
            ),
            _action(
                (_p("visible_word_count", "gt", 0), _p("visible_word_count", "lt", VISIBLE_WORD_WARNING), _WARNING),
                "Check whether this short page needs more context",
                "A short page may be appropriate for its purpose. Check whether visitors get the context they need.",
                Impact.HIGH,
                Effort.MODERATE,
                AnatomyPart.CONTENT,
                verdict_focus="The very short page content",
            ),
            _action(
                (_WARNING,),
                "Check that the page answers its visitors' main question",
                "The fetched HTML contains about {visible_word_count} visible words. A short page may be appropriate for its purpose; check whether it gives visitors the context they need.",
                Impact.MEDIUM,
                Effort.MODERATE,
                AnatomyPart.CONTENT,
            ),
            _IDLE,
        ),
    ),
    "internal_links": FindingPolicy(
        "internal_links",
        (
            _action(
                (_WARNING,),
                "Add useful links to related pages",
                "No internal links were detected in the fetched HTML. Add links where they help visitors move between related pages.",
                Impact.MEDIUM,
                Effort.MODERATE,
                AnatomyPart.LINKS,
            ),
            _IDLE,
        ),
    ),
    "anchor_text": FindingPolicy(
        "anchor_text",
        (
            _action(
                (_WARNING,),
                "Make link text clear",
                "{empty_anchor_summary} Use text that explains where each link goes.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.LINKS,
            ),
            _IDLE,
        ),
    ),
    "link_relationships": FindingPolicy("link_relationships", (_IDLE,)),
    "image_alt": FindingPolicy(
        "image_alt",
        (
            _action(
                (_p("missing_alt_count", "gt", 0),),
                "Check images without alt text",
                "{missing_alt_summary} Check whether each image conveys information; add useful alt text only when it does.",
                Impact.MEDIUM,
                Effort.MODERATE,
                AnatomyPart.IMAGE,
            ),
            _optional(
                (_p("empty_alt_count", "gt", 0),),
                "{empty_alt_summary}",
                "Empty alt attributes may be intentional for decorative images; the analyzer cannot determine that intent from HTML alone.",
            ),
            _IDLE,
        ),
    ),
    "json_ld": FindingPolicy(
        "json_ld",
        (
            _action(
                (_p("malformed_json_ld_count", "gt", 0), _FAIL),
                "Fix malformed structured data",
                "{malformed_json_ld_reason}",
                Impact.MEDIUM,
                Effort.MODERATE,
                AnatomyPart.STRUCTURED_DATA,
            ),
            _optional(
                (_p("json_ld_block_count", "eq", 0), _WARNING),
                "No JSON-LD was found. Structured data is not required for every page.",
                "Missing optional JSON-LD is not a confirmed page defect by itself.",
            ),
            _IDLE,
        ),
    ),
    "open_graph": FindingPolicy(
        "open_graph",
        (
            _action(
                (_WARNING,),
                "Add useful social sharing details",
                "The fetched HTML contains {open_graph_count} of four checked Open Graph fields.",
                Impact.LOW,
                Effort.QUICK,
                AnatomyPart.SHARING,
            ),
            _IDLE,
        ),
    ),
    "twitter_metadata": FindingPolicy(
        "twitter_metadata",
        (
            _action(
                (_WARNING,),
                "Add useful X sharing details",
                "The fetched HTML contains {twitter_metadata_count} of four checked X card fields.",
                Impact.LOW,
                Effort.QUICK,
                AnatomyPart.SHARING,
            ),
            _IDLE,
        ),
    ),
    "html_lang": FindingPolicy(
        "html_lang",
        (
            _action(
                (_WARNING,),
                "Declare the page language",
                "No language was declared on the HTML element. Set it to the page's actual primary language.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
            ),
            _IDLE,
        ),
    ),
    "viewport": FindingPolicy(
        "viewport",
        (
            _action(
                (_WARNING,),
                "Add a viewport declaration",
                "No viewport declaration was found in the fetched HTML.",
                Impact.MEDIUM,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
                fix_snippet='<meta name="viewport" content="width=device-width, initial-scale=1">',
            ),
            _IDLE,
        ),
    ),
    "charset": FindingPolicy(
        "charset",
        (
            _action(
                (_WARNING,),
                "Declare the document encoding",
                "No character encoding declaration was found in the fetched HTML. Confirm the file's actual encoding before adding a label.",
                Impact.LOW,
                Effort.QUICK,
                AnatomyPart.TECHNICAL,
                fix_snippet='<meta charset="utf-8">',
                snippet_requires_review=True,
            ),
            _IDLE,
        ),
    ),
}


EXPECTED_CHECK_IDS = frozenset(CHECK_POLICIES)
