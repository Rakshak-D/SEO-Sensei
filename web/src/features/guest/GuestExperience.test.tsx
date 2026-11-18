import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../app/App";
import auditFixture from "../../../public/fixtures/audit.json";
import { routeFromSearch } from "../../app/route";
import { fixtureSchema, liveSeoAnalysisSchema } from "../analysis/schema";
import { findingsViewModel } from "../analysis/findingsViewModel";
import { GuestFixList } from "./GuestFixList";
import { GuestOnPage } from "./GuestOnPage";
import { GuestPageXray } from "./GuestPageXray";
import { GuestPreviews } from "./GuestPreviews";
import { GuestSummary } from "./GuestSummary";
const guestSession = {
  csrf_token: "c".repeat(43),
  expires_in: 3600,
  bot_check_required: false,
  turnstile_sitekey: null,
  turnstile_action: null,
};
const guestAnalysis = {
  requested_url: "https://northstar.example/guides/home-solar/",
  final_url: "https://northstar.example/guides/home-solar/",
  fetch: {
    requested_url: "https://northstar.example/guides/home-solar/",
    final_url: "https://northstar.example/guides/home-solar/",
    status_code: 200,
    content_type: "text/html",
    content_length: 1200,
    bytes_read: 1200,
    redirect_count: 0,
    elapsed_time: 0.2,
    x_robots_tag: null,
  },
  deterministic_score: {
    version: "1.1",
    overall_score: 75,
    points_earned: 75,
    max_points: 100,
    categories: [
      {
        category: "metadata",
        weight: 20,
        points_earned: 15,
        max_points: 20,
        raw_points: 15,
        raw_max_points: 20,
        check_ids: ["meta_description"],
      },
      {
        category: "technical_indexability",
        weight: 30,
        points_earned: 30,
        max_points: 30,
        raw_points: 30,
        raw_max_points: 30,
        check_ids: ["retrieval_success"],
      },
      {
        category: "structured_data",
        weight: 5,
        points_earned: 0,
        max_points: 5,
        raw_points: 0,
        raw_max_points: 5,
        check_ids: ["json_ld"],
      },
      {
        category: "links",
        weight: 10,
        points_earned: 0,
        max_points: 10,
        raw_points: 0,
        raw_max_points: 10,
        check_ids: ["link_relationships"],
      },
    ],
  },
  checks: [
    {
      id: "meta_description",
      category: "metadata",
      title: "Meta description",
      status: "warning",
      points: 0,
      max_points: 10,
      evidence: {
        observed: "No meta description was found in the fetched HTML.",
        value: null,
      },
      recommendation: "Write a concise description that matches the page.",
      impact: "high",
      effort: "quick",
      finding_title: "Add a page description.",
      finding_reason:
        "A short description helps readers understand this page before opening it.",
      fix_snippet:
        '<meta name="description" content="Write a page-specific summary.">',
      snippet_requires_review: true,
      is_actionable: true,
      optional_note: null,
      exclusion_reason: null,
      anatomy_part: "description",
    },
    {
      id: "retrieval_success",
      category: "technical_indexability",
      title: "HTML retrieval",
      status: "pass",
      points: 10,
      max_points: 10,
      evidence: {
        observed: "The server returned an HTML document.",
        value: 200,
      },
      recommendation: "No action is required.",
      impact: null,
      effort: null,
      finding_title: null,
      finding_reason: null,
      fix_snippet: null,
      snippet_requires_review: false,
      is_actionable: false,
      optional_note: null,
      exclusion_reason: null,
    },
    {
      id: "json_ld",
      category: "structured_data",
      title: "Structured data",
      status: "warning",
      points: 0,
      max_points: 5,
      evidence: {
        observed: "No JSON-LD was found in the fetched HTML.",
        value: 0,
      },
      recommendation: "No action is required for this optional feature.",
      impact: null,
      effort: null,
      finding_title: null,
      finding_reason: null,
      fix_snippet: null,
      snippet_requires_review: false,
      is_actionable: false,
      optional_note: "Structured data is optional for this page.",
      exclusion_reason:
        "Missing optional structured data is not a confirmed defect.",
    },
    {
      id: "link_relationships",
      category: "links",
      title: "Link relationships",
      status: "not_applicable",
      points: 0,
      max_points: 1,
      evidence: {
        observed: "No relationship details were available.",
        value: null,
      },
      recommendation: "No action is required.",
      impact: null,
      effort: null,
      finding_title: null,
      finding_reason: null,
      fix_snippet: null,
      snippet_requires_review: false,
      is_actionable: false,
      optional_note: null,
      exclusion_reason: null,
    },
  ],
  metadata: {
    title: "A guide to home solar planning",
    title_length: 33,
    title_count: 1,
    description: "A practical guide to planning a home solar project.",
    description_length: 52,
    canonical: "https://northstar.example/guides/home-solar/",
    canonical_resolved: "https://northstar.example/guides/home-solar/",
    canonical_relationship: "valid_same_host",
    robots_directives: [],
    language: "en",
    viewport: "width=device-width, initial-scale=1",
    charset: "utf-8",
    mixed_content_reference_count: 0,
  },
  headings: {
    h1: ["Plan a home solar project"],
    h2: ["Compare installation plans", "Prepare questions for an installer"],
    h3: [],
    empty_heading_count: 0,
    hierarchy_jumps: [],
  },
  images: { total: 1, with_alt: 1, missing_alt: 0, empty_alt: 0, alt_coverage_percent: 100, nonempty_alt: 1, empty_alt_intent_unknown: 0 },
  links: { total: 2, internal: 2, external: 0, empty_anchors: 0, nofollow: 0, sponsored: 0, ugc: 0 },
  structured_data: { block_count: 0, valid_blocks: 0, malformed_blocks: 0, types: [] },
  hreflang: { links: [], malformed_count: 0 },
  social_metadata: {
    og_title: null,
    og_description: null,
    og_image: null,
    og_url: null,
    twitter_card: null,
    twitter_title: null,
    twitter_description: null,
    twitter_image: null,
  },
  lexical_signals: { visible_word_count: 241, frequent_terms: [{ term: "solar", count: 8 }] },
  findings_summary: {
    total_checks: 4,
    raw_passes: 1,
    raw_warnings: 2,
    raw_failures: 0,
    raw_not_applicable: 1,
    actionable_count: 1,
    optional_note_count: 1,
    by_impact: { blocking: 0, high: 1, medium: 0, low: 0 },
    by_effort: { quick: 1, moderate: 0, larger_job: 0 },
    prioritized_check_ids: ["meta_description"],
    verdict: "Add a page description before sharing this page.",
    exclusions: [
      {
        check_id: "json_ld",
        status: "warning",
        reason: "Missing optional structured data is not a confirmed defect.",
      },
    ],
  },
};
function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function demoReportWithHeadings(h1: string[] | undefined) {
  const fixture = fixtureSchema.parse(structuredClone(auditFixture));
  if (h1 === undefined) {
    delete fixture.analysis.headings;
  } else {
    fixture.analysis.headings = { ...fixture.analysis.headings!, h1 };
  }
  return { source: "demo", analysis: fixture.analysis, fixture, html: "" } as const;
}

function guestReport(overrides: Record<string, unknown> = {}) {
  const fixture = fixtureSchema.parse(structuredClone(auditFixture));
  const analysis = liveSeoAnalysisSchema.parse({ ...fixture.analysis, ...overrides });
  return { source: "guest" as const, analysis };
}

function guestV11Report(overrides: Record<string, unknown> = {}) {
  const analysis = liveSeoAnalysisSchema.parse({ ...structuredClone(guestAnalysis), ...overrides });
  return { source: "guest" as const, analysis };
}

function renderSummary(report: ReturnType<typeof demoReportWithHeadings>) {
  return render(
    <GuestSummary
      report={report}
      onSeeFix={vi.fn()}
      onReviewAll={vi.fn()}
      onOpenXray={vi.fn()}
    />,
  );
}
function installGuestServices(
  options: {
    challenge?: boolean;
    challengeAction?: string;
    analysisStatus?: number;
  } = {},
) {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const session = {
    ...guestSession,
    bot_check_required: options.challenge ?? false,
    turnstile_sitekey: options.challenge ? "1x00000000000000000000AA" : null,
    turnstile_action: options.challenge ? options.challengeAction ?? "s2_public_audit" : null,
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/guest/v1/session") return response(session);
      if (url === "/api/guest/v1/analyse-url") {
        if (options.analysisStatus && options.analysisStatus !== 200) {
          return response(
            {
              error: {
                code: "guest_session_required",
                message: "private server detail",
                request_id: "guest-test",
              },
            },
            options.analysisStatus,
          );
        }
        return response(guestAnalysis);
      }
      if (url.endsWith("/fixtures/audit.json")) return response(auditFixture);
      if (url.endsWith("/fixtures/northstar-solar.html"))
        return new Response(
          '<html><head><meta name="robots" content="noindex, follow"></head></html>',
        );
      throw new Error(`Unexpected guest test request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
describe("public guest audit journey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: undefined,
    });
  });
  it("shows public URL entry without credentials and renders only the validated v1.1 response", async () => {
    const { calls } = installGuestServices();
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Check a web page for SEO problems.",
      }),
    ).toBeVisible();
    expect(document.querySelector("script[data-guest-turnstile]")).toBeNull();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Page address"),
      "https://northstar.example/guides/home-solar/",
    );
    await user.click(screen.getByRole("button", { name: "Check page" }));
    expect(
      await screen.findByRole("heading", { name: "Summary" }),
    ).toBeVisible();
    expect(screen.getByTestId("report-verdict")).toHaveTextContent(
      "Add a page description before sharing this page.",
    );
    expect(screen.getByTestId("summary-count-line")).toHaveTextContent(
      "1 to fix · 1 passed · 1 not applicable",
    );
    expect(screen.getByText("1 optional note")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Add a page description." }),
    ).toBeVisible();
    expect(calls.map((call) => call.url)).toEqual([
      "/api/guest/v1/session",
      "/api/guest/v1/analyse-url",
    ]);
    const request = calls[1]!;
    expect(request.init?.headers).toEqual({
      Accept: "application/json",
      "X-CSRF-Token": guestSession.csrf_token,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(request.init?.body))).toEqual({
      url: "https://northstar.example/guides/home-solar/",
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "See the fix" }));
    expect(
      await screen.findByRole("heading", { name: "Fix list" }),
    ).toBeVisible();
    expect(screen.getByTestId("findings-count-line")).toHaveTextContent(
      "1 to fix",
    );
    expect(
      screen.getByRole("button", {
        name: "Add a page description. High Quick",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Editable template, not your real copy."),
    ).toBeVisible();
  });
  it("opens observed X-ray regions and returns each numbered pin to its matching fix", async () => {
    installGuestServices();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Check a web page for SEO problems." });
    await user.type(screen.getByLabelText("Page address"), "https://northstar.example/guides/home-solar/");
    await user.click(screen.getByRole("button", { name: "Check page" }));
    await screen.findByRole("heading", { name: "Summary" });
    expect(screen.getByRole("region", { name: "HTML X-ray" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open Page X-ray" }));

    expect(await screen.findByRole("heading", { name: "Page X-ray" })).toBeVisible();
    expect(window.location.search).toContain("view=xray");
    expect(window.location.search).toContain("source=guest");
    expect(window.location.search).not.toContain("northstar.example");
    await user.click(screen.getByText("HTML head metadata"));
    expect(screen.getByText("A guide to home solar planning")).toBeVisible();
    expect(screen.getByText("Plan a home solar project")).toBeVisible();
    expect(screen.getByText("241 visible words found.")).toBeVisible();
    expect(screen.getByText("Not assessed. No header or navigation content was returned.")).toBeVisible();
    expect(screen.getByText("Not assessed. No footer content was returned.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Page X-ray" })).toHaveAttribute("aria-current", "page");

    const pin = screen.getByRole("button", { name: "Priority 1: Add a page description.; open matching fix" });
    await user.click(pin);
    expect(await screen.findByRole("heading", { name: "Fix list" })).toBeVisible();
    expect(window.location.search).toContain("view=findings");
    expect(window.location.search).toContain("check=meta_description");
    expect(screen.getByRole("button", { name: "Add a page description. High Quick" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Show on X-ray" }));
    expect(await screen.findByRole("heading", { name: "Page X-ray" })).toBeVisible();
    expect(window.location.search).toContain("check=meta_description");
    expect(screen.getByRole("button", { name: "Priority 1: Add a page description.; open matching fix" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Add a page description." })).toBeVisible();
  });
  it("copies only the server-provided snippet and reports success only when clipboard write succeeds", async () => {
    installGuestServices();
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clipboard unavailable"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);
    try {
      await screen.findByRole("heading", {
        name: "Check a web page for SEO problems.",
      });
      await user.type(
        screen.getByLabelText("Page address"),
        "https://northstar.example/guides/home-solar/",
      );
      await user.click(screen.getByRole("button", { name: "Check page" }));
      await screen.findByRole("heading", { name: "Summary" });
      await user.click(screen.getByRole("button", { name: "See the fix" }));
      await user.click(
        await screen.findByRole("button", { name: "Copy snippet" }),
      );
      expect(writeText).toHaveBeenNthCalledWith(
        1,
        '<meta name="description" content="Write a page-specific summary.">',
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Snippet copied.",
      );
      await user.click(screen.getByRole("button", { name: "Copy snippet" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Select the snippet to copy it manually.",
      );
      expect(screen.queryByText("Snippet copied.")).not.toBeInTheDocument();
    } finally {
      if (previousClipboard)
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  it("does not fabricate a live result when guest endpoints are unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url === "/api/guest/v1/session" ||
        url === "/api/guest/v1/analyse-url"
      )
        return new Response("Not found", { status: 404 });
      if (url.endsWith("/fixtures/audit.json")) return response(auditFixture);
      if (url.endsWith("/fixtures/northstar-solar.html"))
        return new Response(
          '<html><head><meta name="robots" content="noindex, follow"></head></html>',
        );
      throw new Error("Unexpected request in unavailable guest test: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Check a web page for SEO problems.",
      }),
    ).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Guest audits are not available",
    );
    expect(screen.queryByTestId("report-verdict")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/guest/"),
      ),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Example: Northstar Solar" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Example: Northstar Solar" }),
    );
    expect(await screen.findByText(/Fictional local example/)).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/guest/"),
      ),
    ).toHaveLength(1);
  });
  it("keeps challenge tokens in memory, submits once, and does not repeat an expired-session audit", async () => {
    const { calls } = installGuestServices({
      challenge: true,
      challengeAction: "s2_public_audit",
      analysisStatus: 401,
    });
    let callbacks:
      | Parameters<NonNullable<Window["turnstile"]>["render"]>[1]
      | null = null;
    const api = {
      ready: (callback: () => void) => callback(),
      render: vi.fn(
        (
          _container: HTMLElement,
          options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1],
        ) => {
          callbacks = options;
          return "widget-test";
        },
      ),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: api,
    });
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(api.render.mock.calls[0]?.[1].action).toBe("s2_public_audit");
    expect(calls[0]?.url).toBe("/api/guest/v1/session");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(callbacks).not.toBeNull();
    callbacks!.callback("one-use-challenge");
    await user.type(
      screen.getByLabelText("Page address"),
      "https://northstar.example/guides/home-solar/",
    );
    await user.click(screen.getByRole("button", { name: "Check page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your guest session expired",
    );
    expect(
      calls.filter((call) => call.url === "/api/guest/v1/analyse-url"),
    ).toHaveLength(1);
    const body = JSON.parse(
      String(
        calls.find((call) => call.url === "/api/guest/v1/analyse-url")?.init
          ?.body,
      ),
    );
    expect(body).toEqual({
      url: "https://northstar.example/guides/home-solar/",
      challenge_token: "one-use-challenge",
    });
    expect(calls.some((call) => call.url.startsWith("/api/browser/v1"))).toBe(
      false,
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(
      calls.filter((call) => call.url === "/api/guest/v1/analyse-url"),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Refresh guest session" }),
    );
    await waitFor(() =>
      expect(
        calls.filter((call) => call.url === "/api/guest/v1/session"),
      ).toHaveLength(2),
    );
    expect(
      calls.filter((call) => call.url === "/api/guest/v1/analyse-url"),
    ).toHaveLength(1);
    unmount();
    expect(api.remove).toHaveBeenCalled();
  });
  it("cancels browser waiting and ignores a late response without resubmitting", async () => {
    let completeAnalysis!: (value: Response) => void;
    let markAnalysisStarted!: () => void;
    const analysisStarted = new Promise<void>((resolveStarted) => {
      markAnalysisStarted = resolveStarted;
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/guest/v1/session")
        return response(guestSession);
      if (String(input) === "/api/guest/v1/analyse-url") {
        markAnalysisStarted();
        return new Promise<Response>((resolveAnalysis) => {
          completeAnalysis = resolveAnalysis;
        });
      }
      throw new Error("Unexpected cancellation test request.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      await screen.findByLabelText("Page address"),
      "https://northstar.example/guides/home-solar/",
    );
    await user.click(screen.getByRole("button", { name: "Check page" }));
    await analysisStarted;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText(
        /the server may still be processing the request/i,
      ),
    ).toBeVisible();
    completeAnalysis(response(guestAnalysis));
    await waitFor(() =>
      expect(screen.queryByTestId("report-verdict")).not.toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/guest/v1/analyse-url",
      ),
    ).toHaveLength(1);
  });

  it("shows distinct assessed, unassessed, and observed H1 values in the rendered Summary preview", () => {
    const missing = renderSummary(demoReportWithHeadings(undefined));
    expect(within(screen.getByTestId("xray-preview")).getByText("H1 not assessed.")).toBeVisible();
    missing.unmount();

    const empty = renderSummary(demoReportWithHeadings([]));
    const emptyPreview = screen.getByTestId("xray-preview");
    expect(within(emptyPreview).getByText("No H1 found in the fetched HTML.")).toBeVisible();
    expect(emptyPreview).not.toHaveTextContent(/\bClear\b/);
    empty.unmount();

    const emptyXray = render(
      <GuestPageXray
        report={demoReportWithHeadings([])}
        route={routeFromSearch("?view=xray&source=demo&access=guest")}
        onOpenFix={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    const emptyH1Region = screen.getByRole("region", { name: "Primary heading (H1)" });
    expect(emptyH1Region).toHaveAttribute("data-assessment", "not_found");
    expect(within(emptyH1Region).getByText("Not found")).toBeVisible();
    expect(emptyH1Region).not.toHaveTextContent(/\bClear\b/);
    emptyXray.unmount();

    renderSummary(demoReportWithHeadings(["Observed primary heading"]));
    expect(within(screen.getByTestId("xray-preview")).getByText("Observed primary heading")).toBeVisible();
  });

  it("previews only the first returned H1 while the full X-ray retains every returned heading", () => {
    const report = demoReportWithHeadings(["First observed H1", "Second observed H1"]);
    const summary = renderSummary(report);
    const preview = screen.getByTestId("xray-preview");
    expect(within(preview).getByText("First observed H1")).toBeVisible();
    expect(within(preview).queryByText("Second observed H1")).not.toBeInTheDocument();
    summary.unmount();

    render(
      <GuestPageXray
        report={report}
        route={routeFromSearch("?view=xray&source=demo&access=guest")}
        onOpenFix={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("First observed H1")).toBeVisible();
    expect(screen.getByText("Second observed H1")).toBeVisible();
  });

  it("keeps the existing Summary and Fix-list actionable counts for the same report", () => {
    const report = demoReportWithHeadings([]);
    const summary = renderSummary(report);
    expect(screen.getByTestId("summary-count-line")).toHaveTextContent("4 to fix");
    summary.unmount();

    render(
      <GuestFixList
        report={report}
        route={routeFromSearch("?view=findings&source=demo&access=guest")}
        onNavigate={vi.fn()}
        onShowOnXray={vi.fn()}
      />,
    );
    expect(screen.getByTestId("findings-count-line")).toHaveTextContent("4 to fix");
  });

  it("resolves routed, keyboard-focused, and hovered findings without mixing details", async () => {
    const user = userEvent.setup();
    const report = demoReportWithHeadings(["Observed H1"]);
    const route = routeFromSearch("?view=xray&source=demo&access=guest&check=robots_directives");
    const onOpenFix = vi.fn();
    const onNavigate = vi.fn();
    const view = (nextRoute: ReturnType<typeof routeFromSearch>) => (
      <>
        <GuestPageXray report={report} route={nextRoute} onOpenFix={onOpenFix} onNavigate={onNavigate} />
        <button type="button">Outside mapped regions</button>
      </>
    );
    const { rerender } = render(view(route));
    const robotsPin = screen.getByRole("button", { name: /Priority 1: Robots directives/ });
    const openGraphPin = screen.getByRole("button", { name: /Open Graph metadata/ });
    const twitterPin = screen.getByRole("button", { name: /Twitter metadata/ });
    const details = document.querySelector<HTMLElement>(".guest-xray-finding")!;
    const robotsRegion = document.querySelector<HTMLElement>('[data-xray-region="head-robots"]')!;
    const sharingRegion = document.querySelector<HTMLElement>('[data-xray-region="head-sharing"]')!;

    expect(within(details).getByText("Robots directives are reported")).toBeVisible();
    expect(robotsRegion).toHaveClass("is-highlighted");

    robotsPin.focus();
    await user.tab();
    expect(openGraphPin).toHaveFocus();
    expect(within(details).getByText("Open Graph metadata is reported")).toBeVisible();
    expect(within(details).getByText("Priority 3")).toBeVisible();
    expect(sharingRegion).toHaveClass("is-highlighted");
    expect(robotsRegion).not.toHaveClass("is-highlighted");

    await user.tab();
    expect(twitterPin).toHaveFocus();
    expect(within(details).getByText("Twitter metadata is reported")).toBeVisible();
    expect(within(details).getByText("Priority 4")).toBeVisible();

    await user.hover(robotsPin);
    expect(twitterPin).toHaveFocus();
    expect(within(details).getByText("Robots directives are reported")).toBeVisible();
    expect(robotsRegion).toHaveClass("is-highlighted");
    expect(sharingRegion).not.toHaveClass("is-highlighted");

    await user.unhover(robotsPin);
    expect(twitterPin).toHaveFocus();
    expect(within(details).getByText("Twitter metadata is reported")).toBeVisible();
    expect(sharingRegion).toHaveClass("is-highlighted");
    expect(robotsRegion).not.toHaveClass("is-highlighted");

    await user.click(screen.getByRole("button", { name: "Outside mapped regions" }));
    expect(within(details).getByText("Robots directives are reported")).toBeVisible();
    expect(robotsRegion).toHaveClass("is-highlighted");
    expect(sharingRegion).not.toHaveClass("is-highlighted");

    twitterPin.focus();
    rerender(view(routeFromSearch("?view=xray&source=demo&access=guest&check=open_graph")));
    expect(within(details).getByText("Open Graph metadata is reported")).toBeVisible();
    expect(within(details).getByText("Priority 3")).toBeVisible();
    expect(sharingRegion).toHaveClass("is-highlighted");
    expect(robotsRegion).not.toHaveClass("is-highlighted");
  });

  it("keeps an unknown routed check unavailable during pointer interaction", async () => {
    const user = userEvent.setup();
    const report = demoReportWithHeadings(["Observed H1"]);
    const route = routeFromSearch("?view=xray&source=demo&access=guest&check=unknown_check");
    const onNavigate = vi.fn();
    render(
      <GuestPageXray report={report} route={route} onOpenFix={vi.fn()} onNavigate={onNavigate} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("This finding is not available in the current report.");
    await user.hover(screen.getByRole("button", { name: /Priority 1: Robots directives/ }));
    expect(screen.getByRole("status")).toHaveTextContent("This finding is not available in the current report.");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Robots directives are reported")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all mapped findings" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ check: "" }), { focus: "heading" });
  });

  it("renders observed On-page fields and opens the exact canonical fix", async () => {
    const user = userEvent.setup();
    const report = guestV11Report();
    const onSeeFix = vi.fn();
    render(<GuestOnPage report={report} onSeeFix={onSeeFix} />);

    expect(screen.getByRole("heading", { name: "On-page content" })).toBeVisible();
    expect(screen.getByText(report.analysis.metadata!.title!)).toBeVisible();
    expect(screen.getByText(report.analysis.headings!.h1[0]!)).toBeVisible();
    expect(screen.getByTestId("onpage-count-line")).toHaveTextContent(`${findingsViewModel(report).openCount} to fix`);
    const descriptionFinding = report.analysis.checks.find((check) => check.id === "meta_description")!;
    const descriptionRow = document.querySelector<HTMLElement>('[data-related-check="meta_description"]')!;
    await user.click(within(descriptionRow).getByRole("button", { name: "See the fix" }));
    expect(onSeeFix).toHaveBeenCalledWith(descriptionFinding.id);
  });

  it("renders unassessed and assessed-empty states in the actual On-page view", () => {
    const unassessed = guestReport({ metadata: undefined, headings: undefined, lexical_signals: undefined });
    const first = render(<GuestOnPage report={unassessed} onSeeFix={vi.fn()} />);
    expect(screen.getAllByText("Page metadata not assessed in this report.")).toHaveLength(2);
    expect(screen.getByText("Headings not assessed.")).toBeVisible();
    expect(screen.getByText("Visible content not assessed in this report.")).toBeVisible();
    first.unmount();

    const empty = guestReport({
      metadata: { title: "", description: "" },
      headings: { h1: [], h2: [], h3: [], empty_heading_count: 0, hierarchy_jumps: [] },
      lexical_signals: { visible_word_count: 0, frequent_terms: [] },
    });
    render(<GuestOnPage report={empty} onSeeFix={vi.fn()} />);
    expect(screen.getByText("No page title found in the fetched HTML.")).toBeVisible();
    expect(screen.getByText("No meta description found in the fetched HTML.")).toBeVisible();
    expect(screen.getByText("No H1 found in the fetched HTML.")).toBeVisible();
    expect(screen.getByText("No visible text was found in the fetched HTML.")).toBeVisible();
  });

  it("renders metadata-only Previews and routes related social fixes by check ID", async () => {
    const user = userEvent.setup();
    const report = guestV11Report({
      metadata: { title: "Returned HTML title", description: "Returned HTML description" },
      social_metadata: {
        og_title: "Returned OG title", og_description: "Returned OG description", og_url: "https://northstar.example/share",
        og_image: "https://northstar.example/remote-image.png", twitter_card: "summary", twitter_title: "Returned X title",
        twitter_description: "Returned X description", twitter_image: null,
      },
    });
    const onSeeFix = vi.fn();
    render(<GuestPreviews report={report} onSeeFix={onSeeFix} />);

    expect(screen.getByRole("heading", { name: "Search and social previews" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Returned HTML title" })).toBeVisible();
    expect(screen.getByText("Returned HTML description")).toBeVisible();
    expect(screen.getAllByText("Returned OG title")).toHaveLength(2);
    expect(screen.getByText("Returned X title")).toBeVisible();
    expect(screen.getByText("summary", { selector: ".guest-x-preview dd span" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "LinkedIn-style sharing illustration" })).toBeVisible();
    expect(screen.getByText(/Search engines may display something different/)).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    const descriptionRow = document.querySelector<HTMLElement>('[data-related-check="meta_description"]')!;
    await user.click(within(descriptionRow).getByRole("button", { name: "See the fix" }));
    expect(onSeeFix).toHaveBeenCalledWith("meta_description");
  });

  it("does not substitute page text when social metadata was not assessed", () => {
    const report = guestReport({
      metadata: { title: "Do not use as social fallback", description: "Do not copy this into an OG field" },
      social_metadata: undefined,
    });
    render(<GuestPreviews report={report} onSeeFix={vi.fn()} />);
    expect(screen.getAllByText("Open Graph title not assessed in this report.")).toHaveLength(2);
    expect(screen.queryByText("Do not use as social fallback", { selector: ".guest-og-preview *" })).not.toBeInTheDocument();
    expect(screen.queryByText("No Open Graph title returned.")).not.toBeInTheDocument();
  });

  it("renders script-like metadata as text in previews", () => {
    const payload = "<script>window.__seoSenseiInjected = true</script>";
    const report = guestReport({
      metadata: { title: payload, description: "Safe text" },
      social_metadata: {
        og_title: payload, og_description: "Safe text", og_url: "javascript:alert(1)", og_image: null,
        twitter_card: "summary", twitter_title: payload, twitter_description: "Safe text", twitter_image: null,
      },
    });
    const { container } = render(<GuestPreviews report={report} onSeeFix={vi.fn()} />);

    expect(screen.getAllByText(payload)).toHaveLength(4);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(window).not.toHaveProperty("__seoSenseiInjected");
    expect(screen.getAllByText("javascript:alert(1)")).toHaveLength(2);
  });

  it("routes a guest report through both specialist pages and into the exact Fix-list row", async () => {
    installGuestServices();
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Page address"), "https://northstar.example/guides/home-solar/");
    await user.click(screen.getByRole("button", { name: "Check page" }));
    await screen.findByRole("heading", { name: "Summary" });

    await user.click(screen.getByRole("link", { name: "On-page" }));
    expect(await screen.findByRole("heading", { name: "On-page content" })).toHaveFocus();
    expect(window.location.search).toBe("?view=on-page&source=guest");

    await user.click(screen.getByRole("link", { name: "Previews" }));
    expect(await screen.findByRole("heading", { name: "Search and social previews" })).toHaveFocus();
    expect(window.location.search).toBe("?view=previews&source=guest");

    const descriptionCheck = document.querySelector<HTMLElement>('[data-related-check="meta_description"]')!;
    await user.click(within(descriptionCheck).getByRole("button", { name: "See the fix" }));
    expect(await screen.findByRole("heading", { name: "Fix list" })).toBeVisible();
    expect(window.location.search).toContain("view=findings");
    expect(window.location.search).toContain("check=meta_description");
    const descriptionFinding = document.querySelector<HTMLElement>('[data-finding-id="meta_description"]')!;
    expect(descriptionFinding).toHaveAttribute("aria-expanded", "true");
    expect(descriptionFinding).toHaveFocus();
  });
});
