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

async function installAuthenticatedSession(page: Page) {
  await page.route("**/api/browser/v1/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      authenticated: true, user: { username: "test-reviewer" }, csrf_token: "c".repeat(43),
    }) });
  });
  await page.route("**/api/browser/v1/analyse-url", async (route) => {
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
      error: { code: "invalid_url", message: "The requested URL is invalid.", request_id: "e2e-analysis" },
    }) });
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
