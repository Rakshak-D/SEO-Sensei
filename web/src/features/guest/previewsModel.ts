import { findingsViewModel } from "../analysis/findingsViewModel";
import type { AnalysisReport } from "../analysis/report";
import type { SeoCheck } from "../analysis/schema";

export type PreviewField =
  | { state: "observed"; value: string; source: string }
  | { state: "empty"; value: ""; message: string; source: string }
  | { state: "not_found"; message: string; source: string }
  | { state: "not_assessed"; message: string; source: string };

export type PreviewsModel = {
  hostname: string;
  search: { host: string; finalUrl: string; title: PreviewField; description: PreviewField };
  openGraph: { title: PreviewField; description: PreviewField; url: PreviewField; image: PreviewField };
  x: { card: PreviewField; title: PreviewField; description: PreviewField; image: PreviewField };
  linkedin: { title: PreviewField; description: PreviewField; url: PreviewField; image: PreviewField };
  related: Array<{ check: SeoCheck; actionable: boolean; state: "actionable" | "passed" | "not_applicable" | "optional" | "not_listed" }>;
  disclosures: { search: string; openGraph: string; x: string; linkedin: string };
};

const previewCheckIds = ["title", "meta_description", "open_graph", "twitter_metadata"] as const;

function field(
  value: string | null | undefined,
  sectionAssessed: boolean,
  source: string,
  label: string,
): PreviewField {
  if (!sectionAssessed || value === undefined) return { state: "not_assessed", message: `${label} not assessed in this report.`, source };
  if (value === null) return { state: "not_found", message: `No ${label} returned.`, source };
  if (value === "") return { state: "empty", value: "", message: `An empty ${label} value was returned.`, source };
  return { state: "observed", value, source };
}

function hostnameFor(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Hostname unavailable";
  }
}

function relatedChecks(report: AnalysisReport): PreviewsModel["related"] {
  const canonicalPriorities = new Set(findingsViewModel(report).prioritized.map((check) => check.id));
  return report.analysis.checks
    .filter((check) => previewCheckIds.includes(check.id as typeof previewCheckIds[number]))
    .map((check) => {
      const actionable = canonicalPriorities.has(check.id)
        && check.is_actionable !== false
        && !check.optional_note;
      const state: PreviewsModel["related"][number]["state"] = actionable ? "actionable"
        : check.status === "pass" ? "passed"
          : check.status === "not_applicable" ? "not_applicable"
            : check.optional_note ? "optional" : "not_listed";
      return { check, actionable, state };
    });
}

export function buildPreviewsModel(report: AnalysisReport): PreviewsModel {
  const { analysis } = report;
  const metadata = analysis.metadata;
  const social = analysis.social_metadata;
  const host = hostnameFor(analysis.final_url);
  const searchTitle = field(metadata?.title, Boolean(metadata), "HTML page title", "page title");
  const searchDescription = field(metadata?.description, Boolean(metadata), "HTML meta description", "meta description");
  const og = {
    title: field(social?.og_title, Boolean(social), "Open Graph metadata", "Open Graph title"),
    description: field(social?.og_description, Boolean(social), "Open Graph metadata", "Open Graph description"),
    url: field(social?.og_url, Boolean(social), "Open Graph metadata", "Open Graph URL"),
    image: field(social?.og_image, Boolean(social), "Open Graph metadata", "Open Graph image address"),
  };
  const x = {
    card: field(social?.twitter_card, Boolean(social), "X metadata", "X card type"),
    title: field(social?.twitter_title, Boolean(social), "X metadata", "X title"),
    description: field(social?.twitter_description, Boolean(social), "X metadata", "X description"),
    image: field(social?.twitter_image, Boolean(social), "X metadata", "X image address"),
  };

  return {
    hostname: host,
    search: { host, finalUrl: analysis.final_url, title: searchTitle, description: searchDescription },
    openGraph: og,
    x,
    linkedin: { title: og.title, description: og.description, url: og.url, image: og.image },
    related: relatedChecks(report),
    disclosures: {
      search: "Illustration based on fetched metadata. Search engines may display something different.",
      openGraph: "Illustration from returned Open Graph metadata; actual sharing-service rendering is not verified.",
      x: "Illustration from returned X metadata; platform behavior is not verified.",
      linkedin: "Illustration from returned Open Graph metadata. LinkedIn rendering is not verified.",
    },
  };
}
