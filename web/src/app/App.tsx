import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnalysisOverview } from "../features/analysis/AnalysisOverview";
import { FindingDetail } from "../features/analysis/FindingDetail";
import { Findings } from "../features/analysis/Findings";
import { loadLocalFixture, type FixtureBundle } from "../features/analysis/loadFixture";
import { PageEntry } from "../features/analysis/PageEntry";
import { sampleUrl, type SeoCheck } from "../features/analysis/schema";
import { findingsParent, routeFromSearch, routeSearch, type AppRoute, type ViewName } from "./route";

type LoadState =
  | { state: "loading" }
  | { state: "ready"; bundle: FixtureBundle }
  | { state: "error"; message: string };
type FocusRequest = "heading" | "url" | "finding" | "error" | "search";

function Wordmark({ onOpenEntry }: { onOpenEntry: () => void }) {
  return (
    <a className="wordmark" href="?view=entry" onClick={(event) => { event.preventDefault(); onOpenEntry(); }}>
      <span className="wordmark-seo">SEO</span>
      <span className="wordmark-sensei">Sensei</span>
    </a>
  );
}

function Masthead({ source, onOpenEntry }: { source: string; onOpenEntry: () => void }) {
  return (
    <header className="masthead">
      <Wordmark onOpenEntry={onOpenEntry} />
      <span className="masthead-purpose">Page review</span>
      <span className="masthead-source">{source}</span>
    </header>
  );
}

function ReportContext({ onChangePage }: { onChangePage: () => void }) {
  return (
      <div className="report-context">
        <span className="context-brand">Northstar Solar</span>
        <span className="context-separator" aria-hidden="true">/</span>
        <code className="context-path">/guides/home-solar/</code>
        <button className="context-change" type="button" onClick={onChangePage}>Change page</button>
      </div>
  );
}

function ReportNavigation({ route, navigate, checkCount }: {
  route: AppRoute;
  navigate: (route: AppRoute, options?: { replace?: boolean; focus?: FocusRequest }) => void;
  checkCount: number;
}) {
  const overview = { ...route, view: "overview" as const, check: "" };
  const findings = findingsParent(route);
  return (
    <nav className="report-nav" aria-label="Report sections">
      <a href={routeSearch(overview)} aria-current={route.view === "overview" ? "page" : undefined}
        onClick={(event) => { event.preventDefault(); navigate(overview, { focus: "heading" }); }}>Overview</a>
      <a href={routeSearch(findings)} aria-current={route.view === "findings" || route.view === "detail" ? "page" : undefined}
        onClick={(event) => { event.preventDefault(); navigate(findings, { focus: "heading" }); }}>
        Findings <span className="nav-count">{checkCount}</span>
      </a>
    </nav>
  );
}

function FixtureRecovery({ route, message, onRetry, onChangePage }: {
  route: AppRoute;
  message: string;
  onRetry: () => void;
  onChangePage: () => void;
}) {
  const directReport = route.view !== "entry";
  return (
    <section className="entry-shell recovery-shell" aria-labelledby="recovery-title">
      <p className="eyebrow">Local example unavailable</p>
      <h1 id="recovery-title" tabIndex={-1}>The sample report could not be opened.</h1>
      <p className="entry-intro">No website was requested. Restore the bundled Northstar example files, then retry.</p>
      <p className="form-message error-message" role="alert">{message}</p>
      <div className="entry-actions">
        <button className="button-primary" type="button" onClick={onRetry}>Try loading the local example again</button>
        {directReport && <button className="button-link" type="button" onClick={onChangePage}>Return to page entry</button>}
      </div>
    </section>
  );
}

function FixtureFooter() {
  return (
    <footer className="site-footer">
      <span>Evidence first. Interpretation labelled.</span>
      <span>This local example makes no website or AI request.</span>
    </footer>
  );
}

function readRoute() {
  return routeFromSearch(window.location.search);
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(readRoute);
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [entryValue, setEntryValue] = useState(sampleUrl);
  const [entryError, setEntryError] = useState("");
  const [recheckMessage, setRecheckMessage] = useState("No recheck has been performed.");
  const [rechecking, setRechecking] = useState(false);
  const focusRequest = useRef<FocusRequest | null>(null);
  const focusFindingId = useRef("");
  const retryRoute = useRef<AppRoute | null>(null);
  const cameFromFindings = useRef(false);
  const currentRoute = useRef(route);
  const recheckTimer = useRef<number | null>(null);

  const navigate = useCallback((next: AppRoute, options: { replace?: boolean; focus?: FocusRequest } = {}) => {
    if (options.focus) focusRequest.current = options.focus;
    const search = routeSearch(next);
    if (options.replace) window.history.replaceState({}, "", search);
    else window.history.pushState({}, "", search);
    currentRoute.current = next;
    setRoute(next);
  }, []);

  const loadFixture = useCallback(async (retry = false) => {
    if (retry) retryRoute.current = currentRoute.current;
    setLoad({ state: "loading" });
    try {
      const bundle = await loadLocalFixture();
      setLoad({ state: "ready", bundle });
      if (retry) focusRequest.current = retryRoute.current?.view === "entry" ? "url" : "heading";
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bundled local example could not be loaded.";
      setLoad({ state: "error", message });
      focusRequest.current = "error";
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadFixture(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFixture]);

  useEffect(() => {
    function handlePopState() {
      const previous = currentRoute.current;
      const next = readRoute();
      currentRoute.current = next;
      if (previous.view === "detail" && next.view === "findings") {
        focusRequest.current = "finding";
        focusFindingId.current = previous.check;
      } else if (previous.view !== next.view) {
        focusRequest.current = "heading";
      }
      setRoute(next);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    let target: HTMLElement | null = null;
    if (request === "url") target = document.getElementById("page-url");
    if (request === "finding") {
      target = Array.from(document.querySelectorAll<HTMLElement>("[data-finding-id]"))
        .find((element) => element.dataset.findingId === focusFindingId.current) ?? null;
    }
    if (request === "search") target = document.getElementById("finding-search");
    if (request === "heading") target = document.querySelector("main h1[tabindex='-1']");
    if (request === "error") target = document.querySelector("main h1[tabindex='-1']");
    target?.focus();
    focusRequest.current = null;
  }, [route, load]);

  useEffect(() => () => {
    if (recheckTimer.current) window.clearTimeout(recheckTimer.current);
  }, []);

  const openEntry = () => {
    cameFromFindings.current = false;
    setEntryError("");
    navigate({ ...route, view: "entry", check: "", q: "", status: "all" }, { focus: "url" });
  };

  const onSubmitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = entryValue.trim();
    if (!value) {
      setEntryError("Enter the Northstar sample address, or choose Open local sample.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      setEntryError("Enter a complete web address, such as https://example.com/page/.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      setEntryError("Only an HTTP or HTTPS address can be checked. No request was made.");
      return;
    }
    const expected = new URL(sampleUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (parsed.origin === expected.origin && normalizedPath === expected.pathname.replace(/\/+$/, "") && !parsed.search && !parsed.hash && !parsed.username && !parsed.password) {
      setEntryError("");
      navigate({ ...route, view: "overview", mode: "review", q: "", status: "all", check: "" }, { focus: "heading" });
      return;
    }
    setEntryError("Live URL analysis is not available in this frontend-only demonstration. This address was not requested.");
  };

  const openSample = () => {
    if (load.state !== "ready") return;
    setEntryValue(sampleUrl);
    setEntryError("");
    navigate({ ...route, view: "overview", mode: "review", q: "", status: "all", check: "" }, { focus: "heading" });
  };

  const openFinding = (check: SeoCheck, fromFindings = true) => {
    cameFromFindings.current = fromFindings;
    const next = { ...route, view: "detail" as const, check: check.id };
    navigate(next, { focus: "heading" });
  };

  const returnToFindings = () => {
    if (cameFromFindings.current && route.view === "detail") {
      focusRequest.current = "finding";
      focusFindingId.current = route.check;
      window.history.back();
      return;
    }
    navigate(findingsParent(route), { replace: true, focus: "heading" });
  };

  const changeView = (next: AppRoute, replace = false) => navigate(next, { replace, focus: "heading" });

  const source = load.state === "loading" ? "Loading local example" : load.state === "error"
    ? "Example unavailable" : route.view === "entry" ? "Local example" : "Fixture report";

  let view: ReactNode;
  if (load.state === "loading") {
    view = (
      <section className="entry-shell" aria-labelledby="loading-title">
        <p className="eyebrow">Local demonstration</p>
        <h1 id="loading-title" tabIndex={-1}>Opening the Northstar example.</h1>
        <p className="form-message" role="status">Loading the bundled fixture files. No website request is made.</p>
      </section>
    );
  } else if (load.state === "error") {
    view = <FixtureRecovery route={route} message={load.message} onRetry={() => void loadFixture(true)} onChangePage={openEntry} />;
  } else if (route.view === "entry") {
    view = <PageEntry value={entryValue} setValue={setEntryValue} error={entryError}
      onSubmit={onSubmitUrl} onOpenSample={openSample} />;
  } else {
    const fixture = load.bundle.fixture;
    const analysis = fixture.analysis;
    const finding = analysis.checks.find((check) => check.id === route.check);
    const viewName: ViewName = route.view;
    const pageView = viewName === "overview" ? (
      <AnalysisOverview fixture={fixture} recheckMessage={recheckMessage} rechecking={rechecking}
        onRecheck={() => {
          if (recheckTimer.current) window.clearTimeout(recheckTimer.current);
          setRechecking(true);
          setRecheckMessage("Showing a local recheck simulation. No request is running.");
          recheckTimer.current = window.setTimeout(() => {
            setRechecking(false);
            setRecheckMessage("No recheck was performed. The illustrative fixture remains unchanged.");
          }, 700);
        }}
        onFindings={() => changeView(findingsParent(route))} onFinding={() => openFinding(analysis.checks.find((item) => item.id === "robots_directives")!, false)} />
    ) : viewName === "findings" ? (
      <Findings fixture={fixture} route={route} onRouteChange={navigate} onOpenFinding={openFinding} />
    ) : viewName === "detail" && finding ? (
      <FindingDetail fixture={fixture} html={load.bundle.html} route={route} finding={finding}
        onBack={returnToFindings} onSelect={(check) => navigate({ ...route, check: check.id }, { replace: true, focus: "heading" })} />
    ) : viewName === "detail" ? (
      <section className="view state-view" aria-labelledby="missing-finding-title">
        <p className="eyebrow">Finding unavailable</p>
        <h1 id="missing-finding-title" tabIndex={-1}>This finding is not in the local example.</h1>
        <p className="entry-intro">The route does not identify one of the fixture’s 23 checks.</p>
        <button className="button-link" type="button" onClick={() => changeView(findingsParent(route))}>Return to findings</button>
      </section>
    ) : (
      <section className="view state-view" aria-labelledby="unknown-view-title">
        <p className="eyebrow">Report view unavailable</p>
        <h1 id="unknown-view-title" tabIndex={-1}>Choose a report view.</h1>
        <button className="button-link" type="button" onClick={() => changeView({ ...route, view: "overview" })}>Open overview</button>
      </section>
    );
    view = (
      <>
        <ReportContext onChangePage={openEntry} />
        <ReportNavigation route={route} navigate={navigate} checkCount={analysis.checks.length} />
        {pageView}
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to review</a>
      <Masthead source={source} onOpenEntry={openEntry} />
      <main id="main-content" className="page-shell" tabIndex={-1}>{view}</main>
      <FixtureFooter />
    </>
  );
}
