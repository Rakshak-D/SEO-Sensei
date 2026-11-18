import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4173";
const pageUrl = "https://colour-check.example/page/";

type TestImpact = "medium" | "high" | "blocking" | null;
type ApiMode =
  | { kind: "report"; analysis: ReturnType<typeof analysisFor> }
  | { kind: "error" }
  | { kind: "pending" };

function analysisFor(impact: TestImpact, includeSecondFinding = false, requestedUrl = pageUrl) {
  const checks: Array<Record<string, unknown>> = [{
    id: "retrieval_success", category: "technical_indexability", title: "HTML retrieval", status: "pass",
    points: 10, max_points: 10, evidence: { observed: "The controlled server returned an HTML document.", value: 200 },
    recommendation: "No action is required.", impact: null, effort: null, finding_title: null, finding_reason: null,
    fix_snippet: null, snippet_requires_review: false, is_actionable: false, optional_note: null, exclusion_reason: null,
  }];
  if (impact) checks.push({
    id: "meta_description", category: "metadata", title: "Meta description", status: impact === "blocking" ? "fail" : "warning",
    points: 0, max_points: 10, evidence: { observed: "No meta description was found in the controlled HTML.", value: null },
    recommendation: "Add a concise description of this page.", impact, effort: "quick",
    finding_title: "Add a page description.", finding_reason: "The fetched HTML has no page description.",
    fix_snippet: null, snippet_requires_review: false, is_actionable: true, optional_note: null, exclusion_reason: null,
    anatomy_part: "description",
  });
  if (includeSecondFinding) checks.push({
    id: "heading_hierarchy", category: "headings_content_structure", title: "Heading hierarchy", status: "warning",
    points: 4, max_points: 5, evidence: { observed: "A heading level is skipped in the controlled HTML.", value: "H1 to H3" },
    recommendation: "Review the returned heading order.", impact: "medium", effort: "moderate",
    finding_title: "Review the heading order.", finding_reason: "The returned headings skip a level.",
    fix_snippet: null, snippet_requires_review: false, is_actionable: true, optional_note: null, exclusion_reason: null,
    anatomy_part: "heading",
  });
  const verdict = impact === "blocking" ? "Resolve the blocking issue first."
    : impact === "high" ? "Fix this high-priority issue first."
      : impact === "medium" ? "Review this page finding."
        : "No actionable fixes were returned by these checks.";
  return {
    requested_url: requestedUrl,
    final_url: requestedUrl,
    fetch: {
      requested_url: requestedUrl, final_url: requestedUrl, status_code: 200, content_type: "text/html",
      content_length: 512, bytes_read: 512, redirect_count: 0, elapsed_time: 0.1, x_robots_tag: null,
    },
    deterministic_score: {
      version: "1.1", overall_score: impact ? (includeSecondFinding ? 75 : 80) : 100, points_earned: impact ? (includeSecondFinding ? 75 : 80) : 100, max_points: 100,
      categories: [
        { category: "technical_indexability", weight: 30, points_earned: 30, max_points: 30, raw_points: 30, raw_max_points: 30, check_ids: ["retrieval_success"] },
        ...(impact ? [{ category: "metadata", weight: 20, points_earned: 10, max_points: 20, raw_points: 10, raw_max_points: 20, check_ids: ["meta_description"] }] : []),
        ...(includeSecondFinding ? [{ category: "headings_content_structure", weight: 15, points_earned: 5, max_points: 15, raw_points: 5, raw_max_points: 15, check_ids: ["heading_hierarchy"] }] : []),
      ],
    },
    checks,
    metadata: {
      title: "A controlled page for interface checks", title_length: 39, title_count: 1,
      description: "Observed description for the controlled accessibility and colour regression.", description_length: 70,
      canonical: null, canonical_relationship: "missing", robots_directives: [], language: "en",
    },
    headings: { h1: ["A controlled page"], h2: ["Observed section"], h3: [], empty_heading_count: 0, hierarchy_jumps: [] },
    images: { total: 0, with_alt: 0, missing_alt: 0, empty_alt: 0, alt_coverage_percent: 100 },
    links: { total: 0, internal: 0, external: 0, empty_anchors: 0, nofollow: 0, sponsored: 0, ugc: 0 },
    structured_data: { block_count: 0, valid_blocks: 0, malformed_blocks: 0, types: [] },
    social_metadata: {
      og_title: null, og_description: null, og_image: null, og_url: null,
      twitter_card: null, twitter_title: null, twitter_description: null, twitter_image: null,
    },
    lexical_signals: { visible_word_count: 24, frequent_terms: [] },
    findings_summary: {
      total_checks: checks.length, raw_passes: 1,
      raw_warnings: (impact && impact !== "blocking" ? 1 : 0) + (includeSecondFinding ? 1 : 0),
      raw_failures: impact === "blocking" ? 1 : 0, raw_not_applicable: 0, actionable_count: (impact ? 1 : 0) + (includeSecondFinding ? 1 : 0),
      optional_note_count: 0,
      by_impact: { blocking: impact === "blocking" ? 1 : 0, high: impact === "high" ? 1 : 0, medium: (impact === "medium" ? 1 : 0) + (includeSecondFinding ? 1 : 0), low: 0 },
      by_effort: { quick: impact ? 1 : 0, moderate: includeSecondFinding ? 1 : 0, larger_job: 0 },
      prioritized_check_ids: [...(impact ? ["meta_description"] : []), ...(includeSecondFinding ? ["heading_hierarchy"] : [])], verdict, exclusions: [],
    },
  };
}

async function installApi(page: Page) {
  let mode: ApiMode = { kind: "report", analysis: analysisFor("medium") };
  let releasePending: (() => void) | null = null;
  await page.route("**/api/guest/v1/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ csrf_token: "c".repeat(43), expires_in: 3600, bot_check_required: false, turnstile_sitekey: null, turnstile_action: null }),
  }));
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    if (mode.kind === "error") {
      await route.fulfill({ status: 429, headers: { "Retry-After": "30" }, contentType: "application/json", body: JSON.stringify({
        error: { code: "rate_limited", message: "sanitized", request_id: "colour-check" },
      }) });
      return;
    }
    if (mode.kind === "pending") {
      await new Promise<void>((resolve) => { releasePending = resolve; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mode.kind === "report" ? mode.analysis : analysisFor("medium")) });
  });
  return {
    setReport: (impact: TestImpact, includeSecondFinding = false, requestedUrl = pageUrl) => {
      mode = { kind: "report", analysis: analysisFor(impact, includeSecondFinding, requestedUrl) };
    },
    setCustomReport: (analysis: ReturnType<typeof analysisFor>) => { mode = { kind: "report", analysis }; },
    setError: () => { mode = { kind: "error" }; },
    setPending: () => { mode = { kind: "pending" }; },
    releasePending: () => { releasePending?.(); releasePending = null; },
  };
}

async function submitAudit(page: Page, url = pageUrl) {
  await page.getByLabel("Page address").fill(url);
  await page.getByRole("button", { name: "Check page" }).click();
}

async function expectInkVerdict(page: Page) {
  const verdict = page.getByTestId("report-verdict");
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveCSS("color", "rgb(20, 19, 15)");
}

async function expectNoUnapprovedVermilion(page: Page, label: string) {
  console.log("Computed colour scan:", label);
  const violations = await page.evaluate(() => {
    const redChannels = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const channels = match[1]!.replace(/\//g, " ").split(/[ ,]+/).filter(Boolean).map(Number);
      if (channels.length < 3 || channels.some((part) => !Number.isFinite(part))) return null;
      const [red, green, blue] = channels;
      const alpha = channels[3] ?? 1;
      if (alpha <= 0) return null;
      return red! >= 120 && red! - green! >= 60 && green! - blue! >= 24 && red! > green! * 1.45 && green! > blue! * 1.4;
    };
    const properties = [
      "color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "outlineColor", "fill", "stroke", "textDecorationColor", "boxShadow", "textShadow",
    ] as const;
    const styleEntries = (element: Element, pseudo: "::before" | "::after" | null) => {
      const style = getComputedStyle(element, pseudo);
      if (pseudo && (!style.content || style.content === "none" || style.content === "normal")) return [];
      return properties.flatMap((property) => {
        if (property.startsWith("border") && property.endsWith("Color")) {
          const side = property.slice("border".length, -"Color".length).toLowerCase();
          if (style.getPropertyValue(`border-${side}-style`) === "none"
            || Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) <= 0) return [];
        }
        if (property === "outlineColor" && (style.outlineStyle === "none" || Number.parseFloat(style.outlineWidth) <= 0)) return [];
        if (property === "textDecorationColor" && style.textDecorationLine === "none") return [];
        const value = style[property];
        return redChannels(value) ? [{ property, value }] : [];
      });
    };
    const isAllowed = (element: Element, property: string) => {
      const paint = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "fill", "stroke"];
      if (element.matches("a.guest-wordmark > span") && property === "color") return true;
      if (element.matches(".guest-app .impact-tag.impact-blocking, .guest-app .impact-tag.impact-high") && paint.includes(property)) return true;
      if (element.matches(".guest-app .impact-tag.impact-blocking > .impact-mark, .guest-app .impact-tag.impact-high > .impact-mark") && ["backgroundColor", "color"].includes(property)) return true;
      if (element.matches(".guest-app button.guest-xray-pin") && paint.includes(property)) return true;
      if (element.matches(".guest-app section.guest-xray-region.is-highlighted") && property === "outlineColor") return true;
      if (element.matches(".guest-app ol.guest-xray-preview-pins > li > button > span") && property === "backgroundColor") return true;
      return false;
    };
    const root = document.querySelector(".guest-app");
    if (!root) return [{ element: "missing .guest-app", property: "root", value: "not rendered" }];
    const results: Array<{ element: string; pseudo: string; property: string; value: string }> = [];
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none"
        && style.visibility !== "hidden" && style.visibility !== "collapse" && Number(style.opacity) > 0;
      if (!visible) continue;
      for (const pseudo of [null, "::before", "::after"] as const) {
        for (const entry of styleEntries(element, pseudo)) {
          if (!isAllowed(element, entry.property)) {
            results.push({
              element: `${element.tagName.toLowerCase()}${typeof element.className === "string" && element.className ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
              pseudo: pseudo ?? "",
              ...entry,
            });
          }
        }
      }
    }
    return results;
  });
  console.log("Computed colour scan complete:", label, "violations", violations.length);
  expect(violations, `${label}: unapproved vermilion uses`).toEqual([]);
}

test("checks strict computed colours across guest pages and severity states", async ({ page }) => {
  test.setTimeout(90_000);
  const api = await installApi(page);
  const externalOrigins = new Set<string>();
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== appOrigin) externalOrigins.add(origin);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Check a web page for SEO problems." })).toBeVisible();
  await expectNoUnapprovedVermilion(page, "Home");
  await page.getByRole("button", { name: "Check page" }).focus();
  await expectNoUnapprovedVermilion(page, "Home with keyboard focus");
  await submitAudit(page);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expectInkVerdict(page);
  await expectNoUnapprovedVermilion(page, "Normal Summary");

  await page.getByRole("link", { name: "Fix list" }).click();
  await expectNoUnapprovedVermilion(page, "Fix list");
  await page.getByRole("link", { name: "Page X-ray" }).click();
  await page.locator(".guest-xray-head > summary").click();
  await page.locator(".guest-xray-pin").first().hover();
  await expectNoUnapprovedVermilion(page, "X-ray with inspection mark");
  await page.getByRole("link", { name: "On-page" }).click();
  await expectNoUnapprovedVermilion(page, "On-page");
  await page.getByRole("link", { name: "Previews" }).click();
  await expectNoUnapprovedVermilion(page, "Previews");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pages" })).toBeVisible();
  await expectNoUnapprovedVermilion(page, "Mobile More sheet");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeFocused();

  for (const impact of ["high", "blocking", null] as const) {
    api.setReport(impact);
    await page.goto("/");
    await submitAudit(page);
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expectInkVerdict(page);
    await expectNoUnapprovedVermilion(page, `${impact ?? "zero-fix"} Summary`);
  }
  expect([...externalOrigins]).toEqual([]);
});

test("checks computed colours in indeterminate loading and error states", async ({ page }) => {
  const api = await installApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  api.setPending();
  await submitAudit(page);
  await expect(page.getByText("Waiting for the audit service to return a report.")).toBeVisible();
  await expect(page.getByText(/^(Fetching the page|Reading the HTML|Running 23 checks|Building your report)$/)).toHaveCount(0);
  await expect(page.locator(".guest-loading-step--complete")).toHaveCount(0);
  await expectNoUnapprovedVermilion(page, "Loading");
  api.releasePending();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

  api.setError();
  await page.goto("/");
  await submitAudit(page);
  await expect(page.getByRole("alert")).toContainText("The guest audit limit has been reached for now.");
  await expectNoUnapprovedVermilion(page, "Error");
});

test("discloses that target keywords are not analyzed or sent to the guest API", async ({ page }) => {
  let submittedBody: unknown;
  let authorization: string | undefined;
  await page.route("**/api/guest/v1/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ csrf_token: "c".repeat(43), expires_in: 3600, bot_check_required: false, turnstile_sitekey: null, turnstile_action: null }),
  }));
  await page.route("**/api/guest/v1/analyse-url", async (route) => {
    submittedBody = route.request().postDataJSON();
    authorization = route.request().headers().authorization;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analysisFor(null)) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Add a target keyword" }).click();
  await expect(page.getByText("This is not included in the current audit.")).toBeVisible();
  await page.getByLabel("Target keyword").fill("solar panels");
  await submitAudit(page);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  expect(submittedBody).toEqual({ url: pageUrl });
  expect(authorization).toBeUndefined();
});

test("long priority reasons wrap and remain fully visible", async ({ page }) => {
  const api = await installApi(page);
  const report = analysisFor("medium");
  const check = report.checks.find((item) => item.id === "meta_description");
  const longReason = "The fetched page contains a short, observed description that may suit its purpose. ".repeat(7);
  if (check) check.finding_reason = longReason;
  api.setCustomReport(report);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await submitAudit(page);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  const reason = page.locator(".guest-priority-copy p").first();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(reason).toHaveText(longReason);
    const dimensions = await reason.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("keeps two complete priority cards above mobile navigation with the controlled warnings report", async ({ page }) => {
  const api = await installApi(page);
  const report = analysisFor("medium", true);
  const first = report.checks.find((item) => item.id === "meta_description")!;
  first.id = "visible_text";
  first.category = "headings_content_structure";
  first.anatomy_part = "content";
  first.impact = "high";
  first.finding_title = "Check whether this short page needs more context";
  first.finding_reason = "A short page may be appropriate for its purpose. Check whether visitors get the context they need.";
  const second = report.checks.find((item) => item.id === "heading_hierarchy")!;
  second.id = "title";
  second.category = "metadata";
  second.anatomy_part = "title";
  second.finding_title = "Make the page title more descriptive";
  second.finding_reason = "The title has 11 characters. Check that it clearly identifies this page; this length check does not predict search presentation.";
  const additionalFindings = [
    { id: "canonical", title: "Canonical URL", finding_title: "Review the canonical URL", finding_reason: "The observed canonical relationship is missing. Confirm that the canonical URL identifies the page intended by the site owner.", impact: "medium", effort: "moderate", anatomy_part: "technical" },
    { id: "internal_links", title: "Internal links", finding_title: "Add useful links to related pages", finding_reason: "No internal links were detected in the fetched HTML. Add links where they help visitors move between related pages.", impact: "medium", effort: "moderate", anatomy_part: "links" },
    { id: "open_graph", title: "Open Graph metadata", finding_title: "Add useful social sharing details", finding_reason: "The fetched HTML contains 0 of four checked Open Graph fields.", impact: "low", effort: "quick", anatomy_part: "sharing" },
    { id: "twitter_metadata", title: "X metadata", finding_title: "Add useful X sharing details", finding_reason: "The fetched HTML contains 0 of four checked X card fields.", impact: "low", effort: "quick", anatomy_part: "sharing" },
  ];
  report.checks.push(...additionalFindings.map((finding) => ({
    ...first,
    ...finding,
  })));
  const passingCheck = report.checks[0]!;
  report.checks.push(...Array.from({ length: 13 }, (_, index) => ({
    ...passingCheck,
    id: `controlled_pass_${index + 1}`,
    title: `Passing check ${index + 1}`,
  })));
  report.checks.push(...Array.from({ length: 2 }, (_, index) => ({
    ...passingCheck,
    id: `controlled_na_${index + 1}`,
    title: `Not applicable check ${index + 1}`,
    status: "not_applicable",
  })));
  report.checks.push({
    ...passingCheck,
    id: "json_ld",
    title: "Structured data",
    status: "warning",
    impact: null,
    effort: null,
    is_actionable: false,
    optional_note: "Optional structured data was not found.",
    exclusion_reason: "Optional structured data is not required for every page.",
  });
  report.findings_summary.total_checks = 23;
  report.findings_summary.raw_passes = 14;
  report.findings_summary.raw_warnings = 7;
  report.findings_summary.raw_failures = 0;
  report.findings_summary.raw_not_applicable = 2;
  report.findings_summary.actionable_count = 6;
  report.findings_summary.optional_note_count = 1;
  report.findings_summary.by_impact = { blocking: 0, high: 1, medium: 3, low: 2 };
  report.findings_summary.by_effort = { quick: 3, moderate: 3, larger_job: 0 };
  report.findings_summary.prioritized_check_ids = ["visible_text", "title", "canonical", "internal_links", "open_graph", "twitter_metadata"];
  report.findings_summary.exclusions = [{
    check_id: "json_ld",
    status: "warning",
    reason: "Optional structured data is not required for every page.",
  }];
  report.findings_summary.verdict = "6 fixes. The very short page content matters most.";
  report.deterministic_score.overall_score = 84;
  report.deterministic_score.points_earned = 84;
  api.setCustomReport(report);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await submitAudit(page);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  const measurement = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".guest-mobile-tabs")!.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-priority-card]"))
      .slice(0, 2)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, top: box.top, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      });
    return { navTop: nav.top, cards, scrollWidth: document.documentElement.scrollWidth };
  });
  console.log("S2-C1 controlled warnings mobile priority bounds:", JSON.stringify(measurement));
  expect(measurement.scrollWidth).toBe(390);
  expect(measurement.cards).toHaveLength(2);
  expect(measurement.cards.every((card) => card.top >= 0 && card.bottom <= measurement.navTop)).toBe(true);
  await expect(page.getByTestId("summary-count-line")).toContainText("6 to fix");
  await expect(page.getByTestId("summary-count-line")).toContainText("14 passed");
  await expect(page.getByTestId("summary-count-line")).toContainText("2 not applicable");
  await expect(page.getByTestId("summary-count-line")).toContainText("1 optional note");
  await expect(page.locator("[data-priority-card] .guest-priority-copy p").first()).toHaveText(first.finding_reason!);
  await expect(page.locator("[data-priority-card] .guest-priority-copy p").nth(1)).toHaveText(second.finding_reason!);
  await expect(page.locator("[data-priority-card] .guest-priority-copy p").first()).toHaveCSS("font-size", "16px");
  const evidenceDirectory = resolve(process.cwd(), "review/s2-c1");
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, "summary-mobile-priority-clearance-390x844.png") });
});

test("checks keyboard access, announcements, touch targets, and responsive reflow", async ({ page }) => {
  test.setTimeout(90_000);
  const api = await installApi(page);
  api.setReport("medium", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const homeAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(homeAxe.violations).toEqual([]);

  const address = page.getByLabel("Page address");
  await address.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Check page" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP or HTTPS");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAttribute("aria-describedby", /guest-url-error/);
  await submitAudit(page);
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByTestId("summary-count-line")).toContainText("2 to fix");

  const scoreHelp = page.locator(".guest-score-help > summary");
  await scoreHelp.click();
  await expect(page.getByRole("note")).toContainText("not a search-ranking prediction");
  await scoreHelp.press("Enter");
  await expect(page.getByRole("note")).toHaveCount(0);
  const summaryAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(summaryAxe.violations).toEqual([]);

  const pageRoutes = [
    { name: "Summary", link: /^Summary/ },
    { name: "Fix list", link: /^Fix list/ },
    { name: "Page X-ray", link: "Page X-ray" },
    { name: "On-page", link: "On-page" },
    { name: "Previews", link: "Previews" },
  ] as const;
  const measurements: Array<Record<string, number | string | null>> = [];
  for (const route of pageRoutes) {
    if (route.name !== "Summary") {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("link", { name: route.link }).click();
      await expect(page.locator("main h1")).toBeFocused();
    }
    for (const width of [320, 390, 768, 1024, 1440]) {
      const height = 844;
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const measured = await page.evaluate(() => {
        const targets = Array.from(document.querySelectorAll<HTMLElement>(".guest-app button:not([disabled]), .guest-app a[href], .guest-app summary"))
          .filter((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
        const nav = document.querySelector<HTMLElement>(".guest-mobile-tabs");
        const navBox = nav?.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          minTargetHeight: Math.min(...targets.map((element) => element.getBoundingClientRect().height)),
          navTop: navBox && getComputedStyle(nav!).display !== "none" ? navBox.top : null,
          priorityCards: Array.from(document.querySelectorAll<HTMLElement>("[data-priority-card]"))
            .map((element) => ({ y: element.getBoundingClientRect().y, bottom: element.getBoundingClientRect().bottom })),
        };
      });
      measurements.push({ page: route.name, width, ...measured });
      expect(measured.scrollWidth, `${route.name} scroll width at ${width}px`).toBeLessThanOrEqual(width);
      expect(measured.minTargetHeight, `${route.name} minimum target at ${width}px`).toBeGreaterThanOrEqual(44);
      if (width <= 1023) expect(measured.navTop).not.toBeNull();
      if (route.name === "Summary" && width === 390) {
        expect(measured.priorityCards.length).toBeGreaterThanOrEqual(2);
        expect(measured.priorityCards.slice(0, 2).every((card) => card.y >= 0 && card.bottom <= measured.navTop!)).toBe(true);
        await page.screenshot({ path: "review/s2-c1/summary-mobile-priority-clearance-390x844.png" });
      }
      if (width <= 1023) {
        const bottom = await page.evaluate(() => {
          const originalScrollBehavior = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = "auto";
          window.scrollTo(0, document.documentElement.scrollHeight);
          const report = document.querySelector("main .guest-report-page");
          const nav = document.querySelector<HTMLElement>(".guest-mobile-tabs");
          const targets = Array.from(report?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary") ?? [])
            .filter((element) => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            });
          const last = targets[targets.length - 1]?.getBoundingClientRect();
          const result = {
            lastTargetBottom: last?.bottom ?? null,
            lastTargetName: targets[targets.length - 1]?.innerText ?? null,
            navTop: nav?.getBoundingClientRect().top ?? null,
            scrollY: window.scrollY,
            scrollHeight: document.documentElement.scrollHeight,
            clientHeight: document.documentElement.clientHeight,
          };
          document.documentElement.style.scrollBehavior = originalScrollBehavior;
          window.scrollTo(0, 0);
          return result;
        });
        console.log(`S2-C1 ${route.name} bottom clearance at ${width}px:`, JSON.stringify(bottom));
        expect(bottom.lastTargetBottom, `${route.name} last target exists at ${width}px`).not.toBeNull();
        expect(bottom.lastTargetBottom!, `${route.name} bottom navigation clearance at ${width}px`).toBeLessThanOrEqual(bottom.navTop!);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const enlarged = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(".guest-app main h1, .guest-app main h2, .guest-app main h3, .guest-app main p, .guest-app main li, .guest-app main button, .guest-app main a, .guest-app main label, .guest-app main summary, .guest-app main span, .guest-app main strong"))
        .filter((element) => element.textContent?.trim());
      const previous = elements.map((element) => element.style.getPropertyValue("font-size"));
      elements.forEach((element) => {
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        element.style.setProperty("font-size", `${size * 1.5}px`, "important");
      });
      const result = {
        scale: 1.5,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        outsideRight: elements.filter((element) => element.getBoundingClientRect().right > innerWidth + 1).length,
      };
      elements.forEach((element, index) => {
        if (previous[index]) element.style.setProperty("font-size", previous[index]!);
        else element.style.removeProperty("font-size");
      });
      return result;
    });
    measurements.push({ page: route.name, textScale: `${enlarged.scale}x`, scrollWidth: enlarged.scrollWidth, outsideRight: enlarged.outsideRight });
    expect(enlarged.scrollWidth, `${route.name} 1.5x text-size reflow`).toBeLessThanOrEqual(enlarged.viewportWidth);
    expect(enlarged.outsideRight, `${route.name} 1.5x text-size clipping`).toBe(0);
    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await page.evaluate(() => {
      const originalScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      const targets = Array.from(document.querySelectorAll<HTMLElement>(".guest-app button:not([disabled]), .guest-app a[href], .guest-app summary"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
      window.scrollTo(0, document.documentElement.scrollHeight);
      const report = document.querySelector("main .guest-report-page");
      const reportTargets = Array.from(report?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary") ?? [])
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
      const lastTarget = reportTargets[reportTargets.length - 1]?.getBoundingClientRect();
      const navTop = document.querySelector<HTMLElement>(".guest-mobile-tabs")?.getBoundingClientRect().top ?? null;
      const result = {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        minTargetHeight: Math.min(...targets.map((element) => element.getBoundingClientRect().height)),
        lastTargetBottom: lastTarget?.bottom ?? null,
        navTop,
      };
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      window.scrollTo(0, 0);
      return result;
    });
    measurements.push({ page: route.name, orientation: "landscape", ...landscape });
    expect(landscape.scrollWidth, `${route.name} landscape overflow`).toBeLessThanOrEqual(landscape.width);
    expect(landscape.minTargetHeight, `${route.name} landscape target size`).toBeGreaterThanOrEqual(44);
    expect(landscape.lastTargetBottom, `${route.name} landscape last target exists`).not.toBeNull();
    expect(landscape.lastTargetBottom!, `${route.name} landscape bottom-nav clearance`).toBeLessThanOrEqual(landscape.navTop!);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations, `${route.name} axe violations`).toEqual([]);
  }
  console.log("S2-C1 responsive guest page measurements:", JSON.stringify(measurements));

  await page.setViewportSize({ width: 390, height: 844 });
  const moreButton = page.getByRole("button", { name: "More", exact: true });
  await moreButton.click();
  const sheet = page.getByRole("dialog", { name: "Pages" });
  await expect(sheet).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const moreAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(moreAxe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(moreButton).toBeFocused();

  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  console.log("S2-C1 landscape reflow:", JSON.stringify(landscape));
  expect(landscape.scrollWidth).toBeLessThanOrEqual(landscape.width);
});
