import { describe, expect, it } from "vitest";
import auditFixture from "../../../public/fixtures/audit.json";
import { fixtureSchema, liveSeoAnalysisSchema } from "../analysis/schema";
import { findingsViewModel } from "../analysis/findingsViewModel";
import { buildOnPageModel } from "./onPageModel";

const fixture = fixtureSchema.parse(structuredClone(auditFixture));

function modelFor(overrides: Record<string, unknown> = {}) {
  const analysis = liveSeoAnalysisSchema.parse({
    ...structuredClone(fixture.analysis),
    ...overrides,
  });
  return buildOnPageModel({ source: "guest", analysis });
}

describe("buildOnPageModel", () => {
  it("keeps observed, assessed-empty, and unassessed metadata distinct", () => {
    const missingSection = modelFor({ metadata: undefined });
    expect(missingSection.title).toMatchObject({
      state: "not_assessed",
      message: "Page metadata not assessed in this report.",
    });

    const assessedEmpty = modelFor({ metadata: { title: "", description: "" } });
    expect(assessedEmpty.title).toMatchObject({ state: "not_found", message: "No page title found in the fetched HTML." });
    expect(assessedEmpty.description).toMatchObject({ state: "not_found", message: "No meta description found in the fetched HTML." });

    const observed = modelFor({ metadata: { title: "A returned title", description: "A returned description" } });
    expect(observed.title).toMatchObject({ state: "observed", value: "A returned title" });
    expect(observed.description).toMatchObject({ state: "observed", value: "A returned description" });
  });

  it("retains title lengths and multiple-title observations returned by the API", () => {
    const model = modelFor({ metadata: { title: "Observed title", title_length: 14, title_count: 2 } });
    expect(model.title).toMatchObject({ value: "Observed title", length: 14, count: 2 });
  });

  it("distinguishes missing headings data from an assessed page with no H1", () => {
    expect(modelFor({ headings: undefined }).headings).toMatchObject({
      state: "not_assessed",
      h1State: "not_assessed",
      h1Message: "Headings not assessed.",
    });
    expect(modelFor({ headings: { h1: [], h2: [], h3: [], empty_heading_count: 0, hierarchy_jumps: [] } }).headings).toMatchObject({
      state: "assessed",
      h1State: "not_found",
      h1Message: "No H1 found in the fetched HTML.",
    });
  });

  it("keeps every heading grouped by its returned level and retains heading observations", () => {
    const model = modelFor({ headings: {
      h1: ["Primary one", "Primary two"],
      h2: ["Section two"],
      h3: ["Section three"],
      empty_heading_count: 1,
      hierarchy_jumps: ["H1 to H3"],
    } });
    expect(model.headings.h1).toEqual(["Primary one", "Primary two"]);
    expect(model.headings.h2).toEqual(["Section two"]);
    expect(model.headings.h3).toEqual(["Section three"]);
    expect(model.headings.emptyHeadingCount).toBe(1);
    expect(model.headings.hierarchyJumps).toEqual(["H1 to H3"]);
    expect(model.headings.orderNote).toContain("grouped by heading level");
  });

  it("distinguishes zero, observed, and unassessed visible-content signals", () => {
    expect(modelFor({ lexical_signals: undefined }).content).toMatchObject({ state: "not_assessed" });
    expect(modelFor({ lexical_signals: { visible_word_count: 0, frequent_terms: [] } }).content).toMatchObject({ state: "not_found", wordCount: 0 });
    expect(modelFor({ lexical_signals: { visible_word_count: 16, frequent_terms: [{ term: "solar", count: 3 }] } }).content).toMatchObject({
      state: "observed", wordCount: 16, frequentTerms: [{ term: "solar", count: 3 }],
    });
    expect(modelFor({ lexical_signals: { visible_word_count: 348, frequent_terms: [{ term: "solar", count: 27 }] } }).content).toMatchObject({
      state: "observed", wordCount: 348, frequentTerms: [{ term: "solar", count: 27 }],
    });
  });

  it("relates only canonical findings and keeps optional notes out of actionable fixes", () => {
    const report = {
      source: "guest" as const,
      analysis: liveSeoAnalysisSchema.parse({
        ...structuredClone(fixture.analysis),
        checks: fixture.analysis.checks.map((check) => check.id === "visible_text"
      ? { ...check, status: "warning", is_actionable: false, optional_note: "Optional social metadata." }
          : check),
      }),
    };
    const model = buildOnPageModel(report);
    expect(model.related.title.some((item) => item.check.id === "title")).toBe(true);
    const optional = model.related.content.find((item) => item.check.id === "visible_text");
    expect(optional).toMatchObject({ state: "optional", actionable: false });
    expect(model.openCount).toBe(findingsViewModel(report).openCount);
  });
});
