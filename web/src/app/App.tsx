import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnalysisOverview } from "../features/analysis/AnalysisOverview";
import { FindingDetail } from "../features/analysis/FindingDetail";
import { Findings } from "../features/analysis/Findings";
import { loadLocalFixture, type FixtureBundle } from "../features/analysis/loadFixture";
import { demoReport, type AnalysisReport } from "../features/analysis/report";
import { PageEntry } from "../features/analysis/PageEntry";
import { sampleUrl, type SeoCheck } from "../features/analysis/schema";
import { SignIn } from "../features/auth/SignIn";
import {
  analyzeUrl,
  BrowserApiError,
  getBrowserSession,
  login,
  logout,
  messageForApiError,
  type BrowserSession,
} from "../features/auth/api";
import { findingsParent, routeFromSearch, routeSearch, type AppRoute, type ViewName } from "./route";

type AuthState =
  | { status: "checking"; session: null; message: string }
  | { status: "authenticated"; session: BrowserSession; message: string }
  | { status: "anonymous"; session: null; message: string }
  | { status: "unavailable"; session: null; message: string };
type DemoState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; bundle: FixtureBundle }
  | { state: "error"; message: string };
type FocusRequest = "heading" | "url" | "finding" | "error" | "search" | "username";

function Wordmark({ onOpenEntry }: { onOpenEntry: () => void }) {
  return (
    <a className="wordmark" href="?view=entry" onClick={(event) => { event.preventDefault(); onOpenEntry(); }}>
      <span className="wordmark-seo">SEO</span>
      <span className="wordmark-sensei">Sensei</span>
    </a>
  );
}

function Masthead({ source, username, onOpenEntry, onLogout }: {
  source: string;
  username?: string;
  onOpenEntry: () => void;
  onLogout: () => void;
}) {
  return (
    <header className={username ? "masthead masthead-authenticated" : "masthead"}>
      <Wordmark onOpenEntry={onOpenEntry} />
      <span className="masthead-purpose">Page review</span>
      <span className="masthead-source">{source}</span>
      {username && <span className="masthead-user">{username}</span>}
      {username && <button className="masthead-action" type="button" onClick={onLogout}>Sign out</button>}
    </header>
  );
}

function reportIdentity(report: AnalysisReport) {
  let url: URL | null = null;
  try { url = new URL(report.analysis.final_url); } catch { /* already runtime-validated as text */ }
  return {
    brand: url?.hostname ?? "Analyzed page",
    path: url?.pathname && url.pathname !== "/" ? url.pathname : "/",
  };
}

function ReportContext({ report, onChangePage }: { report: AnalysisReport; onChangePage: () => void }) {
  const identity = reportIdentity(report);
  return (
    <div className="report-context">
      <span className="context-brand">{identity.brand}</span>
      <span className="context-separator" aria-hidden="true">/</span>
      <code className="context-path">{identity.path}</code>
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

function LostLiveReport({ onChangePage }: { onChangePage: () => void }) {
  return (
    <section className="view state-view" aria-labelledby="lost-report-title">
      <p className="eyebrow">Live report not stored</p>
      <h1 id="lost-report-title" tabIndex={-1}>Run the analysis again to reopen this page.</h1>
      <p className="entry-intro">Live results are held in memory only. This address does not identify a saved report, so the previous result is unavailable after reload.</p>
      <button className="button-primary lost-report-action" type="button" onClick={onChangePage}>Return to URL entry</button>
    </section>
  );
}

function LoadingState({ title, message }: { title: string; message: string }) {
  return (
    <section className="entry-shell" aria-labelledby="loading-title">
      <p className="eyebrow">Secure analysis</p>
      <h1 id="loading-title" tabIndex={-1}>{title}</h1>
      <p className="form-message" role="status" aria-live="polite">{message}</p>
    </section>
  );
}

function readRoute() {
  return routeFromSearch(window.location.search);
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(readRoute);
  const [auth, setAuth] = useState<AuthState>({ status: "checking", session: null, message: "Checking the secure sign-in service." });
  const [demo, setDemo] = useState<DemoState>({ state: "idle" });
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [entryValue, setEntryValue] = useState("");
  const [entryError, setEntryError] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const focusRequest = useRef<FocusRequest | null>(null);
  const focusFindingId = useRef("");
  const cameFromFindings = useRef(false);
  const currentRoute = useRef(route);
  const demoLoadActive = useRef(false);
  const reportRef = useRef(report);

  useEffect(() => { reportRef.current = report; }, [report]);

  const navigate = useCallback((next: AppRoute, options: { replace?: boolean; focus?: FocusRequest } = {}) => {
    if (options.focus) focusRequest.current = options.focus;
    const search = routeSearch(next);
    if (options.replace) window.history.replaceState({}, "", search);
    else window.history.pushState({}, "", search);
    currentRoute.current = next;
    setRoute(next);
  }, []);

  const refreshSession = useCallback(async (focus = false, announce = true) => {
    if (announce) setAuth({ status: "checking", session: null, message: "Checking the secure sign-in service." });
    try {
      const session = await getBrowserSession();
      setAuth({ status: "authenticated", session, message: "" });
      if (focus) focusRequest.current = "url";
      return session;
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401 && error.code === "auth_required") {
        setAuth({ status: "anonymous", session: null, message: "No active browser session was found. Sign in to continue." });
        setReport(null);
      } else {
        setAuth({ status: "unavailable", session: null, message: messageForApiError(error) });
      }
      return null;
    }
  }, []);

  const loadDemo = useCallback(async () => {
    if (demoLoadActive.current) return;
    demoLoadActive.current = true;
    setDemo({ state: "loading" });
    try {
      const bundle = await loadLocalFixture();
      setDemo({ state: "ready", bundle });
      focusRequest.current = "heading";
    } catch (error) {
      setDemo({ state: "error", message: error instanceof Error ? error.message : "The bundled local example could not be loaded." });
      focusRequest.current = "error";
    } finally {
      demoLoadActive.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshSession(false, false); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshSession]);

  useEffect(() => {
    if (route.view !== "entry" && route.source === "demo" && demo.state === "idle") {
      const timer = window.setTimeout(() => { void loadDemo(); }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [route.view, route.source, demo.state, loadDemo]);

  useEffect(() => {
    function handlePopState() {
      const previous = currentRoute.current;
      const next = readRoute();
      currentRoute.current = next;
      if (previous.view === "detail" && next.view === "findings") {
        focusRequest.current = "finding";
        focusFindingId.current = previous.check;
      } else if (previous.view !== next.view || previous.source !== next.source) {
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
    if (request === "username") target = document.getElementById("login-username");
    if (request === "finding") {
      target = Array.from(document.querySelectorAll<HTMLElement>("[data-finding-id]"))
        .find((element) => element.dataset.findingId === focusFindingId.current) ?? null;
    }
    if (request === "search") target = document.getElementById("finding-search");
    if (request === "heading" || request === "error") target = document.querySelector("main h1[tabindex='-1']");
    target?.focus();
    focusRequest.current = null;
  }, [route, auth.status, demo, report]);

  const openEntry = () => {
    cameFromFindings.current = false;
    setEntryError("");
    setAnalysisMessage("");
    const currentReport = route.source === "demo" && demo.state === "ready" ? demoReport(demo.bundle) : report;
    if (currentReport) setEntryValue(currentReport.analysis.requested_url);
    navigate({ ...route, view: "entry", source: "live", check: "", q: "", status: "all" }, { focus: "url" });
  };

  const openDemo = () => {
    cameFromFindings.current = false;
    setEntryError("");
    setAnalysisMessage("");
    setEntryValue(sampleUrl);
    setReport(null);
    navigate({ ...route, source: "demo", view: "overview", mode: "review", q: "", status: "all", check: "" }, { focus: "heading" });
  };

  const clearForSignIn = (message: string) => {
    setAuth({ status: "anonymous", session: null, message });
    setReport(null);
    setDemo({ state: "idle" });
    setGlobalMessage("");
    setEntryError("");
    currentRoute.current = { ...currentRoute.current, view: "entry", source: "live", check: "", q: "", status: "all" };
    window.history.replaceState({}, "", routeSearch(currentRoute.current));
    setRoute(currentRoute.current);
    focusRequest.current = "username";
  };

  const signIn = async (username: string, password: string) => {
    try {
      await login(username, password);
      const session = await getBrowserSession();
      setAuth({ status: "authenticated", session, message: "" });
      setGlobalMessage("");
      navigate({ ...route, view: "entry", source: "live", check: "", q: "", status: "all" }, { replace: true, focus: "url" });
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401 && error.code === "auth_required") {
        clearForSignIn(messageForApiError(error));
        return;
      }
      throw new Error(messageForApiError(error), { cause: error });
    }
  };

  const signOut = async () => {
    if (auth.status !== "authenticated") return;
    try {
      await logout(auth.session.csrf_token);
      clearForSignIn("");
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401) {
        clearForSignIn(messageForApiError(error));
      } else {
        setGlobalMessage(messageForApiError(error));
      }
    }
  };

  const runAnalysis = async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) {
      setEntryError("Enter the page address to analyze.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      setEntryError("Enter a complete page address, such as https://site.example/page/.");
      return;
    }
    if (!(parsed.protocol === "https:" || parsed.protocol === "http:") || !parsed.hostname || parsed.username || parsed.password) {
      setEntryError("Enter an HTTP or HTTPS page address without embedded credentials.");
      return;
    }
    if (auth.status !== "authenticated") {
      setEntryError("Sign in before requesting a live analysis.");
      return;
    }

    setEntryError("");
    setAnalysisMessage("");
    setAnalyzing(true);
    try {
      const analysis = await analyzeUrl(value, auth.session.csrf_token);
      const liveReport: AnalysisReport = { source: "live", analysis };
      setReport(liveReport);
      setAnalysisMessage("");
      navigate({ ...route, source: "live", view: "overview", check: "", mode: "review", status: "all", q: "" }, { focus: "heading" });
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401 && error.code === "auth_required") {
        clearForSignIn(messageForApiError(error));
        return;
      }
      if (error instanceof BrowserApiError && error.code === "csrf_rejected") {
        try {
          const refreshed = await getBrowserSession();
          setAuth({ status: "authenticated", session: refreshed, message: "" });
          const explanation = "The server refreshed the session check. Submit the analysis again; no automatic repeat was made.";
          if (reportRef.current) setAnalysisMessage(explanation);
          else setEntryError(explanation);
          return;
        } catch (refreshError) {
          clearForSignIn(messageForApiError(refreshError));
          return;
        }
      }
      const message = messageForApiError(error);
      if (reportRef.current && route.view !== "entry") setAnalysisMessage(message);
      else setEntryError(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const onSubmitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAnalysis(entryValue);
  };

  const reanalyze = () => {
    if (!report || report.source !== "live" || analyzing) return;
    setEntryValue(report.analysis.requested_url);
    void runAnalysis(report.analysis.requested_url);
  };

  const openFinding = (check: SeoCheck, fromFindings = true) => {
    cameFromFindings.current = fromFindings;
    navigate({ ...route, view: "detail", check: check.id }, { focus: "heading" });
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

  let activeReport: AnalysisReport | null = report;
  if (route.source === "demo" && demo.state === "ready") activeReport = demoReport(demo.bundle);
  else if (route.source === "demo") activeReport = null;
  else if (report?.source !== "live") activeReport = null;

  let view: ReactNode;
  if (route.view === "entry") {
    if (auth.status === "checking") {
      view = <LoadingState title="Checking the sign-in service." message={auth.message} />;
    } else if (auth.status !== "authenticated") {
      view = <SignIn available={auth.status === "anonymous"} message={auth.message} onSignIn={signIn}
        onRetry={() => void refreshSession(true)} onOpenDemo={openDemo} />;
    } else {
      view = <PageEntry value={entryValue} setValue={setEntryValue} error={entryError} isAnalyzing={analyzing}
        onSubmit={onSubmitUrl} onOpenDemo={openDemo} />;
    }
  } else if (route.source === "demo" && demo.state === "loading") {
    view = <LoadingState title="Opening the Northstar example." message="Loading the local fixture files. No website request is made." />;
  } else if (route.source === "demo" && demo.state === "error") {
    view = <FixtureRecovery route={route} message={demo.message} onRetry={() => void loadDemo()} onChangePage={openEntry} />;
  } else if (!activeReport && route.source === "live" && auth.status === "checking") {
    view = <LoadingState title="Restoring the secure session." message="The live report is not stored; checking access before returning to URL entry." />;
  } else if (!activeReport && route.source === "live" && auth.status !== "authenticated") {
    view = <SignIn available={auth.status === "anonymous"} message={auth.message || "This live report is not stored. Sign in and run the analysis again."}
      onSignIn={signIn} onRetry={() => void refreshSession(true)} onOpenDemo={openDemo} />;
  } else if (!activeReport && route.source === "live") {
    view = <LostLiveReport onChangePage={openEntry} />;
  } else if (activeReport) {
    const finding = activeReport.analysis.checks.find((check) => check.id === route.check);
    const viewName: ViewName = route.view;
    const pageView = viewName === "overview" ? (
      <AnalysisOverview report={activeReport} reanalysisMessage={analysisMessage} isReanalyzing={analyzing}
        onReanalyze={reanalyze} onFindings={() => changeView(findingsParent(route))}
        onFinding={(id) => { const check = activeReport.analysis.checks.find((item) => item.id === id); if (check) openFinding(check, false); }} />
    ) : viewName === "findings" ? (
      <Findings report={activeReport} route={route} onRouteChange={navigate} onOpenFinding={openFinding} />
    ) : viewName === "detail" && finding ? (
      <FindingDetail report={activeReport} route={route} finding={finding} onBack={returnToFindings}
        onSelect={(check) => navigate({ ...route, check: check.id }, { replace: true, focus: "heading" })} />
    ) : viewName === "detail" ? (
      <section className="view state-view" aria-labelledby="missing-finding-title">
        <p className="eyebrow">Finding unavailable</p>
        <h1 id="missing-finding-title" tabIndex={-1}>This finding is not in the current report.</h1>
        <p className="entry-intro">The route does not identify a check in this in-memory response.</p>
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
        <ReportContext report={activeReport} onChangePage={openEntry} />
        <ReportNavigation route={route} navigate={navigate} checkCount={activeReport.analysis.checks.length} />
        {pageView}
      </>
    );
  } else {
    view = <LoadingState title="Opening the selected report." message="The report is being restored." />;
  }

  const isDemoRoute = route.source === "demo" && route.view !== "entry";
  const headerSource = auth.status === "checking" ? "Checking session"
    : isDemoRoute ? demo.state === "error" ? "Example unavailable" : "Fictional example"
      : route.view === "entry" ? auth.status === "authenticated" ? "Protected analysis" : "Sign in"
        : route.source === "live" ? "Live analysis" : "Report unavailable";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to review</a>
      <Masthead source={headerSource} username={auth.status === "authenticated" ? auth.session.user.username : undefined}
        onOpenEntry={openEntry} onLogout={() => void signOut()} />
      <main id="main-content" className="page-shell" tabIndex={-1}>
        {globalMessage && <p className="report-error" role="alert">{globalMessage}</p>}
        {view}
      </main>
      <footer className="site-footer">
        <span>Evidence first. Interpretation labelled.</span>
        <span>{isDemoRoute ? "This local example makes no website or AI request." : "Live reports are in-memory only; deterministic analysis does not use AI."}</span>
      </footer>
    </>
  );
}

\n