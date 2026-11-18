import type { LiveSeoAnalysis, FindingImpact, SeoCheck } from "../analysis/schema";

export type XrayAssessment = "not_assessed" | "not_found" | "observed" | "clear" | "needs_attention" | "blocking";
export type XrayRegionId =
  | "unassessed-header"
  | "primary-heading"
  | "subheadings"
  | "visible-content"
  | "images"
  | "links"
  | "unassessed-footer"
  | "head-title"
  | "head-description"
  | "head-canonical"
  | "head-robots"
  | "head-sharing";

export type XrayPin = {
  checkId: string;
  number: number;
  title: string;
  impact: FindingImpact | null | undefined;
};

export type XrayRegion = {
  id: XrayRegionId;
  label: string;
  value: string;
  summaryPreview?: string;
  items: string[];
  itemLabels: string[];
  assessment: XrayAssessment;
  findingIds: string[];
  severity: FindingImpact | null;
  pins: XrayPin[];
};

export type XrayPriority = {
  check: SeoCheck;
  number: number;
  regionId: XrayRegionId | null;
};

export type XraySelection =
  | { status: "none" }
  | { status: "selected"; checkId: string; regionId: XrayRegionId | null }
  | { status: "unavailable"; checkId: string };

export type XrayModel = {
  caption: string;
  headMetadata: XrayRegion[];
  regions: XrayRegion[];
  priorities: XrayPriority[];
  unplacedPriorities: XrayPriority[];
  selection: XraySelection;
  selectedFinding: SeoCheck | null;
};

type Observation = {
  value: string;
  summaryPreview?: string;
  items?: string[];
  itemLabels?: string[];
  assessment: XrayAssessment;
};

const caption = "A simplified view of the HTML we could assess. Not the page's actual layout.";

// Older bundled local reports predate anatomy_part. These stable IDs may be
// located for presentation only; this mapping never changes status or priority.
const legacyAnatomyByCheckId: Record<string, NonNullable<SeoCheck["anatomy_part"]>> = {
  title: "title",
  meta_description: "description",
  h1_structure: "heading",
  heading_hierarchy: "heading",
  visible_text: "content",
  image_alt: "image",
  internal_links: "links",
  anchor_text: "links",
  robots_directives: "technical",
  canonical: "technical",
  open_graph: "sharing",
  twitter_metadata: "sharing",
  json_ld: "structured_data",
};

function regionForCheck(check: SeoCheck): XrayRegionId | null {
  switch (check.anatomy_part ?? legacyAnatomyByCheckId[check.id]) {
    case "title": return "head-title";
    case "description": return "head-description";
    case "heading":
      if (check.id === "h1_structure") return "primary-heading";
      if (check.id === "heading_hierarchy") return "subheadings";
      return null;
    case "content": return "visible-content";
    case "image": return "images";
    case "links": return "links";
    case "technical":
      if (check.id === "canonical") return "head-canonical";
      if (check.id === "robots_directives") return "head-robots";
      return null;
    case "sharing": return "head-sharing";
    case "page":
    case "structured_data":
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

function observed(value: string | undefined, unavailable: string): Observation {
  if (value === undefined) return { value: unavailable, assessment: "not_assessed" };
  if (!value.trim()) return { value: "No text was found in the fetched HTML.", assessment: "not_found" };
  return { value, assessment: "observed" };
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function imageObservation(analysis: LiveSeoAnalysis): Observation {
  const images = analysis.images;
  if (!images) return { value: "Images not assessed in this report.", assessment: "not_assessed" };
  if (images.total === 0) return { value: "No image elements found in the fetched HTML.", assessment: "not_found" };
  const parts = [countLabel(images.total, "image element")];
  if (images.missing_alt > 0) parts.push(`${images.missing_alt} missing alt text`);
  else if (images.empty_alt > 0) parts.push(`${images.empty_alt} have empty alt text; intent was not assessed`);
  else parts.push("no missing alt text observed");
  return { value: `${parts[0]} found; ${parts.slice(1).join("; ")}.`, assessment: "observed" };
}

function linkObservation(analysis: LiveSeoAnalysis): Observation {
  const links = analysis.links;
  if (!links) return { value: "Links not assessed in this report.", assessment: "not_assessed" };
  if (links.total === 0) return { value: "No link elements found in the fetched HTML.", assessment: "not_found" };
  return {
    value: `${countLabel(links.total, "link")} found: ${links.internal} internal, ${links.external} external.`,
    assessment: "observed",
  };
}

function robotsObservation(analysis: LiveSeoAnalysis): Observation {
  const directives = analysis.metadata?.robots_directives;
  const header = analysis.fetch.x_robots_tag;
  if (directives === undefined && header == null) {
    return { value: "Robots directives not assessed in this report.", assessment: "not_assessed" };
  }
  const observedDirectives = [...(directives ?? [])];
  if (header) observedDirectives.push(`X-Robots-Tag: ${header}`);
  return {
    value: observedDirectives.length ? observedDirectives.join(", ") : "No robots directives were observed in the fetched HTML or response headers.",
    assessment: observedDirectives.length ? "observed" : "not_found",
  };
}

function baseRegion(id: XrayRegionId, label: string, observation: Observation): XrayRegion {
  return {
    id,
    label,
    value: observation.value,
    summaryPreview: observation.summaryPreview,
    items: observation.items ?? [],
    itemLabels: observation.itemLabels ?? [],
    assessment: observation.assessment,
    findingIds: [],
    severity: null,
    pins: [],
  };
}

function headingsObservation(analysis: LiveSeoAnalysis, key: "h1" | "subheadings"): Observation {
  const headings = analysis.headings;
  if (!headings) return {
    value: "Headings not assessed in this report.",
    summaryPreview: key === "h1" ? "H1 not assessed." : undefined,
    assessment: "not_assessed",
    items: [],
  };
  const items = key === "h1" ? headings.h1 : [...headings.h2, ...headings.h3];
  const itemLabels = key === "h1"
    ? headings.h1.map(() => "H1")
    : [...headings.h2.map(() => "H2"), ...headings.h3.map(() => "H3")];
  if (items.length === 0) {
    return {
      value: key === "h1" ? "No H1 heading was found in the fetched HTML." : "No H2 or H3 subheadings were found in the fetched HTML.",
      summaryPreview: key === "h1" ? "No H1 found in the fetched HTML." : undefined,
      assessment: "not_found",
      items,
      itemLabels,
    };
  }
  return {
    value: key === "h1" ? countLabel(items.length, "H1 heading") : `${countLabel(headings.h2.length, "H2 heading")} and ${countLabel(headings.h3.length, "H3 heading")} found.`,
    summaryPreview: key === "h1" ? items[0] : undefined,
    assessment: "observed",
    items,
    itemLabels,
  };
}

function contentObservation(analysis: LiveSeoAnalysis): Observation {
  const count = analysis.lexical_signals?.visible_word_count;
  if (count === undefined) return { value: "Visible text not assessed in this report.", assessment: "not_assessed" };
  if (count === 0) return { value: "No visible page text was found in the fetched HTML.", assessment: "not_found" };
  return { value: `${count} visible ${count === 1 ? "word" : "words"} found.`, assessment: "observed" };
}

function canonicalObservation(analysis: LiveSeoAnalysis): Observation {
  const metadata = analysis.metadata;
  if (!metadata || metadata.canonical_relationship === undefined) {
    return { value: "Canonical URL not assessed in this report.", assessment: "not_assessed" };
  }
  if (metadata.canonical_relationship === "missing" || metadata.canonical == null) {
    return { value: "No canonical link was found in the fetched HTML.", assessment: "not_found" };
  }
  return { value: metadata.canonical_resolved ?? metadata.canonical, assessment: "observed" };
}

function socialObservation(analysis: LiveSeoAnalysis): Observation {
  const social = analysis.social_metadata;
  if (!social) return { value: "Social sharing metadata not assessed in this report.", assessment: "not_assessed" };
  const fields = [social.og_title, social.og_description, social.og_url, social.twitter_card, social.twitter_title, social.twitter_description]
    .filter((value): value is string => Boolean(value));
  const imageUrlsReturned = Boolean(social.og_image || social.twitter_image);
  return fields.length || imageUrlsReturned
    ? {
      value: [
        ...fields,
        ...(social.og_image ? ["An Open Graph image URL was returned; no image request was made."] : []),
        ...(social.twitter_image ? ["An X image URL was returned; no image request was made."] : []),
      ].join(" · "),
      assessment: "observed",
    }
    : { value: "No text-based social sharing values were returned.", assessment: "not_found" };
}

function applyFindings(
  region: XrayRegion,
  checks: SeoCheck[],
  priorities: XrayPriority[],
) {
  const matchingPriorities = priorities.filter((item) => item.regionId === region.id);
  region.findingIds = matchingPriorities.map((item) => item.check.id);
  region.pins = matchingPriorities.map(({ check, number }) => ({
    checkId: check.id,
    number,
    title: check.finding_title ?? check.title,
    impact: check.impact,
  }));
  region.severity = matchingPriorities[0]?.check.impact ?? null;
  if (region.severity === "blocking") region.assessment = "blocking";
  else if (matchingPriorities.length) region.assessment = "needs_attention";
  else if (region.assessment === "observed"
    && checks.some((check) => regionForCheck(check) === region.id && check.status === "pass")) region.assessment = "clear";
}

export function buildXrayModel(
  analysis: LiveSeoAnalysis,
  prioritized: SeoCheck[],
  selectedCheckId = "",
): XrayModel {
  const priorities: XrayPriority[] = prioritized.map((check, index) => ({
    check,
    number: index + 1,
    regionId: regionForCheck(check),
  }));
  const headMetadata = [
    baseRegion("head-title", "Page title in HTML metadata", observed(analysis.metadata?.title, "Page title not assessed in this report.")),
    baseRegion("head-description", "Meta description", observed(analysis.metadata?.description, "Meta description not assessed in this report.")),
    baseRegion("head-canonical", "Canonical URL", canonicalObservation(analysis)),
    baseRegion("head-robots", "Robots directives", robotsObservation(analysis)),
    baseRegion("head-sharing", "Social sharing metadata", socialObservation(analysis)),
  ];
  const regions = [
    baseRegion("unassessed-header", "Header area", { value: "Not assessed. No header or navigation content was returned.", assessment: "not_assessed" }),
    baseRegion("primary-heading", "Primary heading (H1)", headingsObservation(analysis, "h1")),
    baseRegion("subheadings", "Subheadings", headingsObservation(analysis, "subheadings")),
    baseRegion("visible-content", "Visible page text", contentObservation(analysis)),
    baseRegion("images", "Images", imageObservation(analysis)),
    baseRegion("links", "Links", linkObservation(analysis)),
    baseRegion("unassessed-footer", "Footer area", { value: "Not assessed. No footer content was returned.", assessment: "not_assessed" }),
  ];
  const regionIndex = new Map<XrayRegionId, XrayRegion>([...headMetadata, ...regions].map((region) => [region.id, region]));
  [...headMetadata, ...regions].forEach((region) => applyFindings(region, analysis.checks, priorities));
  const selectedPriority = selectedCheckId ? priorities.find((item) => item.check.id === selectedCheckId) : undefined;
  const selectedFinding = selectedPriority?.check ?? null;
  const selection: XraySelection = !selectedCheckId
    ? { status: "none" }
    : selectedPriority
      ? { status: "selected", checkId: selectedCheckId, regionId: selectedPriority.regionId }
      : { status: "unavailable", checkId: selectedCheckId };

  return {
    caption,
    headMetadata,
    regions,
    priorities,
    unplacedPriorities: priorities.filter((item) => item.regionId === null),
    selection,
    selectedFinding: selectedFinding && selectedPriority?.regionId && regionIndex.has(selectedPriority.regionId)
      ? selectedFinding
      : null,
  };
}
