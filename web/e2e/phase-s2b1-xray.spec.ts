import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const auditFixture = JSON.parse(readFileSync(resolve(process.cwd(), "public/fixtures/audit.json"), "utf8")) as unknown;
const evidenceDirectory = resolve(process.cwd(), "review/s2-b1");
const appOrigin = "http://127.0.0.1:4173";
mkdirSync(evidenceDirectory, { recursive: true });

function localFixtureWithImpactLabels() {
  const fixture = structuredClone(auditFixture) as {
    analysis: { checks: Array<Record<string, unknown> & { id: string }> };
  };
  const impactById: Record<string, string> = {
    robots_directives: "blocking",
    visible_text: "high",
    open_graph: "medium",
    twitter_metadata: "low",
  };
  fixture.analysis.checks = fixture.analysis.checks.map((check) => ({
    ...check,
    ...(impactById[check.id] ? { impact: impactById[check.id] } : {}),
  }));
  return fixture;
}

function controlledPointerAnalysis() {
  const check = (values: Record<string, unknown>) => ({
    points: 0,
    max_points: 10,
    evidence: { observed: "Controlled analysis evidence.", value: null },
    recommendation: "Review the observed HTML signal.",
    fix_snippet: null,
    snippet_requires_review: false,
    optional_note: null,
    exclusion_reason: null,
    ...values,
  });
  const checks = [
    check({
      id: "retrieval_success", category: "technical_indexability", title: "HTML retrieval", status: "pass",
      impact: null, effort: null, finding_title: null, finding_reason: null, is_actionable: false,
    }),
    check({
      id: "robots_directives", category: "technical_indexability", title: "Robots directives", status: "fail",
      impact: "blocking", effort: "quick", finding_title: "Review the observed robots directive",
      finding_reason: "The controlled response contains a blocking robots finding.", is_actionable: true,
      anatomy_part: "technical",
    }),
    check({
      id: "heading_hierarchy", category: "headings_content_structure", title: "Heading hierarchy", status: "warning",
      impact: "high", effort: "moderate", finding_title: "Review the heading order",
      finding_reason: "The controlled response contains a heading-order finding.", is_actionable: true,
      anatomy_part: "heading",
    }),
  ];
  return {
    requested_url: "https://safe.example/review/",
    final_url: "https://safe.example/review/",
    fetch: {
      requested_url: "https://safe.example/review/", final_url: "https://safe.example/review/", status_code: 200,
      content_type: "text/html", content_length: 512, bytes_read: 512, redirect_count: 0, elapsed_time: 0.1, x_robots_tag: null,
    },
    deterministic_score: {
      version: "1.1", overall_score: 80, points_earned: 80, max_points: 100,
      categories: [
        { category: "technical_indexability", weight: 30, points_earned: 20, max_points: 30, raw_points: 20, raw_max_points: 30, check_ids: ["retrieval_success", "robots_directives"] },
        { category: "headings_content_structure", weight: 15, points_earned: 15, max_points: 15, raw_points: 15, raw_max_points: 15, check_ids: ["heading_hierarchy"] },
      ],
    },
    checks,
    metadata: { title: "Controlled pointer report", robots_directives: ["noindex"] },
    headings: { h1: ["Page heading"], h2: ["A section"], h3: [], empty_heading_count: 0, hierarchy_jumps: ["H1 to H3"] },
    findings_summary: {
      total_checks: 3, raw_passes: 1, raw_warnings: 1, raw_failures: 1, raw_not_applicable: 0,
      actionable_count: 2, optional_note_count: 0,
      by_impact: { blocking: 1, high: 1, medium: 0, low: 0 },
      by_effort: { quick: 1, moderate: 1, larger_job: 0 },
      prioritized_check_ids: ["robots_directives", "heading_hierarchy"],
      verdict: "Review the blocking robots directive first.", exclusions: [],
    },
  };
}

async function installControlledPointerReport(page: Page) {
  await page.route("**/api/guest/v1/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    csrf_token: "c".repeat(43), expires_in: 3600, bot_check_required: false, turnstile_sitekey: null, turnstile_action: null,
  }) }));
  await page.route("**/api/guest/v1/analyse-url", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(controlledPointerAnalysis()),
  }));
}

async function installLocalExample(page: Page, fixture: unknown = auditFixture) {
  await page.route("**/api/guest/v1/session", (route) => route.fulfill({ status: 404, body: "Guest audit disabled in local UI test." }));
  await page.route("**/fixtures/audit.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }));
  await page.route("**/fixtures/northstar-solar.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: '<!doctype html><html><head><title>Home Solar Installation: Planning Guide | Northstar</title><meta name="robots" content="noindex, follow"></head><body><h1>Plan a home solar installation</h1></body></html>',
  }));
}

async function expectPinInViewport(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
  }), { message: `${selector} should scroll into the viewport after focus` }).toBe(true);
}

async function expectXrayDetailsInViewport(page: Page) {
  await expect.poll(() => page.locator(".guest-xray-details").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
  }), { message: "The selected finding details should remain visible with the focused X-ray pin" }).toBe(true);
}

async function xrayCaptureMeasurements(page: Page, pinSelector: string, regionSelector: string) {
  return page.evaluate(({ pinSelector: pinQuery, regionSelector: regionQuery }) => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY: window.scrollY,
      pin: rect(pinQuery),
      region: rect(regionQuery),
      details: rect(".guest-xray-details"),
      selectedTitle: document.querySelector(".guest-xray-finding h3")?.textContent?.trim() ?? null,
      selectedPriority: document.querySelector(".guest-xray-priority-label")?.textContent?.trim() ?? null,
    };
  }, { pinSelector, regionSelector });
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: resolve(evidenceDirectory, name), animations: "disabled" });
}

test("opens the fictional Northstar report X-ray and preserves its provenance", async ({ page }) => {
  const externalOrigins: string[] = [];
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin) externalOrigins.push(origin);
  });
  await installLocalExample(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Check a web page for SEO problems." })).toBeVisible();
  await page.getByRole("button", { name: "Example: Northstar Solar" }).click();
  await expect(page.getByText(/Fictional local example/)).toBeVisible();
  await expect(page.getByTestId("xray-preview")).toBeVisible();
  await page.getByRole("button", { name: "Open Page X-ray" }).click();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(8);
  await expect(page.getByText("A simplified view of the HTML we could assess. Not the page's actual layout.")).toBeVisible();
  await expect(page.getByText("Plan a home solar installation")).toBeVisible();
  await expect(page.getByText("Not assessed. No header or navigation content was returned.")).toBeVisible();
  await expect(page.getByText("Not assessed. No footer content was returned.")).toBeVisible();
  await expect(page).not.toHaveURL(/northstar\.example/);
  await expect(page.getByRole("link", { name: "Page X-ray" })).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => document.fonts.ready);
  await capture(page, "xray-northstar-desktop-1440x900.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "X-ray" })).toHaveAttribute("aria-current", "page");
  await capture(page, "xray-northstar-mobile-390x844.png");
  await page.locator(".guest-xray-head > summary").click();
  await expect(page.getByText("Home Solar Installation: Planning Guide | Northstar")).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "Pages" });
  await expect(sheet.getByRole("link", { name: "Page X-ray" })).toHaveAttribute("aria-current", "page");
  await expect(sheet.locator("li")).toHaveCount(10);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More" })).toBeFocused();
  expect(externalOrigins).toEqual([]);
});

test("keeps report reload recovery honest and never substitutes local data for a lost guest result", async ({ page }) => {
  await installLocalExample(page);
  await page.goto("/?view=xray&source=guest&check=robots_directives");
  await expect(page.getByRole("heading", { name: "Start a new audit to see this page again." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toHaveCount(0);
  await expect(page.locator(".guest-lost-report").getByRole("button", { name: "New audit" })).toBeVisible();
  await expect(page).not.toHaveURL(/northstar\.example/);
});

test("keeps routed, keyboard, pointer, and shared-region finding selection coherent", async ({ page }) => {
  await installLocalExample(page, localFixtureWithImpactLabels());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Example: Northstar Solar" }).click();
  await page.getByRole("button", { name: "See the fix" }).first().click();
  await expect(page).toHaveURL(/view=findings.*check=robots_directives/);
  await page.getByRole("button", { name: "Show on X-ray" }).click();

  const robotsPin = page.locator('[data-xray-check="robots_directives"]');
  const openGraphPin = page.locator('[data-xray-check="open_graph"]');
  const twitterPin = page.locator('[data-xray-check="twitter_metadata"]');
  const finding = page.locator(".guest-xray-finding");
  const robotsRegion = page.locator('[data-xray-region="head-robots"]');
  const sharingRegion = page.locator('[data-xray-region="head-sharing"]');

  await expect(robotsPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Robots directives are reported");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await page.keyboard.press("Tab");
  await expect(openGraphPin).toBeFocused();
  await expectPinInViewport(page, '[data-xray-check="open_graph"]');
  await expectXrayDetailsInViewport(page);
  await expect(openGraphPin).toHaveCSS("outline-style", "solid");
  await expect(openGraphPin).toHaveCSS("outline-width", "3px");
  await expect(page).toHaveURL(/check=robots_directives/);
  await expect(finding.locator("h3")).toHaveText("Open Graph metadata is reported");
  await expect(finding.locator(".guest-xray-priority-label")).toHaveText("Priority 3");
  await expect(sharingRegion).toHaveClass(/is-highlighted/);
  await expect(robotsRegion).not.toHaveClass(/is-highlighted/);
  console.log("S2-C1 keyboard X-ray capture:", JSON.stringify(await xrayCaptureMeasurements(page, '[data-xray-check="open_graph"]', '[data-xray-region="head-sharing"]')));
  await page.screenshot({ path: "review/s2-c1/xray-keyboard-focus-1440x900.png" });

  await page.keyboard.press("Tab");
  await expect(twitterPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Twitter metadata is reported");
  await expect(finding.locator(".guest-xray-priority-label")).toHaveText("Priority 4");

  await robotsPin.hover();
  await expect(twitterPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Robots directives are reported");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await expect(sharingRegion).not.toHaveClass(/is-highlighted/);

  await page.mouse.move(12, 12);
  await expect(twitterPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Twitter metadata is reported");
  await expect(sharingRegion).toHaveClass(/is-highlighted/);
  await expect(robotsRegion).not.toHaveClass(/is-highlighted/);

  await page.getByRole("link", { name: /^Summary/ }).first().focus();
  await expect(finding.locator("h3")).toHaveText("Robots directives are reported");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await expect(sharingRegion).not.toHaveClass(/is-highlighted/);

  await page.goBack();
  await expect(page).toHaveURL(/view=findings.*check=robots_directives/);
  await expect(page.locator('[data-finding-id="robots_directives"]')).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/view=xray.*check=robots_directives/);
  await expect(robotsPin).toBeFocused();
  await expectPinInViewport(page, '[data-xray-check="robots_directives"]');

  await twitterPin.click();
  await expect(page).toHaveURL(/view=findings.*check=twitter_metadata/);
  const twitterRow = page.locator('[data-finding-id="twitter_metadata"]');
  await expect(twitterRow).toBeFocused();
  await expect(twitterRow).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Show on X-ray" }).click();
  await expect(page).toHaveURL(/view=xray.*check=twitter_metadata/);
  await expect(twitterPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Twitter metadata is reported");

  await page.evaluate(() => {
    window.history.pushState({}, "", "?view=xray&source=demo&access=guest&check=unknown_check");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".guest-xray-selection-error")).toContainText("This finding is not available in the current report.");
  await robotsPin.hover();
  await expect(page.locator(".guest-xray-selection-error")).toBeVisible();
  await expect(finding).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/view=xray.*check=twitter_metadata/);
  await expect(twitterPin).toBeFocused();
  await expect(finding.locator("h3")).toHaveText("Twitter metadata is reported");
});

test("stationary pointer does not override the routed X-ray finding on navigation", async ({ page }) => {
  await installControlledPointerReport(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("Page address").fill("https://safe.example/review/");
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await page.getByRole("button", { name: "See the fix" }).first().click();
  await expect(page).toHaveURL(/view=findings.*check=robots_directives/);

  const showOnXray = page.getByRole("button", { name: "Show on X-ray" });
  await showOnXray.hover();
  await expect(showOnXray).toBeVisible();
  const stationaryPoint = await showOnXray.boundingBox();
  expect(stationaryPoint).not.toBeNull();
  await showOnXray.click();

  const robotsPin = page.locator('[data-xray-check="robots_directives"]');
  const hierarchyPin = page.locator('[data-xray-check="heading_hierarchy"]');
  const finding = page.locator(".guest-xray-finding");
  const robotsRegion = page.locator('[data-xray-region="head-robots"]');
  const stationaryTarget = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return {
      checkId: target?.closest("[data-xray-check]")?.getAttribute("data-xray-check") ?? null,
      regionId: target?.closest("[data-xray-region]")?.getAttribute("data-xray-region") ?? null,
    };
  }, { x: stationaryPoint!.x + stationaryPoint!.width / 2, y: stationaryPoint!.y + stationaryPoint!.height / 2 });
  expect(stationaryTarget.regionId).toBe("subheadings");

  await expect(page).toHaveURL(/view=xray.*check=robots_directives/);
  await expect(robotsPin).toBeFocused();
  const routedSelectionAfterMount = await page.evaluate(() => ({
    checkId: document.activeElement?.getAttribute("data-xray-check") ?? null,
    title: document.querySelector(".guest-xray-finding h3")?.textContent?.trim() ?? null,
    highlightedRegion: document.querySelector(".guest-xray-region.is-highlighted")?.getAttribute("data-xray-region") ?? null,
  }));
  expect(routedSelectionAfterMount).toEqual({
    checkId: "robots_directives",
    title: "Review the observed robots directive",
    highlightedRegion: "head-robots",
  });
  await expect(finding.locator("h3")).toHaveText("Review the observed robots directive");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await expectPinInViewport(page, '[data-xray-check="robots_directives"]');
  const viewportRect = async (selector: string) => page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const routedPinRect = await viewportRect('[data-xray-check="robots_directives"]');
  expect(routedPinRect.y).toBeGreaterThanOrEqual(0);
  expect(routedPinRect.y + routedPinRect.height).toBeLessThanOrEqual(900);
  await expectXrayDetailsInViewport(page);
  console.log("S2-C1 stationary routed X-ray capture:", JSON.stringify(await xrayCaptureMeasurements(page, '[data-xray-check="robots_directives"]', '[data-xray-region="head-robots"]')));
  await page.screenshot({ path: "review/s2-c1/xray-stationary-routed-1440x900.png" });

  await page.locator('[data-xray-region="subheadings"]').evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(finding.locator("h3")).toHaveText("Review the observed robots directive");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);
  await hierarchyPin.hover();
  await expect(finding.locator("h3")).toHaveText("Review the heading order");
  await expect(finding.locator(".guest-xray-priority-label")).toHaveText("Priority 2");
  await expect(page.locator('[data-xray-region="subheadings"]')).toHaveClass(/is-highlighted/);
  await expect(robotsRegion).not.toHaveClass(/is-highlighted/);
  console.log("S2-C1 deliberate hover X-ray capture:", JSON.stringify(await xrayCaptureMeasurements(page, '[data-xray-check="heading_hierarchy"]', '[data-xray-region="subheadings"]')));
  await page.screenshot({ path: "review/s2-c1/xray-deliberate-hover-1440x900.png" });

  await page.mouse.move(12, 12);
  await expect(finding.locator("h3")).toHaveText("Review the observed robots directive");
  await expect(page.locator('[data-xray-region="subheadings"]')).not.toHaveClass(/is-highlighted/);
  await expect(robotsRegion).toHaveClass(/is-highlighted/);

  await page.getByRole("button", { name: /Open Fix list/ }).focus();
  await expect(finding.locator("h3")).toHaveText("Review the observed robots directive");
  await expect(robotsRegion).toHaveClass(/is-highlighted/);

  await page.goBack();
  await expect(page).toHaveURL(/view=findings.*check=robots_directives/);
  await expect(page.locator('[data-finding-id="robots_directives"]')).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/view=xray.*check=robots_directives/);
  await expect(robotsPin).toBeFocused();
  await expectPinInViewport(page, '[data-xray-check="robots_directives"]');
  await expectXrayDetailsInViewport(page);
  await expect(finding.locator("h3")).toHaveText("Review the observed robots directive");

  await page.evaluate(() => {
    window.history.pushState({}, "", "?view=xray&source=guest&check=unknown_check");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".guest-xray-selection-error")).toBeVisible();
  await expect(finding).toHaveCount(0);
});

test("measures X-ray overflow, touch targets, mobile nav clearance, and reduced motion at every supported width", async ({ page }) => {
  await installLocalExample(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Example: Northstar Solar" }).click();
  await page.getByRole("button", { name: "Open Page X-ray" }).click();
  await expect(page.getByRole("heading", { name: "Page X-ray" })).toBeVisible();
  const measurements = [] as Array<{ width: number; scrollWidth: number; minTarget: number; navTop: number | null; navBottom: number | null }>;
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const measured = await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>(".guest-app button:not([disabled]), .guest-app a[href], .guest-app summary"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
        });
      const nav = document.querySelector<HTMLElement>(".guest-mobile-tabs");
      const navBox = nav?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        minTarget: Math.min(...targets.map((element) => element.getBoundingClientRect().height)),
        navTop: navBox ? navBox.top : null,
        navBottom: navBox ? navBox.bottom : null,
      };
    });
    measurements.push({ width, ...measured });
    expect(measured.scrollWidth, `X-ray horizontal scroll at ${width}px`).toBeLessThanOrEqual(width);
    expect(measured.minTarget, `Minimum target at ${width}px`).toBeGreaterThanOrEqual(44);
    if (width <= 1023) expect(measured.navTop).toBeLessThan(844);
  }
  console.log("S2-B1 X-ray responsive measurements:", JSON.stringify(measurements));

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.evaluate(() => Array.from(document.querySelectorAll(".guest-app *"))
    .map((element) => getComputedStyle(element).animationDuration)
    .filter((duration) => duration !== "0s"));
  expect(motion).toEqual([]);
});
