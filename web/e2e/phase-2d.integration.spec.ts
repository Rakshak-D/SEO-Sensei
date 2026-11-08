import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const appOrigin = process.env.PHASE2D_BASE_URL ?? "https://seo-sensei.localhost:8443";
const apiDomain = process.env.PHASE2D_API_BASE_URL ?? "https://seo-sensei-api.localhost:8443";
const username = process.env.PHASE2D_TEST_USERNAME ?? "phase2d-reviewer";
const password = process.env.PHASE2D_TEST_PASSWORD;
const evidenceDir = "review/evidence/phase-2d";
const requestPath = "/api/browser/v1/analyse-url";

mkdirSync(evidenceDir, { recursive: true });

async function analyze(page: Page, url: string, expectedStatus = 200) {
  await page.getByLabel("Page address").fill(url);
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === requestPath);
  await page.getByRole("button", { name: "Analyze page" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  return response;
}

async function reanalyze(page: Page, expectedStatus = 200) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === requestPath);
  await page.getByRole("button", { name: "Analyze again" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  return response;
}

test("authenticated HTTPS analysis, live reports, budget errors, session recovery, and screenshots", async ({ page, context }) => {
  test.skip(!password || password.length < 24, "The isolated integration runner must provide its disposable account password.");
  const browserErrors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/responded with a status of (401|403|429) \(/.test(message.text())) {
      browserErrors.push(message.text());
    }
  });
  page.on("request", (request) => requests.push(request.url()));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=entry");
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/login-1440x900.png`, fullPage: true });

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("wrong password for integration test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("The username or password is incorrect.");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Inspect what a page returns." })).toBeVisible();

  const sessionCookie = (await context.cookies(appOrigin)).find((cookie) => cookie.name === "__Host-seo_sensei_session");
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie?.secure).toBe(true);
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(sessionCookie?.path).toBe("/");
  expect(sessionCookie?.domain).toBe("seo-sensei.localhost");
  expect(await page.evaluate(() => document.cookie)).not.toContain("__Host-seo_sensei_session");

  const noindexResponse = await analyze(page, "https://phase2d.test/pages/noindex");
  const noindexData = await noindexResponse.json() as { requested_url: string; checks: Array<{ id: string; status: string }> };
  expect(noindexData.requested_url).toBe("https://phase2d.test/pages/noindex");
  expect(noindexData.checks.find((check) => check.id === "robots_directives")?.status).toBe("fail");
  await expect(page.getByRole("heading", { name: "Home Solar Project Planning Guide for Owners" })).toBeVisible();
  await expect(page.getByText("Detected directives: noindex, follow.")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("url")).toBeNull();
  expect(new URL(page.url()).searchParams.get("requested_url")).toBeNull();
  await page.screenshot({ path: `${evidenceDir}/live-noindex-overview-1440x900.png`, fullPage: true });

  await page.getByRole("link", { name: /Findings/ }).click();
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/of \d+ review checks/);
  const allList = page.getByRole("link", { name: /All checks/ });
  await allList.click();
  await expect(page.getByRole("list", { name: "All analyzer checks in response order" }).getByRole("listitem")).toHaveCount(23);
  await expect(page.getByRole("link", { name: /Rule status: Not applicable/ }))
    .toHaveCount(noindexData.checks.filter((check) => check.status === "not_applicable").length);
  await page.getByRole("link", { name: /Needs review/ }).click();
  await page.screenshot({ path: `${evidenceDir}/live-findings-needs-review-1440x900.png`, fullPage: true });
  await page.getByRole("link", { name: /Robots directives are reported/ }).click();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeFocused();
  await expect(page.getByText(/analyzer-returned checks\[\]\.evidence\.observed/i)).toBeVisible();
  await expect(page.getByText(/fictional fixture/i)).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/live-evidence-1440x900.png`, fullPage: true });
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Findings investigation" })).toBeVisible();
  await expect(page.locator("[data-finding-id='robots_directives']")).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Robots directives are reported" })).toBeVisible();
  await page.getByRole("button", { name: "Change page" }).click();

  const allPassResponse = await analyze(page, "https://phase2d.test/pages/all-pass");
  const allPassData = await allPassResponse.json() as { checks: Array<{ status: string }> };
  expect(allPassData.checks).toHaveLength(23);
  expect(allPassData.checks.every((check) => check.status === "pass" || check.status === "not_applicable")).toBe(true);
  await expect(page.getByText("No failed rules in this response.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /noindex directive is present/i })).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/live-all-pass-overview-1440x900.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: `${evidenceDir}/live-all-pass-overview-390x844.png`, fullPage: true });
  const allPassAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(allPassAxe.violations).toEqual([]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Change page" }).click();
  const warningResponse = await analyze(page, "https://phase2d.test/pages/warnings");
  const warningData = await warningResponse.json() as { checks: Array<{ status: string }> };
  expect(warningData.checks.some((check) => check.status === "warning")).toBe(true);
  expect(warningData.checks.some((check) => check.status === "fail")).toBe(false);
  await page.getByRole("button", { name: /Review \d+ checks/ }).click();
  await expect(page.getByRole("status")).toContainText("of ");
  await page.screenshot({ path: `${evidenceDir}/live-findings-warnings-1440x900.png`, fullPage: true });
  await page.getByRole("link", { name: /All checks/ }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: `${evidenceDir}/live-findings-320x844.png`, fullPage: true });
  await page.getByRole("link", { name: /Needs review/ }).click();
  await page.getByRole("link", { name: /Title is present and reasonably bounded/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: `${evidenceDir}/live-evidence-390x844.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Overview" }).click();
  for (let successful = 4; successful <= 6; successful += 1) await reanalyze(page, 200);
  const rejected = await reanalyze(page, 429);
  expect(Number(rejected.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toContainText("Wait approximately");
  await expect(page.getByRole("heading", { name: /Solar notes/ })).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/live-rate-limited-1440x900.png`, fullPage: true });

  const logoutResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/browser/v1/session/logout");
  await page.getByRole("button", { name: "Sign out" }).click();
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  expect((await context.cookies(appOrigin)).some((cookie) => cookie.name === "__Host-seo_sensei_session")).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=overview&source=live");
  await expect(page.getByRole("heading", { name: "Sign in to analyze a page." })).toBeVisible();
  await expect(page.getByText(/No active browser session was found/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/live-session-expired-390x844.png`, fullPage: true });
  expect((await context.cookies(appOrigin)).some((cookie) => cookie.name === "__Host-seo_sensei_session")).toBe(false);
  expect(browserErrors).toEqual([]);
  expect(requests.every((url) => new URL(url).origin === appOrigin)).toBe(true);
});

test("Caddy serves SPA paths and isolates browser auth from the extension API domain", async ({ page }) => {
  const appFallback = await page.goto("/reports/direct/history");
  expect(appFallback?.status()).toBe(200);
  await expect(page.locator("#root")).toBeVisible();

  const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  for (const path of [
    "/api/browser/v1",
    "/api/browser/v1/",
    "/api/browser/v1/session",
    "/api/browser/v1/session/login",
    "/api/browser/v1/session/logout",
    "/api/browser/v10",
    "/api/browser/v1evil",
  ]) {
    await page.setExtraHTTPHeaders({ Origin: extensionOrigin });
    const response = await page.goto(`${apiDomain}${path}`);
    expect(response).not.toBeNull();
    expect(response!.status(), path).toBe(404);
    expect(response!.headers()["access-control-allow-origin"], path).toBeUndefined();
  }

  await page.setExtraHTTPHeaders({ Origin: extensionOrigin });
  const extensionOnApp = await page.goto(`${appOrigin}/api/browser/v1/session`);
  expect(extensionOnApp?.status()).toBe(403);
  expect(extensionOnApp!.headers()["access-control-allow-origin"]).toBeUndefined();
  const extensionError = await extensionOnApp!.json() as { error: { code: string } };
  expect(extensionError.error.code).toBe("origin_rejected");

  await page.setExtraHTTPHeaders({});
  const appBootstrap = await page.goto(`${appOrigin}/api/browser/v1/session`);
  expect(appBootstrap?.status()).toBe(401);
  const bootstrapBody = await appBootstrap!.json() as { error: { code: string } };
  expect(bootstrapBody.error.code).toBe("auth_required");
});
