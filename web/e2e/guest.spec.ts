import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
const auditFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/fixtures/audit.json"), "utf8"),
) as unknown;
const appOrigin = "http://127.0.0.1:4173";
const reviewUrl = "https://safe.example/review/";
const csrfToken = "c".repeat(43);
const challengeToken1 = "controlled-challenge-one";
const challengeToken2 = "controlled-challenge-two";
function liveResponse() {
  const checks = [
    {
      id: "meta_description",
      category: "metadata",
      title: "Meta description",
      status: "warning",
      points: 0,
      max_points: 10,
      evidence: {
        observed: "No meta description was found in the fetched HTML.",
        value: null,
      },
      recommendation: "Write a page-specific description.",
      impact: "high",
      effort: "quick",
      finding_title: "Add a page description.",
      finding_reason:
        "The page has no short description to summarize its content.",
      fix_snippet:
        '<meta name="description" content="Write a page-specific summary.">',
      snippet_requires_review: true,
      is_actionable: true,
      optional_note: null,
      exclusion_reason: null,
    },
    {
      id: "retrieval_success",
      category: "technical_indexability",
      title: "HTML retrieval",
      status: "pass",
      points: 10,
      max_points: 10,
      evidence: {
        observed: "The server returned an HTML document.",
        value: 200,
      },
      recommendation: "No action is required.",
      impact: null,
      effort: null,
      finding_title: null,
      finding_reason: null,
      fix_snippet: null,
      snippet_requires_review: false,
      is_actionable: false,
      optional_note: null,
      exclusion_reason: null,
    },
  ];
  return {
    requested_url: reviewUrl,
    final_url: reviewUrl,
    fetch: {
      requested_url: reviewUrl,
      final_url: reviewUrl,
      status_code: 200,
      content_type: "text/html",
      content_length: 512,
      bytes_read: 512,
      redirect_count: 0,
      elapsed_time: 0.1,
      x_robots_tag: null,
    },
    deterministic_score: {
      version: "1.1",
      overall_score: 75,
      points_earned: 15,
      max_points: 20,
      categories: [
        {
          category: "metadata",
          weight: 20,
          points_earned: 15,
          max_points: 20,
          raw_points: 15,
          raw_max_points: 20,
          check_ids: ["meta_description"],
        },
      ],
    },
    checks,
    metadata: { title: "A useful page review" },
    findings_summary: {
      total_checks: 2,
      raw_passes: 1,
      raw_warnings: 1,
      raw_failures: 0,
      raw_not_applicable: 0,
      actionable_count: 1,
      optional_note_count: 0,
      by_impact: { blocking: 0, high: 1, medium: 0, low: 0 },
      by_effort: { quick: 1, moderate: 0, larger_job: 0 },
      prioritized_check_ids: ["meta_description"],
      verdict: "Add a page description.",
      exclusions: [],
    },
  };
}
test("renders an honest unavailable state without falling back to fictional live data", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin)
      externalRequests.push(new URL(request.url()).origin);
  });
  await page.route("**/api/guest/v1/session", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "Not found",
    });
  });
  await page.route("**/fixtures/audit.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(auditFixture),
    });
  });
  await page.route("**/fixtures/northstar-solar.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<html><head><meta name="robots" content="noindex, follow"></head></html>',
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Check a web page for SEO problems." }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Guest audits are not available",
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByTestId("report-verdict")).toHaveCount(0);
  const analysisRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/guest/v1/analyse-url"))
      analysisRequests.push(request.url());
  });
  await page.getByRole("button", { name: "Example: Northstar Solar" }).click();
  await expect(page.getByText(/Fictional local example/)).toBeVisible();
  expect(analysisRequests).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More" }).click();
  const moreSheet = page.getByRole("dialog", { name: "Pages" });
  await expect(moreSheet).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await moreSheet.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More" })).toBeFocused();
  expect(externalRequests).toEqual([]);
});

test("keeps guest Home, Summary, and Fix list within the viewport with usable touch targets", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin)
      externalRequests.push(new URL(request.url()).origin);
  });
  await page.route("**/api/guest/v1/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      csrf_token: csrfToken,
      expires_in: 3600,
      bot_check_required: false,
      turnstile_sitekey: null,
      turnstile_action: null,
    }) });
  });
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liveResponse()) });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Check page" })).toBeEnabled();
  expect(await page.locator("script[data-guest-turnstile]").count()).toBe(0);
  expect(externalRequests).toEqual([]);
  const widths = [320, 390, 768, 1024, 1440];
  const measured: Array<{ width: number; home: number; summary: number; fixes: number; minTarget: number }> = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    measured.push({ width, home: await page.evaluate(() => document.documentElement.scrollWidth), summary: 0, fixes: 0, minTarget: 0 });
  }
  await page.getByLabel("Page address").fill(reviewUrl);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByTestId("report-verdict")).toHaveCSS("color", "rgb(20, 19, 15)");

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const measurement = measured.find((entry) => entry.width === width)!;
    measurement.summary = await page.evaluate(() => document.documentElement.scrollWidth);
    measurement.minTarget = await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>(".guest-app button:not([disabled]), .guest-app a[href], .guest-app summary"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
        });
      return Math.min(...targets.map((element) => element.getBoundingClientRect().height));
    });
    expect(measurement.summary, `Summary scroll width at ${width}px`).toBeLessThanOrEqual(width);
    expect(measurement.minTarget, `Minimum interactive target height at ${width}px`).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "See all fixes" }).click();
  await expect(page.getByRole("heading", { name: "Fix list" })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const measurement = measured.find((entry) => entry.width === width)!;
    measurement.fixes = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(measurement.fixes, `Fix list scroll width at ${width}px`).toBeLessThanOrEqual(width);
  }
  console.log("Guest responsive measurements:", JSON.stringify(measured));
});

test("recovers from a controlled Turnstile error and submits a fresh one-use token only after success", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const analysisBodies: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin)
      externalRequests.push(new URL(request.url()).origin);
  });
  await page.addInitScript(() => {
    let widgetNumber = 0;
    const global = window as unknown as {
      turnstile?: {
        ready: (callback: () => void) => void;
        render: (
          _container: HTMLElement,
          options: Record<string, unknown>,
        ) => string;
        reset: (_id: string) => void;
        remove: (_id: string) => void;
      };
      __testTurnstileOptions?: Record<string, unknown>;
      __testTurnstileRenderCount?: number;
    };
    global.turnstile = {
      ready: (callback) => callback(),
      render: (_container, options) => {
        widgetNumber += 1;
        global.__testTurnstileOptions = options;
        global.__testTurnstileRenderCount = widgetNumber;
        return String(widgetNumber);
      },
      reset: () => undefined,
      remove: () => undefined,
    };
  });
  await page.route("**/api/guest/v1/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        csrf_token: csrfToken,
        expires_in: 3600,
        bot_check_required: true,
        turnstile_sitekey: "1x00000000000000000000AA",
        turnstile_action: "s2_public_audit",
      }),
    });
  });
  let analysisCount = 0;
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    analysisBodies.push(route.request().postDataJSON());
    analysisCount += 1;
    if (analysisCount === 1) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bot_verification_failed",
            message: "sanitized",
            request_id: "turnstile-test",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveResponse()),
    });
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __testTurnstileRenderCount?: number;
            }
          ).__testTurnstileRenderCount,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __testTurnstileOptions?: Record<string, unknown>;
          }
        ).__testTurnstileOptions?.action,
    ),
  ).toBe("s2_public_audit");
  await page.getByLabel("Page address").fill(reviewUrl);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(
    page.getByText("Complete the security check before starting the audit."),
  ).toBeVisible();
  expect(analysisCount).toBe(0);
  await page.evaluate(() => {
    const options = (
      window as unknown as {
        __testTurnstileOptions?: Record<string, () => void>;
      }
    ).__testTurnstileOptions;
    options?.["error-callback"]?.();
  });
  await expect(page.getByRole("alert")).toContainText(
    "The security check could not load",
  );
  await page.getByRole("button", { name: "Retry security check" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __testTurnstileRenderCount?: number;
            }
          ).__testTurnstileRenderCount,
      ),
    )
    .toBe(2);
  await page.evaluate(() => {
    const options = (
      window as unknown as {
        __testTurnstileOptions?: Record<string, (token?: string) => void>;
      }
    ).__testTurnstileOptions;
    options?.["expired-callback"]?.();
  });
  await expect(
    page.getByText(
      "The security check expired. Complete it again before auditing.",
    ),
  ).toBeVisible();
  await page.evaluate((token) => {
    const options = (
      window as unknown as {
        __testTurnstileOptions?: Record<string, (token?: string) => void>;
      }
    ).__testTurnstileOptions;
    options?.callback?.(token);
  }, challengeToken1);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The security check did not complete",
  );
  expect(analysisCount).toBe(1);
  expect(analysisBodies[0]).toEqual({
    url: reviewUrl,
    challenge_token: challengeToken1,
  });
  await page.getByRole("button", { name: "Retry security check" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __testTurnstileRenderCount?: number;
            }
          ).__testTurnstileRenderCount,
      ),
    )
    .toBe(4);
  await page.evaluate((token) => {
    const options = (
      window as unknown as {
        __testTurnstileOptions?: Record<string, (token?: string) => void>;
      }
    ).__testTurnstileOptions;
    options?.callback?.(token);
  }, challengeToken2);
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(
    page.getByRole("heading", { name: "Summary" }),
  ).toBeVisible();
  expect(analysisCount).toBe(2);
  expect(analysisBodies[1]).toEqual({
    url: reviewUrl,
    challenge_token: challengeToken2,
  });
  expect(externalRequests).toEqual([]);
});
