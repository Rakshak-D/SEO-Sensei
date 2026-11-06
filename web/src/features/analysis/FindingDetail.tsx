import { useMemo } from "react";
import { StatusTag } from "../../components/StatusTag";
import { categoryLabels, type LocalFixture, type SeoCheck } from "./schema";
import { filteredChecks } from "./findingSelection";
import { findingsParent, routeSearch, type AppRoute } from "../../app/route";

type Props = {
  fixture: LocalFixture;
  html: string;
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

export function FindingDetail({ fixture, html, route, finding, onBack, onSelect }: Props) {
  const note = fixture.review_notes[finding.id];
  const excerpt = finding.id === "robots_directives" ? sourceExcerpt(html) : null;
  const nearby = useMemo(() => filteredChecks(fixture.analysis.checks, route), [fixture.analysis.checks, route]);
  const selectedIndex = nearby.findIndex((check) => check.id === finding.id);
  const previous = selectedIndex > 0 ? nearby[selectedIndex - 1] : undefined;
  const next = selectedIndex >= 0 && selectedIndex < nearby.length - 1 ? nearby[selectedIndex + 1] : undefined;
  const interpretation = note?.why_it_matters
    ?? "This rule records a page observation from the local fixture. Review it in the context of the page’s purpose.";
  const suggestedAction = note?.fix ?? finding.recommendation;
  const verification = note?.verify
    ?? "After making any change, re-fetch the page and compare the returned analyzer evidence. This prototype cannot perform that check.";

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
              <p className="provenance-caveat">Source: analyzer evidence text from checks[].evidence.observed. The API does not identify a source node or line for this rule.</p>
            )}
          </section>

          <section className="detail-section" aria-labelledby="interpretation-title">
            <h2 className="step-title" id="interpretation-title"><span>02</span> Interpretation</h2>
            <p>{interpretation}</p>
            {finding.id === "robots_directives" && (
              <p className="context-note">A crawler needs to fetch a page to read its robots directive. This single fixture does not show whether Google has processed the instruction or what its current index state is.</p>
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
