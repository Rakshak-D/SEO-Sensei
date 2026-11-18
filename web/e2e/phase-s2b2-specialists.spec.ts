import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidenceDirectory = resolve(process.cwd(), "review/s2-b2");
mkdirSync(evidenceDirectory, { recursive: true });

async function capture(page: Page, filename: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: resolve(evidenceDirectory, filename), animations: "disabled" });
}

async function rectangles(page: Page, selectors: string[]) {
  return page.evaluate((items) => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY: rounded(scrollY),
      elements: Object.fromEntries(items.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        const box = element?.getBoundingClientRect();
        return [selector, box ? {
          x: rounded(box.x), y: rounded(box.y), width: rounded(box.width),
          height: rounded(box.height), bottom: rounded(box.bottom),
        } : null];
      })),
    };
  }, selectors);
}

test("local example opens reload-safe On-page and Previews with usable mobile navigation", async ({ page, baseURL, browser }) => {
  const appOrigin = new URL(baseURL!).origin;
  console.log("S2-B2 screenshot browser:", browser.version());
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin) externalRequests.push(origin);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Example: Northstar Solar" }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByText(/Fictional local example/)).toBeVisible();

  await page.getByRole("link", { name: "On-page" }).click();
  await expect(page.getByRole("heading", { name: "On-page content" })).toBeFocused();
  await expect(page).toHaveURL(/view=on-page&source=demo&access=guest/);
  await expect(page.getByText("Headings are grouped by heading level; the returned data does not preserve their full original order.")).toBeVisible();
  await expect(page.getByText(/Fictional local example/)).toBeVisible();
  console.log("S2-B2 demo On-page desktop rectangles:", JSON.stringify(await rectangles(page, [
    "#guest-onpage-title", "#guest-onpage-title-field", ".guest-mobile-tabs",
  ])));
  await capture(page, "on-page-demo-desktop-1440x900.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log("S2-B2 demo On-page mobile rectangles:", JSON.stringify(await rectangles(page, [
    "#guest-onpage-title", "#guest-onpage-title-field", ".guest-mobile-tabs",
  ])));
  await capture(page, "on-page-demo-mobile-390x844.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("link", { name: "Previews" }).click();
  await expect(page.getByRole("heading", { name: "Search and social previews" })).toBeFocused();
  await expect(page).toHaveURL(/view=previews&source=demo&access=guest/);
  await expect(page.getByText(/Search engines may display something different/)).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "On-page content" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Search and social previews" })).toBeVisible();

  const xrayTab = page.locator(".guest-mobile-tabs a").filter({ hasText: "X-ray" });
  await expect(xrayTab.locator("small")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Pages" });
  await expect(sheet).toBeFocused();
  await expect(sheet.getByRole("link", { name: "Previews" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Shift+Tab");
  expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("dialog", { name: "Pages" }).getByRole("link", { name: "On-page" }).click();
  await expect(page.getByRole("heading", { name: "On-page content" })).toBeFocused();
  const breakpoints = [320, 390, 768, 1024, 1440];
  const measurements: Array<{ width: number; onPageScrollWidth: number; previewsScrollWidth: number; minTarget: number; onPageNavTop?: number; onPageLastActionBottom?: number; navTop?: number; lastActionBottom?: number }> = [];
  const selectView = async (view: "On-page" | "Previews", width: number) => {
    if (width <= 1023) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("dialog", { name: "Pages" }).getByRole("link", { name: view }).click();
    } else {
      await page.getByRole("link", { name: view }).click();
    }
  };
  for (const width of breakpoints) {
    await page.setViewportSize({ width, height: 844 });
    const onPageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const minTarget = await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>(".guest-app button:not([disabled]), .guest-app a[href]"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
        });
      return Math.min(...targets.map((element) => element.getBoundingClientRect().height));
    });
    expect(onPageScrollWidth, `On-page overflow at ${width}px`).toBeLessThanOrEqual(width);

    const measured: (typeof measurements)[number] = { width, onPageScrollWidth, previewsScrollWidth: 0, minTarget };
    if (width <= 1023) {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      measured.onPageNavTop = await page.locator(".guest-mobile-tabs").evaluate((element) => element.getBoundingClientRect().top);
      measured.onPageLastActionBottom = await page.locator(".guest-onpage .guest-specialist-related button").last().evaluate((element) => element.getBoundingClientRect().bottom);
      expect(measured.minTarget, `Minimum visible target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(measured.onPageLastActionBottom, `On-page bottom clearance at ${width}px`).toBeLessThanOrEqual(measured.onPageNavTop);
    }

    await selectView("Previews", width);
    const previewsScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(previewsScrollWidth, `Previews overflow at ${width}px`).toBeLessThanOrEqual(width);
    measured.previewsScrollWidth = previewsScrollWidth;
    if (width <= 1023) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      measured.navTop = await page.locator(".guest-mobile-tabs").evaluate((element) => element.getBoundingClientRect().top);
      measured.lastActionBottom = await page.locator(".guest-previews-related").evaluate((element) => element.getBoundingClientRect().bottom);
      expect(measured.minTarget, `Minimum visible target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(measured.lastActionBottom, `Previews bottom clearance at ${width}px`).toBeLessThanOrEqual(measured.navTop);
    }
    measurements.push(measured);
    await selectView("On-page", width);
  }
  console.log("S2-B2 specialist responsive measurements:", JSON.stringify(measurements));
  expect(externalRequests).toEqual([]);
});

test("a guest specialist route never restores an unavailable live report from the local example", async ({ page }) => {
  let analysisRequests = 0;
  await page.route("**/api/guest/v1/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      csrf_token: "c".repeat(43), expires_in: 3600, bot_check_required: false, turnstile_sitekey: null, turnstile_action: null,
    }) });
  });
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    analysisRequests += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "Unavailable", request_id: "controlled" } }) });
  });
  await page.goto("/?view=on-page&source=guest");
  await expect(page.getByRole("heading", { name: "Start a new audit to see this page again." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On-page content" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Example: Northstar Solar" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Start a new audit to see this page again." })).toBeVisible();
  expect(analysisRequests).toBe(0);
});
