import { useEffect, useState } from "react";
import type { AnalysisReport } from "../analysis/report";
import type { FindingImpact, SeoCheck } from "../analysis/schema";
import { findingsViewModel } from "../analysis/findingsViewModel";
import { ImpactTag } from "../../components/StatusTag";
import type { AppRoute } from "../../app/route";

type Filter = "all" | "blocking" | "high" | "quick";
type Props = {
  report: AnalysisReport;
  route: AppRoute;
  onNavigate: (route: AppRoute, options?: { replace?: boolean; focus?: "heading" | "finding" }) => void;
};

const filterLabels: Record<Filter, string> = {
  all: "All",
  blocking: "Blocking",
  high: "High",
  quick: "Quick wins",
};

const groupLabels: Array<{ title: string; impacts: FindingImpact[] }> = [
  { title: "Do first", impacts: ["blocking", "high"] },
  { title: "Next", impacts: ["medium"] },
  { title: "Later", impacts: ["low"] },
];

function matchesFilter(check: SeoCheck, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "quick") return check.effort === "quick";
  return check.impact === filter;
}

export function GuestFixList({ report, route, onNavigate }: Props) {
  const model = findingsViewModel(report);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState(route.check);
  const [copyMessage, setCopyMessage] = useState("");
  const filtered = model.prioritized.filter((check) => matchesFilter(check, filter));

  useEffect(() => {
    if (!route.check) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(route.check)}"]`)?.focus());
  }, [route.check]);

  const copySnippet = async (check: SeoCheck) => {
    if (!check.fix_snippet) return;
    try {
      await navigator.clipboard.writeText(check.fix_snippet);
      setCopyMessage("Snippet copied.");
    } catch {
      setCopyMessage("Copy is unavailable in this browser. Select the snippet to copy it manually.");
    }
  };

  const openFinding = (check: SeoCheck) => {
    setCopyMessage("");
    setExpandedId((current) => current === check.id ? "" : check.id);
  };

  return (
    <section className="guest-report-page guest-fix-list" aria-labelledby="guest-fix-title">
      <header className="guest-report-heading">
        <p className="guest-summary-kicker">Your page review</p>
        <h1 id="guest-fix-title" tabIndex={-1}>Fix list</h1>
        <p>Work through the open findings in the order the server prioritized them.</p>
        {report.source === "demo" && <span className="guest-sample-label">Fictional local example · no new page request</span>}
      </header>

      <p className="guest-fix-count" data-testid="findings-count-line"><strong>{model.openCount} to fix</strong></p>
      <div className="guest-filters" role="group" aria-label="Filter fixes">
        {(Object.keys(filterLabels) as Filter[]).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setCopyMessage(""); }}>
            {filterLabels[value]}
          </button>
        ))}
      </div>

      {copyMessage && <p className="guest-copy-feedback" role="status" aria-live="polite">{copyMessage}</p>}

      {groupLabels.map((group) => {
        const checks = filtered.filter((check) => check.impact && group.impacts.includes(check.impact));
        if (!checks.length) return null;
        return (
          <section className="guest-fix-group" key={group.title} aria-labelledby={`guest-group-${group.title.replaceAll(" ", "-").toLowerCase()}`}>
            <div className="guest-section-heading"><h2 id={`guest-group-${group.title.replaceAll(" ", "-").toLowerCase()}`}>{group.title}</h2><span>{checks.length}</span></div>
            <ul>
              {checks.map((check) => {
                const expanded = expandedId === check.id;
                return (
                  <li className="guest-fix-row" key={check.id}>
                    <button
                      type="button"
                      className="guest-fix-toggle"
                      aria-expanded={expanded}
                      aria-controls={`fix-details-${check.id}`}
                      data-finding-id={check.id}
                      onClick={() => openFinding(check)}
                    >
                      <span className="guest-fix-title">{check.finding_title ?? check.title}</span>
                      {check.impact && <ImpactTag impact={check.impact} />}
                      {check.effort && <span className="guest-effort-tag">{check.effort === "larger_job" ? "Larger job" : check.effort === "moderate" ? "Moderate" : "Quick"}</span>}
                      <span className="guest-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                    </button>
                    {expanded && (
                      <div className="guest-fix-details" id={`fix-details-${check.id}`}>
                        <p><strong>Why:</strong> {check.finding_reason ?? check.recommendation}</p>
                        <p><strong>Observed:</strong> {check.evidence.observed}</p>
                        <p><strong>Next step:</strong> {check.recommendation}</p>
                        {check.fix_snippet ? (
                          <div className="guest-snippet-block">
                            {check.snippet_requires_review && <p className="guest-template-note">Editable template, not your real copy.</p>}
                            <pre><code data-role="code">{check.fix_snippet}</code></pre>
                            <button type="button" className="guest-secondary-button" onClick={() => void copySnippet(check)}>Copy snippet</button>
                          </div>
                        ) : <p className="guest-no-snippet">The response does not include a safe copyable snippet for this finding.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {filtered.length === 0 && <p className="guest-empty-fixes">No open findings match this filter.</p>}
      {model.optionalNotes.length > 0 && (
        <details className="guest-optional-notes"><summary>{model.optionalNotes.length} optional {model.optionalNotes.length === 1 ? "note" : "notes"}</summary>
          <ul>{model.optionalNotes.map((check) => <li key={check.id}>{check.optional_note}</li>)}</ul>
        </details>
      )}
      <button className="guest-text-button guest-back-summary" type="button" onClick={() => onNavigate({ ...route, view: "overview", check: "" }, { focus: "heading" })}>Back to Summary</button>
    </section>
  );
}
