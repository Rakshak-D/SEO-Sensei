import { describe, expect, it } from "vitest";
import fixtureData from "../../../public/fixtures/audit.json";
import { liveSeoAnalysisSchema, type SeoCheck } from "../analysis/schema";
import { buildXrayModel } from "./xrayModel";

function sourceAnalysis() {
  return liveSeoAnalysisSchema.parse(fixtureData.analysis);
}

function finding(id: string, anatomyPart: SeoCheck["anatomy_part"], impact: SeoCheck["impact"] = "medium") {
  const source = sourceAnalysis().checks.find((check) => check.id === id);
  if (!source) throw new Error(`Missing fixture check ${id}`);
  return {
    ...source,
    anatomy_part: anatomyPart,
    status: "warning" as const,
    impact,
    effort: "quick" as const,
    is_actionable: true,
    finding_title: `Fix ${id}`,
    finding_reason: `Reason for ${id}`,
  } satisfies SeoCheck;
}

describe("buildXrayModel", () => {
  it("uses only returned page observations and separates head metadata from the schematic body", () => {
    const analysis = sourceAnalysis();
    const model = buildXrayModel(analysis, [
      finding("title", "title", "high"),
      finding("meta_description", "description"),
      finding("h1_structure", "heading"),
      finding("visible_text", "content"),
      finding("image_alt", "image"),
      finding("internal_links", "links"),
    ]);

    expect(model.caption).toBe("A simplified view of the HTML we could assess. Not the page's actual layout.");
    expect(model.headMetadata.find((region) => region.id === "head-title")?.value).toBe(analysis.metadata?.title);
    expect(model.headMetadata.find((region) => region.id === "head-description")?.value).toBe(analysis.metadata?.description);
    expect(model.regions.find((region) => region.id === "primary-heading")?.items).toEqual(["Plan a home solar installation"]);
    expect(model.regions.find((region) => region.id === "subheadings")?.items).toEqual(analysis.headings?.h2);
    expect(model.regions.find((region) => region.id === "visible-content")?.value).toBe("232 visible words found.");
    expect(model.regions.find((region) => region.id === "images")?.value).toBe("1 image element found; no missing alt text observed.");
    expect(model.regions.find((region) => region.id === "links")?.value).toBe("2 links found: 2 internal, 0 external.");
    expect(model.regions.find((region) => region.id === "unassessed-header")?.assessment).toBe("not_assessed");
    expect(model.regions.find((region) => region.id === "unassessed-footer")?.assessment).toBe("not_assessed");
    expect(model.regions.map((region) => Object.keys(region))).not.toContain("coordinates");
  });

  it("distinguishes unassessed sections from observed absence and clear checks", () => {
    const missing = sourceAnalysis();
    delete missing.headings;
    delete missing.images;
    const missingModel = buildXrayModel(missing, []);
    expect(missingModel.regions.find((region) => region.id === "primary-heading")?.assessment).toBe("not_assessed");
    expect(missingModel.regions.find((region) => region.id === "images")?.value).toBe("Images not assessed in this report.");

    const observedEmpty = sourceAnalysis();
    observedEmpty.headings = { h1: [], h2: [], h3: [], empty_heading_count: 0, hierarchy_jumps: [] };
    observedEmpty.images = { total: 0, with_alt: 0, missing_alt: 0, empty_alt: 0, alt_coverage_percent: 0 };
    const emptyModel = buildXrayModel(observedEmpty, []);
    expect(emptyModel.regions.find((region) => region.id === "primary-heading")?.assessment).toBe("not_found");
    expect(emptyModel.regions.find((region) => region.id === "images")?.value).toBe("No image elements found in the fetched HTML.");

    const clearAnalysis = sourceAnalysis();
    clearAnalysis.checks = clearAnalysis.checks.map((check) => check.id === "image_alt"
      ? { ...check, anatomy_part: "image", status: "pass", impact: null, is_actionable: false }
      : check);
    const clearModel = buildXrayModel(clearAnalysis, []);
    expect(clearModel.regions.find((region) => region.id === "images")?.assessment).toBe("clear");
  });

  it("maps repeated findings to one region while retaining stable independent priorities", () => {
    const first = finding("title", "title", "high");
    const second = { ...finding("meta_description", "title", "medium"), id: "title_alias" };
    const model = buildXrayModel(sourceAnalysis(), [first, second]);
    const region = model.headMetadata.find((item) => item.id === "head-title");
    expect(region?.findingIds).toEqual([first.id, second.id]);
    expect(region?.pins.map((pin) => [pin.checkId, pin.number])).toEqual([[first.id, 1], [second.id, 2]]);
    expect(region?.severity).toBe("high");
  });

  it("keeps unsupported anatomy priorities explicitly unplaced", () => {
    const unsupported = finding("http_status", "technical", "blocking");
    const model = buildXrayModel(sourceAnalysis(), [unsupported]);
    expect(model.unplacedPriorities.map((item) => [item.check.id, item.number])).toEqual([[unsupported.id, 1]]);
    expect(model.regions.flatMap((region) => region.findingIds)).not.toContain(unsupported.id);
  });

  it("reports an unknown selected check without selecting a different finding", () => {
    const model = buildXrayModel(sourceAnalysis(), [finding("title", "title")], "missing_check");
    expect(model.selection).toEqual({ status: "unavailable", checkId: "missing_check" });
    expect(model.selectedFinding).toBeNull();
  });

  it("maps only evidenced values and does not treat empty alt as a confirmed defect", () => {
    const analysis = sourceAnalysis();
    analysis.images = { total: 2, with_alt: 2, missing_alt: 0, empty_alt: 2, alt_coverage_percent: 100 };
    const imageCheck = { ...finding("image_alt", "image"), status: "warning" as const, optional_note: "Empty alt attributes may be intentional.", is_actionable: false };
    analysis.checks = analysis.checks.map((check) => check.id === "image_alt" ? imageCheck : check);
    const model = buildXrayModel(analysis, []);
    expect(model.regions.find((region) => region.id === "images")?.value).toBe("2 image elements found; 2 have empty alt text; intent was not assessed.");
    expect(model.regions.find((region) => region.id === "images")?.findingIds).toEqual([]);
    expect(imageCheck.is_actionable).toBe(false);
  });

  it("keeps the backend blocking impact and canonical priority number on a head finding", () => {
    const noindex = finding("robots_directives", "technical", "blocking");
    const model = buildXrayModel(sourceAnalysis(), [noindex], noindex.id);
    const region = model.headMetadata.find((item) => item.id === "head-robots");
    expect(region?.assessment).toBe("blocking");
    expect(region?.severity).toBe("blocking");
    expect(region?.pins).toEqual([{ checkId: noindex.id, number: 1, title: "Fix robots_directives", impact: "blocking" }]);
    expect(model.selection).toEqual({ status: "selected", checkId: noindex.id, regionId: "head-robots" });
    expect(model.selectedFinding?.id).toBe(noindex.id);
  });

  it("preserves multiple returned headings and keeps empty metadata distinct from missing metadata", () => {
    const analysis = sourceAnalysis();
    analysis.headings = {
      ...analysis.headings!,
      h1: ["Primary title observed", "Second H1 observed"],
      h2: ["First H2"],
      h3: ["Nested H3"],
    };
    const headingsModel = buildXrayModel(analysis, [finding("h1_structure", "heading", "high"), finding("heading_hierarchy", "heading", "medium")]);
    const h1 = headingsModel.regions.find((region) => region.id === "primary-heading");
    const subheadings = headingsModel.regions.find((region) => region.id === "subheadings");
    expect(h1?.items).toEqual(["Primary title observed", "Second H1 observed"]);
    expect(subheadings?.items).toEqual(["First H2", "Nested H3"]);
    expect(subheadings?.itemLabels).toEqual(["H2", "H3"]);
    expect(subheadings?.findingIds).toEqual(["heading_hierarchy"]);

    const emptyText = sourceAnalysis();
    emptyText.metadata = { ...emptyText.metadata, title: "", description: "" };
    const emptyModel = buildXrayModel(emptyText, []);
    expect(emptyModel.headMetadata.find((region) => region.id === "head-title")?.assessment).toBe("not_found");
    expect(emptyModel.headMetadata.find((region) => region.id === "head-description")?.assessment).toBe("not_found");

    const absentText = sourceAnalysis();
    if (absentText.metadata) delete absentText.metadata.description;
    const absentModel = buildXrayModel(absentText, []);
    expect(absentModel.headMetadata.find((region) => region.id === "head-description")?.assessment).toBe("not_assessed");
  });

  it("reports observed zero images and mixed link counts without inventing elements", () => {
    const analysis = sourceAnalysis();
    analysis.images = { total: 0, with_alt: 0, missing_alt: 0, empty_alt: 0, alt_coverage_percent: 0 };
    analysis.links = { total: 3, internal: 1, external: 2, empty_anchors: 0, nofollow: 1, sponsored: 0, ugc: 0 };
    const model = buildXrayModel(analysis, []);
    expect(model.regions.find((region) => region.id === "images")).toMatchObject({ assessment: "not_found", value: "No image elements found in the fetched HTML.", items: [] });
    expect(model.regions.find((region) => region.id === "links")?.value).toBe("3 links found: 1 internal, 2 external.");
  });

  it("has no pins for a zero-finding report and accounts for every supplied priority", () => {
    const zero = buildXrayModel(sourceAnalysis(), []);
    expect(zero.priorities).toEqual([]);
    expect(zero.regions.flatMap((region) => region.pins)).toEqual([]);
    expect(zero.unplacedPriorities).toEqual([]);

    const priorities = [finding("http_status", "technical", "blocking"), finding("title", "title", "high")];
    const mixed = buildXrayModel(sourceAnalysis(), priorities);
    const represented = [...mixed.headMetadata, ...mixed.regions].flatMap((region) => region.findingIds)
      .concat(mixed.unplacedPriorities.map((item) => item.check.id));
    expect([...represented].sort()).toEqual(priorities.map((check) => check.id).sort());
    expect(mixed.unplacedPriorities[0]?.number).toBe(1);
    expect(mixed.headMetadata.find((region) => region.id === "head-title")?.pins[0]?.number).toBe(2);
  });
});
