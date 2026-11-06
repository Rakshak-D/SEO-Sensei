import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const sampleAddress = "https://northstar.example/guides/home-solar/";

test("supports direct report routes, keyboard activation, history, and focus restoration", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") externalRequests.push(request.url());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to review" })).toBeFocused();
  expect(await page.getByRole("link", { name: "Skip to review" }).evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
  await page.keyboard.press("Tab");
  await expect(page.locator(".wordmark")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Skip to review" })).toBeFocused();

  const url = page.getByLabel("Page address");
  await url.fill(sampleAddress);
  await url.press("Enter");
  await expect(page.getByRole("heading", { name: "Home Solar Installation: Planning Guide" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();

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
  await page.getByRole("link", { name: /Back to findings/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeVisible();
  await expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("keeps local-only entry behavior, sample activation, simulated recheck, and reduced motion", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
  const url = page.getByLabel("Page address");
  await url.fill("https://elsewhere.example/page/");
  await url.press("Enter");
  await expect(page.getByRole("alert")).toContainText("This address was not requested");
  expect(requested.some((item) => item.includes("elsewhere.example"))).toBe(false);

  const sampleButton = page.getByRole("button", { name: "Open local sample" });
  await sampleButton.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();
  await expect(page.getByText(/Optional AI suggestions are unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Show recheck simulation" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toContainText("No request is running");
  await expect(page.getByRole("status")).toContainText("No recheck was performed", { timeout: 2_000 });
  await page.getByRole("button", { name: "Change page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
  await page.getByRole("button", { name: "Open local sample" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
  expect(requested.every((item) => new URL(item).origin === "http://127.0.0.1:4173")).toBe(true);
});

test("handles unavailable fixture on a direct detail route and retries without leaving the route", async ({ page }) => {
  await page.route("**/fixtures/audit.json", (route) => route.abort("failed"));
  await page.goto("/?view=detail&mode=review&check=robots_directives");
  await expect(page.getByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
  await expect(page.getByText("No website was requested. Restore the bundled Northstar example files, then retry.")).toBeVisible();
  await page.unroute("**/fixtures/audit.json");
  await page.getByRole("button", { name: "Try loading the local example again" }).click();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  await expect(page).toHaveURL(/view=detail/);
});

test("has no automated axe violations on the principal entry and finding views", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
  const entryResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(entryResults.violations).toEqual([]);

  await page.getByRole("button", { name: "Open local sample" }).click();
  const overviewResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(overviewResults.violations).toEqual([]);
  await page.getByRole("link", { name: /Findings/ }).click();
  const findingResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(findingResults.violations).toEqual([]);
  await page.getByRole("link", { name: /Robots directives are reported/ }).click();
  const detailResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(detailResults.violations).toEqual([]);
});

test("captures the required real-browser review screenshots", async ({ page }) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") externalRequests.push(request.url());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
  await page.screenshot({ path: "review/evidence/desktop-entry-1440x900.png" });

  await page.getByRole("button", { name: "Open local sample" }).click();
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();
  await page.screenshot({ path: "review/evidence/desktop-overview-1440x900.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "review/evidence/mobile-overview-390x844.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: /Findings/ }).click();
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeVisible();
  await page.screenshot({ path: "review/evidence/desktop-needs-review-1440x900.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "review/evidence/mobile-needs-review-390x844.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: /All checks/ }).click();
  await page.screenshot({ path: "review/evidence/desktop-all-checks-1440x900.png" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: /Robots directives are reported/ }).click();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  await page.screenshot({ path: "review/evidence/desktop-evidence-1440x900.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "review/evidence/mobile-evidence-390x844.png" });

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("link", { name: /Back to findings/ }).click();
  await page.getByRole("link", { name: /All checks/ }).click();
  await expect(page.getByRole("list", { name: "All analyzer checks in fixture order" })).toBeVisible();
  await page.screenshot({ path: "review/evidence/findings-320x844.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/fixtures/audit.json", (route) => route.abort("failed"));
  await page.goto("/?view=overview");
  await expect(page.getByRole("heading", { name: "The sample report could not be opened." })).toBeVisible();
  await page.screenshot({ path: "review/evidence/fixture-error-390x844.png" });
  await page.unroute("**/fixtures/audit.json");
  await page.getByRole("button", { name: "Try loading the local example again" }).click();
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("has no horizontal overflow at 390px and 320px in each report view", async ({ page }) => {
  await page.goto("/?view=overview");
  await expect(page.getByRole("heading", { name: "A noindex directive is present." })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("link", { name: /Findings/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("link", { name: /Robots directives are reported/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("button", { name: "Change page" }).click();
    await expect(page.getByRole("heading", { name: "A clearer view of what a page returns." })).toBeVisible();
    await page.getByRole("button", { name: "Open local sample" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
