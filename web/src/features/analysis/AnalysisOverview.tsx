import { StatusTag } from "../../components/StatusTag";
import { categoryLabels, statusLabels, type LocalFixture } from "./schema";

type Props = {
  fixture: LocalFixture;
  recheckMessage: string;
  rechecking: boolean;
  onRecheck: () => void;
  onFindings: () => void;
  onFinding: () => void;
};

export function AnalysisOverview({ fixture, recheckMessage, rechecking, onRecheck, onFindings, onFinding }: Props) {
  const { analysis } = fixture;
  const lead = analysis.checks.find((check) => check.id === "robots_directives");
  const counts = analysis.checks.reduce<Record<string, number>>((result, check) => {
    result[check.status] = (result[check.status] ?? 0) + 1;
    return result;
  }, {});
  const reviewCount = analysis.checks.filter((check) => check.status === "fail" || check.status === "warning").length;
  const categoryRows = analysis.deterministic_score.categories.map((category) => {
    const checks = analysis.checks.filter((check) => check.category === category.category);
    const statusCounts = checks.reduce<Record<string, number>>((result, check) => {
      result[check.status] = (result[check.status] ?? 0) + 1;
      return result;
    }, {});
    return { category, checks, statusCounts };
  });
  if (!lead) {
    return <section className="view state-view" role="alert"><h1 tabIndex={-1}>The expected fixture observation is unavailable.</h1></section>;
  }

  return (
    <section className="view overview-view" aria-labelledby="overview-title">
      <div className="view-title-row">
        <div className="view-title-main">
          <p className="eyebrow">Illustrative static HTML review</p>
          <h1 className="page-title" id="overview-title" tabIndex={-1}>{analysis.metadata.title.replace(/ \| Northstar$/, "")}</h1>
          <p className="page-url">{analysis.requested_url}</p>
        </div>
        <aside className="score-note" aria-label="Heuristic score">
          <span className="score-label">Weighted heuristic</span>
          <strong className="score-value">{analysis.deterministic_score.overall_score} / 100</strong>
          <span className="score-caveat">Rule output only. Not a Google ranking or index score.</span>
        </aside>
      </div>

      <article className="lead-finding" aria-labelledby="lead-title">
        <div className="lead-status">
          <span className="status-caption">Rule result</span>
          <StatusTag status={lead.status} />
        </div>
        <div className="lead-copy">
          <p className="source-marker">Observed in static HTML · fixture</p>
          <h2 id="lead-title">A noindex directive is present.</h2>
          <p>If this page is meant to appear in search, review the publishing setting. This sample does not show whether Google has indexed or processed the page.</p>
        </div>
        <button className="lead-action" type="button" onClick={onFinding}>Inspect evidence</button>
      </article>

      <div className="overview-meta">
        <div className="meta-block">
          <span className="meta-label">Fixture transport context · mocked</span>
          <p className="meta-value">
            HTTP {analysis.fetch.status_code} · {analysis.fetch.content_type} · {analysis.fetch.bytes_read.toLocaleString()} decoded bytes · {analysis.fetch.redirect_count} redirects · {analysis.fetch.elapsed_time.toFixed(2)} s
          </p>
        </div>
        <div className="meta-block">
          <span className="meta-label">Rule outcomes · not severity</span>
          <div className="meta-statuses" aria-label="Rule outcome counts">
            {(["fail", "warning", "pass", "not_applicable"] as const).map((status) => (
              <span className="meta-status" key={status}><strong>{counts[status] ?? 0}</strong> {statusLabels[status]}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="secondary-tools">
        <p className="ai-note">Optional AI suggestions are unavailable here. No provider was contacted.</p>
        <button className="button-link" type="button" onClick={onRecheck} disabled={rechecking}>
          {rechecking ? "Showing recheck simulation…" : "Show recheck simulation"}
        </button>
        <span className="recheck-note" role="status" aria-live="polite">{recheckMessage}</span>
      </div>

      <section className="category-overview" aria-labelledby="category-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Coverage by category</p>
            <h2 id="category-title">What the checks cover</h2>
          </div>
          <button className="button-link" type="button" onClick={onFindings}>Review {reviewCount} checks</button>
        </div>
        <ul className="category-list">
          {categoryRows.map(({ category, checks, statusCounts }) => (
            <li className="category-item" key={category.category}>
              <span className="category-name">{categoryLabels[category.category]}</span>
              <span className="category-counts">
                <strong>{checks.length} {checks.length === 1 ? "check" : "checks"}</strong>
                {(["fail", "warning", "pass", "not_applicable"] as const).filter((status) => statusCounts[status]).map((status) => (
                  <span key={status}> · {statusCounts[status]} {statusLabels[status].toLowerCase()}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="score-footnote">The 0–100 value is a weighted analyzer heuristic. It does not measure ranking, index status, traffic, content quality, or Core Web Vitals.</p>
      </section>
    </section>
  );
}
