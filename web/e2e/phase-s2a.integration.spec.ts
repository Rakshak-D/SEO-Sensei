import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
const evidenceDirectory = resolve(process.cwd(), "review/s2-a");
mkdirSync(evidenceDirectory, { recursive: true });
const b2EvidenceDirectory = resolve(process.cwd(), "review/s2-b2");
mkdirSync(b2EvidenceDirectory, { recursive: true });
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
  await page.setViewportSize({ width: 1440, height: 900 });
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
  const robotsRegion = page.locator('[data-xray-region="head-robots"]');
  const sharingRegion = page.locator('[data-xray-region="head-sharing"]');
  const openGraphPin = page.locator('[data-xray-check="open_graph"]');
  const twitterPin = page.locator('[data-xray-check="twitter_metadata"]');
  const findingDetails = page.locator(".guest-xray-finding");
  const openGraphTitle = noindex.checks.find((check) => check.id === "open_graph")?.finding_title;
  const twitterTitle = noindex.checks.find((check) => check.id === "twitter_metadata")?.finding_title;
  expect(openGraphTitle).toBeTruthy();
  expect(twitterTitle).toBeTruthy();
  await expect(findingDetails.locator("h3")).toHaveText(
    noindex.checks.find((check) => check.id === "robots_directives")?.finding_title ?? "",
  );
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await page.keyboard.press("Tab");
  await expect(openGraphPin).toBeFocused();
  await expect(findingDetails.locator("h3")).toHaveText(openGraphTitle!);
  await expect(findingDetails.locator(".guest-xray-priority-label")).toHaveText(
    `Priority ${noindex.findings_summary.prioritized_check_ids.indexOf("open_graph") + 1}`,
  );
  await expect(sharingRegion).toHaveClass(/is-highlighted/);
  await expect(robotsRegion).not.toHaveClass(/is-highlighted/);
  await page.keyboard.press("Tab");
  await expect(twitterPin).toBeFocused();
  await expect(findingDetails.locator("h3")).toHaveText(twitterTitle!);
  await expect(findingDetails.locator(".guest-xray-priority-label")).toHaveText(
    `Priority ${noindex.findings_summary.prioritized_check_ids.indexOf("twitter_metadata") + 1}`,
  );
  await selectedPin.hover();
  await expect(twitterPin).toBeFocused();
  await expect(findingDetails.locator("h3")).toHaveText(
    noindex.checks.find((check) => check.id === "robots_directives")?.finding_title ?? "",
  );
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await expect(sharingRegion).not.toHaveClass(/is-highlighted/);
  await page.mouse.move(12, 12);
  await expect(twitterPin).toBeFocused();
  await expect(findingDetails.locator("h3")).toHaveText(twitterTitle!);
  await expect(sharingRegion).toHaveClass(/is-highlighted/);
  await expect(robotsRegion).not.toHaveClass(/is-highlighted/);
  await page.getByRole("link", { name: /^Summary/ }).first().focus();
  await expect(findingDetails.locator("h3")).toHaveText(
    noindex.checks.find((check) => check.id === "robots_directives")?.finding_title ?? "",
  );
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await expect(sharingRegion).not.toHaveClass(/is-highlighted/);
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
  await expect.poll(async () => selectedPin.evaluate((element) => {
    const pin = element.getBoundingClientRect();
    const nav = document.querySelector(".guest-mobile-tabs")?.getBoundingClientRect();
    return Boolean(nav && pin.top >= 0 && pin.bottom <= nav.top);
  })).toBe(true);
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
  await expect(selectedPin).toBeFocused();
  await twitterPin.click();
  await expect(page).toHaveURL(/view=findings.*check=twitter_metadata/);
  const expandedTwitter = page.locator('[data-finding-id="twitter_metadata"]');
  await expect(expandedTwitter).toBeFocused();
  await expect(expandedTwitter).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Show on X-ray" }).click();
  await expect(page).toHaveURL(/view=xray.*check=twitter_metadata/);
  await expect(twitterPin).toBeFocused();
  await expect(findingDetails.locator("h3")).toHaveText(twitterTitle!);
  await page.goBack();
  await expect(page).toHaveURL(/view=findings.*check=twitter_metadata/);
  await expect(expandedTwitter).toBeFocused();
  await expect(expandedTwitter).toHaveAttribute("aria-expanded", "true");
  await page.goForward();
  await expect(page).toHaveURL(/view=xray.*check=twitter_metadata/);
  await expect(twitterPin).toBeFocused();
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
test("renders On-page and Previews from two controlled HTTPS analyses", async ({
  page,
  baseURL,
  browser,
}) => {
  console.log("S2-B2 controlled screenshot browser:", browser.version());
  const appOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin) externalRequests.push(origin);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const warning = await submit(page, warningUrl);
  requestContract(warning.request, warningUrl);
  const warningAnalysis = warning.analysis as {
    deterministic_score: { version: string };
    checks: unknown[];
    findings_summary: { actionable_count: number };
  };
  expect(warningAnalysis.deterministic_score.version).toBe("1.1");
  expect(warningAnalysis.checks).toHaveLength(23);
  expect(warningAnalysis.findings_summary.actionable_count).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

  await page.getByRole("link", { name: "On-page" }).click();
  await expect(page.getByRole("heading", { name: "On-page content" })).toBeVisible();
  await expect(page.getByText("Solar notes")).toBeVisible();
  const onPageRelatedFix = page.locator(".guest-onpage .guest-specialist-related button", { hasText: "See the fix" }).first();
  await expect(onPageRelatedFix).toBeVisible();
  const onPageCheckId = await onPageRelatedFix.locator("xpath=ancestor::*[@data-related-check][1]").getAttribute("data-related-check");
  expect(onPageCheckId).toBeTruthy();
  await onPageRelatedFix.click();
  await expect(page).toHaveURL(new RegExp("view=findings.*check=" + onPageCheckId));
  const onPageSelectedRow = page.locator('[data-finding-id="' + onPageCheckId + '"]');
  await expect(onPageSelectedRow).toHaveAttribute("aria-expanded", "true");
  await expect(onPageSelectedRow).toBeFocused();
  console.log("S2-B2 On-page selected fix route:", page.url());
  const onPageExpandedRow = page.locator('[data-finding-id="' + onPageCheckId + '"]').locator("xpath=ancestor::li[contains(@class, 'guest-fix-row')]");
  await page.setViewportSize({ width: 390, height: 844 });
  await onPageExpandedRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  await expect.poll(async () => onPageExpandedRow.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const nav = document.querySelector(".guest-mobile-tabs")?.getBoundingClientRect();
    return Boolean(nav && row.top >= 0 && row.bottom <= nav.top);
  })).toBe(true);
  console.log("S2-B2 on-page selected-fix mobile rectangles:", JSON.stringify(await measureRectangles(page, [
    "[data-finding-id]", ".guest-fix-row:has([data-finding-id][aria-expanded='true'])", ".guest-mobile-tabs",
  ])));
  await captureTo(page, b2EvidenceDirectory, "on-page-selected-fix-390x844.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Previews" }).click();
  await expect(page.getByRole("heading", { name: "Search and social previews" })).toBeVisible();
  await expect(page.getByText("No Open Graph title returned.")).toHaveCount(2);
  await expect(page.getByText(/Illustration based on fetched metadata/)).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const missingPreview = await measureRectangles(page, [
    "#guest-previews-title", ".guest-search-preview", ".guest-og-preview", ".guest-x-preview", ".guest-linkedin-preview",
  ]);
  console.log("S2-B2 missing-metadata preview rectangles:", JSON.stringify(missingPreview));
  await captureTo(page, b2EvidenceDirectory, "previews-missing-metadata-1440x900.png");
  const previewRelatedFix = page.locator(".guest-previews-related button", { hasText: "See the fix" }).first();
  await expect(previewRelatedFix).toBeVisible();
  const previewCheckId = await previewRelatedFix.locator("xpath=ancestor::*[@data-related-check][1]").getAttribute("data-related-check");
  expect(previewCheckId).toBeTruthy();
  await previewRelatedFix.click();
  await expect(page).toHaveURL(new RegExp("view=findings.*check=" + previewCheckId));
  const previewSelectedRow = page.locator('[data-finding-id="' + previewCheckId + '"]');
  await expect(previewSelectedRow).toHaveAttribute("aria-expanded", "true");
  await expect(previewSelectedRow).toBeFocused();
  console.log("S2-B2 Preview related fix route:", page.url());
  const previewExpandedRow = page.locator('[data-finding-id="' + previewCheckId + '"]').locator("xpath=ancestor::li[contains(@class, 'guest-fix-row')]");
  await page.setViewportSize({ width: 390, height: 844 });
  await previewExpandedRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  console.log("S2-B2 preview selected-fix mobile rectangles:", JSON.stringify(await measureRectangles(page, [
    "[data-finding-id]", ".guest-fix-row:has([data-finding-id][aria-expanded='true'])", ".guest-mobile-tabs",
  ])));
  await captureTo(page, b2EvidenceDirectory, "previews-related-fix-390x844.png");

  await page.getByRole("button", { name: "New audit" }).first().click();
  await expect(page.getByRole("heading", { name: "Check a web page for SEO problems." })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const rich = await submit(page, allPassUrl);
  requestContract(rich.request, allPassUrl);
  const richAnalysis = rich.analysis as {
    deterministic_score: { version: string };
    checks: unknown[];
    findings_summary: { actionable_count: number };
    social_metadata: { og_title: string | null; twitter_title: string | null };
  };
  expect(richAnalysis.deterministic_score.version).toBe("1.1");
  expect(richAnalysis.checks).toHaveLength(23);
  expect(richAnalysis.findings_summary.actionable_count).toBe(0);
  expect(richAnalysis.social_metadata.og_title).toBeTruthy();
  expect(richAnalysis.social_metadata.twitter_title).toBeTruthy();
  await page.getByRole("link", { name: "Previews" }).click();
  await expect(page.getByRole("heading", { name: "Search and social previews" })).toBeVisible();
  await expect(page.getByText(richAnalysis.social_metadata.og_title!, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(richAnalysis.social_metadata.twitter_title!, { exact: true }).first()).toBeVisible();
  expect(await page.locator("img").count()).toBe(0);
  console.log("S2-B2 rich preview desktop rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-previews-title", ".guest-search-preview", ".guest-og-preview", ".guest-x-preview", ".guest-linkedin-preview",
  ])));
  await captureTo(page, b2EvidenceDirectory, "previews-rich-desktop-1440x900.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log("S2-B2 rich preview mobile rectangles:", JSON.stringify(await measureRectangles(page, [
    "#guest-previews-title", ".guest-search-preview", ".guest-mobile-tabs",
  ])));
  await captureTo(page, b2EvidenceDirectory, "previews-rich-mobile-390x844.png");
  expect(externalRequests).toEqual([]);
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
