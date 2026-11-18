import { useState } from "react";
import type { AnalysisReport } from "../analysis/report";
import { categoryLabels } from "../analysis/schema";
import { findingsViewModel } from "../analysis/findingsViewModel";
import { ImpactTag } from "../../components/StatusTag";
import { buildXrayModel } from "./xrayModel";

type Props = {
  report: AnalysisReport;
  onSeeFix: (checkId: string) => void;
  onReviewAll: () => void;
  onOpenXray: () => void;
};

function hostAndPath(value: string) {
  try {
    const url = new URL(value);
    return { host: url.hostname, path: `${url.pathname}${url.search}${url.hash}` || "/" };
  } catch {
    return { host: "Page address", path: value };
  }
}

export function GuestSummary({ report, onSeeFix, onReviewAll, onOpenXray }: Props) {
  const [showAllGood, setShowAllGood] = useState(false);
  const { analysis } = report;
  const model = findingsViewModel(report);
  const identity = hostAndPath(analysis.final_url);
  const verdict = analysis.findings_summary?.verdict ?? "Review the findings returned for this page.";
  const priorities = model.prioritized.slice(0, 3);
  const xray = buildXrayModel(analysis, model.prioritized);
  const passing = analysis.checks.filter((check) => check.status === "pass");
  const optionalCount = analysis.findings_summary?.optional_note_count ?? model.optionalNotes.length;

  return (
    <section className="guest-report-page guest-summary" aria-labelledby="guest-summary-title">
      <header className="guest-page-identity">
        <p className="guest-host">{identity.host}</p>
        <p className="guest-page-url" data-role="code">{analysis.final_url}</p>
        {report.source === "demo" && <span className="guest-sample-label">Fictional local example · no new page request</span>}
        <h1 id="guest-summary-title" tabIndex={-1}>Summary</h1>
      </header>

      <section className="guest-verdict-block" aria-labelledby="guest-verdict-title">
        <div className="guest-verdict-heading">
          <div>
            <h2 className="guest-verdict" id="guest-verdict-title" data-testid="report-verdict">{verdict}</h2>
          </div>
          <div className="guest-score" aria-label={`Score ${analysis.deterministic_score.overall_score} out of 100`}>
            <span>Score</span><strong>{analysis.deterministic_score.overall_score}</strong>
            <details className="guest-score-help">
              <summary aria-label="How the score works" title="How the score works"><span aria-hidden="true">i</span></summary>
              <div className="guest-score-popover" role="note">
                <h3>How this score works</h3>
                <p>This is a deterministic score from the page data the server observed. It is not a search-ranking prediction or proof of index status.</p>
                <ul>
                  {analysis.deterministic_score.categories.map((category) => (
                    <li key={category.category}><span>{categoryLabels[category.category]}</span><strong>{category.weight}%</strong></li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        </div>

        <p className="guest-report-counts" data-testid="summary-count-line">
          <strong>{model.openCount} to fix</strong><span aria-hidden="true"> · </span>{model.passedCount} passed<span aria-hidden="true"> · </span>{model.notApplicableCount} not applicable
        </p>
        {optionalCount > 0 && <p className="guest-optional-count">{optionalCount} optional {optionalCount === 1 ? "note" : "notes"}</p>}

        <div className="guest-priority-heading">
          <h2>Do these first</h2>
          <button type="button" className="guest-text-button" onClick={onReviewAll}>See all fixes</button>
        </div>
        {priorities.length ? (
          <ol className="guest-priority-list" aria-label="First three priorities">
            {priorities.map((check, index) => (
              <li className="guest-priority-card" key={check.id} data-priority-card={index + 1}>
                <span className="guest-priority-number" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
                <div className="guest-priority-copy">
                  <h3>{check.finding_title ?? check.title}</h3>
                  <p>{check.finding_reason ?? check.recommendation}</p>
                </div>
                <div className="guest-priority-footer">
                  <div className="guest-priority-tags">
                    {check.impact && <ImpactTag impact={check.impact} />}
                    {check.effort && <span className="guest-effort-tag">{check.effort === "larger_job" ? "Larger job" : check.effort === "moderate" ? "Moderate" : "Quick"}</span>}
                  </div>
                  <button className="guest-card-action" type="button" onClick={() => onSeeFix(check.id)}>See the fix</button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="guest-no-fixes">No actionable fixes were returned by these checks.</p>
        )}

        <section className="guest-xray-preview" aria-labelledby="guest-xray-preview-title" data-testid="xray-preview">
          <div className="guest-xray-preview-heading">
            <div><p className="guest-summary-kicker">Page structure</p><h2 id="guest-xray-preview-title">HTML X-ray</h2></div>
            <button type="button" className="guest-secondary-button" onClick={onOpenXray}>Open Page X-ray</button>
          </div>
          <div className="guest-xray-preview-frame" aria-label="Compact schematic from observed HTML">
            <div className="guest-xray-preview-head">
              <span>HTML metadata</span>
              <strong>{xray.headMetadata.find((region) => region.id === "head-title")?.value}</strong>
            </div>
            <div className="guest-xray-preview-body">
              <span className="guest-xray-preview-unassessed">Header not assessed</span>
              <strong>{xray.regions.find((region) => region.id === "primary-heading")?.summaryPreview}</strong>
              <span>{xray.regions.find((region) => region.id === "visible-content")?.value}</span>
              <div className="guest-xray-preview-facts">
                <span>{xray.regions.find((region) => region.id === "images")?.value}</span>
                <span>{xray.regions.find((region) => region.id === "links")?.value}</span>
              </div>
              <span className="guest-xray-preview-unassessed">Footer not assessed</span>
            </div>
          </div>
          {xray.priorities.slice(0, 3).some((item) => item.regionId) && (
            <ol className="guest-xray-preview-pins" aria-label="Priority marks">
              {xray.priorities.slice(0, 3).filter((item) => item.regionId).map((item) => (
                <li key={item.check.id}><button type="button" onClick={() => onSeeFix(item.check.id)} aria-label={`Priority ${item.number}: ${item.check.finding_title ?? item.check.title}; see the fix`}>
                  <span>{item.number}</span>{item.check.finding_title ?? item.check.title}
                </button></li>
              ))}
            </ol>
          )}
          {xray.priorities.slice(0, 3).filter((item) => !item.regionId).map((item) => (
            <p className="guest-xray-unplaced-note" key={item.check.id}>Priority {item.number} cannot be placed on the page drawing. <button type="button" className="guest-text-button" onClick={() => onSeeFix(item.check.id)}>See the fix</button></p>
          ))}
        </section>
      </section>

      <section className="guest-categories" aria-labelledby="guest-category-title">
        <div className="guest-section-heading"><h2 id="guest-category-title">By category</h2><span>Checks returned</span></div>
        <ul>
          {model.categories.map(({ category, checks, counts }) => (
            <li key={category}>
              <div className="guest-category-row"><span>{categoryLabels[category]}</span><span>{counts.pass} of {checks.length} passed</span></div>
              <div className="guest-category-track" aria-hidden="true"><span style={{ width: `${checks.length ? (counts.pass / checks.length) * 100 : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="guest-good-checks" aria-labelledby="guest-good-title">
        <div className="guest-section-heading"><h2 id="guest-good-title">Already good</h2><span>{passing.length} passed</span></div>
        <ul>
          {passing.slice(0, showAllGood ? passing.length : 5).map((check) => <li key={check.id}>{check.title}</li>)}
        </ul>
        {passing.length > 5 && <button className="guest-text-button" type="button" onClick={() => setShowAllGood((value) => !value)}>{showAllGood ? "Show fewer" : "Show all"}</button>}
      </section>
    </section>
  );
}
