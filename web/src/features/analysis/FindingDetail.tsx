import { useMemo } from "react";
import { StatusTag } from "../../components/StatusTag";
import type { AnalysisReport } from "./report";
import { categoryLabels, type SeoCheck } from "./schema";
import { filteredChecks } from "./findingSelection";
import { findingsParent, routeSearch, type AppRoute } from "../../app/route";

type Props = {
  report: AnalysisReport;
  route: AppRoute;
  finding: SeoCheck;
  onBack: () => void;
  onSelect: (check: SeoCheck) => void;
};

function sourceExcerpt(html: string) {
  const lines = html.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes("<meta name=\"robots\""));
  return index < 0 ? null : { line: index + 1, text: lines[index]!.trim() };
}

export function FindingDetail({ report, route, finding, onBack, onSelect }: Props) {
  const demo = report.source === "demo" ? report : null;
  const note = demo?.fixture.review_notes[finding.id];
  const excerpt = demo && finding.id === "robots_directives" ? sourceExcerpt(demo.html) : null;
  const nearby = useMemo(() => filteredChecks(report.analysis.checks, route), [report.analysis.checks, route]);
  const selectedIndex = nearby.findIndex((check) => check.id === finding.id);
  const previous = selectedIndex > 0 ? nearby[selectedIndex - 1] : undefined;
  const next = selectedIndex >= 0 && selectedIndex < nearby.length - 1 ? nearby[selectedIndex + 1] : undefined;
  const interpretation = note?.why_it_matters
    ?? `The deterministic analyzer classified the “${finding.id}” rule as ${finding.status}. This records a page signal; consider its purpose and context before acting.`;
  const suggestedAction = note?.fix ?? finding.recommendation;
  const verification = note?.verify
    ?? "After any change on the website, run a new analysis and inspect the returned evidence. This application does not apply changes to the page.";

  return (
    <article className="view detail-view" aria-labelledby="detail-title">
      <a className="back-link" href={routeSearch(findingsParent(route))} onClick={(event) => { event.preventDefault(); onBack(); }}>← Back to findings</a>
      <header className="detail-header">
        <div>
          <p className="eyebrow">{categoryLabels[finding.category]}</p>
          <h1 id="detail-title" tabIndex={-1}>{finding.title}</h1>
        </div>
        <StatusTag status={finding.status} />
      </header>
      <p className="detail-meta">Rule status describes this check only; no severity or business priority is supplied.</p>

      <div className="detail-grid">
        <div className="detail-evidence-column">
          <section className="detail-section" aria-labelledby="observation-title">
            <h2 className="step-title" id="observation-title"><span>01</span> Observation returned</h2>
            <p className="evidence-value">{finding.evidence.observed}</p>
            {excerpt ? (
              <div className="provenance">
                <p className="provenance-label"><strong>Static HTML · fictional fixture</strong> <span>northstar-solar.html · line {excerpt.line}</span></p>
                <pre className="source-excerpt"><code>{excerpt.text}</code></pre>
                <p className="provenance-caveat">This exact excerpt is from the bundled fictional HTML file. The production API returns typed evidence text, but no arbitrary source excerpt or DOM location.</p>
              </div>
            ) : (
              <p className="provenance-caveat">{demo
                ? "Source: analyzer evidence text from the fictional fixture. No source location is shown for this check."
                : "Source: analyzer-returned checks[].evidence.observed. The API does not return an HTML excerpt or DOM location."}</p>
            )}
          </section>

          <section className="detail-section" aria-labelledby="interpretation-title">
            <h2 className="step-title" id="interpretation-title"><span>02</span> Interpretation</h2>
            <p>{interpretation}</p>
            {finding.id === "robots_directives" && (
              <p className="context-note">A crawler must fetch a page to read its robots directive. This observation does not establish whether Google has processed the instruction or the page’s current index state.</p>
            )}
          </section>
        </div>

        <aside className="detail-action-column" aria-label="Possible next steps">
          <section className="detail-section action-section" aria-labelledby="suggestion-title">
            <span className="suggestion-label">Suggested · not applied</span>
            <h2 className="step-title" id="suggestion-title"><span>03</span> Possible next step</h2>
            <p>{suggestedAction}</p>
            <p className="not-applied">SEO Sensei has not changed the page or its publishing settings.</p>
          </section>
          <section className="detail-section" aria-labelledby="verification-title">
            <h2 className="step-title" id="verification-title"><span>04</span> Verify after a change</h2>
            <p>{verification}</p>
          </section>
          <nav className="detail-adjacent" aria-label="Other matching findings">
            {previous ? (
              <button className="adjacent-link" type="button" onClick={() => onSelect(previous)}>← {previous.title}</button>
            ) : <span className="adjacent-empty">No earlier match</span>}
            {next ? (
              <button className="adjacent-link adjacent-next" type="button" onClick={() => onSelect(next)}>{next.title} →</button>
            ) : <span className="adjacent-empty">No later match</span>}
          </nav>
        </aside>
      </div>
    </article>
  );
}
