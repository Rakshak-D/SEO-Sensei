import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { routeSearch, type AppRoute } from "../../app/route";

type Props = {
  route: AppRoute;
  openCount: number;
  hasReport: boolean;
  children: ReactNode;
  onNavigate: (route: AppRoute, options?: { focus?: "heading" | "xray" | "finding" }) => void;
  onNewAudit: () => void;
  onOperator: () => void;
};

const sections = [
  { title: "Overview", items: ["Summary", "Fix list", "Page X-ray"] },
  { title: "Checks", items: ["Technical", "On-page", "Links and images", "Structured data", "Speed"] },
  { title: "Share", items: ["Previews"] },
  { title: "Other", items: ["History"] },
];

function routeFor(item: string, current: AppRoute): AppRoute | null {
  if (item === "Summary") return { ...current, view: "overview", check: "" };
  if (item === "Fix list") return { ...current, view: "findings", check: "" };
  if (item === "Page X-ray") return { ...current, view: "xray", check: "" };
  if (item === "On-page") return { ...current, view: "on-page", check: "" };
  if (item === "Previews") return { ...current, view: "previews", check: "" };
  return null;
}

function PageLink({ item, route, openCount, onNavigate }: {
  item: string;
  route: AppRoute;
  openCount: number;
  onNavigate: Props["onNavigate"];
}) {
  const target = routeFor(item, route);
  if (!target) return <span className="guest-nav-disabled" aria-disabled="true">{item}<small>Coming later</small></span>;
  const active = item === "Summary"
    ? route.view === "overview"
    : item === "Fix list"
      ? route.view === "findings" || route.view === "detail"
      : item === "Page X-ray" ? route.view === "xray"
        : item === "On-page" ? route.view === "on-page"
          : item === "Previews" && route.view === "previews";
  return (
    <a className="guest-nav-link" href={routeSearch(target)} aria-current={active ? "page" : undefined}
      onClick={(event) => { event.preventDefault(); onNavigate(target, { focus: item === "Page X-ray" ? "xray" : "heading" }); }}>
      <span>{item}</span>
      {(item === "Summary" || item === "Fix list") && <span className="guest-nav-count" aria-label={`${openCount} open problems`}>{openCount}</span>}
    </a>
  );
}

export function GuestNavigation({ route, openCount, hasReport, children, onNavigate, onNewAudit, onOperator }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const summary = { ...route, view: "overview" as const, check: "" };
  const fixes = { ...route, view: "findings" as const, check: "" };
  const xray = { ...route, view: "xray" as const, check: "" };

  useEffect(() => {
    if (!moreOpen) return;
    dialog.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        moreTrigger.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (document.activeElement === dialog.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen]);

  const closeMore = (restoreFocus = true) => {
    setMoreOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => moreTrigger.current?.focus());
  };

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeMore();
  };

  return (
    <>
      <header className="guest-topbar">
        <a href="/?view=entry" className="guest-wordmark" onClick={(event) => { event.preventDefault(); onNewAudit(); }} aria-label="SEO Sensei, new audit">
          <span>SEO</span><strong>Sensei</strong>
        </a>
        <div className="guest-top-actions">
          <button type="button" className="guest-secondary-button guest-new-audit" onClick={onNewAudit} aria-label="New audit">
            <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false"><path d="M10 4v12M4 10h12" /></svg>
            <span className="guest-new-audit-label">New audit</span>
          </button>
          <button type="button" className="guest-text-button guest-operator-link" onClick={onOperator}>Operator sign in</button>
        </div>
      </header>

      <div className={hasReport ? "guest-app-layout has-report" : "guest-app-layout"}>
        {hasReport && (
          <aside className="guest-sidebar" aria-label="Report navigation">
            <button type="button" className="guest-primary-button guest-sidebar-new" onClick={onNewAudit}>New audit</button>
            {sections.map((section) => (
              <section key={section.title} className="guest-sidebar-section" aria-labelledby={`guest-nav-${section.title.toLowerCase()}`}>
                <h2 id={`guest-nav-${section.title.toLowerCase()}`}>{section.title}</h2>
                <ul>{section.items.map((item) => <li key={item}><PageLink item={item} route={route} openCount={openCount} onNavigate={onNavigate} /></li>)}</ul>
              </section>
            ))}
          </aside>
        )}

        <main id="main-content" className={hasReport ? "guest-main has-report-main" : "guest-main"} tabIndex={-1}>
          {children}
        </main>

        {hasReport && (
          <nav className="guest-mobile-tabs" aria-label="Report navigation">
            <a href={routeSearch(summary)} aria-current={route.view === "overview" ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); onNavigate(summary, { focus: "heading" }); }}>
              <span>Summary</span><small>{openCount}</small>
            </a>
            <a href={routeSearch(fixes)} aria-current={route.view === "findings" || route.view === "detail" ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); onNavigate(fixes, { focus: "heading" }); }}>
              <span>Fix list</span><small>{openCount}</small>
            </a>
            <a href={routeSearch(xray)} aria-current={route.view === "xray" ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); onNavigate(xray, { focus: "xray" }); }}>
              <span>X-ray</span>
            </a>
            <button type="button" ref={moreTrigger} aria-expanded={moreOpen} aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>More</button>
          </nav>
        )}
      </div>

      {moreOpen && (
        <div className="guest-more-backdrop" onMouseDown={handleBackdrop}>
          <div className="guest-more-sheet" role="dialog" aria-modal="true" aria-labelledby="guest-more-title" tabIndex={-1} ref={dialog}>
            <div className="guest-more-heading"><h2 id="guest-more-title">Pages</h2><button type="button" className="guest-text-button" onClick={() => closeMore()}>Close</button></div>
            {sections.map((section) => (
              <section key={section.title} aria-labelledby={`guest-more-${section.title.toLowerCase()}`}>
                <h3 id={`guest-more-${section.title.toLowerCase()}`}>{section.title}</h3>
                <ul>{section.items.map((item) => {
                  const target = routeFor(item, route);
                  if (!target) return <li key={item}><button type="button" className="guest-more-disabled" disabled aria-disabled="true">{item}<span>Coming later</span></button></li>;
                  const active = item === "Summary" ? route.view === "overview"
                    : item === "Fix list" ? route.view === "findings" || route.view === "detail"
                      : item === "Page X-ray" ? route.view === "xray"
                        : item === "On-page" ? route.view === "on-page"
                          : item === "Previews" && route.view === "previews";
                  return <li key={item}><a href={routeSearch(target)} aria-current={active ? "page" : undefined} onClick={(event) => { event.preventDefault(); onNavigate(target, { focus: item === "Page X-ray" ? "xray" : "heading" }); closeMore(false); }}>{item}</a></li>;
                })}</ul>
              </section>
            ))}
            <button type="button" className="guest-more-operator" onClick={() => { closeMore(false); onOperator(); }}>Operator sign in</button>
          </div>
        </div>
      )}
    </>
  );
}
