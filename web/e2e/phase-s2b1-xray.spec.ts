import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const auditFixture = JSON.parse(readFileSync(resolve(process.cwd(), "public/fixtures/audit.json"), "utf8")) as unknown;
const evidenceDirectory = resolve(process.cwd(), "review/s2-b1");
const appOrigin = "http://127.0.0.1:4173";
mkdirSync(evidenceDirectory, { recursive: true });

async function installLocalExample(page: Page) {
  await page.route("**/api/guest/v1/session", (route) => route.fulfill({ status: 404, body: "Guest audit disabled in local UI test." }));
  await page.route("**/fixtures/audit.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auditFixture) }));
  await page.route("**/fixtures/northstar-solar.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: '<!doctype html><html><head><title>Home Solar Installation: Planning Guide | Northstar</title><meta name="robots" content="noindex, follow"></head><body><h1>Plan a home solar installation</h1></body></html>',
  }));
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
