import { describe, expect, it } from "vitest";
import fixtureData from "../../../public/fixtures/audit.json";
import { fixtureSchema } from "./schema";
import { filteredChecks } from "./findingSelection";
import { routeFromSearch } from "../../app/route";

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
});
