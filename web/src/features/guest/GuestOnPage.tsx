import type { AnalysisReport } from "../analysis/report";
import { ImpactTag } from "../../components/StatusTag";
import { buildOnPageModel, type ObservedText, type RelatedCheck } from "./onPageModel";

type Props = {
  report: AnalysisReport;
  onSeeFix: (checkId: string) => void;
};

function ObservedValue({ observation }: { observation: ObservedText }) {
  return observation.state === "observed"
    ? <p className="guest-onpage-observed">{observation.value}</p>
    : <p className="guest-onpage-state" data-state={observation.state}>{observation.message}</p>;
}

function effortLabel(value: NonNullable<RelatedCheck["check"]["effort"]>) {
  return value === "larger_job" ? "Larger job" : value === "moderate" ? "Moderate" : "Quick";
}

function RelatedChecks({ items, onSeeFix }: { items: RelatedCheck[]; onSeeFix: Props["onSeeFix"] }) {
  if (!items.length) return <p className="guest-onpage-no-related">No related check was returned in this report.</p>;
  return (
    <ul className="guest-specialist-related">
      {items.map(({ check, actionable, state }) => (
        <li key={check.id} data-related-check={check.id}>
          {actionable ? (
            <>
              <div className="guest-specialist-finding-heading">
                <h3>{check.finding_title ?? check.title}</h3>
                {check.impact && <ImpactTag impact={check.impact} />}
                {check.effort && <span className="guest-effort-tag">{effortLabel(check.effort)}</span>}
              </div>
              <p>{check.finding_reason ?? check.recommendation}</p>
              <p><strong>Observed:</strong> {check.evidence.observed}</p>
              <p><strong>Next step:</strong> {check.recommendation}</p>
              <button type="button" className="guest-secondary-button" onClick={() => onSeeFix(check.id)}>See the fix</button>
            </>
          ) : (
            <div className="guest-specialist-check-state" data-state={state}>
              <span>{state === "passed" ? "Passed" : state === "not_applicable" ? "Not applicable" : state === "optional" ? "Optional note" : "Not listed as an actionable fix"}</span>
              <strong>{check.title}</strong>
              {state === "optional" && check.optional_note && <p>{check.optional_note}</p>}
              {state === "not_applicable" && <p>{check.evidence.observed}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function CharacterCount({ label, value }: { label: string; value: number }) {
  return <p className="guest-onpage-meta">{value} {label}{value === 1 ? " character" : " characters"}</p>;
}

function HeadingGroup({ label, values }: { label: "H1" | "H2" | "H3"; values: string[] }) {
  return (
    <section className="guest-onpage-heading-group" aria-labelledby={`guest-onpage-${label.toLowerCase()}`}>
      <h3 id={`guest-onpage-${label.toLowerCase()}`}>{label}</h3>
      {values.length ? <ul>{values.map((value, index) => <li key={`${label}-${index}`}>{value}</li>)}</ul> : <p className="guest-onpage-state">No {label} found in the fetched HTML.</p>}
    </section>
  );
}

export function GuestOnPage({ report, onSeeFix }: Props) {
  const model = buildOnPageModel(report);
  return (
    <article className="guest-report-page guest-specialist-page guest-onpage" aria-labelledby="guest-onpage-title">
      <header className="guest-specialist-heading">
        <p className="guest-host">{model.hostname}</p>
        <p className="guest-page-url" data-role="code">{model.finalUrl}</p>
        {report.source === "demo" && <span className="guest-sample-label">Fictional local example · no new page request</span>}
        <h1 id="guest-onpage-title" tabIndex={-1}>On-page content</h1>
        <p>Review the page title, headings, and how much visible text the analyzer found.</p>
        <p className="guest-specialist-counts" data-testid="onpage-count-line">{model.openCount} to fix · {model.passedCount} passed · {model.notApplicableCount} not applicable</p>
      </header>

      <section className="guest-onpage-section" aria-labelledby="guest-onpage-title-field">
        <div className="guest-onpage-section-heading"><h2 id="guest-onpage-title-field">Page title</h2>{model.title.count !== undefined && model.title.count > 1 && <span>{model.title.count} title elements</span>}</div>
        <ObservedValue observation={model.title} />
        {model.title.length !== undefined && <CharacterCount label="title" value={model.title.length} />}
        <RelatedChecks items={model.related.title} onSeeFix={onSeeFix} />
      </section>

      <section className="guest-onpage-section" aria-labelledby="guest-onpage-description-field">
        <div className="guest-onpage-section-heading"><h2 id="guest-onpage-description-field">Meta description</h2></div>
        <ObservedValue observation={model.description} />
        {model.description.length !== undefined && <CharacterCount label="description" value={model.description.length} />}
        <RelatedChecks items={model.related.description} onSeeFix={onSeeFix} />
      </section>

      <section className="guest-onpage-section" aria-labelledby="guest-onpage-headings">
        <div className="guest-onpage-section-heading"><h2 id="guest-onpage-headings">Heading structure</h2></div>
        {model.headings.state === "not_assessed" ? (
          <p className="guest-onpage-state">Headings not assessed.</p>
        ) : (
          <>
            {model.headings.h1State === "not_found" && <p className="guest-onpage-state" data-state="not_found">{model.headings.h1Message}</p>}
            {model.headings.h1State === "observed" && <HeadingGroup label="H1" values={model.headings.h1} />}
            <HeadingGroup label="H2" values={model.headings.h2} />
            <HeadingGroup label="H3" values={model.headings.h3} />
            {model.headings.orderNote && <p className="guest-onpage-meta">{model.headings.orderNote}</p>}
            {model.headings.emptyHeadingCount !== undefined && model.headings.emptyHeadingCount > 0 && <p className="guest-onpage-meta">{model.headings.emptyHeadingCount} empty {model.headings.emptyHeadingCount === 1 ? "heading was" : "headings were"} observed.</p>}
            {model.headings.hierarchyJumps?.map((jump, index) => <p className="guest-onpage-meta" key={`jump-${index}`}>Heading hierarchy: {jump}</p>)}
          </>
        )}
        <RelatedChecks items={model.related.headings} onSeeFix={onSeeFix} />
      </section>

      <section className="guest-onpage-section" aria-labelledby="guest-onpage-content">
        <div className="guest-onpage-section-heading"><h2 id="guest-onpage-content">Visible content</h2></div>
        {model.content.wordCount !== undefined && <p className="guest-onpage-word-count"><strong>{model.content.wordCount}</strong> visible {model.content.wordCount === 1 ? "word" : "words"}</p>}
        <p className="guest-onpage-state" data-state={model.content.state}>{model.content.message}</p>
        {model.content.frequentTerms && model.content.frequentTerms.length > 0 && (
          <ul className="guest-onpage-terms" aria-label="Frequent terms returned">
            {model.content.frequentTerms.map(({ term, count }, index) => <li key={`${term}-${index}`}>{term}<span>{count}</span></li>)}
          </ul>
        )}
        {model.content.frequentTerms?.length === 0 && <p className="guest-onpage-meta">No frequent terms were returned.</p>}
        <RelatedChecks items={model.related.content} onSeeFix={onSeeFix} />
      </section>
    </article>
  );
}
