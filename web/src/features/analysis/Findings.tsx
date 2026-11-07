import { StatusTag } from "../../components/StatusTag";
import { SourceMarker } from "../../components/SourceMarker";
import { categoryLabels, statusLabels, type CheckStatus, type SeoCheck } from "./schema";
import type { AnalysisReport } from "./report";
import { routeSearch, type AppRoute, type StatusFilter } from "../../app/route";

type IndexedCheck = { check: SeoCheck; sourceIndex: number };
type Props = {
  report: AnalysisReport;
  route: AppRoute;
  onRouteChange: (route: AppRoute, options?: { replace?: boolean; focus?: "heading" | "url" | "finding" | "error" | "search" }) => void;
  onOpenFinding: (check: SeoCheck) => void;
};

function orderedChecks(checks: SeoCheck[], mode: AppRoute["mode"]): IndexedCheck[] {
  const indexed = checks.map((check, sourceIndex) => ({ check, sourceIndex }));
  if (mode === "all") return indexed;
  return (["fail", "warning"] as const).flatMap((status) =>
    indexed.filter(({ check }) => check.status === status),
  );
}

function rowHref(route: AppRoute, check: SeoCheck) {
  return routeSearch({ ...route, view: "detail", check: check.id });
}

function FindingRow({ route, check, reportSource, onOpenFinding }: {
  route: AppRoute;
  check: SeoCheck;
  reportSource: AnalysisReport["source"];
  onOpenFinding: (check: SeoCheck) => void;
}) {
  const sourceLabel = reportSource === "demo" && check.id === "robots_directives"
    ? "Fictional fixture · static HTML observation"
    : reportSource === "demo" ? "Fixture-backed analyzer evidence" : "Analyzer-returned evidence text";
  return (
    <li className="finding-item">
      <a className="finding-open" href={rowHref(route, check)} data-finding-id={check.id}
        onClick={(event) => { event.preventDefault(); onOpenFinding(check); }}>
        <span className="finding-main">
          <span className="finding-name">{check.title}</span>
          <StatusTag status={check.status} />
          <span className="finding-category">{categoryLabels[check.category]}</span>
        </span>
        <span className="finding-evidence">
          <span className="finding-observed">{check.evidence.observed}</span>
          <span className="finding-source"><SourceMarker>{sourceLabel}</SourceMarker></span>
        </span>
      </a>
    </li>
  );
}

export function Findings({ report, route, onRouteChange, onOpenFinding }: Props) {
  const checks = report.analysis.checks;
  const ordered = orderedChecks(checks, route.mode);
  const scoped = ordered.filter(({ check }) => route.status === "all" || check.status === route.status);
  const query = route.q.trim().toLocaleLowerCase();
  const visible = scoped.filter(({ check }) => {
    if (!query) return true;
    const searchable = [check.id, check.title, categoryLabels[check.category], check.evidence.observed, check.recommendation]
      .join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
  const modeCounts = {
    review: checks.filter((check) => check.status === "fail" || check.status === "warning").length,
    all: checks.length,
  };

  const setRoute = (partial: Partial<AppRoute>) => onRouteChange({ ...route, ...partial }, { replace: true });
  const selectMode = (mode: AppRoute["mode"]) => {
    const next = { ...route, view: "findings" as const, mode };
    onRouteChange(next, { focus: "heading" });
  };
  const groups: { status: CheckStatus; checks: SeoCheck[] }[] = [];
  if (route.mode === "review" && route.status === "all") {
    for (const status of ["fail", "warning"] as const) {
      const members = visible.filter(({ check }) => check.status === status).map(({ check }) => check);
      if (members.length > 0) groups.push({ status, checks: members });
    }
  }

  return (
    <section className="view findings-view" aria-labelledby="findings-title">
      <div className="findings-heading">
        <div>
          <p className="eyebrow">{report.source === "demo" ? "Fictional example · deterministic rule results" : "Deterministic rule results"}</p>
          <h1 id="findings-title" tabIndex={-1}>Findings investigation</h1>
          <p className="findings-intro">{checks.length} {checks.length === 1 ? "check is" : "checks are"} included in this response. Search findings and use rule status to narrow the list.</p>
        </div>
        <p className="status-semantics">Fail and warning are analyzer statuses. They are not severity, urgency, or business value.</p>
      </div>

      <nav className="scope-tabs" aria-label="Finding list scope">
        <a href={routeSearch({ ...route, view: "findings", mode: "review" })}
          aria-current={route.mode === "review" ? "page" : undefined}
          onClick={(event) => { event.preventDefault(); selectMode("review"); }}>
          Needs review <span className="tab-count">{modeCounts.review}</span>
        </a>
        <a href={routeSearch({ ...route, view: "findings", mode: "all" })}
          aria-current={route.mode === "all" ? "page" : undefined}
          onClick={(event) => { event.preventDefault(); selectMode("all"); }}>
          All checks <span className="tab-count">{modeCounts.all}</span>
        </a>
      </nav>

      <p className="ordering-note">
        {route.mode === "review"
          ? "Failed rules appear first, followed by warnings. Order within each status follows the analyzer response."
            : `All checks follow the ${report.source === "demo" ? "fixture’s" : "server’s"} original response order, including pass and not-applicable results.`}
      </p>

      <div className="filters">
        <div className="filter-control search-control">
          <label htmlFor="finding-search">Search findings</label>
          <input id="finding-search" className="search-input" type="search" value={route.q}
            placeholder="Title, category, rule, observed text"
            onChange={(event) => setRoute({ q: event.currentTarget.value.slice(0, 120) })} />
        </div>
        <div className="filter-control status-control">
          <label htmlFor="finding-status">Rule status</label>
          <select id="finding-status" className="status-select" value={route.status}
            onChange={(event) => setRoute({ status: event.currentTarget.value as StatusFilter })}>
            <option value="all">All statuses</option>
            <option value="fail">Fail</option>
            <option value="warning">Warning</option>
            <option value="pass">Pass</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </div>
      </div>

      <p className="result-count" role="status" aria-live="polite">
        Showing {visible.length} of {scoped.length} {route.mode === "all" ? "available" : "review"} checks
        {query ? " matching “" + route.q + "”" : ""}
      </p>

      {visible.length === 0 ? (
        <div className="empty-state">
          <h2>No checks match this view.</h2>
          <p>Clear the search or choose a different rule status. Your current view and filters are unchanged.</p>
          <button className="button-link" type="button" onClick={() => onRouteChange({ ...route, q: "", status: "all" }, { replace: true, focus: "search" })}>Clear search and status</button>
        </div>
      ) : groups.length > 0 ? (
        <div className="finding-groups" aria-label="Needs review results">
          {groups.map((group) => (
            <section className={"status-group status-group-" + group.status} key={group.status} aria-labelledby={"group-" + group.status}>
              <div className="status-group-heading">
                <h2 id={"group-" + group.status}>{group.status === "fail" ? "Failed rules" : "Warnings"}</h2>
                <span>{group.checks.length} {group.checks.length === 1 ? "check" : "checks"} · rule outcome</span>
              </div>
              <ul className="finding-list" aria-label={statusLabels[group.status] + " checks"}>
                {group.checks.map((check) => <FindingRow key={check.id} route={route} check={check} reportSource={report.source} onOpenFinding={onOpenFinding} />)}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="finding-list all-finding-list" aria-label={route.mode === "all" ? `All analyzer checks in ${report.source === "demo" ? "fixture" : "response"} order` : "Filtered analyzer checks"}>
          {visible.map(({ check }) => <FindingRow key={check.id} route={route} check={check} reportSource={report.source} onOpenFinding={onOpenFinding} />)}
        </ul>
      )}

      <p className="findings-disclosure">Needs review includes failed and warning rules, in that order. All checks follows the original {report.source === "demo" ? "fixture" : "server response"} order and includes pass and not-applicable results. Status does not represent severity or business priority.</p>
    </section>
  );
}
