import { z } from "zod";

export const checkStatusSchema = z.enum(["pass", "warning", "fail", "not_applicable"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const impactSchema = z.enum(["blocking", "high", "medium", "low"]);
export type FindingImpact = z.infer<typeof impactSchema>;

export const effortSchema = z.enum(["quick", "moderate", "larger_job"]);
export type FindingEffort = z.infer<typeof effortSchema>;

const anatomyPartSchema = z.enum([
  "page", "title", "description", "heading", "content", "image", "links", "technical", "sharing", "structured_data",
]);

export const categorySchema = z.enum([
  "technical_indexability",
  "metadata",
  "headings_content_structure",
  "links",
  "images",
  "structured_data",
  "social_metadata",
  "html_signals",
]);
export type SeoCategory = z.infer<typeof categorySchema>;

const evidenceSchema = z.object({
  observed: z.string().max(2_000),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
});

export const seoCheckSchema = z.object({
  id: z.string().min(1).max(80),
  category: categorySchema,
  title: z.string().max(500),
  status: checkStatusSchema,
  points: z.number().min(0).max(100),
  max_points: z.number().min(0).max(100),
  evidence: evidenceSchema,
  recommendation: z.string().max(2_000),
  impact: impactSchema.nullable().optional(),
  effort: effortSchema.nullable().optional(),
  finding_title: z.string().max(500).nullable().optional(),
  finding_reason: z.string().max(2_000).nullable().optional(),
  fix_snippet: z.string().max(2_000).nullable().optional(),
  snippet_requires_review: z.boolean().optional(),
  is_actionable: z.boolean().optional(),
  optional_note: z.string().max(2_000).nullable().optional(),
  exclusion_reason: z.string().max(2_000).nullable().optional(),
  anatomy_part: anatomyPartSchema.nullable().optional(),
});
export type SeoCheck = z.infer<typeof seoCheckSchema>;

const fetchSchema = z.object({
  requested_url: z.string().min(1).max(2_048),
  final_url: z.string().min(1).max(2_048),
  status_code: z.number().int().min(0).max(599),
  content_type: z.string().max(128),
  content_length: z.number().int().nonnegative().nullable(),
  bytes_read: z.number().int().nonnegative(),
  redirect_count: z.number().int().min(0).max(10),
  elapsed_time: z.number().min(0).max(120),
  x_robots_tag: z.string().max(2_000).nullable(),
});

const scoreCategorySchema = z.object({
  category: categorySchema,
  weight: z.number().positive().max(100),
  points_earned: z.number().min(0).max(100),
  max_points: z.number().positive().max(100),
  raw_points: z.number().min(0).max(100),
  raw_max_points: z.number().min(0).max(100),
  check_ids: z.array(z.string().max(80)).max(30),
});

const scoreSchema = z.object({
  version: z.string().min(1),
  overall_score: z.number().int().min(0).max(100),
  points_earned: z.number().min(0).max(100),
  max_points: z.number().positive().max(100),
  categories: z.array(scoreCategorySchema).max(8),
});

const findingsSummarySchema = z.object({
  total_checks: z.number().int().min(0).max(100),
  raw_passes: z.number().int().min(0).max(100),
  raw_warnings: z.number().int().min(0).max(100),
  raw_failures: z.number().int().min(0).max(100),
  raw_not_applicable: z.number().int().min(0).max(100),
  actionable_count: z.number().int().min(0).max(100),
  optional_note_count: z.number().int().min(0).max(100),
  by_impact: z.object({
    blocking: z.number().int().min(0).max(100), high: z.number().int().min(0).max(100),
    medium: z.number().int().min(0).max(100), low: z.number().int().min(0).max(100),
  }),
  by_effort: z.object({
    quick: z.number().int().min(0).max(100), moderate: z.number().int().min(0).max(100),
    larger_job: z.number().int().min(0).max(100),
  }),
  prioritized_check_ids: z.array(z.string().min(1).max(80)).max(100),
  verdict: z.string().min(1).max(500),
  exclusions: z.array(z.object({
    check_id: z.string().min(1).max(80),
    status: checkStatusSchema,
    reason: z.string().max(2_000),
  })).max(100),
});
export type FindingsSummary = z.infer<typeof findingsSummarySchema>;

// This is the real analysis response subset rendered by this UI. Fixture wrapper
// metadata remains separate and is never treated as a production API field.
export const seoAnalysisSchema = z.object({
  requested_url: z.string().min(1).max(2_048),
  final_url: z.string().min(1).max(2_048),
  fetch: fetchSchema,
  deterministic_score: scoreSchema,
  checks: z.array(seoCheckSchema).max(100),
  metadata: z.object({ title: z.string().max(500) }),
  findings_summary: findingsSummarySchema.optional(),
});
export type SeoAnalysis = z.infer<typeof seoAnalysisSchema>;

// Live API responses use the same analyzer fields, but metadata is not a
// presentation prerequisite. Keep this parser independent of the fixture
// wrapper and its Northstar-specific invariants.
export const liveSeoAnalysisSchema = seoAnalysisSchema.extend({
  metadata: z.object({ title: z.string().max(500).optional() }).optional(),
}).superRefine((analysis, context) => {
  const ids = new Set<string>();
  analysis.checks.forEach((check, index) => {
    if (ids.has(check.id)) {
      context.addIssue({
        code: "custom",
        message: "Finding identifiers must be unique.",
        path: ["checks", index, "id"],
      });
    }
    ids.add(check.id);
  });

  const summary = analysis.findings_summary;
  if (analysis.deterministic_score.version === "1.1") {
    if (!summary) {
      context.addIssue({ code: "custom", message: "The version 1.1 response is missing its resolved findings summary.", path: ["findings_summary"] });
      return;
    }
    const statusCounts = analysis.checks.reduce<Record<CheckStatus, number>>((counts, check) => {
      counts[check.status] += 1;
      return counts;
    }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
    const actionable = analysis.checks.filter((check) => check.is_actionable === true);
    const optionalNoteCount = analysis.checks.filter((check) => Boolean(check.optional_note)).length;
    const actualActionIds = analysis.checks.filter((check) => check.is_actionable).map((check) => check.id);
    const actualActionIdSet = new Set(actualActionIds);
    const impactCounts = analysis.checks.reduce<Record<"blocking" | "high" | "medium" | "low", number>>((counts, check) => {
      if (check.is_actionable && check.impact) counts[check.impact] += 1;
      return counts;
    }, { blocking: 0, high: 0, medium: 0, low: 0 });
    const effortCounts = analysis.checks.reduce<Record<"quick" | "moderate" | "larger_job", number>>((counts, check) => {
      if (check.is_actionable && check.effort) counts[check.effort] += 1;
      return counts;
    }, { quick: 0, moderate: 0, larger_job: 0 });
    const expectedExclusions = analysis.checks.filter((check) =>
      (check.status === "warning" || check.status === "fail") && check.is_actionable !== true,
    );
    const exclusionIds = summary.exclusions.map((item) => item.check_id);
    const exclusionStatusMatches = expectedExclusions.every((check) => {
      const exclusion = summary.exclusions.find((item) => item.check_id === check.id);
      return Boolean(exclusion && exclusion.status === check.status && exclusion.reason.length > 0);
    });
    if (summary.total_checks !== analysis.checks.length
      || summary.total_checks !== summary.raw_passes + summary.raw_warnings + summary.raw_failures + summary.raw_not_applicable
      || summary.raw_passes !== statusCounts.pass
      || summary.raw_warnings !== statusCounts.warning
      || summary.raw_failures !== statusCounts.fail
      || summary.raw_not_applicable !== statusCounts.not_applicable
      || summary.actionable_count !== actionable.length
      || summary.optional_note_count !== optionalNoteCount
      || summary.by_impact.blocking !== impactCounts.blocking
      || summary.by_impact.high !== impactCounts.high
      || summary.by_impact.medium !== impactCounts.medium
      || summary.by_impact.low !== impactCounts.low
      || summary.by_effort.quick !== effortCounts.quick
      || summary.by_effort.moderate !== effortCounts.moderate
      || summary.by_effort.larger_job !== effortCounts.larger_job) {
      context.addIssue({ code: "custom", message: "The version 1.1 response counts do not reconcile with its checks.", path: ["findings_summary"] });
    }
    if (summary.prioritized_check_ids.length !== actualActionIdSet.size
      || new Set(summary.prioritized_check_ids).size !== summary.prioritized_check_ids.length
      || summary.prioritized_check_ids.some((id) => !actualActionIdSet.has(id))) {
      context.addIssue({ code: "custom", message: "The prioritized findings do not match actionable checks.", path: ["findings_summary", "prioritized_check_ids"] });
    }
    if (new Set(exclusionIds).size !== exclusionIds.length
      || exclusionIds.length !== expectedExclusions.length
      || !exclusionStatusMatches) {
      context.addIssue({ code: "custom", message: "Warning and failure exclusions do not match the checks.", path: ["findings_summary", "exclusions"] });
    }
    analysis.checks.forEach((check, index) => {
      if (typeof check.is_actionable !== "boolean") {
        context.addIssue({ code: "custom", message: "A version 1.1 check is missing its actionability decision.", path: ["checks", index, "is_actionable"] });
      }
      if ((check.status === "warning" || check.status === "fail")
        && check.is_actionable !== true
        && !check.exclusion_reason) {
        context.addIssue({ code: "custom", message: "A non-actionable warning or failure needs an explicit reason.", path: ["checks", index, "exclusion_reason"] });
      }
      if (check.is_actionable
        && (!check.finding_title || !check.finding_reason || !check.impact || !check.effort)) {
        context.addIssue({ code: "custom", message: "An actionable finding is missing its resolved presentation fields.", path: ["checks", index] });
      }
    });
  }
});
export type LiveSeoAnalysis = z.infer<typeof liveSeoAnalysisSchema>;

const reviewNoteSchema = z.object({
  why_it_matters: z.string().max(2_000).optional(),
  fix: z.string().max(2_000).optional(),
  verify: z.string().max(2_000).optional(),
});

export const fixtureSchema = z.object({
  fixture_notice: z.string().min(1).max(2_000),
  fixture_html: z.literal("fixtures/northstar-solar.html"),
  analysis: seoAnalysisSchema,
  review_notes: z.record(z.string().max(80), reviewNoteSchema),
}).superRefine((fixture, context) => {
  if (fixture.analysis.checks.length !== 23) {
    context.addIssue({ code: "custom", message: "The Northstar fixture must contain exactly 23 checks." });
  }
  const ids = new Set(fixture.analysis.checks.map((check) => check.id));
  if (ids.size !== fixture.analysis.checks.length) {
    context.addIssue({ code: "custom", message: "Finding identifiers must be unique." });
  }
  const robots = fixture.analysis.checks.find((check) => check.id === "robots_directives");
  if (!robots || robots.status !== "fail" || !robots.evidence.observed.toLowerCase().includes("noindex")) {
    context.addIssue({ code: "custom", message: "The expected noindex observation is unavailable." });
  }
  const counts = fixture.analysis.checks.reduce<Record<CheckStatus, number>>((acc, check) => {
    acc[check.status] += 1;
    return acc;
  }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
  if (counts.fail !== 1 || counts.warning !== 3 || counts.pass !== 18 || counts.not_applicable !== 1) {
    context.addIssue({ code: "custom", message: "The Northstar status totals do not match the accepted fixture." });
  }
});

export type LocalFixture = z.infer<typeof fixtureSchema>;

export const categoryLabels: Record<SeoCategory, string> = {
  technical_indexability: "Technical & indexability",
  metadata: "Metadata",
  headings_content_structure: "Headings & content",
  links: "Links",
  images: "Images",
  structured_data: "Structured data",
  social_metadata: "Social metadata",
  html_signals: "HTML signals",
};

export const statusLabels: Record<CheckStatus, string> = {
  fail: "Fail",
  warning: "Warning",
  pass: "Pass",
  not_applicable: "Not applicable",
};

export const sampleUrl = "https://northstar.example/guides/home-solar/";
