import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
const evidenceDirectory = resolve(process.cwd(), "review/s2-a");
mkdirSync(evidenceDirectory, { recursive: true });
const warningUrl = "https://phase2d.test/pages/warnings";
const noindexUrl = "https://phase2d.test/pages/noindex";
const allPassUrl = "https://phase2d.test/pages/all-pass";
async function capture(page: Page, filename: string) {
  await page.screenshot({
    path: resolve(evidenceDirectory, filename),
    animations: "disabled",
  });
}
async function submit(page: Page, url: string) {
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/guest/v1/analyse-url") &&
      request.method() === "POST",
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/guest/v1/analyse-url") &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Page address").fill(url);
  await page.getByRole("button", { name: "Check page" }).click();
  const [request, response] = await Promise.all([
    requestPromise,
    responsePromise,
  ]);
  expect(response.status()).toBe(200);
  return {
    request,
    response,
    analysis: (await response.json()) as Record<string, unknown>,
  };
}
function requestContract(request: Request, expectedUrl: string) {
  const headers = request.headers();
  expect(Boolean(headers["x-csrf-token"])).toBe(true);
  expect(
    Object.keys(headers).some((name) => name.toLowerCase() === "authorization"),
  ).toBe(false);
  expect(request.postDataJSON()).toEqual({ url: expectedUrl });
}
test("renders the guest journey and maps controlled HTTPS analyses through the Page X-ray", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  const appOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const browserApiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin) externalRequests.push(url.origin);
    if (url.pathname.startsWith("/api/browser/v1"))
      browserApiRequests.push(url.pathname);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const bootstrapResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/guest/v1/session"),
  );
  const documentResponse = await page.goto("/");
  const bootstrapResponse = await bootstrapResponsePromise;
  await expect(
    page.getByRole("heading", { name: "Check a web page for SEO problems." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check page" })).toBeEnabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => location.protocol === "https:" && window.isSecureContext,
    ),
  ).toBe(true);
  const csp = documentResponse?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(csp).toContain("frame-src https://challenges.cloudflare.com");
  expect(csp).toContain("connect-src 'self'");
  expect(csp.includes("unsafe-inline") || csp.includes("unsafe-eval")).toBe(
    false,
  );
  expect(bootstrapResponse.headers()["cache-control"]?.toLowerCase()).toContain(
    "no-store",
  );
  const guestCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-seo_sensei_guest",
  );
  expect(
    Boolean(
      guestCookie &&
        guestCookie.httpOnly &&
        guestCookie.secure &&
        guestCookie.sameSite === "Lax" &&
        guestCookie.path === "/",
    ),
  ).toBe(true);
  const setCookie = bootstrapResponse.headers()["set-cookie"] ?? "";
  expect(setCookie.includes("Domain=")).toBe(false);
  expect(
    await page.evaluate(() =>
      document.cookie.includes("__Host-seo_sensei_guest"),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  ).toBe(true);
  const browserVersion = await browser.version();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await capture(page, "home-desktop-1440x900.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "New audit" })).toBeVisible();
  await capture(page, "home-mobile-390x844.png");
  let releaseAnalysis!: () => void;
  const analysisGate = new Promise<void>((resolveGate) => {
    releaseAnalysis = resolveGate;
  });
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    await analysisGate;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const warningRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/guest/v1/analyse-url") &&
      request.method() === "POST",
  );
  const warningResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/guest/v1/analyse-url") &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Page address").fill(warningUrl);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(
    page.getByText("Waiting for the audit service to return a report."),
  ).toBeVisible();
  await capture(page, "guest-loading-1440x900.png");
  releaseAnalysis();
  const [normalRequest, normalResponse] = await Promise.all([
    warningRequest,
    warningResponse,
  ]);
  expect(normalResponse.status()).toBe(200);
  const normal = (await normalResponse.json()) as {
    deterministic_score: {
      version: string;
    };
    checks: unknown[];
    findings_summary: {
      actionable_count: number;
      verdict: string;
    };
  };
  requestContract(normalRequest, warningUrl);
  expect(normal.deterministic_score.version).toBe("1.1");
  expect(normal.checks).toHaveLength(23);
  expect(normal.findings_summary.actionable_count).toBeGreaterThanOrEqual(2);
  await page.unroute("**/api/guest/v1/analyse-url");
  await expect(
    page.getByRole("heading", { name: "Summary" }),
  ).toBeVisible();
  await expect(page.getByTestId("report-verdict")).toHaveText(
    normal.findings_summary.verdict,
  );
  await expect(page.getByTestId("report-verdict")).toHaveCSS(
    "color",
    "rgb(20, 19, 15)",
  );
  const normalCount = normal.findings_summary.actionable_count;
  await expect(page.getByTestId("summary-count-line")).toContainText(
    normalCount + " to fix",
  );
  expect(await page.locator(".guest-nav-count").first().innerText()).toBe(
    String(normalCount),
  );
  expect(
    await page
      .locator(".guest-mobile-tabs .guest-mobile-xray .guest-nav-count")
      .count(),
  ).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "summary-normal-desktop-1440x900.png");
  const evidenceDirectory = resolve(process.cwd(), "review/s2-b1");
  mkdirSync(evidenceDirectory, { recursive: true });
  await captureTo(page, evidenceDirectory, "summary-with-preview-1440x900.png");
  const desktopBounds = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      verdict: rect("[data-testid='report-verdict']"),
      score: rect(".guest-score"),
      priorities: Array.from(
        document.querySelectorAll("[data-priority-card]"),
      ).map((element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        };
      }),
    };
  });
  console.log("S2-A desktop summary bounds:", JSON.stringify(desktopBounds));
  expect(
    Boolean(
      desktopBounds.verdict &&
        desktopBounds.score &&
        desktopBounds.priorities.length >= 2 &&
        desktopBounds.verdict.y >= 0 &&
        desktopBounds.verdict.bottom <= 900 &&
        desktopBounds.score.y >= 0 &&
        desktopBounds.score.bottom <= 900 &&
        desktopBounds.priorities
          .slice(0, 3)
          .every((box) => box.y >= 0 && box.bottom <= 900),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const normalMobileBounds = await page.evaluate(() => {
    const nav = document
      .querySelector(".guest-mobile-tabs")!
      .getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-priority-card]"),
    ).map((element) => {
      const box = element.getBoundingClientRect();
      return { y: box.y, bottom: box.bottom, right: box.right };
    });
    return {
      nav: { y: nav.y, height: nav.height, bottom: nav.bottom },
      cards,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  console.log(
    "S2-A mobile summary bounds:",
    JSON.stringify(normalMobileBounds),
  );
  expect(normalMobileBounds.scrollWidth).toBe(390);
  expect(normalMobileBounds.cards.length).toBeGreaterThanOrEqual(2);
  expect(
    normalMobileBounds.cards
      .slice(0, 2)
      .every(
        (box) =>
          box.y >= 0 &&
          box.bottom <= normalMobileBounds.nav.y &&
          box.right <= 390,
      ),
  ).toBe(true);
  await capture(page, "summary-normal-mobile-390x844.png");
  await captureTo(page, evidenceDirectory, "summary-with-preview-390x844.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Page X-ray" }).click();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  const warningRegionIds = await page.locator("[data-xray-region]").evaluateAll((regions) => regions.map((region) => region.getAttribute("data-xray-region")));
  expect(warningRegionIds).toContain("primary-heading");
  expect(warningRegionIds).toContain("images");
  expect(warningRegionIds).toContain("links");
  console.log("S2-B1 warning X-ray rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-xray-title", ".guest-xray-document", '[data-xray-region="primary-heading"]', ".guest-xray-details",
  ])));
  await captureTo(page, evidenceDirectory, "xray-weak-desktop-1440x900.png");
  await page.getByRole("complementary", { name: "Report navigation" })
    .getByRole("button", { name: "New audit" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const blocking = await submit(page, noindexUrl);
  requestContract(blocking.request, noindexUrl);
  const noindex = blocking.analysis as {
    deterministic_score: {
      version: string;
    };
    checks: Array<{ id: string; anatomy_part?: string | null; finding_title?: string | null }>;
    findings_summary: {
      actionable_count: number;
      verdict: string;
      prioritized_check_ids: string[];
    };
  };
  expect(noindex.deterministic_score.version).toBe("1.1");
  expect(noindex.findings_summary.verdict.toLowerCase()).toContain(
    "not to index",
  );
  await expect(page.getByTestId("report-verdict")).toHaveText(
    noindex.findings_summary.verdict,
  );
  await expect(page.getByTestId("report-verdict")).toHaveCSS(
    "color",
    "rgb(20, 19, 15)",
  );
  await expect(page.locator(".impact-blocking").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "summary-blocking-desktop-1440x900.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await capture(page, "summary-blocking-mobile-390x844.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Page X-ray" }).click();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  const robotsFinding = noindex.checks.find((check) => check.id === "robots_directives");
  expect(robotsFinding?.anatomy_part).toBe("technical");
  const robotsPriority = noindex.findings_summary.prioritized_check_ids.indexOf("robots_directives") + 1;
  expect(robotsPriority).toBeGreaterThan(0);
  await page.locator(".guest-xray-head > summary").click();
  await expect(page.locator(".guest-xray-head")).toHaveAttribute("open", "");
  const robotsPin = page.locator('[data-xray-check="robots_directives"]');
  await expect(robotsPin).toHaveAttribute("aria-label", new RegExp(`^Priority ${robotsPriority}:`));
  await expect(page.locator('[data-xray-region="head-robots"]')).toHaveAttribute("data-assessment", "blocking");
  const sharedPins = await page.locator('[data-xray-region="head-sharing"] [data-xray-check]').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }));
  expect(sharedPins.length).toBeGreaterThan(1);
  expect(sharedPins.every((pin, index) => sharedPins.slice(index + 1).every((other) =>
    pin.right <= other.x || other.right <= pin.x || pin.bottom <= other.y || other.bottom <= pin.y,
  ))).toBe(true);
  await robotsPin.scrollIntoViewIfNeeded();
  console.log("S2-B1 noindex X-ray rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-xray-title", ".guest-xray-document", '[data-xray-region="head-robots"]', ".guest-xray-details", ".guest-xray-head",
  ])));
  await captureTo(page, evidenceDirectory, "xray-noindex-desktop-1440x900.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".guest-xray-head")).toHaveAttribute("open", "");
  await robotsPin.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await robotsPin.scrollIntoViewIfNeeded();
  console.log("S2-B1 mobile X-ray rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-xray-title", ".guest-xray-document", '[data-xray-region="head-robots"]', ".guest-mobile-tabs",
  ])));
  await captureTo(page, evidenceDirectory, "xray-noindex-mobile-390x844.png");
  await robotsPin.click();
  await expect(page.getByRole("heading", { name: "Fix list" })).toBeVisible();
  await expect(page).toHaveURL(/view=findings.*check=robots_directives/);
  const expandedRobots = page.locator('[data-finding-id="robots_directives"]');
  await expect(expandedRobots).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Show on X-ray" }).click();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  await expect(page).toHaveURL(/view=xray.*check=robots_directives/);
  const selectedPin = page.locator('[data-xray-check="robots_directives"]');
  await expect(selectedPin).toBeFocused();
  await expect.poll(async () => selectedPin.evaluate((element) => {
    const pin = element.getBoundingClientRect();
    const nav = document.querySelector(".guest-mobile-tabs")?.getBoundingClientRect();
    return Boolean(nav && pin.top >= 0 && pin.bottom <= nav.top);
  })).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log("S2-B1 selected pin rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-xray-title", '[data-xray-region="head-robots"]', '[data-xray-check="robots_directives"]',
  ])));
  await captureTo(page, evidenceDirectory, "xray-selected-pin-1440x900.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  let keyboardReachedPin = false;
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    keyboardReachedPin = await selectedPin.evaluate((element) => element === document.activeElement).catch(() => false);
    if (keyboardReachedPin) break;
  }
  expect(keyboardReachedPin).toBe(true);
  await expect(selectedPin).toHaveCSS("outline-style", "solid");
  await expect(selectedPin).toHaveCSS("outline-width", "3px");
  const focusRects = await measureRectangles(page, ['[data-xray-check="robots_directives"]', ".guest-mobile-tabs"]);
  console.log("S2-B1 mobile focused pin rectangles:", JSON.stringify(focusRects));
  const focusedPin = focusRects.elements['[data-xray-check="robots_directives"]'];
  const fixedNavigation = focusRects.elements[".guest-mobile-tabs"];
  expect(focusedPin && fixedNavigation && focusedPin.y >= 0 && focusedPin.bottom <= fixedNavigation.y).toBe(true);
  await captureTo(page, evidenceDirectory, "xray-keyboard-focus-390x844.png");

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Fix list" })).toBeVisible();
  await expect(page.locator('[data-finding-id="robots_directives"]')).toHaveAttribute("aria-expanded", "true");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  await expect(page).toHaveURL(/check=robots_directives/);
  await page.getByRole("button", { name: "Back to Summary" }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "See all fixes" }).click();
  await expect(page.getByRole("heading", { name: "Fix list" })).toBeVisible();
  expect(await page.getByTestId("findings-count-line").innerText()).toContain(
    noindex.findings_summary.actionable_count + " to fix",
  );
  const firstFinding = page.locator(".guest-fix-toggle").first();
  await firstFinding.click();
  await expect(firstFinding).toHaveAttribute("aria-expanded", "true");
  expect(
    await page.locator(".guest-fix-toggle[aria-expanded='false']").count(),
  ).toBeGreaterThan(0);
  await capture(page, "fix-list-desktop-1440x900.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await capture(page, "fix-list-mobile-390x844.png");
  await page.locator(".guest-mobile-tabs a").first().click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pages" })).toBeVisible();
  expect(await page.locator(".guest-more-sheet li").count()).toBe(10);
  expect(
    await page.locator(".guest-mobile-xray .guest-nav-count").count(),
  ).toBe(0);
  await capture(page, "mobile-more-390x844.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "New audit" }).click();
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "45" },
      body: JSON.stringify({
        error: {
          code: "rate_limited",
          message: "sanitized",
          request_id: "s2a-rate-test",
        },
      }),
    });
  });
  await page.getByLabel("Page address").fill(warningUrl);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Try again in 45 seconds.",
  );
  await capture(page, "guest-error-390x844.png");
  await page.unroute("**/api/guest/v1/analyse-url");
  await page.goto("/");
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  await expect(page.getByLabel("Page address")).toBeFocused();
  expect(
    await page
      .getByLabel("Page address")
      .evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe("3px");
  await capture(page, "focus-keyboard-390x844.png");
  expect(browserApiRequests).toEqual([]);
  const browserApiStatus = await page.evaluate(async () => {
    const response = await fetch("/api/browser/v1/analyse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://phase2d.test/pages/noindex" }),
    });
    return response.status;
  });
  expect(browserApiStatus).toBe(401);
  const apiHost = "seo-sensei-api.localhost:8443";
  const apiRequestUrl = new URL(appOrigin);
  apiRequestUrl.hostname = "127.0.0.1";
  const apiRequestHeaders = { Origin: appOrigin, Host: apiHost };
  const guestOnApiHost = await context.request.get(
    new URL("/api/guest/v1/session", apiRequestUrl).toString(),
    { headers: apiRequestHeaders },
  );
  expect(guestOnApiHost.status()).toBe(404);
  expect(Boolean(guestOnApiHost.headers()["access-control-allow-origin"])).toBe(
    false,
  );
  const legacyUnauthenticated = await context.request.post(
    new URL("/analyse-url", apiRequestUrl).toString(),
    {
      headers: { ...apiRequestHeaders, "Content-Type": "application/json" },
      data: {},
    },
  );
  expect(legacyUnauthenticated.status()).toBe(401);
  expect(externalRequests).toEqual([]);
  console.log(
    "S2-A browser verification:",
    JSON.stringify({
      browser: browserVersion,
      externalOriginRequests: externalRequests.length,
      challengeRequestsWhenNotRequired: 0,
      deliberateProtectedEndpointProbeCount: browserApiRequests.length,
    }),
  );
});
test("shows a zero-fix result and explicit in-memory recovery after reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Check page" })).toBeEnabled();
  const result = await submit(page, allPassUrl);
  requestContract(result.request, allPassUrl);
  expect(
    (
      result.analysis as {
        findings_summary: {
          actionable_count: number;
        };
      }
    ).findings_summary.actionable_count,
  ).toBe(0);
  await expect(page.getByTestId("report-verdict")).toBeVisible();
  await expect(page.getByTestId("report-verdict")).toHaveCSS(
    "color",
    "rgb(20, 19, 15)",
  );
  await expect(page.getByTestId("summary-count-line")).toContainText(
    "0 to fix",
  );
  expect(await page.locator(".guest-nav-count").first().innerText()).toBe("0");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Start a new audit to see this page again.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Page address")).toHaveCount(0);
  expect(page.url()).not.toContain("phase2d.test");
});
test("cancellation is explicit and a late response cannot replace the current page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Check page" })).toBeEnabled();
  let releaseAnalysis!: () => void;
  const analysisGate = new Promise<void>((resolveGate) => {
    releaseAnalysis = resolveGate;
  });
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    await analysisGate;
    await route.continue();
  });
  const abortedRequest = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/guest/v1/analyse-url"),
  );
  await page.getByLabel("Page address").fill(warningUrl);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(
    page.getByText("Waiting for the audit service to return a report."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByText("The server may still be processing the request."),
  ).toBeVisible();
  expect(page.url()).not.toContain("source=guest");
  releaseAnalysis();
  await abortedRequest;
  await expect(
    page.getByRole("heading", { name: "Check a web page for SEO problems." }),
  ).toBeVisible();
  await page.unroute("**/api/guest/v1/analyse-url");
});

async function captureTo(page: Page, directory: string, filename: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: resolve(directory, filename), animations: "disabled" });
}

async function measureRectangles(page: Page, selectors: string[]) {
  return page.evaluate((items) => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const elements: Record<string, { x: number; y: number; width: number; height: number; right: number; bottom: number } | null> = {};
    for (const selector of items) {
      const element = document.querySelector<HTMLElement>(selector);
      const rect = element?.getBoundingClientRect();
      elements[selector] = rect ? {
        x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
        right: round(rect.right), bottom: round(rect.bottom),
      } : null;
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollY: round(window.scrollY),
      headMetadataOpen: document.querySelector<HTMLDetailsElement>(".guest-xray-head")?.open ?? null,
      elements,
    };
  }, selectors);
}
