"""Resolve the ruleset into one deterministic, API-visible findings summary."""

from __future__ import annotations

from collections import Counter
from html import escape
from typing import Any

from .models import (
    CheckStatus,
    FindingExclusion,
    FindingsEffortCounts,
    FindingsImpactCounts,
    FindingsSummary,
    SEOAnalysis,
    SEOCheck,
)
from .rules import CHECK_POLICIES, Effort, Impact, RuleCase


_IMPACT_ORDER = {Impact.BLOCKING: 0, Impact.HIGH: 1, Impact.MEDIUM: 2, Impact.LOW: 3}
_EFFORT_ORDER = {Effort.QUICK: 0, Effort.MODERATE: 1, Effort.LARGER_JOB: 2}


def _facts(analysis: SEOAnalysis, check: SEOCheck) -> dict[str, Any]:
    social = analysis.social_metadata
    empty_alt_count = analysis.images.empty_alt
    missing_alt_count = analysis.images.missing_alt
    title_length = analysis.metadata.title_length
    description_length = analysis.metadata.description_length
    empty_anchor_count = analysis.links.empty_anchors
    return {
        "status": check.status.value,
        "status_code": analysis.fetch.status_code,
        "robots_noindex": "noindex" in analysis.metadata.robots_directives,
        "title_missing": not bool(analysis.metadata.title.strip()),
        "title_length": title_length,
        "title_length_count": f"{title_length} {'character' if title_length == 1 else 'characters'}",
        "description_missing": not bool(analysis.metadata.description.strip()),
        "description_length": description_length,
        "description_length_count": f"{description_length} {'character' if description_length == 1 else 'characters'}",
        "canonical_relationship": analysis.metadata.canonical_relationship,
        "h1_count": len(analysis.headings.h1),
        "empty_heading_count": analysis.headings.empty_heading_count,
        "hierarchy_jumps": ", ".join(analysis.headings.hierarchy_jumps) or "none",
        "visible_word_count": analysis.lexical_signals.visible_word_count,
        "empty_anchor_count": empty_anchor_count,
        "empty_anchor_summary": (
            "One link has empty or placeholder text."
            if empty_anchor_count == 1
            else f"{empty_anchor_count} links have empty or placeholder text."
        ),
        "missing_alt_count": missing_alt_count,
        "empty_alt_count": empty_alt_count,
        "missing_alt_summary": (
            "One image has no alt attribute."
            if missing_alt_count == 1
            else f"{missing_alt_count} images have no alt attributes."
        ),
        "empty_alt_summary": (
            "One image has an empty alt attribute; the HTML alone cannot show whether it is decorative."
            if empty_alt_count == 1
            else f"{empty_alt_count} images have empty alt attributes; the HTML alone cannot show whether they are decorative."
        ),
        "malformed_json_ld_count": analysis.structured_data.malformed_blocks,
        "malformed_json_ld_summary": (
            "1 JSON-LD block could not be parsed"
            if analysis.structured_data.malformed_blocks == 1
            else f"{analysis.structured_data.malformed_blocks} JSON-LD blocks could not be parsed"
        ),
        "json_ld_block_count": analysis.structured_data.block_count,
        "open_graph_count": sum(
            value is not None for value in (social.og_title, social.og_description, social.og_image, social.og_url)
        ),
        "twitter_metadata_count": sum(
            value is not None
            for value in (
                social.twitter_card,
                social.twitter_title,
                social.twitter_description,
                social.twitter_image,
            )
        ),
        # A final URL is inserted only into an explicitly review-required code template.
        "final_url": escape(analysis.final_url, quote=True),
    }


def _matches(case: RuleCase, facts: dict[str, Any]) -> bool:
    if case.when is None:
        return True
    for predicate in case.when:
        actual = facts.get(predicate.field)
        expected = predicate.value
        if predicate.operator == "eq":
            matched = actual == expected
        elif predicate.operator == "gt":
            matched = isinstance(actual, (int, float)) and actual > expected  # type: ignore[operator]
        elif predicate.operator == "lt":
            matched = isinstance(actual, (int, float)) and actual < expected  # type: ignore[operator]
        elif predicate.operator == "in":
            matched = actual in expected  # type: ignore[operator]
        else:
            raise RuntimeError("Unsupported SEO finding condition.")
        if not matched:
            return False
    return True


def _selected_case(check: SEOCheck, analysis: SEOAnalysis, facts: dict[str, Any]) -> RuleCase:
    policy = CHECK_POLICIES.get(check.id)
    if policy is None:
        raise RuntimeError("An SEO check has no finding policy.")
    for case in policy.cases:
        if _matches(case, facts):
            return case
    raise RuntimeError("An SEO finding policy has no default case.")


def _render(value: str | None, facts: dict[str, Any]) -> str | None:
    if value is None:
        return None
    return value.format(**facts)


def _counts(checks: list[SEOCheck]) -> Counter[CheckStatus]:
    return Counter(check.status for check in checks)


def _verdict(prioritized: list[tuple[SEOCheck, RuleCase]]) -> str:
    if not prioritized:
        return "Nothing to fix in these checks."

    blocking = next((item for item in prioritized if item[1].impact == Impact.BLOCKING), None)
    if blocking:
        statement = blocking[1].blocking_verdict
        if not statement:
            raise RuntimeError("A blocking finding is missing its plain-language verdict.")
        return statement

    count = len(prioritized)
    high = next((item for item in prioritized if item[1].impact == Impact.HIGH), None)
    if high:
        phrase = high[1].verdict_focus
        if not phrase:
            raise RuntimeError("A high-impact finding is missing its verdict phrase.")
        lead = f"{count} fix. " if count == 1 else f"{count} fixes. "
        return f"{lead}{phrase} matters most."

    return "1 small fix." if count == 1 else f"{count} small fixes."


def resolve_findings(analysis: SEOAnalysis) -> SEOAnalysis:
    """Enrich checks and derive shared counts, priority order, and verdict."""

    resolved: list[SEOCheck] = []
    selected: list[tuple[int, SEOCheck, RuleCase]] = []
    exclusions: list[FindingExclusion] = []

    for index, check in enumerate(analysis.checks):
        facts = _facts(analysis, check)
        case = _selected_case(check, analysis, facts)
        actionable = case.actionable and check.status in {CheckStatus.WARNING, CheckStatus.FAIL}
        optional_note = _render(case.optional_note, facts)
        exclusion_reason = _render(case.exclusion_reason, facts)
        if check.status in {CheckStatus.WARNING, CheckStatus.FAIL} and not actionable:
            reason = exclusion_reason or optional_note
            if not reason:
                raise RuntimeError("A warning or failure has no actionable finding or exclusion reason.")
            exclusions.append(FindingExclusion(check_id=check.id, status=check.status, reason=reason))

        enriched = check.model_copy(
            update={
                "impact": case.impact if actionable else None,
                "effort": case.effort if actionable else None,
                "finding_title": _render(case.finding_title, facts) if actionable else None,
                "finding_reason": _render(case.finding_reason, facts) if actionable else None,
                "fix_snippet": _render(case.fix_snippet, facts) if actionable else None,
                "snippet_requires_review": case.snippet_requires_review if actionable else False,
                "is_actionable": actionable,
                "optional_note": optional_note,
                "exclusion_reason": exclusion_reason,
                "anatomy_part": case.anatomy_part if actionable else None,
            }
        )
        resolved.append(enriched)
        if actionable and case.impact is not None and case.effort is not None:
            selected.append((index, enriched, case))

    selected.sort(key=lambda item: (_IMPACT_ORDER[item[2].impact], _EFFORT_ORDER[item[2].effort], item[0]))  # type: ignore[index]
    prioritized = [(check, case) for _, check, case in selected]
    statuses = _counts(resolved)
    impact_counts = Counter(check.impact for check in resolved if check.is_actionable)
    effort_counts = Counter(check.effort for check in resolved if check.is_actionable)

    summary = FindingsSummary(
        total_checks=len(resolved),
        raw_passes=statuses[CheckStatus.PASS],
        raw_warnings=statuses[CheckStatus.WARNING],
        raw_failures=statuses[CheckStatus.FAIL],
        raw_not_applicable=statuses[CheckStatus.NOT_APPLICABLE],
        actionable_count=len(prioritized),
        optional_note_count=sum(item.optional_note is not None for item in resolved),
        by_impact=FindingsImpactCounts(
            blocking=impact_counts[Impact.BLOCKING],
            high=impact_counts[Impact.HIGH],
            medium=impact_counts[Impact.MEDIUM],
            low=impact_counts[Impact.LOW],
        ),
        by_effort=FindingsEffortCounts(
            quick=effort_counts[Effort.QUICK],
            moderate=effort_counts[Effort.MODERATE],
            larger_job=effort_counts[Effort.LARGER_JOB],
        ),
        prioritized_check_ids=[check.id for check, _ in prioritized],
        verdict=_verdict(prioritized),
        exclusions=exclusions,
    )
    return analysis.model_copy(update={"checks": resolved, "findings_summary": summary})
