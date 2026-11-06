import { categoryLabels, type SeoCheck } from "./schema";
import type { AppRoute } from "../../app/route";

export function orderedChecks(checks: SeoCheck[], mode: AppRoute["mode"]): SeoCheck[] {
  if (mode === "all") return [...checks];
  return [
    ...checks.filter((check) => check.status === "fail"),
    ...checks.filter((check) => check.status === "warning"),
  ];
}

export function filteredChecks(checks: SeoCheck[], route: AppRoute): SeoCheck[] {
  const query = route.q.trim().toLocaleLowerCase();
  return orderedChecks(checks, route.mode).filter((check) => {
    if (route.status !== "all" && check.status !== route.status) return false;
    if (!query) return true;
    const searchable = [check.id, check.title, categoryLabels[check.category], check.evidence.observed, check.recommendation]
      .join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}
