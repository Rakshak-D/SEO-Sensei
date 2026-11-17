import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../app/App";
import auditFixture from "../../../public/fixtures/audit.json";
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
  metadata: { title: "A guide to home solar planning" },
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
});
