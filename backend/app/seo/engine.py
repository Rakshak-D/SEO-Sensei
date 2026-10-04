"""Pure deterministic SEO parser and scoring engine.

No network calls, provider calls, current time, randomness, or ranking APIs are
used here. Given the same HTML, final URL, and fetch metadata, the output is
identical.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from .models import (
    CategoryScore,
    CheckStatus,
    Evidence,
    FetchMetadata,
    HeadingSummary,
    HreflangInfo,
    HreflangLink,
    ImageStatistics,
    LexicalSignals,
    LinkStatistics,
    PageMetadata,
    SEOAnalysis,
    SEOCategory,
    SEOCheck,
    SEOScore,
    SocialMetadata,
    StructuredDataInfo,
    TermFrequency,
)


TITLE_SHORT = 30
TITLE_LONG = 60
DESCRIPTION_SHORT = 50
DESCRIPTION_LONG = 160
VISIBLE_WORD_WARNING = 100
VISIBLE_WORD_PASS = 300
SCORE_WEIGHTS = {
    SEOCategory.TECHNICAL_INDEXABILITY: 30.0,
    SEOCategory.METADATA: 20.0,
    SEOCategory.HEADINGS_CONTENT: 15.0,
    SEOCategory.LINKS: 10.0,
    SEOCategory.IMAGES: 10.0,
    SEOCategory.STRUCTURED_DATA: 5.0,
    SEOCategory.SOCIAL_METADATA: 5.0,
    SEOCategory.HTML_SIGNALS: 5.0,
}
STOP_WORDS = frozenset("a an and are as at be by for from in is it of on or that the this to with your".split())
MIXED_CONTENT_RE = re.compile(r"(?:src|href|action)\s*=\s*['\"]http://", re.IGNORECASE)
HREFLANG_RE = re.compile(r"^(?:[a-z]{2,3}(?:-[A-Z]{2}|-[0-9]{3})?|x-default)$")


class _Link:
    def __init__(self, attrs: dict[str, str]) -> None:
        self.attrs = attrs
        self.text: list[str] = []


class _SEOHTMLParser(HTMLParser):
    """Small bounded parser using only the standard library."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.title_count = 0
        self.meta: list[dict[str, str]] = []
        self.links: list[dict[str, str]] = []
        self.anchors: list[_Link] = []
        self.images: list[dict[str, str]] = []
        self.headings: dict[str, list[str]] = {"h1": [], "h2": [], "h3": []}
        self.empty_heading_count = 0
        self.html_lang: str | None = None
        self.charset: str | None = None
        self.viewport: str | None = None
        self.visible_parts: list[str] = []
        self._stack: list[str] = []
        self._title_depth = 0
        self._heading: tuple[str, list[str]] | None = None
        self._anchor: _Link | None = None
        self._script_type: str | None = None
        self._script_parts: list[str] = []
        self.json_ld: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        self._stack.append(tag)
        if tag == "html" and attr_map.get("lang"):
            self.html_lang = attr_map["lang"].strip()
        if tag == "title":
            self.title_count += 1
            self._title_depth = len(self._stack)
        if tag == "meta":
            self.meta.append(attr_map)
            if "charset" in attr_map:
                self.charset = attr_map["charset"].strip()
            if attr_map.get("name", "").lower() == "viewport":
                self.viewport = attr_map.get("content", "").strip()
        if tag == "link":
            self.links.append(attr_map)
        if tag == "img":
            self.images.append(attr_map)
        if tag in self.headings:
            self._heading = (tag, [])
        if tag == "a":
            self._anchor = _Link(attr_map)
        if tag == "script":
            self._script_type = attr_map.get("type", "").lower().split(";", 1)[0].strip()
            self._script_parts = []

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title" and self._title_depth:
            self.title_parts.extend(self._current_text_parts())
            self._title_depth = 0
        if tag in self.headings and self._heading and self._heading[0] == tag:
            value = " ".join(self._heading[1]).strip()
            self.headings[tag].append(value)
            if not value:
                self.empty_heading_count += 1
            self._heading = None
        if tag == "a" and self._anchor is not None:
            self._anchor.text = [part.strip() for part in self._anchor.text if part.strip()]
            self.anchors.append(self._anchor)
            self._anchor = None
        if tag == "script":
            if self._script_type == "application/ld+json":
                self.json_ld.append("".join(self._script_parts))
            self._script_type = None
            self._script_parts = []
        if self._stack:
            for index in range(len(self._stack) - 1, -1, -1):
                if self._stack[index] == tag:
                    del self._stack[index:]
                    break

    def handle_data(self, data: str) -> None:
        if self._title_depth:
            self.title_parts.append(data)
        if self._heading is not None:
            self._heading[1].append(data)
        if self._anchor is not None:
            self._anchor.text.append(data)
        if self._script_type == "application/ld+json":
            self._script_parts.append(data)
        ignored = {"script", "style", "noscript", "template", "head", "title"}
        if not any(tag in ignored for tag in self._stack):
            self.visible_parts.append(data)

    def _current_text_parts(self) -> list[str]:
        return []


def _text(parts: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _meta_value(meta: list[dict[str, str]], name: str) -> str | None:
    for item in meta:
        if item.get("name", "").lower() == name or item.get("property", "").lower() == name:
            return item.get("content", "").strip()
    return None


def _all_meta_values(meta: list[dict[str, str]], names: set[str]) -> list[str]:
    values: list[str] = []
    for item in meta:
        key = item.get("name", "").lower()
        if key in names and item.get("content", "").strip():
            values.append(item["content"].strip())
    return values


def _canonical_data(parser: _SEOHTMLParser, final_url: str) -> tuple[str | None, str | None, str]:
    canonical: str | None = None
    for link in parser.links:
        rel = {token.lower() for token in link.get("rel", "").split()}
        if "canonical" in rel:
            canonical = link.get("href", "").strip()
            break
    if canonical is None:
        return None, None, "missing"
    if not canonical:
        return "", None, "malformed"
    try:
        resolved = urljoin(final_url, canonical)
        parsed = urlsplit(resolved)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return canonical, None, "malformed"
    except ValueError:
        return canonical, None, "malformed"
    final_host = urlsplit(final_url).hostname
    relation = "relative" if not urlsplit(canonical).scheme and not urlsplit(canonical).netloc else "valid_same_host"
    if parsed.hostname and final_host and parsed.hostname.lower() != final_host.lower():
        relation = "valid_other_host"
    return canonical, resolved, relation


def _hreflang_info(parser: _SEOHTMLParser, final_url: str) -> HreflangInfo:
    links: list[HreflangLink] = []
    malformed = 0
    for link in parser.links:
        rel = {token.lower() for token in link.get("rel", "").split()}
        language_region = link.get("hreflang", "").strip()
        if "alternate" not in rel or not language_region:
            continue
        href = link.get("href", "").strip()
        try:
            resolved = urljoin(final_url, href)
            parsed = urlsplit(resolved)
            valid_href = parsed.scheme in {"http", "https"} and bool(parsed.hostname)
        except ValueError:
            valid_href = False
        if not HREFLANG_RE.fullmatch(language_region) or not href or not valid_href:
            malformed += 1
            continue
        links.append(HreflangLink(language_region=language_region, href=resolved[:2_048]))
    return HreflangInfo(links=links[:50], malformed_count=malformed)


def _robots_directives(parser: _SEOHTMLParser, fetch: FetchMetadata) -> list[str]:
    directives: list[str] = []
    for value in _all_meta_values(parser.meta, {"robots", "googlebot", "googlebot-news"}):
        for directive in re.split(r"[,\s]+", value.lower()):
            if directive and directive not in directives:
                directives.append(directive)
    if fetch.x_robots_tag:
        for directive in re.split(r"[,\s]+", fetch.x_robots_tag.lower()):
            if directive and directive not in directives:
                directives.append(directive)
    return directives[:30]


def _json_ld_info(blocks: list[str]) -> StructuredDataInfo:
    valid = 0
    malformed = 0
    types: list[str] = []

    def collect(value: object) -> None:
        if isinstance(value, dict):
            item_type = value.get("@type")
            values = item_type if isinstance(item_type, list) else [item_type]
            for item in values:
                if isinstance(item, str) and item and item not in types:
                    types.append(item[:100])
            for nested in value.values():
                collect(nested)
        elif isinstance(value, list):
            for nested in value:
                collect(nested)

    for block in blocks:
        try:
            collect(json.loads(block.strip()))
            valid += 1
        except (TypeError, ValueError, json.JSONDecodeError):
            malformed += 1
    return StructuredDataInfo(block_count=len(blocks), valid_blocks=valid, malformed_blocks=malformed, types=types[:30])


def _check(
    check_id: str,
    category: SEOCategory,
    title: str,
    status: CheckStatus,
    points: float,
    max_points: float,
    observed: str,
    recommendation: str,
    value: str | int | float | bool | None = None,
) -> SEOCheck:
    return SEOCheck(
        id=check_id,
        category=category,
        title=title,
        status=status,
        points=points,
        max_points=max_points,
        evidence=Evidence(observed=observed, value=value),
        recommendation=recommendation,
    )


def _score(checks: list[SEOCheck]) -> SEOScore:
    categories: list[CategoryScore] = []
    weighted_total = 0.0
    for category, weight in SCORE_WEIGHTS.items():
        category_checks = [check for check in checks if check.category == category]
        raw_max = sum(check.max_points for check in category_checks)
        raw_points = sum(check.points for check in category_checks)
        ratio = raw_points / raw_max if raw_max else 1.0
        weighted = round(weight * ratio, 2)
        weighted_total += weighted
        categories.append(
            CategoryScore(
                category=category,
                weight=weight,
                points_earned=weighted,
                max_points=weight,
                raw_points=round(raw_points, 2),
                raw_max_points=round(raw_max, 2),
                check_ids=[check.id for check in category_checks],
            )
        )
    overall = max(0, min(100, round(weighted_total)))
    return SEOScore(version="1.0", overall_score=overall, points_earned=round(weighted_total, 2), categories=categories)


def analyze_html(html: str, final_url: str, fetch: FetchMetadata) -> SEOAnalysis:
    """Analyze bounded HTML without performing any network or AI operation."""

    parser = _SEOHTMLParser()
    parser.feed(html)
    parser.close()

    title = _text(parser.title_parts)
    description = _meta_value(parser.meta, "description") or ""
    canonical, canonical_resolved, canonical_relationship = _canonical_data(parser, final_url)
    robots = _robots_directives(parser, fetch)
    visible_text = _text(parser.visible_parts)
    terms = [term.lower() for term in re.findall(r"[\w'-]+", visible_text, flags=re.UNICODE)]
    term_counts = Counter(term for term in terms if len(term) > 3 and term not in STOP_WORDS)
    frequent_terms = [
        TermFrequency(term=term, count=count)
        for term, count in sorted(term_counts.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]

    final_parts = urlsplit(final_url)
    final_host = (final_parts.hostname or "").lower()
    total_links = len(parser.anchors)
    internal = external = empty_anchors = nofollow = sponsored = ugc = 0
    for anchor in parser.anchors:
        href = anchor.attrs.get("href", "").strip()
        anchor_text = _text(anchor.text)
        if not anchor_text or href in {"", "#"}:
            empty_anchors += 1
        if href:
            try:
                target = urlsplit(urljoin(final_url, href))
                if target.hostname and target.hostname.lower() == final_host:
                    internal += 1
                elif target.hostname:
                    external += 1
            except ValueError:
                pass
        rel = {token.lower() for token in anchor.attrs.get("rel", "").split()}
        nofollow += int("nofollow" in rel)
        sponsored += int("sponsored" in rel)
        ugc += int("ugc" in rel)

    images_total = len(parser.images)
    missing_alt = sum("alt" not in image for image in parser.images)
    empty_alt = sum("alt" in image and not image.get("alt", "").strip() for image in parser.images)
    with_alt = images_total - missing_alt
    alt_coverage = round((with_alt / images_total) * 100, 2) if images_total else 0.0
    headings = HeadingSummary(
        h1=parser.headings["h1"][:20],
        h2=parser.headings["h2"][:50],
        h3=parser.headings["h3"][:100],
        empty_heading_count=parser.empty_heading_count,
        hierarchy_jumps=[],
    )
    previous_level = 0
    jumps: list[str] = []
    for level, tag in [(1, "h1"), (2, "h2"), (3, "h3")]:
        if parser.headings[tag]:
            if previous_level and level - previous_level > 1:
                jumps.append(f"h{previous_level} to h{level}")
            previous_level = level
    headings.hierarchy_jumps.extend(jumps[:20])

    metadata = PageMetadata(
        title=title,
        title_length=len(title),
        title_count=parser.title_count,
        description=description,
        description_length=len(description),
        canonical=canonical,
        canonical_resolved=canonical_resolved,
        canonical_relationship=canonical_relationship,  # type: ignore[arg-type]
        robots_directives=robots,
        language=parser.html_lang,
        viewport=parser.viewport,
        charset=parser.charset,
        mixed_content_reference_count=len(MIXED_CONTENT_RE.findall(html)) if final_parts.scheme == "https" else 0,
    )
    images = ImageStatistics(
        total=images_total,
        with_alt=with_alt,
        missing_alt=missing_alt,
        empty_alt=empty_alt,
        alt_coverage_percent=alt_coverage,
    )
    links = LinkStatistics(
        total=total_links,
        internal=internal,
        external=external,
        empty_anchors=empty_anchors,
        nofollow=nofollow,
        sponsored=sponsored,
        ugc=ugc,
    )
    structured = _json_ld_info(parser.json_ld)
    hreflang = _hreflang_info(parser, final_url)
    social = SocialMetadata(
        og_title=_meta_value(parser.meta, "og:title"),
        og_description=_meta_value(parser.meta, "og:description"),
        og_image=_meta_value(parser.meta, "og:image"),
        og_url=_meta_value(parser.meta, "og:url"),
        twitter_card=_meta_value(parser.meta, "twitter:card"),
        twitter_title=_meta_value(parser.meta, "twitter:title"),
        twitter_description=_meta_value(parser.meta, "twitter:description"),
        twitter_image=_meta_value(parser.meta, "twitter:image"),
    )

    checks: list[SEOCheck] = []
    status_code = fetch.status_code
    checks.append(
        _check(
            "retrieval_success",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "HTML retrieval succeeded",
            CheckStatus.PASS if html and status_code < 400 else CheckStatus.FAIL,
            5 if html and status_code < 400 else 0,
            5,
            f"Received {fetch.bytes_read} decoded bytes with status {status_code}.",
            "Ensure the page returns bounded HTML successfully.",
        )
    )
    checks.append(
        _check(
            "http_status",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "HTTP status is successful",
            CheckStatus.PASS
            if 200 <= status_code < 300
            else CheckStatus.WARNING
            if 300 <= status_code < 400
            else CheckStatus.FAIL,
            5 if 200 <= status_code < 300 else 3 if status_code < 400 else 0,
            5,
            f"Observed HTTP status {status_code}.",
            "Return a successful HTTP response for the canonical page.",
        )
    )
    checks.append(
        _check(
            "https",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "HTTPS is used",
            CheckStatus.PASS if final_parts.scheme == "https" else CheckStatus.WARNING,
            5 if final_parts.scheme == "https" else 3,
            5,
            f"Final URL scheme is {final_parts.scheme or 'missing'}.",
            "Prefer HTTPS for transport privacy and browser security.",
        )
    )
    checks.append(
        _check(
            "content_type",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "HTML content type is supported",
            CheckStatus.PASS if fetch.content_type in {"text/html", "application/xhtml+xml"} else CheckStatus.FAIL,
            4 if fetch.content_type in {"text/html", "application/xhtml+xml"} else 0,
            4,
            f"Content type is {fetch.content_type or 'missing'}.",
            "Serve the document with text/html or application/xhtml+xml.",
        )
    )
    checks.append(
        _check(
            "redirects",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "Redirect chain is short",
            CheckStatus.PASS if fetch.redirect_count == 0 else CheckStatus.WARNING,
            3 if fetch.redirect_count == 0 else 2,
            3,
            f"Observed {fetch.redirect_count} redirect(s); final URL is {final_url}.",
            "Keep the redirect path short and point directly to the final URL.",
        )
    )
    checks.append(
        _check(
            "fetch_duration",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "Bounded fetch duration observed",
            CheckStatus.PASS if fetch.elapsed_time <= 1 else CheckStatus.WARNING,
            3 if fetch.elapsed_time <= 1 else 2,
            3,
            f"The bounded fetch took {fetch.elapsed_time:.3f} seconds.",
            "This is an observed fetch duration, not a page-speed or Core Web Vitals measurement.",
        )
    )
    robot_status = (
        CheckStatus.FAIL
        if "noindex" in robots
        else CheckStatus.WARNING
        if any(item in robots for item in {"nofollow", "noarchive"})
        else CheckStatus.PASS
    )
    robot_points = 0 if robot_status == CheckStatus.FAIL else 3 if robot_status == CheckStatus.WARNING else 5
    checks.append(
        _check(
            "robots_directives",
            SEOCategory.TECHNICAL_INDEXABILITY,
            "Robots directives are reported",
            robot_status,
            robot_points,
            5,
            f"Detected directives: {', '.join(robots) if robots else 'none'}.",
            "Review robots directives against the intended indexing and crawling behavior.",
        )
    )

    title_status = (
        CheckStatus.FAIL
        if not title
        else CheckStatus.WARNING
        if len(title) < TITLE_SHORT or len(title) > TITLE_LONG
        else CheckStatus.PASS
    )
    title_points = 0 if not title else 5 if len(title) < 10 else 6 if title_status == CheckStatus.WARNING else 8
    checks.append(
        _check(
            "title",
            SEOCategory.METADATA,
            "Title is present and reasonably bounded",
            title_status,
            title_points,
            8,
            f"Title length is {len(title)} characters.",
            "Add one clear title; very short or long titles may be less useful in search presentation.",
            len(title),
        )
    )
    desc_status = (
        CheckStatus.FAIL
        if not description
        else CheckStatus.WARNING
        if len(description) < DESCRIPTION_SHORT or len(description) > DESCRIPTION_LONG
        else CheckStatus.PASS
    )
    desc_points = (
        0 if not description else 5 if len(description) < 20 else 6 if desc_status == CheckStatus.WARNING else 8
    )
    checks.append(
        _check(
            "meta_description",
            SEOCategory.METADATA,
            "Meta description is present and reasonably bounded",
            desc_status,
            desc_points,
            8,
            f"Description length is {len(description)} characters.",
            "Add a concise, useful description; length thresholds are heuristics, not SERP guarantees.",
            len(description),
        )
    )
    canonical_status = (
        CheckStatus.FAIL
        if canonical_relationship == "malformed"
        else CheckStatus.WARNING
        if canonical_relationship in {"missing", "valid_other_host", "relative"}
        else CheckStatus.PASS
    )
    canonical_points = (
        0 if canonical_status == CheckStatus.FAIL else 2 if canonical_status == CheckStatus.WARNING else 4
    )
    checks.append(
        _check(
            "canonical",
            SEOCategory.METADATA,
            "Canonical URL is structurally understandable",
            canonical_status,
            canonical_points,
            4,
            f"Canonical relationship: {canonical_relationship}.",
            "Use one parseable canonical URL and verify its intended host relationship.",
        )
    )

    h1_count = len(parser.headings["h1"])
    h1_status = (
        CheckStatus.FAIL
        if h1_count == 0 or headings.empty_heading_count
        else CheckStatus.WARNING
        if h1_count > 1
        else CheckStatus.PASS
    )
    h1_points = 0 if h1_status == CheckStatus.FAIL else 4 if h1_status == CheckStatus.WARNING else 6
    checks.append(
        _check(
            "h1_structure",
            SEOCategory.HEADINGS_CONTENT,
            "Primary heading structure is detectable",
            h1_status,
            h1_points,
            6,
            f"Found {h1_count} H1 element(s); empty headings: {headings.empty_heading_count}.",
            "Use a clear primary heading and avoid empty heading elements.",
        )
    )
    hierarchy_status = CheckStatus.WARNING if jumps else CheckStatus.PASS
    checks.append(
        _check(
            "heading_hierarchy",
            SEOCategory.HEADINGS_CONTENT,
            "Heading hierarchy has no obvious jumps",
            hierarchy_status,
            2 if jumps else 4,
            4,
            f"Hierarchy jumps: {', '.join(jumps) if jumps else 'none'}.",
            "Organize headings in a logical sequence without skipping levels.",
        )
    )
    word_count = len(re.findall(r"\b[\w'-]+\b", visible_text, flags=re.UNICODE))
    text_status = (
        CheckStatus.FAIL
        if word_count == 0
        else CheckStatus.WARNING
        if word_count < VISIBLE_WORD_PASS
        else CheckStatus.PASS
    )
    text_points = (
        0
        if word_count == 0
        else 3
        if word_count < VISIBLE_WORD_WARNING
        else 4
        if text_status == CheckStatus.WARNING
        else 5
    )
    checks.append(
        _check(
            "visible_text",
            SEOCategory.HEADINGS_CONTENT,
            "Visible text is present",
            text_status,
            text_points,
            5,
            f"Approximate visible word count: {word_count}.",
            "Review whether the page communicates its purpose clearly; word count alone does not establish content quality.",
            word_count,
        )
    )

    internal_status = CheckStatus.PASS if internal else CheckStatus.WARNING if total_links else CheckStatus.WARNING
    checks.append(
        _check(
            "internal_links",
            SEOCategory.LINKS,
            "Internal links are detectable",
            internal_status,
            6 if internal else 2,
            6,
            f"Found {internal} internal and {external} external link(s).",
            "Add useful internal links where they help users navigate related content.",
        )
    )
    anchor_status = CheckStatus.PASS if empty_anchors == 0 else CheckStatus.WARNING
    checks.append(
        _check(
            "anchor_text",
            SEOCategory.LINKS,
            "Anchors have useful text",
            anchor_status,
            2 if empty_anchors == 0 else 1,
            2,
            f"Empty or placeholder anchors: {empty_anchors}.",
            "Give links descriptive text and avoid empty or placeholder-only anchors.",
        )
    )
    checks.append(
        _check(
            "link_relationships",
            SEOCategory.LINKS,
            "Link relationship attributes are reported",
            CheckStatus.NOT_APPLICABLE,
            0,
            0,
            f"nofollow={nofollow}, sponsored={sponsored}, ugc={ugc}.",
            "Review relationship attributes according to the purpose and sponsorship of each link.",
        )
    )

    if images_total:
        image_status = (
            CheckStatus.PASS
            if missing_alt == 0 and empty_alt == 0
            else CheckStatus.WARNING
            if alt_coverage >= 80
            else CheckStatus.FAIL
        )
        image_points = 10 if image_status == CheckStatus.PASS else 7 if image_status == CheckStatus.WARNING else 0
        checks.append(
            _check(
                "image_alt",
                SEOCategory.IMAGES,
                "Images have usable alt coverage",
                image_status,
                image_points,
                10,
                f"{with_alt}/{images_total} images have non-empty alt text ({alt_coverage:.2f}%).",
                "Add concise alt text to informative images; use empty alt only for genuinely decorative images.",
            )
        )
    else:
        checks.append(
            _check(
                "image_alt",
                SEOCategory.IMAGES,
                "Image alt coverage",
                CheckStatus.NOT_APPLICABLE,
                0,
                0,
                "No image elements were found in the fetched HTML.",
                "Recheck this signal if images are added.",
            )
        )

    structured_status = (
        CheckStatus.FAIL
        if structured.malformed_blocks
        else CheckStatus.PASS
        if structured.valid_blocks
        else CheckStatus.WARNING
    )
    structured_points = (
        0 if structured_status == CheckStatus.FAIL else 5 if structured_status == CheckStatus.PASS else 3
    )
    checks.append(
        _check(
            "json_ld",
            SEOCategory.STRUCTURED_DATA,
            "JSON-LD blocks are parseable",
            structured_status,
            structured_points,
            5,
            f"Blocks: {structured.block_count}; valid: {structured.valid_blocks}; malformed: {structured.malformed_blocks}; types: {', '.join(structured.types) or 'none'}.",
            "Fix malformed JSON-LD and validate intended schemas separately; this check does not certify rich-result eligibility.",
        )
    )

    og_count = sum(
        value is not None for value in [social.og_title, social.og_description, social.og_image, social.og_url]
    )
    twitter_count = sum(
        value is not None
        for value in [social.twitter_card, social.twitter_title, social.twitter_description, social.twitter_image]
    )
    checks.append(
        _check(
            "open_graph",
            SEOCategory.SOCIAL_METADATA,
            "Open Graph metadata is reported",
            CheckStatus.PASS if og_count == 4 else CheckStatus.WARNING,
            3 if og_count == 4 else 1.5 if og_count else 1,
            3,
            f"Open Graph fields present: {og_count}/4.",
            "Add consistent Open Graph metadata for social sharing; it is not a core search-ranking score.",
        )
    )
    checks.append(
        _check(
            "twitter_metadata",
            SEOCategory.SOCIAL_METADATA,
            "Twitter metadata is reported",
            CheckStatus.PASS if twitter_count >= 2 else CheckStatus.WARNING,
            2 if twitter_count >= 2 else 1,
            2,
            f"Twitter fields present: {twitter_count}/4.",
            "Add suitable Twitter card metadata for social previews; it is not a ranking guarantee.",
        )
    )

    lang_status = CheckStatus.PASS if parser.html_lang else CheckStatus.WARNING
    viewport_status = CheckStatus.PASS if parser.viewport else CheckStatus.WARNING
    charset_status = CheckStatus.PASS if parser.charset else CheckStatus.WARNING
    checks.extend(
        [
            _check(
                "html_lang",
                SEOCategory.HTML_SIGNALS,
                "HTML language is declared",
                lang_status,
                2 if parser.html_lang else 1,
                2,
                f"HTML lang: {parser.html_lang or 'missing'}.",
                "Declare the primary document language when known.",
            ),
            _check(
                "viewport",
                SEOCategory.HTML_SIGNALS,
                "Viewport metadata is declared",
                viewport_status,
                2 if parser.viewport else 1,
                2,
                f"Viewport: {parser.viewport or 'missing'}.",
                "Add a valid viewport declaration for responsive browser rendering.",
            ),
            _check(
                "charset",
                SEOCategory.HTML_SIGNALS,
                "Character encoding is declared",
                charset_status,
                1 if parser.charset else 0,
                1,
                f"Charset: {parser.charset or 'missing'}.",
                "Declare the document character encoding explicitly.",
            ),
        ]
    )

    return SEOAnalysis(
        requested_url=fetch.requested_url,
        final_url=final_url,
        fetch=fetch,
        deterministic_score=_score(checks),
        checks=checks,
        metadata=metadata,
        headings=headings,
        images=images,
        links=links,
        structured_data=structured,
        hreflang=hreflang,
        social_metadata=social,
        lexical_signals=LexicalSignals(visible_word_count=word_count, frequent_terms=frequent_terms),
    )
