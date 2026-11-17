import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGuestUrl, getGuestSession, GuestApiError, isSupportedPageUrl } from "./api";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const session = {
  csrf_token: "c".repeat(43),
  expires_in: 3600,
  bot_check_required: false,
  turnstile_sitekey: null,
  turnstile_action: null,
};

const analysis = {
  requested_url: "https://example.test/article/",
  final_url: "https://example.test/article/",
  fetch: {
    requested_url: "https://example.test/article/", final_url: "https://example.test/article/", status_code: 200,
    content_type: "text/html", content_length: 1200, bytes_read: 1200, redirect_count: 0, elapsed_time: 0.2, x_robots_tag: null,
  },
  deterministic_score: { version: "1.1", overall_score: 80, points_earned: 80, max_points: 100, categories: [] },
  checks: [],
  metadata: { title: "Example page" },
  findings_summary: {
    total_checks: 0, raw_passes: 0, raw_warnings: 0, raw_failures: 0, raw_not_applicable: 0,
    actionable_count: 0, optional_note_count: 0, by_impact: { blocking: 0, high: 0, medium: 0, low: 0 },
    by_effort: { quick: 0, moderate: 0, larger_job: 0 }, prioritized_check_ids: [], verdict: "Nothing to fix in these checks.", exclusions: [],
  },
};

describe("guest API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bootstraps the cookie-backed session without reading or sending an identity", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => { void input; void init; return json(session); });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGuestSession()).resolves.toEqual(session);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/guest/v1/session");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("sends only the guest URL, optional challenge token, and session CSRF header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => { void input; void init; return json(analysis); });
    vi.stubGlobal("fetch", fetchMock);

    await analyzeGuestUrl("https://example.test/article/", session.csrf_token, "one-use-challenge-token");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/guest/v1/analyse-url");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://example.test/article/", challenge_token: "one-use-challenge-token" });
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "X-CSRF-Token": session.csrf_token,
      "Content-Type": "application/json",
    });
  });

  it("omits a challenge field when bootstrap says no challenge is required", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => { void input; void init; return json(analysis); });
    vi.stubGlobal("fetch", fetchMock);
    await analyzeGuestUrl("https://example.test/article/", session.csrf_token);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ url: "https://example.test/article/" });
  });

  it("rejects an invalid challenge bootstrap and an incompatible analysis response", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ ...session, bot_check_required: true, turnstile_sitekey: null }))
      .mockResolvedValueOnce(json({ requested_url: "https://example.test/" })));

    await expect(getGuestSession()).rejects.toMatchObject({ code: "contract_error" });
    await expect(analyzeGuestUrl("https://example.test/", session.csrf_token)).rejects.toMatchObject({ code: "contract_error" });
  });

  it.each([
    { bot_check_required: true, turnstile_sitekey: "public-sitekey", turnstile_action: null },
    { bot_check_required: true, turnstile_sitekey: "public-sitekey", turnstile_action: "bad action" },
    { bot_check_required: true, turnstile_sitekey: "public-sitekey" },
    { bot_check_required: false, turnstile_sitekey: null, turnstile_action: "guest_analysis" },
  ])("rejects an incomplete or inconsistent Turnstile action contract", async (challengeFields) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...session, ...challengeFields })));
    await expect(getGuestSession()).rejects.toMatchObject({ code: "contract_error" });
    vi.unstubAllGlobals();
  });

  it("retains the backend-configured public action unchanged", async () => {
    const configuredAction = "s2_public_audit";
    vi.stubGlobal("fetch", vi.fn(async () => json({
      ...session,
      bot_check_required: true,
      turnstile_sitekey: "public-sitekey",
      turnstile_action: configuredAction,
    })));

    await expect(getGuestSession()).resolves.toMatchObject({
      bot_check_required: true,
      turnstile_action: configuredAction,
    });
  });

  it("shows bounded retry guidance from a 429 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "rate_limited", message: "internal", request_id: "req-safe" } }, 429, { "Retry-After": "45" })));
    await expect(getGuestSession()).rejects.toMatchObject({
      code: "rate_limited", status: 429, retryAfterSeconds: 45, message: expect.stringContaining("45 seconds"),
    });
  });

  it("accepts only HTTP or HTTPS URLs without embedded credentials", () => {
    expect(isSupportedPageUrl("https://example.test/a" )).toBe(true);
    expect(isSupportedPageUrl("http://example.test/a" )).toBe(true);
    expect(isSupportedPageUrl("ftp://example.test/a" )).toBe(false);
    const credentialUrl = ["https:/", "/user:pass@example.test/a"].join("");
    expect(isSupportedPageUrl(credentialUrl)).toBe(false);
    expect(isSupportedPageUrl("not a url" )).toBe(false);
  });

  it("keeps API failures sanitized instead of echoing server text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "destination_blocked", message: "private IP value", request_id: "req-safe" } }, 422)));
    try {
      await analyzeGuestUrl("https://example.test/", session.csrf_token);
      throw new Error("Expected the API call to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(GuestApiError);
      expect((error as Error).message).not.toContain("private IP");
      expect((error as GuestApiError).message).toContain("publicly reachable");
    }
  });
});
