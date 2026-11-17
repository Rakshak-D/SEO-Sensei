import { ImpactTag } from "../../components/StatusTag";
import type { AnalysisReport } from "./report";
import { categoryLabels, type SeoCheck } from "./schema";
import { findingsViewModel } from "./findingsViewModel";

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

function effortLabel(check: SeoCheck): string | null {
  if (!check.effort) return null;
  return check.effort === "larger_job" ? "Larger job" : check.effort === "moderate" ? "Moderate" : "Quick";
}

export function AnalysisOverview({ report, isReanalyzing, reanalysisMessage, onReanalyze, onFindings, onFinding }: Props) {
  const { analysis } = report;
  const model = findingsViewModel(report);
  const demo = report.source === "demo";
  const topFindings = model.prioritized.slice(0, 3);
  const verdict = analysis.findings_summary?.verdict
    ?? topFindings[0]?.finding_title
    ?? (model.openCount === 0 ? "Nothing to fix in these checks." : `${model.openCount} checks are ready to review.`);
  const categoryRows = model.categories;

  return (
    <section className="view overview-view" aria-labelledby="overview-title">
      <div className="view-title-row summary-identity">
        <div className="view-title-main">
          <p className="eyebrow">{demo ? "Fictional local example · static HTML fixture" : "Fetched page · deterministic analysis"}</p>
          <h1 className="page-title" id="overview-title" tabIndex={-1}>{pageTitle(report)}</h1>
          <p className="page-url">{analysis.final_url}</p>
          {analysis.requested_url !== analysis.final_url && (
            <p className="requested-url">Requested: <span>{analysis.requested_url}</span></p>
          )}
        </div>
      </div>

      <section className="summary-priorities" aria-labelledby="summary-verdict">
        <div className="summary-verdict-row">
          <div className="summary-verdict-copy">
            <p className="eyebrow">Page verdict</p>
            <h2 className="summary-verdict" id="summary-verdict" data-testid="report-verdict">{verdict}</h2>
          </div>
          <aside className="score-note" aria-label="Deterministic score">
            <span className="score-label">Weighted heuristic</span>
            <strong className="score-value">{analysis.deterministic_score.overall_score} / 100</strong>
            <span className="score-caveat">Rule output only. Not a Google ranking or index score.</span>
          </aside>
        </div>

        <p className="summary-count-line" data-testid="summary-count-line">{model.statusLine}</p>
        {analysis.findings_summary?.optional_note_count === 1 && (
          <p className="optional-note-count">1 optional note</p>
        )}
        {(analysis.findings_summary?.optional_note_count ?? model.optionalNotes.length) > 1 && (
          <p className="optional-note-count">{analysis.findings_summary?.optional_note_count ?? model.optionalNotes.length} optional notes</p>
        )}

        <div className="summary-priority-heading">
          <div>
            <p className="eyebrow">Prioritized actions</p>
            <h2>Do these first</h2>
          </div>
          <button className="button-link" type="button" onClick={onFindings}>Review all checks</button>
        </div>

        {topFindings.length ? (
          <ol className="priority-list" aria-label="Top three priorities">
            {topFindings.map((check, index) => {
              const title = check.finding_title ?? check.title;
              const reason = check.finding_reason ?? check.recommendation;
              const effort = effortLabel(check);
              return (
                <li className="priority-card" key={check.id} data-priority-card={index + 1}>
                  <span className="priority-number" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
                  <div className="priority-copy">
                    <h3>{title}</h3>
                    <p>{reason}</p>
                    {demo && <p className="priority-evidence">{check.evidence.observed}</p>}
                    <div className="priority-tags">
                      {check.impact && <ImpactTag impact={check.impact} />}
                      {effort && <span className="effort-tag">{effort}</span>}
                    </div>
                  </div>
                  <button className="priority-action" type="button" onClick={() => onFinding(check.id)}>
                    See the fix
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="summary-no-actions">No actionable findings were returned by these checks.</p>
        )}
      </section>

      {model.optionalNotes.length > 0 && (
        <details className="optional-notes">
          <summary>Optional notes ({model.optionalNotes.length})</summary>
          <ul>
            {model.optionalNotes.map((check) => <li key={check.id}>{check.optional_note}</li>)}
          </ul>
        </details>
      )}

      <div className="overview-meta">
        <div className="meta-block">
          <span className="meta-label">{demo ? "Fixture transport context · illustrative" : "Observed fetch context"}</span>
          <p className="meta-value">
            HTTP {analysis.fetch.status_code} · {analysis.fetch.content_type || "content type not reported"} · {analysis.fetch.bytes_read.toLocaleString()} decoded bytes · {analysis.fetch.redirect_count} redirects · {analysis.fetch.elapsed_time.toFixed(2)} s
          </p>
        </div>
        <div className="meta-block">
          <span className="meta-label">Check outcomes</span>
          <p className="meta-value">{analysis.checks.length} checks returned; status and priority are separate measurements.</p>
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
            {categoryRows.map(({ category, checks, counts, actionableCount }) => (
              <li className="category-item" key={category}>
                <span className="category-name">{categoryLabels[category]}</span>
                <span className="category-counts">
                  <strong>{checks.length} {checks.length === 1 ? "check" : "checks"}</strong>
                  <span> · {actionableCount} to fix</span>
                  {counts.pass > 0 && <span> · {counts.pass} passed</span>}
                  {counts.not_applicable > 0 && <span> · {counts.not_applicable} not applicable</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="empty-category-note">The response did not include category score details.</p>}
      </section>
    </section>
  );
}
