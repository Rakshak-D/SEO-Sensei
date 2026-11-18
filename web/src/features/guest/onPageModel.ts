import { findingsViewModel } from "../analysis/findingsViewModel";
import type { AnalysisReport } from "../analysis/report";
import type { SeoCheck } from "../analysis/schema";

export type ObservedText =
  | { state: "observed"; value: string }
  | { state: "not_found"; message: string }
  | { state: "not_assessed"; message: string };

export type RelatedCheck = {
  check: SeoCheck;
  actionable: boolean;
  state: "actionable" | "passed" | "not_applicable" | "optional" | "not_listed";
};

export type OnPageModel = {
  hostname: string;
  finalUrl: string;
  title: ObservedText & { length?: number; count?: number };
  description: ObservedText & { length?: number };
  headings: {
    state: "assessed" | "not_assessed";
    h1State: "observed" | "not_found" | "not_assessed";
    h1Message: string;
    h1: string[];
    h2: string[];
    h3: string[];
    emptyHeadingCount?: number;
    hierarchyJumps?: string[];
    orderNote: string;
  };
  content: {
    state: "observed" | "not_found" | "not_assessed";
    wordCount?: number;
    frequentTerms?: Array<{ term: string; count: number }>;
    message: string;
  };
  related: Record<"title" | "description" | "headings" | "content", RelatedCheck[]>;
  openCount: number;
  passedCount: number;
  notApplicableCount: number;
};

const onPageCheckIds = {
  title: ["title"],
  description: ["meta_description"],
  headings: ["h1_structure", "heading_hierarchy"],
  content: ["visible_text"],
} as const;

function readText(value: string | undefined, label: string, sectionAssessed: boolean): ObservedText {
  if (!sectionAssessed) return { state: "not_assessed", message: "Page metadata not assessed in this report." };
  if (value === undefined) return { state: "not_assessed", message: `${label} not assessed in this report.` };
  if (value === "") return { state: "not_found", message: `No ${label.toLowerCase()} found in the fetched HTML.` };
  return { state: "observed", value };
}

function hostnameFor(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Hostname unavailable";
  }
}

function relatedChecks(report: AnalysisReport, ids: readonly string[]): RelatedCheck[] {
  const canonicalPriorities = new Set(findingsViewModel(report).prioritized.map((check) => check.id));
  return report.analysis.checks
    .filter((check) => ids.includes(check.id))
    .map((check) => {
      const actionable = canonicalPriorities.has(check.id)
        && check.is_actionable !== false
        && !check.optional_note;
      const state: RelatedCheck["state"] = actionable ? "actionable"
        : check.status === "pass" ? "passed"
          : check.status === "not_applicable" ? "not_applicable"
            : check.optional_note ? "optional" : "not_listed";
      return { check, actionable, state };
    });
}

export function buildOnPageModel(report: AnalysisReport): OnPageModel {
  const { analysis } = report;
  const metadata = analysis.metadata;
  const headings = analysis.headings;
  const lexical = analysis.lexical_signals;
  const findings = findingsViewModel(report);
  const title = readText(metadata?.title, "page title", Boolean(metadata));
  const description = readText(metadata?.description, "meta description", Boolean(metadata));
  const h1State = !headings ? "not_assessed" : headings.h1.length ? "observed" : "not_found";
  const contentState = !lexical ? "not_assessed" : lexical.visible_word_count > 0 ? "observed" : "not_found";

  return {
    hostname: hostnameFor(analysis.final_url),
    finalUrl: analysis.final_url,
    title: { ...title, ...(metadata?.title_length !== undefined ? { length: metadata.title_length } : {}), ...(metadata?.title_count !== undefined ? { count: metadata.title_count } : {}) },
    description: { ...description, ...(metadata?.description_length !== undefined ? { length: metadata.description_length } : {}) },
    headings: {
      state: headings ? "assessed" : "not_assessed",
      h1State,
      h1Message: !headings ? "Headings not assessed." : headings.h1.length ? "" : "No H1 found in the fetched HTML.",
      h1: headings?.h1 ?? [],
      h2: headings?.h2 ?? [],
      h3: headings?.h3 ?? [],
      ...(headings ? { emptyHeadingCount: headings.empty_heading_count, hierarchyJumps: headings.hierarchy_jumps } : {}),
      orderNote: headings ? "Headings are grouped by heading level; the returned data does not preserve their full original order." : "",
    },
    content: {
      state: contentState,
      ...(lexical ? { wordCount: lexical.visible_word_count, frequentTerms: lexical.frequent_terms } : {}),
      message: !lexical ? "Visible content not assessed in this report."
        : lexical.visible_word_count === 0 ? "No visible text was found in the fetched HTML."
          : "This is the number of visible words the analyzer could read. It is not a target; a short page can suit its purpose.",
    },
    related: {
      title: relatedChecks(report, onPageCheckIds.title),
      description: relatedChecks(report, onPageCheckIds.description),
      headings: relatedChecks(report, onPageCheckIds.headings),
      content: relatedChecks(report, onPageCheckIds.content),
    },
    openCount: findings.openCount,
    passedCount: findings.passedCount,
    notApplicableCount: findings.notApplicableCount,
  };
}
