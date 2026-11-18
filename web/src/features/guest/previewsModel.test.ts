import { describe, expect, it } from "vitest";
import auditFixture from "../../../public/fixtures/audit.json";
import { fixtureSchema, liveSeoAnalysisSchema } from "../analysis/schema";
import { buildPreviewsModel } from "./previewsModel";

const fixture = fixtureSchema.parse(structuredClone(auditFixture));

function modelFor(overrides: Record<string, unknown> = {}) {
  const analysis = liveSeoAnalysisSchema.parse({
    ...structuredClone(fixture.analysis),
    ...overrides,
  });
  return buildPreviewsModel({ source: "guest", analysis });
}

describe("buildPreviewsModel", () => {
  it("uses only the returned HTML title and description for search illustration", () => {
    const model = modelFor({ final_url: "https://site.example/page?q=1", metadata: { title: "Returned title", description: "Returned description" } });
    expect(model.search).toMatchObject({
      host: "site.example",
      finalUrl: "https://site.example/page?q=1",
      title: { state: "observed", value: "Returned title" },
      description: { state: "observed", value: "Returned description" },
    });
  });

  it("distinguishes missing sections, missing values, and observed empty values", () => {
    expect(modelFor({ metadata: undefined }).search.title).toMatchObject({ state: "not_assessed" });
    expect(modelFor({ metadata: { title: undefined, description: undefined } }).search).toMatchObject({
      title: { state: "not_assessed", message: "page title not assessed in this report." },
      description: { state: "not_assessed", message: "meta description not assessed in this report." },
    });
    expect(modelFor({ metadata: { title: "", description: "" } }).search).toMatchObject({
      title: { state: "empty", value: "" },
      description: { state: "empty", value: "" },
    });
  });

  it("uses OG and X fields separately and labels social-section absence as not assessed", () => {
    const social = {
      og_title: "OG heading", og_description: "OG description", og_url: "https://site.example/og",
      og_image: "javascript:alert(1)", twitter_card: "summary", twitter_title: "X heading",
      twitter_description: "X description", twitter_image: null,
    };
    const model = modelFor({ social_metadata: social });
    expect(model.openGraph).toMatchObject({
      title: { state: "observed", value: "OG heading" },
      description: { state: "observed", value: "OG description" },
      url: { state: "observed", value: "https://site.example/og" },
      image: { state: "observed", value: "javascript:alert(1)" },
    });
    expect(model.x).toMatchObject({
      card: { state: "observed", value: "summary" },
      title: { state: "observed", value: "X heading" },
      description: { state: "observed", value: "X description" },
      image: { state: "not_found" },
    });
    expect(modelFor({ social_metadata: undefined }).openGraph.title).toMatchObject({ state: "not_assessed" });
  });

  it("does not invent HTML fallbacks and never requests remote images", () => {
    const model = modelFor({ social_metadata: {
      og_title: null, og_description: null, og_url: null, og_image: null,
      twitter_card: null, twitter_title: null, twitter_description: null, twitter_image: null,
    } });
    expect(model.openGraph.title).toMatchObject({ state: "not_found", message: "No Open Graph title returned." });
    expect(model.openGraph.title).not.toHaveProperty("fallback");
    expect(model.openGraph.image).toMatchObject({ state: "not_found", message: expect.stringContaining("No Open Graph image address returned") });
  });

  it("keeps social previews distinct and maps related fixes to canonical check IDs", () => {
    const model = modelFor({ social_metadata: {
      og_title: "Observed OG", og_description: "Observed OG text", og_url: null, og_image: null,
      twitter_card: "summary_large_image", twitter_title: "Observed X", twitter_description: "Observed X text", twitter_image: null,
    } });
    expect(model.linkedin.title).toEqual(model.openGraph.title);
    expect(model.x.title).toMatchObject({ state: "observed", value: "Observed X" });
    expect(model.related.map((item) => item.check.id)).toEqual(expect.arrayContaining(["title", "meta_description", "open_graph", "twitter_metadata"]));
    expect(model.disclosures.search).toContain("Search engines may display something different.");
    expect(model.disclosures.linkedin).toContain("LinkedIn rendering is not verified.");
  });
});
