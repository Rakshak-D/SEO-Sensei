import { categoryLabels, type SeoCheck } from "./schema";
import type { AppRoute } from "../../app/route";

export function orderedChecks(checks: SeoCheck[], mode: AppRoute["mode"], prioritizedIds?: string[]): SeoCheck[] {
  if (mode === "all") return [...checks];
  if (prioritizedIds) {
    const byId = new Map(checks.map((check) => [check.id, check]));
    return prioritizedIds.flatMap((id) => {
      const check = byId.get(id);
      return check ? [check] : [];
    });
  }
  return [
    ...checks.filter((check) => check.status === "fail"),
    ...checks.filter((check) => check.status === "warning"),
  ];
}

export function filteredChecks(checks: SeoCheck[], route: AppRoute, prioritizedIds?: string[]): SeoCheck[] {
  const query = route.q.trim().toLocaleLowerCase();
  return orderedChecks(checks, route.mode, prioritizedIds).filter((check) => {
    if (route.status !== "all" && check.status !== route.status) return false;
    if (!query) return true;
    const searchable = [check.id, check.finding_title, check.finding_reason, check.title, categoryLabels[check.category], check.evidence.observed, check.recommendation]
      .join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}
