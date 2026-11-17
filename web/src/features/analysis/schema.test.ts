import { describe, expect, it } from "vitest";
import fixtureData from "../../../public/fixtures/audit.json";
import { fixtureSchema, liveSeoAnalysisSchema } from "./schema";
import { filteredChecks } from "./findingSelection";
import { routeFromSearch } from "../../app/route";
import { findingsViewModel } from "./findingsViewModel";
import type { AnalysisReport } from "./report";
import type { FindingsSummary, SeoAnalysis } from "./schema";

function version11LiveAnalysis(): SeoAnalysis {
  const analysis = structuredClone(fixtureData.analysis) as unknown as SeoAnalysis;
  const candidates = [
    ["meta_description", "fail", "high", "quick", "Add a page description", "No meta description was found."],
    ["title", "warning", "medium", "quick", "Make the page title more descriptive", "The title is short."],
    ["visible_text", "warning", "medium", "moderate", "Check the page's main question", "The fetched HTML has about 232 words."],
    ["json_ld", "warning", null, null, null, null],
  ] as const;
  const exclusions: FindingsSummary["exclusions"] = [];
  analysis.checks = candidates.map(([id, status, impact, effort, findingTitle, findingReason]) => {
    const original = analysis.checks.find((check) => check.id === id)!;
    const actionable = findingTitle !== null;
    if (!actionable) {
      exclusions.push({ check_id: id, status, reason: "No optional JSON-LD was found; its absence alone is not a confirmed defect." });
    }
    return {
      ...original,
      status,
      impact,
      effort,
      finding_title: findingTitle,
      finding_reason: findingReason,
      fix_snippet: null,
      snippet_requires_review: false,
      is_actionable: actionable,
      optional_note: actionable ? null : "No JSON-LD was found. It is optional for this page.",
      exclusion_reason: actionable ? null : "Missing optional JSON-LD is not a confirmed defect.",
      anatomy_part: actionable ? (id === "meta_description" ? "description" : id === "title" ? "title" : "content") : null,
    };
  });
  analysis.deterministic_score.version = "1.1";
  analysis.findings_summary = {
    total_checks: 4,
    raw_passes: 0,
    raw_warnings: 3,
    raw_failures: 1,
    raw_not_applicable: 0,
    actionable_count: 3,
    optional_note_count: 1,
    by_impact: { blocking: 0, high: 1, medium: 2, low: 0 },
    by_effort: { quick: 2, moderate: 1, larger_job: 0 },
    prioritized_check_ids: ["meta_description", "title", "visible_text"],
    verdict: "3 fixes. The missing page description matters most.",
    exclusions,
  };
  return analysis;
}

describe("Northstar fixture contract", () => {
  it("validates the full 23-check example and expected status totals", () => {
    const result = fixtureSchema.parse(fixtureData);
    expect(result.analysis.checks).toHaveLength(23);
    expect(result.analysis.deterministic_score.overall_score).toBe(92);
    expect(result.analysis.checks.reduce<Record<string, number>>((counts, check) => {
      counts[check.status] = (counts[check.status] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ pass: 18, fail: 1, warning: 3, not_applicable: 1 });
  });

  it("orders review findings as fail then warning and keeps source order within status", () => {
    const result = fixtureSchema.parse(fixtureData);
    const checks = filteredChecks(result.analysis.checks, routeFromSearch("?view=findings&mode=review"));
    expect(checks.map((check) => check.id)).toEqual([
      "robots_directives",
      "visible_text",
      "open_graph",
      "twitter_metadata",
    ]);
  });

  it("keeps all checks in source order and exposes N/A results", () => {
    const result = fixtureSchema.parse(fixtureData);
    const checks = filteredChecks(result.analysis.checks, routeFromSearch("?view=findings&mode=all"));
    expect(checks).toHaveLength(23);
    expect(checks[15]?.id).toBe("link_relationships");
    expect(checks[15]?.status).toBe("not_applicable");
  });

  it("intersects status and search filters and returns a clear empty result", () => {
    const result = fixtureSchema.parse(fixtureData);
    const matching = filteredChecks(result.analysis.checks, routeFromSearch("?view=findings&mode=all&status=warning&q=twitter"));
    expect(matching.map((check) => check.id)).toEqual(["twitter_metadata"]);
    const none = filteredChecks(result.analysis.checks, routeFromSearch("?view=findings&mode=review&status=fail&q=does-not-exist"));
    expect(none).toEqual([]);
  });

  it("rejects malformed data, unsupported categories, and changed totals", () => {
    expect(fixtureSchema.safeParse({ analysis: { checks: [] } }).success).toBe(false);
    const malformed = structuredClone(fixtureData);
    malformed.analysis.checks[0]!.category = "invented_category";
    expect(fixtureSchema.safeParse(malformed).success).toBe(false);
    const wrongCounts = structuredClone(fixtureData);
    wrongCounts.analysis.checks[0]!.status = "not_applicable";
    expect(fixtureSchema.safeParse(wrongCounts).success).toBe(false);
  });

  it("accepts real-format live results without fixture metadata or fixed finding totals", () => {
    const live = structuredClone(fixtureData.analysis);
    live.requested_url = "https://example.test/a-different-page/";
    live.final_url = live.requested_url;
    delete (live as Partial<typeof live>).metadata;
    live.checks = [live.checks[0]!];
    expect(liveSeoAnalysisSchema.parse(live).checks).toHaveLength(1);

    const empty = structuredClone(live);
    empty.checks = [];
    empty.deterministic_score.categories = [];
    expect(liveSeoAnalysisSchema.parse(empty).checks).toHaveLength(0);
  });

  it("rejects malformed live values and duplicate rule identifiers", () => {
    const live = structuredClone(fixtureData.analysis);
    live.checks = [live.checks[0]!, { ...live.checks[0]!, status: "warning" }];
    expect(liveSeoAnalysisSchema.safeParse(live).success).toBe(false);

    const malformed = structuredClone(fixtureData.analysis);
    malformed.fetch.bytes_read = -1;
    expect(liveSeoAnalysisSchema.safeParse(malformed).success).toBe(false);
  });

  it("requires a reconciled v1.1 summary and uses it for the shared open count", () => {
    const analysis = version11LiveAnalysis();
    const parsed = liveSeoAnalysisSchema.parse(analysis);
    const report = { source: "live", analysis: parsed } as AnalysisReport;
    const view = findingsViewModel(report);

    expect(view.openCount).toBe(3);
    expect(view.statusLine).toBe("3 to fix · 0 passed · 0 not applicable");
    expect(view.prioritized.map((check) => check.id)).toEqual(["meta_description", "title", "visible_text"]);
    expect(view.optionalNotes.map((check) => check.id)).toEqual(["json_ld"]);
    expect(view.categories.reduce((total, category) => total + category.actionableCount, 0)).toBe(view.openCount);
    expect(liveSeoAnalysisSchema.safeParse({ ...analysis, findings_summary: undefined }).success).toBe(false);
    expect(liveSeoAnalysisSchema.safeParse({
      ...analysis,
      findings_summary: { ...analysis.findings_summary, actionable_count: 4 },
    }).success).toBe(false);
  });
});
