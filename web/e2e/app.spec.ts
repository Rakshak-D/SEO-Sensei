import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const sampleAddress = "https://northstar.example/guides/home-solar/";

async function installAnonymousSession(page: Page) {
  await page.route("**/api/browser/v1/session", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({
      error: { code: "auth_required", message: "A valid browser session is required.", request_id: "e2e-session" },
    }) });
  });
}

type ReportScenario = "normal" | "high" | "noindex" | "two" | "clear";

function resolvedAnalysis(scenario: ReportScenario) {
  const details = scenario === "noindex"
    ? [
      ["robots_directives", "technical_indexability", "fail", "blocking", "quick", "Review the noindex directive", "The fetched HTML contains a noindex directive. Confirm that it is intentional.", "technical"],
      ["meta_description", "metadata", "fail", "high", "quick", "Add a page description", "No meta description was found in the fetched HTML.", "description"],
      ["title", "metadata", "warning", "medium", "quick", "Make the page title more descriptive", "The title is 12 characters. Check that it clearly identifies this page.", "title"],
    ]
    : scenario === "high"
      ? [
        ["meta_description", "metadata", "fail", "high", "quick", "Add a page description", "No meta description was found in the fetched HTML.", "description"],
        ["title", "metadata", "warning", "medium", "quick", "Make the page title more descriptive", "The title is 12 characters. Check that it clearly identifies this page.", "title"],
        ["h1_structure", "headings_content_structure", "warning", "medium", "moderate", "Review the main heading", "The fetched HTML contains more than one H1 heading.", "heading"],
      ]
      : scenario === "two" ? [
        ["title", "metadata", "warning", "medium", "quick", "Make the page title more descriptive", "The title is 12 characters. Check that it clearly identifies this page.", "title"],
        ["internal_links", "links", "warning", "low", "moderate", "Add useful links to related pages", "No internal links were detected in the fetched HTML.", "links"],
      ]
        : scenario === "clear" ? [] : [
        ["title", "metadata", "warning", "medium", "quick", "Make the page title more descriptive", "The title is 12 characters. Check that it clearly identifies this page.", "title"],
        ["meta_description", "metadata", "warning", "medium", "quick", "Make the page description more useful", "The description is 24 characters. Check that it accurately summarizes the page.", "description"],
        ["internal_links", "links", "warning", "low", "moderate", "Add useful links to related pages", "No internal links were detected in the fetched HTML.", "links"],
      ];
  const checks = details.map(([id, category, status, impact, effort, title, reason, anatomy_part]) => ({
    id, category, status, impact, effort, finding_title: title, finding_reason: reason, anatomy_part,
    title: `${id} check`, points: 0, max_points: 10,
    evidence: { observed: reason, value: null }, recommendation: "Review this deterministic observation.",
    fix_snippet: null, snippet_requires_review: false, is_actionable: true, optional_note: null, exclusion_reason: null,
  }));
  checks.push({
    id: "json_ld", category: "structured_data", status: "warning", impact: null, effort: null,
    finding_title: null, finding_reason: null, anatomy_part: null, title: "JSON-LD check", points: 0, max_points: 5,
    evidence: { observed: "No JSON-LD was found.", value: 0 }, recommendation: "No action is required for this optional signal.",
    fix_snippet: null, snippet_requires_review: false, is_actionable: false,
    optional_note: "No JSON-LD was found. Structured data is optional for this page.",
    exclusion_reason: "Missing optional JSON-LD is not a confirmed defect.",
  });
  checks.push({
    id: "retrieval_success", category: "technical_indexability", status: "pass", impact: null, effort: null,
    finding_title: null, finding_reason: null, anatomy_part: null, title: "HTML retrieval", points: 10, max_points: 10,
    evidence: { observed: "The test response returned an HTML document.", value: 200 }, recommendation: "No action is required.",
    fix_snippet: null, snippet_requires_review: false, is_actionable: false, optional_note: null, exclusion_reason: null,
  });
  checks.push({
    id: "link_relationships", category: "links", status: "not_applicable", impact: null, effort: null,
    finding_title: null, finding_reason: null, anatomy_part: null, title: "Link relationship details", points: 0, max_points: 1,
    evidence: { observed: "No relevant link relationships were available.", value: null },
    recommendation: "No action is required.", fix_snippet: null, snippet_requires_review: false,
    is_actionable: false, optional_note: null, exclusion_reason: null,
  });
  const impactCounts = { blocking: 0, high: 0, medium: 0, low: 0 };
  for (const check of checks.filter((item) => item.is_actionable)) impactCounts[check.impact as keyof typeof impactCounts] += 1;
  const statusCounts = { pass: 0, warning: 0, fail: 0, not_applicable: 0 };
  for (const check of checks) statusCounts[check.status as keyof typeof statusCounts] += 1;
  const prioritizedIds = details.map(([id]) => id);
  return {
    requested_url: "https://example.test/controlled-page/",
    final_url: "https://example.test/controlled-page/",
    fetch: {
      requested_url: "https://example.test/controlled-page/", final_url: "https://example.test/controlled-page/",
      status_code: 200, content_type: "text/html", content_length: 1200, bytes_read: 1200,
      redirect_count: 0, elapsed_time: 0.2, x_robots_tag: null,
    },
    deterministic_score: { version: "1.1", overall_score: scenario === "normal" ? 86 : scenario === "high" ? 64 : scenario === "two" ? 79 : 91,
      points_earned: 86, max_points: 100, categories: [] },
    checks,
    metadata: { title: "A useful guide to this page" },
    findings_summary: {
      total_checks: checks.length,
      raw_passes: statusCounts.pass,
      raw_warnings: statusCounts.warning,
      raw_failures: statusCounts.fail,
      raw_not_applicable: statusCounts.not_applicable,
      actionable_count: details.length,
      optional_note_count: 1,
      by_impact: impactCounts,
      by_effort: { quick: details.filter((item) => item[4] === "quick").length, moderate: details.filter((item) => item[4] === "moderate").length, larger_job: 0 },
      prioritized_check_ids: prioritizedIds,
      verdict: scenario === "noindex" ? "This page tells search engines not to index it."
        : scenario === "high" ? "3 fixes. The missing page description matters most."
          : scenario === "two" ? "2 small fixes."
          : scenario === "clear" ? "Nothing to fix in these checks." : "3 small fixes.",
      exclusions: [{ check_id: "json_ld", status: "warning", reason: "Missing optional JSON-LD is not a confirmed defect." }],
    },
  };
}

async function installAuthenticatedSession(page: Page, analysisResponse?: unknown | (() => unknown)) {
  await page.route("**/api/browser/v1/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      authenticated: true, user: { username: "test-reviewer" }, csrf_token: "c".repeat(43),
    }) });
  });
  await page.route("**/api/browser/v1/analyse-url", async (route) => {
    const body = analysisResponse === undefined ? {
      error: { code: "invalid_url", message: "The requested URL is invalid.", request_id: "e2e-analysis" },
    } : typeof analysisResponse === "function" ? analysisResponse() : analysisResponse;
    await route.fulfill({ status: analysisResponse === undefined ? 422 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function showLocalExample(page: Page) {
  await page.getByRole("button", { name: "Open local example" }).click();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
}

test("supports demo navigation, keyboard focus, filter state, and browser history", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    // The anonymous session bootstrap intentionally returns a protected 401;
    // Chromium reports failed HTTP resources as console errors despite the UI handling it.
    if (message.type() === "error" && !/responded with a status of 401 \(Unauthorized\)/.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") unexpectedRequests.push(request.url());
  });
  await installAnonymousSession(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to review" })).toBeFocused();
  expect(await page.getByRole("link", { name: "Skip to review" }).evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
  await page.keyboard.press("Tab");
  await expect(page.locator(".wordmark")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Skip to review" })).toBeFocused();
  await page.getByRole("button", { name: "Open local example" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main h1")).toBeFocused();
  await expect(page.getByText(/Fictional local example · static HTML fixture/)).toBeVisible();

  await page.getByRole("link", { name: /Findings/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeFocused();
  const ids = await page.locator(".finding-groups [data-finding-id]").evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-finding-id")),
  );
  expect(ids).toEqual(["robots_directives", "visible_text", "open_graph", "twitter_metadata"]);

  await page.getByRole("searchbox", { name: "Search findings" }).fill("robots");
  const finding = page.getByRole("link", { name: /Robots directives are reported/ });
  await finding.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeFocused();
  expect(page.url()).toContain("q=robots");

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search findings" })).toHaveValue("robots");
  await expect(page.locator("[data-finding-id='robots_directives']")).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  await expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  expect(page.url()).not.toContain(encodeURIComponent(sampleAddress));
});

test("uses the protected API for live submission and keeps the local example explicitly separate", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") externalRequests.push(request.url());
  });
  await installAuthenticatedSession(page);
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "Inspect what a page returns." })).toBeVisible();
  await page.getByLabel("Page address").fill("https://not-contacted.example/page/");
  await page.getByLabel("Page address").press("Enter");
  await expect(page.getByRole("alert")).toContainText("Enter a valid page address");
  expect(externalRequests).toEqual([]);
  await showLocalExample(page);
  await expect(page.getByText(/Fictional local example/)).toBeVisible();
  expect(page.url()).toContain("source=demo");
  expect(page.url()).not.toContain(encodeURIComponent("https://not-contacted.example/page/"));

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
});

test("recovers from an unavailable fixture on a direct demo-detail route", async ({ page }) => {
  await installAnonymousSession(page);
  await page.route("**/fixtures/audit.json", (route) => route.abort("failed"));
  await page.goto("/?view=detail&source=demo&mode=review&check=robots_directives");
  await expect(page.getByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
  await expect(page.getByText("No website was requested. Restore the bundled Northstar example files, then retry.")).toBeVisible();
  await page.unroute("**/fixtures/audit.json");
  await page.getByRole("button", { name: "Try loading the local example again" }).click();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  await expect(page).toHaveURL(/view=detail/);
});

test("has no automated axe violations on sign-in and local report views", async ({ page }) => {
  await installAnonymousSession(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  const loginResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(loginResults.violations).toEqual([]);

  await showLocalExample(page);
  const overviewResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(overviewResults.violations).toEqual([]);
  await page.getByRole("link", { name: /Findings/ }).click();
  const findingResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(findingResults.violations).toEqual([]);
  await page.getByRole("link", { name: /Robots directives are reported/ }).click();
  const detailResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(detailResults.violations).toEqual([]);
});

test("captures demo and authentication browser review screenshots", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installAnonymousSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  await page.screenshot({ path: "review/evidence/phase-2d/login-1440x900.png", fullPage: true });
  await showLocalExample(page);
  await page.screenshot({ path: "review/evidence/phase-2d/demo-overview-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "review/evidence/phase-2d/demo-overview-390x844.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: /Findings/ }).click();
  await page.screenshot({ path: "review/evidence/phase-2d/demo-findings-1440x900.png", fullPage: true });
  await page.getByRole("link", { name: /All checks/ }).click();
  await page.screenshot({ path: "review/evidence/phase-2d/demo-all-checks-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole("list", { name: "All analyzer checks in fixture order" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: "review/evidence/phase-2d/demo-findings-320x844.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: /Robots directives are reported/ }).click();
  await page.screenshot({ path: "review/evidence/phase-2d/demo-evidence-390x844.png", fullPage: true });
  expect(pageErrors).toEqual([]);
});

test("has no horizontal overflow at narrow widths across report views", async ({ page }) => {
  await installAnonymousSession(page);
  await page.goto("/?view=overview&source=demo");
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("link", { name: /Findings/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("link", { name: /Robots directives are reported/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("button", { name: "Change page" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
    await page.getByRole("button", { name: "Open local example" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test("renders v1.1 verdicts, shared counts, priority order, and severity colors in production reports", async ({ page }) => {
  const externalRequests: string[] = [];
  let scenario: ReportScenario = "normal";
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") externalRequests.push(request.url());
  });
  await installAuthenticatedSession(page, () => resolvedAnalysis(scenario));

  async function openScenario(next: ReportScenario) {
    scenario = next;
    if (await page.getByRole("button", { name: "Change page" }).count()) {
      await page.getByRole("button", { name: "Change page" }).click();
    }
    await page.getByLabel("Page address").fill(`https://example.test/${next}/`);
    await page.getByRole("button", { name: "Analyze page" }).click();
    const expected = next === "noindex" ? "This page tells search engines not to index it."
      : next === "high" ? "3 fixes. The missing page description matters most."
        : next === "two" ? "2 small fixes."
        : next === "clear" ? "Nothing to fix in these checks." : "3 small fixes.";
    await expect(page.getByTestId("report-verdict")).toHaveText(expected);
  }

  async function assertColorPolicy() {
    const verdict = page.getByTestId("report-verdict");
    expect(await verdict.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(20, 19, 15)");
    const offenders = await page.locator("body *").evaluateAll((elements) => {
      const isVermilion = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return false;
        const red = Number(match[1]);
        const green = Number(match[2]);
        const blue = Number(match[3]);
        const maximum = Math.max(red, green, blue) / 255;
        const minimum = Math.min(red, green, blue) / 255;
        const delta = maximum - minimum;
        if (delta === 0 || maximum === 0) return false;
        let hue = maximum === red / 255
          ? 60 * (((green / 255 - blue / 255) / delta) % 6)
          : maximum === green / 255
            ? 60 * ((blue / 255 - red / 255) / delta + 2)
            : 60 * ((red / 255 - green / 255) / delta + 4);
        if (hue < 0) hue += 360;
        const saturation = delta / maximum;
        return hue >= 0 && hue <= 25 && saturation > 0.35;
      };
      return elements.flatMap((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        const used = [style.color, style.backgroundColor, style.borderTopColor, style.borderRightColor,
          style.borderBottomColor, style.borderLeftColor, style.outlineColor];
        if (!used.some(isVermilion)) return [];
        if (node.closest(".wordmark, .impact-blocking, .impact-high, .xray-mark")) return [];
        return [`${node.tagName.toLowerCase()}.${String(node.className)}`];
      });
    });
    expect(offenders).toEqual([]);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "Inspect what a page returns." })).toBeVisible();

  for (const next of ["normal", "high", "noindex"] as const) {
    await openScenario(next);
    await assertColorPolicy();
    expect(await page.locator(".nav-count").innerText()).toBe("3");
    if (next === "normal") {
      await expect(page.getByTestId("summary-count-line")).toHaveText("3 to fix · 1 passed · 1 not applicable");
    }
    const priorityNumbers = await page.locator("[data-priority-card] .priority-number").allTextContents();
    expect(priorityNumbers).toEqual(["1", "2", "3"]);
    expect(await page.locator("[data-priority-card]").count()).toBe(3);
    if (next === "normal") await page.screenshot({ path: "review/s1-b/s1-b-summary-normal-1440x900.png" });
    if (next === "high") await page.screenshot({ path: "review/s1-b/s1-b-summary-high-1440x900.png" });
    if (next === "noindex") await page.screenshot({ path: "review/s1-b/s1-b-summary-noindex-1440x900.png" });

    if (next === "normal") {
      await page.locator("[data-priority-card='1'] .priority-action").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Make the page title more descriptive" })).toBeVisible();
      await page.getByRole("link", { name: /Back to findings/ }).click();
      await page.getByRole("link", { name: "Overview" }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const boxes = await page.locator("[data-priority-card]").evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      }));
      console.log("S1B-5 normal mobile priority-card bounds:", JSON.stringify(boxes.slice(0, 2)));
      expect(boxes.slice(0, 2).every((box) => box.y >= 0 && box.bottom <= 844 && box.right <= 390)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      expect(await page.locator(".fixed-bottom-nav").count()).toBe(0);
      await page.screenshot({ path: "review/s1-b/s1-b-summary-normal-390x844.png" });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    if (next === "high") {
      await page.setViewportSize({ width: 390, height: 844 });
      const boxes = await page.locator("[data-priority-card]").evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      }));
      console.log("S1B-5 high mobile priority-card bounds:", JSON.stringify(boxes.slice(0, 2)));
      expect(boxes.slice(0, 2).every((box) => box.y >= 0 && box.bottom <= 844 && box.right <= 390)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      await page.screenshot({ path: "review/s1-b/s1-b-summary-high-390x844.png" });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    if (next === "noindex") {
      await page.setViewportSize({ width: 390, height: 844 });
      const boxes = await page.locator("[data-priority-card]").evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      }));
      console.log("S1B-5 noindex mobile priority-card bounds:", JSON.stringify(boxes.slice(0, 2)));
      expect(boxes.slice(0, 2).every((box) => box.y >= 0 && box.bottom <= 844 && box.right <= 390)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      await page.screenshot({ path: "review/s1-b/s1-b-summary-noindex-390x844.png" });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }

  await page.getByRole("button", { name: "Review all checks" }).click();
  await expect(page.getByTestId("findings-count-line")).toHaveText("3 to fix · 1 passed · 1 not applicable");
  expect(await page.locator(".nav-count").innerText()).toBe("3");
  await expect(page.getByRole("link", { name: /Needs review/ })).toBeVisible();
  const blockingBadge = page.locator(".finding-item .impact-blocking").first();
  const blockingBadgeWidth = await blockingBadge.evaluate((element) => element.getBoundingClientRect().width);
  const blockingRowWidth = await blockingBadge.locator("xpath=ancestor::li[contains(@class, 'finding-item')]").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(blockingBadgeWidth).toBeLessThan(blockingRowWidth / 2);
  await page.screenshot({ path: "review/s1-b/s1-b-findings-1440x900.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "review/s1-b/s1-b-findings-390x844.png" });

  expect(await page.locator(".report-nav a").allTextContents()).toEqual(["Overview", "Findings 3"]);

  await page.getByRole("button", { name: "Change page" }).click();
  scenario = "two";
  await page.getByLabel("Page address").fill("https://example.test/two/");
  await page.getByRole("button", { name: "Analyze page" }).click();
  await expect(page.getByTestId("report-verdict")).toHaveText("2 small fixes.");
  await expect(page.getByTestId("summary-count-line")).toHaveText("2 to fix · 1 passed · 1 not applicable");
  expect(await page.locator(".nav-count").innerText()).toBe("2");
  await page.getByRole("button", { name: "Review all checks" }).click();
  await expect(page.getByTestId("findings-count-line")).toHaveText("2 to fix · 1 passed · 1 not applicable");
  expect(await page.locator(".nav-count").innerText()).toBe("2");
  await expect(page.locator(".findings-optional-notes summary")).toHaveText("Optional notes (1)");
  expect(await page.locator("[data-finding-id='json_ld']").count()).toBe(0);

  await page.getByRole("button", { name: "Change page" }).click();
  scenario = "clear";
  await page.getByLabel("Page address").fill("https://example.test/clear/");
  await page.getByRole("button", { name: "Analyze page" }).click();
  await expect(page.getByTestId("report-verdict")).toHaveText("Nothing to fix in these checks.");
  await assertColorPolicy();
  await expect(page.getByTestId("summary-count-line")).toHaveText("0 to fix · 1 passed · 1 not applicable");
  expect(await page.locator(".nav-count").innerText()).toBe("0");
  expect(await page.locator("[data-priority-card]").count()).toBe(0);
  expect(externalRequests).toEqual([]);
});
