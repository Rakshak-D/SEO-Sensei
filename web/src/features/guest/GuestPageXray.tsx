import { useMemo, useState, type FocusEvent } from "react";
import type { AnalysisReport } from "../analysis/report";
import { findingsViewModel } from "../analysis/findingsViewModel";
import type { AppRoute } from "../../app/route";
import { ImpactTag } from "../../components/StatusTag";
import { buildXrayModel, type XrayRegion } from "./xrayModel";

type Props = {
  report: AnalysisReport;
  route: AppRoute;
  onOpenFix: (checkId: string) => void;
  onNavigate: (route: AppRoute, options?: { focus?: "heading" | "xray" | "finding" }) => void;
};

function hostname(value: string) {
  try { return new URL(value).hostname; } catch { return "Page address"; }
}

function BoundedText({ value, limit = 220, code = false }: { value: string; limit?: number; code?: boolean }) {
  const shown = code ? <code className="guest-xray-url" data-role="code">{value}</code> : value;
  if (value.length <= limit) return <p className="guest-xray-observation">{shown}</p>;
  const preview = value.slice(0, limit).trimEnd();
  return (
    <div className="guest-xray-bounded-text">
      <p className="guest-xray-observation">{code ? <code className="guest-xray-url" data-role="code">{preview}…</code> : `${preview}…`}</p>
      <details>
        <summary>Read the full returned value</summary>
        <p className="guest-xray-observation">{shown}</p>
      </details>
    </div>
  );
}

const assessmentLabels = {
  not_assessed: "Not assessed",
  not_found: "Not found",
  observed: "Observed",
  clear: "Clear",
  needs_attention: "Needs attention",
  blocking: "Blocking",
} as const;

function PinList({ region, onOpenFix, onSelect }: {
  region: XrayRegion;
  onOpenFix: (checkId: string) => void;
  onSelect: (checkId: string) => void;
}) {
  if (!region.pins.length) return null;
  return (
    <ol className="guest-xray-pins" aria-label={`${region.label} priority findings`}>
      {region.pins.map((pin) => (
        <li key={pin.checkId}>
          <button
            type="button"
            className="guest-xray-pin"
            data-xray-check={pin.checkId}
            aria-label={`Priority ${pin.number}: ${pin.title}; open matching fix`}
            title={`Priority ${pin.number}: ${pin.title}`}
            onFocus={() => onSelect(pin.checkId)}
            onClick={() => onOpenFix(pin.checkId)}
          >{pin.number}</button>
        </li>
      ))}
    </ol>
  );
}

function Region({ region, limit = 3, activeCheckId, onOpenFix, onSelect, onHover }: {
  region: XrayRegion;
  limit?: number;
  activeCheckId: string;
  onOpenFix: (checkId: string) => void;
  onSelect: (checkId: string) => void;
  onHover: (checkId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const highlighted = Boolean(activeCheckId && region.findingIds.includes(activeCheckId));
  const displayedItems = showAll ? region.items : region.items.slice(0, limit);
  const chooseRegionFinding = () => region.findingIds[0] ? onSelect(region.findingIds[0]) : undefined;
  const focusRegion = () => chooseRegionFinding();
  const blurRegion = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onSelect("");
  };

  return (
    <section
      className={`guest-xray-region guest-xray-region-${region.id}${highlighted ? " is-highlighted" : ""}`}
      data-xray-region={region.id}
      data-assessment={region.assessment}
      onMouseEnter={() => onHover(region.findingIds[0] ?? "")}
      onMouseLeave={() => onHover("")}
      onFocusCapture={focusRegion}
      onBlurCapture={blurRegion}
      aria-labelledby={`xray-region-${region.id}`}
    >
      <div className="guest-xray-region-heading">
        <h3 id={`xray-region-${region.id}`}>{region.label}</h3>
        <span className={`guest-xray-state guest-xray-state-${region.assessment}`}>{assessmentLabels[region.assessment]}</span>
      </div>
      <BoundedText value={region.value} code={region.id === "head-canonical" && /^https?:\/\//i.test(region.value)} />
      {displayedItems.length > 0 && (
        <ul className="guest-xray-observed-list">
          {displayedItems.map((item, index) => (
            <li key={`${region.id}-${index}`}>
              {region.itemLabels[index] && <span className="guest-xray-level">{region.itemLabels[index]}</span>}
              {item.length <= 220 ? <span>{item}</span> : <><span>{item.slice(0, 220).trimEnd()}…</span><details><summary>Read full returned heading</summary><p>{item}</p></details></>}
            </li>
          ))}
        </ul>
      )}
      {region.items.length > limit && (
        <button type="button" className="guest-xray-show-all" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer returned headings" : `Show all ${region.items.length} returned headings`}
        </button>
      )}
      <PinList region={region} onOpenFix={onOpenFix} onSelect={onSelect} />
    </section>
  );
}

export function GuestPageXray({ report, route, onOpenFix, onNavigate }: Props) {
  const findings = findingsViewModel(report);
  const model = useMemo(() => buildXrayModel(report.analysis, findings.prioritized, route.check), [report.analysis, findings.prioritized, route.check]);
  const [focusedCheckId, setFocusedCheckId] = useState(route.check);
  const [hoveredCheckId, setHoveredCheckId] = useState("");
  const [headMetadataOpen, setHeadMetadataOpen] = useState(false);
  const activeCheckId = model.selection.status === "selected" ? model.selection.checkId : hoveredCheckId || focusedCheckId;
  const selectedPriority = model.priorities.find((item) => item.check.id === activeCheckId);
  const activeFinding = selectedPriority?.check ?? null;
  const clearSelection = () => {
    setFocusedCheckId("");
    setHoveredCheckId("");
    onNavigate({ ...route, check: "" }, { focus: "heading" });
  };
  const openAllFixes = () => onNavigate({ ...route, view: "findings", check: "", mode: "review", q: "", status: "all" }, { focus: "heading" });
  const selectFinding = (checkId: string) => setFocusedCheckId(checkId);

  return (
    <section className="guest-report-page guest-page-xray" aria-labelledby="guest-xray-title">
      <header className="guest-xray-page-heading">
        <p className="guest-host">{hostname(report.analysis.final_url)}</p>
        <p className="guest-page-url" data-role="code">{report.analysis.final_url}</p>
        {report.source === "demo" && <span className="guest-sample-label">Fictional local example · no new page request</span>}
        <h1 id="guest-xray-title" tabIndex={-1}>Page X-ray</h1>
        <p className="guest-xray-intro">{model.caption}</p>
      </header>

      <div className="guest-xray-toolbar">
        <button type="button" className="guest-secondary-button" onClick={() => onNavigate({ ...route, view: "overview", check: "" }, { focus: "heading" })}>Back to Summary</button>
        <button type="button" className="guest-text-button" onClick={openAllFixes}>Open Fix list ({findings.openCount} to fix)</button>
      </div>

      {model.selection.status === "unavailable" && (
        <section className="guest-xray-selection-error" role="status" aria-live="polite">
          <p>This finding is not available in the current report.</p>
          <button type="button" className="guest-secondary-button" onClick={clearSelection}>Show all mapped findings</button>
        </section>
      )}

      <div className="guest-xray-layout">
        <div className="guest-xray-specimen" role="group" aria-label="Schematic of returned page structure">
          <div className="guest-xray-document" role="group" aria-label="Schematic page body">
            <Region region={model.regions[0]!} activeCheckId={activeCheckId} onOpenFix={onOpenFix} onSelect={selectFinding} onHover={setHoveredCheckId} />
            <div className="guest-xray-body">
              {model.regions.slice(1, -1).map((region) => (
                <Region key={region.id} region={region} activeCheckId={activeCheckId} onOpenFix={onOpenFix} onSelect={selectFinding} onHover={setHoveredCheckId} />
              ))}
            </div>
            <Region region={model.regions[model.regions.length - 1]!} activeCheckId={activeCheckId} onOpenFix={onOpenFix} onSelect={selectFinding} onHover={setHoveredCheckId} />
          </div>

          <details
            className="guest-xray-head"
            open={headMetadataOpen || Boolean(activeCheckId && model.headMetadata.some((region) => region.findingIds.includes(activeCheckId)))}
            onToggle={(event) => setHeadMetadataOpen(event.currentTarget.open)}
          >
            <summary className="guest-xray-head-summary">
              <span className="guest-xray-head-summary-copy">
                <span id="guest-xray-head-title" className="guest-xray-head-title" role="heading" aria-level={2}>HTML head metadata</span>
                <span>These values describe page metadata, not visible body content.</span>
              </span>
            </summary>
            <div className="guest-xray-head-items">
              {model.headMetadata.map((region) => (
                <Region key={region.id} region={region} activeCheckId={activeCheckId} onOpenFix={onOpenFix} onSelect={selectFinding} onHover={setHoveredCheckId} />
              ))}
            </div>
          </details>
        </div>

        <aside className="guest-xray-details" aria-labelledby="guest-xray-details-title">
          <div className="guest-xray-section-heading">
            <h2 id="guest-xray-details-title">Finding details</h2>
            <p>Choose a numbered mark to open its exact fix.</p>
          </div>
          {activeFinding ? (
            <article className="guest-xray-finding" aria-live="polite">
              <p className="guest-xray-priority-label">Priority {selectedPriority?.number}</p>
              <h3>{activeFinding.finding_title ?? activeFinding.title}</h3>
              {activeFinding.impact && <ImpactTag impact={activeFinding.impact} />}
              <p>{activeFinding.finding_reason ?? activeFinding.recommendation}</p>
              <p><strong>Observed:</strong> {activeFinding.evidence.observed}</p>
              <button type="button" className="guest-primary-button" onClick={() => onOpenFix(activeFinding.id)}>Open this fix</button>
            </article>
          ) : (
            <p className="guest-xray-empty-detail">Focus or point to a marked region to inspect the finding connected to it.</p>
          )}
          {model.unplacedPriorities.length > 0 && (
            <section className="guest-xray-unplaced" aria-labelledby="guest-xray-unplaced-title">
              <h3 id="guest-xray-unplaced-title">Findings without a page location</h3>
              <p>These checks do not identify a specific visible page region.</p>
              <ul>{model.unplacedPriorities.map((item) => (
                <li key={item.check.id}>
                  <span>Priority {item.number}: {item.check.finding_title ?? item.check.title}</span>
                  <button type="button" className="guest-text-button" onClick={() => onOpenFix(item.check.id)}>Open fix</button>
                </li>
              ))}</ul>
            </section>
          )}
        </aside>
      </div>

      <p className="guest-xray-order-note">The vertical order is an interface convention, not a record of the original document order.</p>
    </section>
  );
}
