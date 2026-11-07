import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import auditFixture from "../../public/fixtures/audit.json";
import { App } from "./App";

const sourceHtml = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "  <head>",
  "    <meta charset=\"utf-8\">",
  "    <meta name=\"robots\" content=\"noindex, follow\">",
  "  </head>",
  "</html>",
].join("\n");

type MockOptions = {
  unavailable?: boolean;
  initiallyAuthenticated?: boolean;
  initialUsername?: string;
  analysis?: unknown;
  analysisResponses?: Array<Promise<Response>>;
  sessionResponses?: Array<Promise<Response> | null>;
  firstFixtureFailure?: boolean;
  fixture?: unknown;
  analysisStatus?: number;
  analysisCode?: string;
  retryAfter?: string;
  loginStatus?: number;
  loginCode?: string;
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function apiError(code: string, status: number, retryAfter?: string) {
  return json({ error: { code, message: "safe server message", request_id: "test-request-1" } }, status,
    retryAfter ? { "Retry-After": retryAfter } : {});
}

function mockServices(options: MockOptions = {}) {
  let authenticated = options.initiallyAuthenticated ?? false;
  let username = options.initialUsername ?? "reviewer";
  let sessionNumber = 0;
  let csrfToken = "c".repeat(43);
  let auditCount = 0;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/browser/v1/session") {
      const pendingSessionResponse = options.sessionResponses?.shift();
      if (pendingSessionResponse) return pendingSessionResponse;
      if (options.unavailable) return new Response("Not Found", { status: 404 });
      if (!authenticated) return apiError("auth_required", 401);
      return json({ authenticated: true, user: { username }, csrf_token: csrfToken });
    }
    if (url === "/api/browser/v1/session/login") {
      if (options.loginStatus && options.loginStatus !== 200) return apiError(options.loginCode ?? "rate_limited", options.loginStatus, options.retryAfter);
      const body = JSON.parse(String(init?.body)) as { username: string; password: string };
      if (!body.username || body.password !== "correct horse battery staple") return apiError("auth_invalid", 401);
      authenticated = true;
      username = body.username;
      sessionNumber += 1;
      csrfToken = String.fromCharCode(96 + sessionNumber).repeat(43);
      return json({ authenticated: true, user: { username } });
    }
    if (url === "/api/browser/v1/session/logout") {
      if (init?.headers && (init.headers as Record<string, string>)["X-CSRF-Token"] !== csrfToken) return apiError("csrf_rejected", 403);
      authenticated = false;
      return json({ authenticated: false });
    }
    if (url === "/api/browser/v1/analyse-url") {
      const pendingAnalysisResponse = options.analysisResponses?.shift();
      if (pendingAnalysisResponse) return pendingAnalysisResponse;
      if (options.analysisStatus && options.analysisStatus !== 200) return apiError(options.analysisCode ?? "resource_unavailable", options.analysisStatus, options.retryAfter);
      return json(options.analysis ?? auditFixture.analysis);
    }
    if (url === "/fixtures/audit.json") {
      auditCount += 1;
      if (options.firstFixtureFailure && auditCount === 1) return new Response("Unavailable", { status: 404 });
      return json(options.fixture ?? auditFixture);
    }
    if (url === "/fixtures/northstar-solar.html") return new Response(options.fixture ? sourceHtml : sourceHtml, { status: 200 });
    throw new Error(`Unexpected network request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls, getSessionToken: () => csrfToken };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function analysisWithTitle(title: string) {
  const analysis = structuredClone(auditFixture.analysis);
  analysis.metadata.title = title;
  return analysis;
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function openDemo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Open local example" }));
  await screen.findByRole("heading", { name: "Robots directives are reported" });
}

async function openLiveEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Username"), "reviewer");
  await user.type(await screen.findByLabelText("Password"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Inspect what a page returns." });
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.type(await screen.findByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Inspect what a page returns." });
}

describe("Evidence Ledger authenticated application", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("shows a truthful unavailable state when browser authentication is disabled", async () => {
    mockServices({ unavailable: true });
    render(<App />);
    expect(await screen.findByText(/Live analysis is unavailable/)).toBeVisible();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open local example" })).toBeVisible();
  });

  it("opens the explicit local demo and keeps its noindex fixture ahead of the score", async () => {
    mockServices({ unavailable: true });
    const user = userEvent.setup();
    render(<App />);
    await openDemo(user);
    expect(screen.getByText(/Fictional local example · static HTML fixture/)).toBeVisible();
    expect(screen.getByText("Detected directives: noindex, follow.")).toBeVisible();
    expect(screen.getByText(/Weighted heuristic/)).toBeVisible();
    expect(screen.getByText(/Not a Google ranking or index score/)).toBeVisible();
    expect(screen.getByText(/Fixture transport context · illustrative/)).toBeVisible();
    expect(screen.getByText(/no AI provider request was made/)).toBeVisible();
    expect(screen.getByText("92 / 100")).toBeVisible();
  });

  it("orders review results and keeps all 23 fixture checks in their response order", async () => {
    mockServices({ unavailable: true });
    window.history.replaceState({}, "", "/?view=findings&source=demo&mode=review");
    render(<App />);
    await screen.findByRole("heading", { name: "Findings investigation" });
    const reviewList = document.querySelector(".finding-groups")!;
    expect(Array.from(reviewList.querySelectorAll("[data-finding-id]")).map((row) => row.getAttribute("data-finding-id")))
      .toEqual(["robots_directives", "visible_text", "open_graph", "twitter_metadata"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 4 review checks");

    await userEvent.setup().click(screen.getByRole("link", { name: /All checks/ }));
    const allChecks = await screen.findByRole("list", { name: "All analyzer checks in fixture order" });
    expect(within(allChecks).getAllByRole("listitem")).toHaveLength(23);
    expect(within(allChecks).getByRole("link", { name: /Rule status: Not applicable/ })).toBeInTheDocument();
    expect(allChecks.querySelector("[data-finding-id='retrieval_success']"))
      .toBe(allChecks.querySelectorAll("[data-finding-id]")[0]);
  });

  it("intersects search and status and restores the filtered list after detail navigation", async () => {
    mockServices({ unavailable: true });
    window.history.replaceState({}, "", "/?view=findings&source=demo&mode=review");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Findings investigation" });
    await user.type(screen.getByRole("searchbox", { name: "Search findings" }), "twitter");
    await user.selectOptions(screen.getByLabelText("Rule status"), "warning");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 review checks");
    await user.click(screen.getByRole("link", { name: /Twitter metadata/ }));
    expect(await screen.findByRole("heading", { name: "Twitter metadata is reported" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: /Back to findings/ }));
    await screen.findByRole("heading", { name: "Findings investigation" });
    expect(screen.getByRole("searchbox", { name: "Search findings" })).toHaveValue("twitter");
    expect(screen.getByLabelText("Rule status")).toHaveValue("warning");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 review checks");
  });

  it("keeps fixture excerpts clearly fictional and renders hostile strings as text", async () => {
    const hostile = structuredClone(auditFixture);
    const robots = hostile.analysis.checks.find((check) => check.id === "robots_directives")!;
    robots.evidence.observed = "Detected noindex. <img src=x onerror=alert(1)>";
    mockServices({ unavailable: true, fixture: hostile });
    window.history.replaceState({}, "", "/?view=detail&source=demo&mode=review&check=robots_directives");
    render(<App />);
    expect(await screen.findByText(robots.evidence.observed)).toBeVisible();
    expect(screen.getByText(/Static HTML · fictional fixture/)).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("recovers from a missing fixture on a direct demo route", async () => {
    mockServices({ unavailable: true, firstFixtureFailure: true });
    window.history.replaceState({}, "", "/?view=overview&source=demo");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try loading the local example again" }));
    expect(await screen.findByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  });

  it("rejects malformed fixture data with a recoverable state", async () => {
    mockServices({ unavailable: true, fixture: { fixture_notice: "truncated" } });
    window.history.replaceState({}, "", "/?view=findings&source=demo&mode=all");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("unexpected shape or status count");
  });

  it("authenticates, sends URL-only JSON with CSRF, and renders a variable-count live response", async () => {
    const live = structuredClone(auditFixture.analysis);
    live.requested_url = "https://example.org/new-path/";
    live.final_url = "https://example.org/new-path/";
    live.metadata.title = "A different page title";
    live.checks = [
      { ...live.checks[0]!, id: "retrieval_success", title: "HTML retrieval succeeded", status: "pass", evidence: { observed: "HTTP response was 200.", value: 200 } },
    ];
    live.deterministic_score.overall_score = 100;
    const services = mockServices({ analysis: live });
    const user = userEvent.setup();
    render(<App />);
    await openLiveEntry(user);
    await user.type(screen.getByLabelText("Page address"), "https://example.org/new-path/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));

    expect(await screen.findByRole("heading", { name: "A different page title" })).toBeVisible();
    expect(screen.getByText("No failed rules in this response.")).toBeVisible();
    expect(screen.getByText("100 / 100")).toBeVisible();
    expect(screen.getByText(/Observed fetch context/)).toBeVisible();
    expect(screen.queryByText(/Northstar Solar/)).not.toBeInTheDocument();
    const analysisCall = services.calls.find((call) => call.url === "/api/browser/v1/analyse-url")!;
    expect(analysisCall.init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(analysisCall.init?.body))).toEqual({ url: "https://example.org/new-path/" });
    expect((analysisCall.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe(services.getSessionToken());
    expect(analysisCall.init?.headers).not.toHaveProperty("Origin");
  });

  it("keeps live provenance in evidence detail and excludes fixture-only notes", async () => {
    const live = structuredClone(auditFixture.analysis);
    live.checks = [live.checks.find((check) => check.id === "robots_directives")!];
    const { calls } = mockServices({ initiallyAuthenticated: true, analysis: live });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), live.requested_url);
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await user.click(await screen.findByRole("button", { name: "Review 1 checks" }));
    await user.click(await screen.findByRole("link", { name: /Robots directives are reported/ }));
    expect(await screen.findByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
    expect(screen.getByText(/Analyzer-returned checks\[\]\.evidence\.observed/i)).toBeVisible();
    expect(screen.getByText(/deterministic analyzer classified/)).toBeVisible();
    expect(screen.queryByText(/fictional fixture/)).not.toBeInTheDocument();
    expect(screen.getByText(/Suggested · not applied/)).toBeVisible();
    expect(screen.getByText(/SEO Sensei has not changed the page/)).toBeVisible();
    expect(calls.some((call) => call.url.includes("northstar.example"))).toBe(false);
  });

  it("shows an incompatible live response as an error without loading the local example", async () => {
    const { fetchMock } = mockServices({ initiallyAuthenticated: true, analysis: { requested_url: "https://example.org/" } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server returned an analysis result this application cannot safely display");
    expect(screen.queryByText(/Northstar Solar/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/fixtures/"))).toBe(false);
  });

  it("shows server 429 guidance and keeps the previous live report after failed reanalysis", async () => {
    const { calls } = mockServices({ initiallyAuthenticated: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/article/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await screen.findByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" });

    const analysisCalls = calls.filter((call) => call.url === "/api/browser/v1/analyse-url");
    expect(analysisCalls).toHaveLength(1);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementationOnce(async (input) => {
      if (String(input) === "/api/browser/v1/analyse-url") return apiError("rate_limited", 429, "120");
      return new Response("Unexpected request", { status: 500 });
    });
    await user.click(screen.getByRole("button", { name: "Analyze again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait approximately 2 minutes");
    expect(screen.getByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" })).toBeVisible();
  });

  it("shows an entry error for a failed new page analysis without loading fixture data", async () => {
    const { fetchMock } = mockServices({ initiallyAuthenticated: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/first/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await screen.findByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" });

    fetchMock.mockImplementationOnce(async (input) => {
      if (String(input) === "/api/browser/v1/analyse-url") return apiError("resource_unavailable", 502);
      throw new Error("Unexpected request during failed reanalysis test.");
    });
    await user.click(screen.getByRole("button", { name: "Change page" }));
    const pageField = screen.getByLabelText("Page address");
    await user.clear(pageField);
    await user.type(pageField, "https://example.org/second/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The page could not be fetched");
    expect(screen.queryByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Northstar Solar/)).not.toBeInTheDocument();
  });

  it("uses generic credential failure and a separate origin rejection message", async () => {
    const services = mockServices();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Username");
    await user.type(screen.getByLabelText("Username"), "reviewer");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The username or password is incorrect.");
    expect(services.calls.filter((call) => call.url === "/api/browser/v1/session/login")).toHaveLength(1);
  });

  it("describes sign-in throttling separately from analysis throttling", async () => {
    mockServices({ loginStatus: 429, loginCode: "rate_limited", retryAfter: "75" });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Username"), "reviewer");
    await user.type(screen.getByLabelText("Password"), "incorrect but bounded");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in attempts are temporarily rate-limited. Wait approximately 2 minutes");
  });

  it("clears in-memory report state on logout", async () => {
    mockServices({ initiallyAuthenticated: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await screen.findByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Username")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Home Solar Installation: Planning Guide | Northstar" })).not.toBeInTheDocument();
  });

  it("discards an analysis completed after logout and cannot reopen it through a live route", async () => {
    const pending = deferred<Response>();
    const services = mockServices({ initiallyAuthenticated: true, analysisResponses: [pending.promise] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/race/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await waitFor(() => expect(services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Username")).toBeVisible();
    await act(async () => {
      pending.resolve(json(analysisWithTitle("Obsolete result after logout")));
      await pending.promise;
      await flushMicrotasks();
    });

    expect(screen.getByLabelText("Username")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Obsolete result after logout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => {
      window.history.pushState({}, "", "/?view=overview&source=live");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByLabelText("Username")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Obsolete result after logout" })).not.toBeInTheDocument();
  });

  it.each([
    { label: "a different user", username: "user-b" },
    { label: "a new session for the same username", username: "user-a" },
  ])("isolates pending results across logout and reauthentication as $label", async ({ username }) => {
    const oldResponse = deferred<Response>();
    const currentTitle = `${username} current session report`;
    const services = mockServices({
      initiallyAuthenticated: true,
      initialUsername: "user-a",
      analysisResponses: [oldResponse.promise, Promise.resolve(json(analysisWithTitle(currentTitle)))],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/shared-url/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await waitFor(() => expect(services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByLabelText("Username");
    await signInAs(user, username);
    expect(screen.getByLabelText("Page address")).toBeVisible();

    await user.type(screen.getByLabelText("Page address"), "https://example.org/shared-url/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    expect(await screen.findByRole("heading", { name: currentTitle })).toBeVisible();
    await act(async () => {
      oldResponse.resolve(json(analysisWithTitle("User A obsolete result")));
      await oldResponse.promise;
      await flushMicrotasks();
    });

    expect(screen.getByRole("heading", { name: currentTitle })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "User A obsolete result" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { label: "401 auth_required", status: 401, code: "auth_required" },
    { label: "403 csrf_rejected", status: 403, code: "csrf_rejected" },
    { label: "429 rate_limited", status: 429, code: "rate_limited" },
    { label: "network failure", status: 0, code: "network" },
  ])("ignores a stale $label after a newer session is established", async ({ status, code }) => {
    const oldResponse = deferred<Response>();
    const currentTitle = "User B protected report";
    const services = mockServices({
      initiallyAuthenticated: true,
      initialUsername: "user-a",
      analysisResponses: [oldResponse.promise, Promise.resolve(json(analysisWithTitle(currentTitle)))],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/race-error/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await waitFor(() => expect(services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByLabelText("Username");
    await signInAs(user, "user-b");
    await user.type(screen.getByLabelText("Page address"), "https://example.org/race-error/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    expect(await screen.findByRole("heading", { name: currentTitle })).toBeVisible();

    if (code === "network") {
      await act(async () => {
        oldResponse.reject(new TypeError("late network failure"));
        await oldResponse.promise.catch(() => undefined);
        await flushMicrotasks();
      });
    } else {
      await act(async () => {
        oldResponse.resolve(apiError(code, status, code === "rate_limited" ? "120" : undefined));
        await oldResponse.promise;
        await flushMicrotasks();
      });
    }

    expect(screen.getByRole("heading", { name: currentTitle })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(services.calls.filter((call) => call.url === "/api/browser/v1/session")).toHaveLength(2);
  });

  it("discards an in-flight CSRF session bootstrap after logout and reauthentication", async () => {
    const oldRefresh = deferred<Response>();
    const services = mockServices({
      initiallyAuthenticated: true,
      initialUsername: "user-a",
      analysisResponses: [
        Promise.resolve(apiError("csrf_rejected", 403)),
        Promise.resolve(json(analysisWithTitle("User B report"))),
      ],
      sessionResponses: [
        null,
        oldRefresh.promise,
        null,
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inspect what a page returns." });
    await user.type(screen.getByLabelText("Page address"), "https://example.org/csrf-race/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    await waitFor(() => expect(services.calls.filter((call) => call.url === "/api/browser/v1/session")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByLabelText("Username");
    await signInAs(user, "user-b");
    await user.type(screen.getByLabelText("Page address"), "https://example.org/csrf-race/");
    await user.click(screen.getByRole("button", { name: "Analyze page" }));
    expect(await screen.findByRole("heading", { name: "User B report" })).toBeVisible();

    await act(async () => {
      oldRefresh.resolve(json({ authenticated: true, user: { username: "user-a" }, csrf_token: "z".repeat(43) }));
      await oldRefresh.promise;
      await flushMicrotasks();
    });
    expect(screen.getByText("user-b")).toBeVisible();
    expect(screen.getByRole("heading", { name: "User B report" })).toBeVisible();
    expect(screen.queryByText(/server refreshed the session check/i)).not.toBeInTheDocument();
    expect(services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Analyze again" }));
    await waitFor(() => expect(services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url")).toHaveLength(3));
    const latestAnalysis = services.calls.filter((call) => call.url === "/api/browser/v1/analyse-url").at(-1)!;
    expect((latestAnalysis.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe(services.getSessionToken());
  });
});
