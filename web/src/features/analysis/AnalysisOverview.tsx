import { StatusTag } from "../../components/StatusTag";
import type { AnalysisReport } from "./report";
import { categoryLabels, statusLabels, type CheckStatus } from "./schema";

type Props = {
  report: AnalysisReport;
  isReanalyzing: boolean;
  reanalysisMessage: string;
  onReanalyze: () => void;
  onFindings: () => void;
  onFinding: (id: string) => void;
};

function pageTitle(report: AnalysisReport): string {
  const title = report.analysis.metadata?.title?.trim();
  if (title) return title;
  try {
    const url = new URL(report.analysis.final_url);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "Analyzed page";
  }
}

export function AnalysisOverview({ report, isReanalyzing, reanalysisMessage, onReanalyze, onFindings, onFinding }: Props) {
  const { analysis } = report;
  const counts = analysis.checks.reduce<Record<CheckStatus, number>>((result, check) => {
    result[check.status] += 1;
    return result;
  }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
  const lead = analysis.checks.find((check) => check.status === "fail");
  const categoryRows = analysis.deterministic_score.categories.map((category) => {
    const checks = analysis.checks.filter((check) => check.category === category.category);
    const categoryCounts = checks.reduce<Record<CheckStatus, number>>((result, check) => {
      result[check.status] += 1;
      return result;
    }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
    return { category, checks, categoryCounts };
  });
  const demo = report.source === "demo";

  return (
    <section className="view overview-view" aria-labelledby="overview-title">
      <div className="view-title-row">
        <div className="view-title-main">
          <p className="eyebrow">{demo ? "Fictional local example · static HTML fixture" : "Fetched page · deterministic analysis"}</p>
          <h1 className="page-title" id="overview-title" tabIndex={-1}>{pageTitle(report)}</h1>
          <p className="page-url">{analysis.final_url}</p>
          {analysis.requested_url !== analysis.final_url && (
            <p className="requested-url">Requested: <span>{analysis.requested_url}</span></p>
          )}
        </div>
        <aside className="score-note" aria-label="Heuristic score">
          <span className="score-label">Weighted heuristic</span>
          <strong className="score-value">{analysis.deterministic_score.overall_score} / 100</strong>
          <span className="score-caveat">Rule output only. Not a Google ranking or index score.</span>
        </aside>
      </div>

      {lead ? (
        <article className="lead-finding" aria-labelledby="lead-title">
          <div className="lead-status">
            <span className="status-caption">Rule result</span>
            <StatusTag status={lead.status} />
          </div>
          <div className="lead-copy">
            <p className="source-marker">{demo ? "Fixture observation" : "Analyzer observation"}</p>
            <h2 id="lead-title">{lead.title}</h2>
            <p className="lead-observation">{lead.evidence.observed}</p>
            <p>{demo
              ? "This is a fictional local example. It does not show whether Google has indexed or processed the page."
              : "This is a deterministic rule result based on the returned evidence. It does not establish ranking or actual search-engine index status."}</p>
          </div>
          <button className="lead-action" type="button" onClick={() => onFinding(lead.id)}>Inspect evidence</button>
        </article>
      ) : (
        <article className="lead-finding lead-finding-neutral" aria-labelledby="lead-title">
          <div className="lead-status"><span className="status-caption">Rule outcomes</span></div>
          <div className="lead-copy">
            <p className="source-marker">Analyzer response</p>
            <h2 id="lead-title">{analysis.checks.length === 0 ? "No check results were returned." : "No failed rules in this response."}</h2>
            <p>{counts.warning > 0
              ? `${counts.warning} ${counts.warning === 1 ? "warning is" : "warnings are"} available for review. Rule status does not express severity or business priority.`
              : "The response contains no failed or warning checks. This does not indicate a search ranking or indexing outcome."}</p>
          </div>
        </article>
      )}

      <div className="overview-meta">
        <div className="meta-block">
          <span className="meta-label">{demo ? "Fixture transport context · illustrative" : "Observed fetch context"}</span>
          <p className="meta-value">
            HTTP {analysis.fetch.status_code} · {analysis.fetch.content_type || "content type not reported"} · {analysis.fetch.bytes_read.toLocaleString()} decoded bytes · {analysis.fetch.redirect_count} redirects · {analysis.fetch.elapsed_time.toFixed(2)} s
          </p>
        </div>
        <div className="meta-block">
          <span className="meta-label">Rule outcomes · not severity</span>
          <div className="meta-statuses" aria-label="Rule outcome counts">
            {(["fail", "warning", "pass", "not_applicable"] as const).map((status) => (
              <span className="meta-status" key={status}><strong>{counts[status]}</strong> {statusLabels[status]}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="secondary-tools">
        <p className="ai-note">Deterministic analysis only · no AI provider request was made.</p>
        {!demo && (
          <button className="button-link" type="button" onClick={onReanalyze} disabled={isReanalyzing}>
            {isReanalyzing ? "Analysis in progress…" : "Analyze again"}
          </button>
        )}
        {isReanalyzing && <span className="recheck-note" role="status" aria-live="polite">Fetching a fresh response. The previous report remains visible until a new result is validated.</span>}
        {reanalysisMessage && <span className="report-error-inline" role="alert" aria-live="assertive">{reanalysisMessage}</span>}
      </div>

      <section className="category-overview" aria-labelledby="category-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Coverage by category</p>
            <h2 id="category-title">What the checks cover</h2>
          </div>
          <button className="button-link" type="button" onClick={onFindings}>Review {analysis.checks.length} checks</button>
        </div>
        {categoryRows.length ? (
          <ul className="category-list">
            {categoryRows.map(({ category, checks, categoryCounts }) => (
              <li className="category-item" key={category.category}>
                <span className="category-name">{categoryLabels[category.category]}</span>
                <span className="category-counts">
                  <strong>{checks.length} {checks.length === 1 ? "check" : "checks"}</strong>
                  {(["fail", "warning", "pass", "not_applicable"] as const).filter((status) => categoryCounts[status] > 0).map((status) => (
                    <span key={status}> · {categoryCounts[status]} {statusLabels[status].toLowerCase()}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="empty-category-note">The response did not include category score details.</p>}
        <p className="score-footnote">The 0–100 value is a weighted analyzer heuristic. It does not measure ranking, index status, traffic, content quality, or Core Web Vitals.</p>
      </section>
    </section>
  );
}

\n