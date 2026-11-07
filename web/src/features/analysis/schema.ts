import { z } from "zod";

export const checkStatusSchema = z.enum(["pass", "warning", "fail", "not_applicable"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

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

// This is the real analysis response subset rendered by this UI. Fixture wrapper
// metadata remains separate and is never treated as a production API field.
export const seoAnalysisSchema = z.object({
  requested_url: z.string().min(1).max(2_048),
  final_url: z.string().min(1).max(2_048),
  fetch: fetchSchema,
  deterministic_score: scoreSchema,
  checks: z.array(seoCheckSchema).max(100),
  metadata: z.object({ title: z.string().max(500) }),
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
