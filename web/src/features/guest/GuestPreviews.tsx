import type { AnalysisReport } from "../analysis/report";
import { ImpactTag } from "../../components/StatusTag";
import { buildPreviewsModel, type PreviewField, type PreviewsModel } from "./previewsModel";

type Props = {
  report: AnalysisReport;
  onSeeFix: (checkId: string) => void;
};

function PreviewValue({ field, code = false }: { field: PreviewField; code?: boolean }) {
  if (field.state === "observed") return code
    ? <code data-role="code">{field.value}</code>
    : <span>{field.value}</span>;
  return <span className="guest-preview-state" data-state={field.state}>{field.message}</span>;
}

function PreviewFieldRow({ label, field, code = false }: { label: string; field: PreviewField; code?: boolean }) {
  return (
    <div className="guest-preview-field">
      <dt>{label}</dt>
      <dd><PreviewValue field={field} code={code} /></dd>
      <dd className="guest-preview-source">Source: {field.source}</dd>
    </div>
  );
}

function ImageAddress({ field }: { field: PreviewField }) {
  return (
    <div className="guest-preview-image-address">
      <span className="guest-preview-field-label">Image</span>
      {field.state === "observed"
        ? <p>Image address returned: <code data-role="code">{field.value}</code>. It was not fetched or displayed.</p>
        : field.state === "not_found"
          ? <p className="guest-preview-state" data-state="not_found">No image preview. {field.message}</p>
          : <p className="guest-preview-state" data-state={field.state}>{field.message}</p>}
      <p className="guest-preview-source">Source: {field.source}</p>
    </div>
  );
}

function effortLabel(value: NonNullable<PreviewsModel["related"][number]["check"]["effort"]>) {
  return value === "larger_job" ? "Larger job" : value === "moderate" ? "Moderate" : "Quick";
}

function RelatedChecks({ model, onSeeFix }: { model: PreviewsModel; onSeeFix: Props["onSeeFix"] }) {
  if (!model.related.length) return <p className="guest-preview-state">No related metadata check was returned.</p>;
  return (
    <ul className="guest-specialist-related">
      {model.related.map(({ check, actionable, state }) => (
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

function SearchPreview({ model }: { model: PreviewsModel }) {
  const title = model.search.title;
  const description = model.search.description;
  return (
    <article className="guest-preview-card guest-search-preview" aria-labelledby="guest-search-preview-title">
      <h2 id="guest-search-preview-title">Search result illustration</h2>
      <p className="guest-preview-source">Source: HTML page metadata</p>
      <div className="guest-search-result">
        <p className="guest-search-host">{model.search.host}</p>
        <p className="guest-search-url" data-role="code">{model.search.finalUrl}</p>
        {title.state === "observed" ? <h3>{title.value}</h3> : <p className="guest-preview-state" data-state={title.state}>{title.message}</p>}
        {description.state === "observed" ? <p className="guest-search-description">{description.value}</p> : <p className="guest-preview-state" data-state={description.state}>{description.message}</p>}
      </div>
      <p className="guest-preview-disclosure">{model.disclosures.search}</p>
    </article>
  );
}

function OpenGraphPreview({ model }: { model: PreviewsModel }) {
  return (
    <article className="guest-preview-card guest-og-preview" aria-labelledby="guest-og-preview-title">
      <h2 id="guest-og-preview-title">Open Graph sharing illustration</h2>
      <p className="guest-preview-source">Source: returned Open Graph metadata</p>
      <dl className="guest-preview-fields">
        <PreviewFieldRow label="Title" field={model.openGraph.title} />
        <PreviewFieldRow label="Description" field={model.openGraph.description} />
        <PreviewFieldRow label="URL" field={model.openGraph.url} code />
      </dl>
      <ImageAddress field={model.openGraph.image} />
      <p className="guest-preview-disclosure">{model.disclosures.openGraph}</p>
    </article>
  );
}

function XPreview({ model }: { model: PreviewsModel }) {
  return (
    <article className="guest-preview-card guest-x-preview" aria-labelledby="guest-x-preview-title">
      <h2 id="guest-x-preview-title">X sharing illustration</h2>
      <p className="guest-preview-source">Source: returned X metadata</p>
      <dl className="guest-preview-fields">
        <PreviewFieldRow label="Card type" field={model.x.card} />
        <PreviewFieldRow label="Title" field={model.x.title} />
        <PreviewFieldRow label="Description" field={model.x.description} />
      </dl>
      <ImageAddress field={model.x.image} />
      <p className="guest-preview-disclosure">{model.disclosures.x}</p>
    </article>
  );
}

function LinkedInPreview({ model }: { model: PreviewsModel }) {
  return (
    <article className="guest-preview-card guest-linkedin-preview" aria-labelledby="guest-linkedin-preview-title">
      <h2 id="guest-linkedin-preview-title">LinkedIn-style sharing illustration</h2>
      <p className="guest-preview-source">Source: returned Open Graph metadata</p>
      <div className="guest-linkedin-summary">
        {model.linkedin.title.state === "observed"
          ? <h3>{model.linkedin.title.value}</h3>
          : <p className="guest-preview-state" data-state={model.linkedin.title.state}>{model.linkedin.title.message}</p>}
        {model.linkedin.description.state === "observed"
          ? <p>{model.linkedin.description.value}</p>
          : <p className="guest-preview-state" data-state={model.linkedin.description.state}>{model.linkedin.description.message}</p>}
        <p className="guest-linkedin-url"><PreviewValue field={model.linkedin.url} code /></p>
      </div>
      <ImageAddress field={model.linkedin.image} />
      <p className="guest-preview-disclosure">{model.disclosures.linkedin}</p>
    </article>
  );
}

export function GuestPreviews({ report, onSeeFix }: Props) {
  const model = buildPreviewsModel(report);
  return (
    <article className="guest-report-page guest-specialist-page guest-previews" aria-labelledby="guest-previews-title">
      <header className="guest-specialist-heading">
        <p className="guest-host">{model.hostname}</p>
        <p className="guest-page-url" data-role="code">{report.analysis.final_url}</p>
        {report.source === "demo" && <span className="guest-sample-label">Fictional local example · no new page request</span>}
        <h1 id="guest-previews-title" tabIndex={-1}>Search and social previews</h1>
        <p>Illustrations use metadata returned in this report. They do not show a confirmed search or social-platform rendering.</p>
      </header>

      <div className="guest-previews-grid">
        <SearchPreview model={model} />
        <OpenGraphPreview model={model} />
        <XPreview model={model} />
        <LinkedInPreview model={model} />
      </div>

      <section className="guest-previews-related" aria-labelledby="guest-previews-related-title">
        <div className="guest-onpage-section-heading"><h2 id="guest-previews-related-title">Related checks</h2></div>
        <RelatedChecks model={model} onSeeFix={onSeeFix} />
      </section>
    </article>
  );
}
