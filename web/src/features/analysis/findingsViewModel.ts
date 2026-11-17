import type { AnalysisReport } from "./report";
import type { CheckStatus, SeoCategory, SeoCheck } from "./schema";

export type FindingCounts = Record<CheckStatus, number>;

export type FindingsViewModel = {
  counts: FindingCounts;
  openCount: number;
  passedCount: number;
  notApplicableCount: number;
  prioritized: SeoCheck[];
  optionalNotes: SeoCheck[];
  categories: Array<{
    category: SeoCategory;
    checks: SeoCheck[];
    counts: FindingCounts;
    actionableCount: number;
  }>;
  statusLine: string;
};

export function findingsViewModel(report: AnalysisReport): FindingsViewModel {
  const { checks, findings_summary: summary } = report.analysis;
  const counts = checks.reduce<FindingCounts>((result, check) => {
    result[check.status] += 1;
    return result;
  }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
  const byId = new Map(checks.map((check) => [check.id, check]));
  const prioritized = summary
    ? summary.prioritized_check_ids.flatMap((id) => {
      const check = byId.get(id);
      return check ? [check] : [];
    })
    : [
      ...checks.filter((check) => check.status === "fail"),
      ...checks.filter((check) => check.status === "warning"),
    ];
  const openCount = summary?.actionable_count ?? prioritized.length;
  const passedCount = summary?.raw_passes ?? counts.pass;
  const notApplicableCount = summary?.raw_not_applicable ?? counts.not_applicable;
  const optionalNotes = checks.filter((check) => Boolean(check.optional_note));
  const categories = report.analysis.deterministic_score.categories.map(({ category }) => {
    const members = checks.filter((check) => check.category === category);
    const categoryCounts = members.reduce<FindingCounts>((result, check) => {
      result[check.status] += 1;
      return result;
    }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
    return {
      category,
      checks: members,
      counts: categoryCounts,
      actionableCount: members.filter((check) => summary
        ? check.is_actionable === true
        : check.status === "fail" || check.status === "warning").length,
    };
  });

  return {
    counts,
    openCount,
    passedCount,
    notApplicableCount,
    prioritized,
    optionalNotes,
    categories,
    statusLine: `${openCount} to fix · ${passedCount} passed · ${notApplicableCount} not applicable`,
  };
}
