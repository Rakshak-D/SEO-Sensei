import type { CheckStatus } from "../features/analysis/schema";

export type ViewName = "entry" | "overview" | "findings" | "detail";
export type FindingsMode = "review" | "all";
export type StatusFilter = "all" | CheckStatus;

export type AppRoute = {
  view: ViewName;
  mode: FindingsMode;
  q: string;
  status: StatusFilter;
  check: string;
};

const knownViews = new Set<ViewName>(["entry", "overview", "findings", "detail"]);
const knownStatuses = new Set<StatusFilter>(["all", "fail", "warning", "pass", "not_applicable"]);

export function routeFromSearch(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const rawView = params.get("view") as ViewName | null;
  const rawStatus = params.get("status") as StatusFilter | null;
  return {
    view: rawView && knownViews.has(rawView) ? rawView : "entry",
    mode: params.get("mode") === "all" ? "all" : "review",
    q: (params.get("q") ?? "").slice(0, 120),
    status: rawStatus && knownStatuses.has(rawStatus) ? rawStatus : "all",
    check: (params.get("check") ?? "").slice(0, 80),
  };
}

export function routeSearch(route: AppRoute): string {
  const params = new URLSearchParams();
  params.set("view", route.view);
  if (route.view === "findings" || route.view === "detail") {
    params.set("mode", route.mode);
    if (route.q) params.set("q", route.q);
    if (route.status !== "all") params.set("status", route.status);
  }
  if (route.view === "detail" && route.check) params.set("check", route.check);
  return "?" + params.toString();
}

export function findingsParent(route: AppRoute): AppRoute {
  return { ...route, view: "findings", check: "" };
}
