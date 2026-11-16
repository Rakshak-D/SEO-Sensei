import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const pagePath = "/docs/design/s1-a/proof-static-not-the-product.html";
const screenshotDir = path.join(here, "screenshots");
const evidenceDir = path.join(here, "evidence");
const require = createRequire(path.join(root, "web", "package.json"));
const { chromium } = require("playwright");
const viewports = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "390x844", width: 390, height: 844 },
];
const layoutViewports = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "390x844", width: 390, height: 844 },
];
const states = ["home", "summary", "on-page", "previews", "fix-list", "loading", "error"];
const checks = [];
const layoutMetrics = [];
const consoleErrors = [];
const requestHosts = new Set();
let requestCount = 0;
let unexpectedRequests = 0;
let server;
let browser;
let context;
let baseUrl;
let activeStage = "initialization";

function check(name, pass, detail) {
  recordCheck(name, pass ? "PASS" : "FAIL", detail);
}

function recordCheck(name, status, detail) {
  checks.push({ name, status, detail });
  console.log(`${status} ${name}: ${detail}`);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ttf": "font/ttf",
  })[ext] || "application/octet-stream";
}

async function startServer() {
  server = http.createServer(async (request, response) => {
    const parsed = new URL(request.url || "/", "http://127.0.0.1");
    let pathname;
    try { pathname = decodeURIComponent(parsed.pathname); } catch { response.writeHead(400).end(); return; }
    const filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) { response.writeHead(403).end(); return; }
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mimeFor(filePath),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(content);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function setupPage() {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__layoutShifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__layoutShifts.push(entry.value);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* LayoutShift API is not exposed by every browser build. */ }
  });
  monitorContext(context);
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push("console error"); });
  page.on("pageerror", (error) => { consoleErrors.push(error.name || "page error"); });
  return page;
}

function monitorContext(browserContext) {
  browserContext.on("request", (request) => {
    requestCount += 1;
    try {
      const parsed = new URL(request.url());
      requestHosts.add(parsed.host);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") unexpectedRequests += 1;
    } catch { unexpectedRequests += 1; }
  });
  browserContext.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort();
  });
}

function viewUrl(state, sample = null, extra = {}) {
  const params = new URLSearchParams({ state });
  if (sample) params.set("sample", sample);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return `${baseUrl}${pagePath}?${params.toString()}`;
}

async function openPage(page, state, sample = null, extra = {}) {
  await page.goto(viewUrl(state, sample, extra), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (state === "summary" || state === "on-page" || state === "previews" || state === "fix-list") {
    await page.waitForFunction(() => {
      const score = document.querySelector("[data-score-target]");
      return !score || score.textContent === score.dataset.scoreTarget;
    });
  }
}

async function inspectLayout(page, state, sample, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await openPage(page, state, sample);
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const rects = [...document.querySelectorAll(".masthead, .report-head, .report-grid, .subpage-layout, .loading-grid, .blocking-banner, .site-footer, .priority-button, .scan-part, .preview-item, .fix-item")]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const evidenceNodes = [...document.querySelectorAll(".report-url, .specialist-url, .scan-part .part-value, .metadata-value, .finding-evidence, .priority-action, .observed-value, .preview-search .preview-url, .snippet-wrap pre")]
      .filter((element) => element.getClientRects().length);
    const evidenceFontSizes = evidenceNodes.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const microLabelNodes = [...document.querySelectorAll(".report-kicker, .score-caption, .score-help summary, .report-grid .section-heading .small-label, .part-tag, .scan-ruler, .xray-zone-label, .xray-browser-bar span, .xray-unassessed-label, .metadata-inspection .status-word, .status-label, .impact-tag, .priority-number, .priority-copy-button, .priority-review-button, .priority-copy-feedback, .metadata-note, .anatomy-footnote, .preview-meta, .preview-disclosure, .preview-image-missing, .entry-count, .specialist-heading .eyebrow, .onpage-primary-values .small-label, .fix-list-intro")]
      .filter((element) => element.getClientRects().length);
    const microLabelFontSizes = microLabelNodes.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const clippedEvidence = evidenceNodes.filter((element) => {
      const style = getComputedStyle(element);
      const lineClamped = style.webkitLineClamp && style.webkitLineClamp !== "none" && style.webkitLineClamp !== "0";
      const clippedByOverflow = (style.overflow === "hidden" || style.overflowY === "hidden" || style.overflowX === "hidden")
        && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
      return Boolean(lineClamped || clippedByOverflow || style.textOverflow === "ellipsis");
    });
    let overlaps = 0;
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i].element;
        const b = rects[j].element;
        if (a.contains(b) || b.contains(a)) continue;
        const x = Math.min(rects[i].rect.right, rects[j].rect.right) - Math.max(rects[i].rect.left, rects[j].rect.left);
        const y = Math.min(rects[i].rect.bottom, rects[j].rect.bottom) - Math.max(rects[i].rect.top, rects[j].rect.top);
        if (x > 1 && y > 1) overlaps += 1;
      }
    }
    return {
      viewportWidth: innerWidth,
      documentWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      overflow: Math.max(doc.scrollWidth, body.scrollWidth) > innerWidth,
      overlaps,
      bodyFontPx: Number.parseFloat(getComputedStyle(body).fontSize),
      evidenceFontPx: Number.parseFloat(getComputedStyle(document.querySelector(".evidence-value, .finding-evidence, .observed-value") || body).fontSize),
      technicalEvidenceFontPx: evidenceFontSizes.length ? Math.min(...evidenceFontSizes) : null,
      technicalEvidenceDetails: evidenceNodes.map((element) => ({ className: element.className || element.localName, fontPx: Number.parseFloat(getComputedStyle(element).fontSize) })).filter((item) => item.fontPx < 13),
      secondaryMicroLabelFontPx: microLabelFontSizes.length ? Math.min(...microLabelFontSizes) : null,
      smallMicroLabelDetails: microLabelNodes.map((element) => ({ className: element.className || element.localName, fontPx: Number.parseFloat(getComputedStyle(element).fontSize) })).filter((item) => item.fontPx < 12),
      clippedTechnicalEvidenceCount: clippedEvidence.length,
      clippedTechnicalEvidenceSelectors: clippedEvidence.map((element) => element.className || element.localName),
      state: document.querySelector(".site-shell")?.dataset.state,
      sample: document.querySelector(".site-shell")?.dataset.sample,
    };
  });
  result.viewport = viewport.label;
  layoutMetrics.push({ state, sample, viewport: viewport.label, ...result });
  return result;
}

async function captureScreenshots(page) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const captures = [];
  for (const viewport of viewports) {
    for (const state of states) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sample = ["summary", "on-page", "previews", "fix-list", "loading"].includes(state) ? "weak" : null;
      await openPage(page, state, sample, state === "error" ? { reason: "static-preview" } : {});
      if (state === "loading") await page.waitForTimeout(720);
      const fileName = `s1-a-${state}-${viewport.label}.png`;
      const filePath = path.join(screenshotDir, fileName);
      await page.screenshot({ path: filePath, fullPage: false, animations: "allow" });
      captures.push({ fileName, relativePath: `docs/design/s1-a/screenshots/${fileName}`, query: sample ? `?state=${state}&sample=${sample}` : state === "error" ? "?state=error&reason=static-preview" : `?state=${state}`, viewport: viewport.label });
    }
    for (const [sample, variant] of [["basic", "basic"], ["noindex", "noindex"]]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPage(page, "summary", sample);
      const fileName = `s1-a-summary-${variant}-${viewport.label}.png`;
      const filePath = path.join(screenshotDir, fileName);
      await page.screenshot({ path: filePath, fullPage: false, animations: "allow" });
      captures.push({ fileName, relativePath: `docs/design/s1-a/screenshots/${fileName}`, query: `?state=summary&sample=${sample}`, viewport: viewport.label });
    }
  }
  return captures;
}

function parseColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance(color) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(first, second) {
  if (!first || !second) return null;
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

async function measureContrast(page) {
  return page.evaluate(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const p = match[1].split(",").map((x) => Number.parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const linear = (v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    const lum = (c) => .2126 * linear(c.r) + .7152 * linear(c.g) + .0722 * linear(c.b);
    const ratio = (a, b) => { const l = Math.max(lum(a), lum(b)); const d = Math.min(lum(a), lum(b)); return (l + .05) / (d + .05); };
    const bgFor = (element) => {
      let node = element;
      while (node) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > .95) return bg;
        node = node.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor) || { r: 250, g: 250, b: 247, a: 1 };
    };
    const textSamples = [...document.querySelectorAll("body *")]
      .filter((el) => el.children.length === 0 && (el.innerText || el.textContent || "").trim() && el.getClientRects().length)
      .map((el) => {
        const style = getComputedStyle(el);
        const fg = parse(style.color);
        const bg = bgFor(el);
        return { ratio: fg ? ratio(fg, bg) : null, text: (el.innerText || el.textContent).trim().slice(0, 48), fontPx: Number.parseFloat(style.fontSize) };
      }).filter((item) => item.ratio !== null);
    const visibleLabels = [...document.querySelectorAll(".status-label")].filter((el) => el.getClientRects().length && !el.closest("details:not([open])"));
    const labelRatios = visibleLabels.map((el) => {
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      const bg = bgFor(el);
      return fg ? ratio(fg, bg) : null;
    }).filter((value) => value !== null);
    const visibleDots = [...document.querySelectorAll(".status-dot")].filter((el) => el.getClientRects().length && !el.closest("details:not([open])"));
    const dotRatios = visibleDots.map((el) => {
      const dotColor = parse(getComputedStyle(el).backgroundColor);
      const background = bgFor(el.parentElement);
      return dotColor ? ratio(dotColor, background) : null;
    }).filter((value) => value !== null);
    const focusElement = document.activeElement;
    const focusStyle = focusElement ? getComputedStyle(focusElement) : null;
    const focus = focusStyle ? parse(focusStyle.outlineColor) : null;
    const base = focusElement?.parentElement ? bgFor(focusElement.parentElement) : bgFor(document.body);
    return {
      minTextRatio: textSamples.length ? Math.min(...textSamples.map((item) => item.ratio)) : null,
      minTextSample: textSamples.sort((a, b) => a.ratio - b.ratio)[0] || null,
      minStatusRatio: [...labelRatios, ...dotRatios].length ? Math.min(...labelRatios, ...dotRatios) : null,
      statusSamples: { labels: labelRatios.length, dots: dotRatios.length },
      focusRatio: focus ? ratio(focus, base) : null,
      focusedElement: focusElement?.tagName?.toLowerCase() || null,
      focusOutlineStyle: focusStyle?.outlineStyle || null,
    };
  });
}

async function focusByTab(page, locator, limit = 90) {
  for (let index = 0; index < limit; index += 1) {
    const matches = await locator.evaluate((element) => element === document.activeElement).catch(() => false);
    if (matches) return index;
    await page.keyboard.press("Tab");
  }
  throw new Error("keyboard target was not reached by Tab navigation");
}

async function testDataAndViews(page) {
  const files = ["audit-weak.json", "audit-basic.json", "audit-noindex-test.json"];
  const raw = {};
  for (const file of files) raw[file] = JSON.parse(await fs.readFile(path.join(here, file), "utf8"));
  const enrichment = JSON.parse(await fs.readFile(path.join(here, "enrichment.json"), "utf8"));
  const expected = {
    "audit-weak.json": { pass: 8, warning: 11, fail: 3, not_applicable: 1, score: 55 },
    "audit-basic.json": { pass: 14, warning: 7, fail: 0, not_applicable: 2, score: 84 },
    "audit-noindex-test.json": { pass: 7, warning: 11, fail: 4, not_applicable: 1, score: 50 },
  };
  let fixtureOk = true;
  const countReport = {};
  for (const [file, analysis] of Object.entries(raw)) {
    const count = analysis.checks.reduce((result, check) => { result[check.status] = (result[check.status] || 0) + 1; return result; }, {});
    const matches = analysis.checks.length === 23
      && analysis.deterministic_score.version === "1.0"
      && analysis.deterministic_score.overall_score === expected[file].score
      && Object.entries(expected[file]).filter(([key]) => key !== "score").every(([key, value]) => (count[key] || 0) === value)
      && analysis.checks.every((check) => Boolean(enrichment.checks[check.id]));
    fixtureOk &&= matches;
    countReport[file] = { score: analysis.deterministic_score.overall_score, checks: analysis.checks.length, statuses: count, enrichment: analysis.checks.length };
  }
  const allIds = raw["audit-weak.json"].checks.map((check) => check.id);
  check("offline analyzer data", fixtureOk, JSON.stringify(countReport));
  const expectedHashes = {
    "audit-weak.json": "6b5ab639b111c52f581fa15c7a778a62fd08043b70812630a5b5bf9eb676acea",
    "audit-basic.json": "374f9a081d34770534de68051402d6b4c6b871a60b2c0acc6e7d018ee9504a2d",
    "audit-noindex-test.json": "018e54337646fc047177c1ab64c9198e19f7f3710d07f1a6cb79d63c48dff89c",
  };
  const outputHashes = {};
  for (const [file, expectedHash] of Object.entries(expectedHashes)) {
    const bytes = await fs.readFile(path.join(here, file));
    outputHashes[file] = crypto.createHash("sha256").update(bytes).digest("hex");
    fixtureOk &&= outputHashes[file] === expectedHash;
  }
  check("R1-10 engine output hashes unchanged", Object.entries(expectedHashes).every(([file, hash]) => outputHashes[file] === hash), JSON.stringify(outputHashes));

  const weak = await inspectLayout(page, "summary", "weak", viewports[0]);
  const weakParts = await page.locator(".scan-part[data-part-id]").evaluateAll((items) => Object.fromEntries(items.map((el) => [el.dataset.partId, el.querySelector(".part-value")?.textContent || ""])));
  await openPage(page, "summary", "basic");
  const basicParts = await page.locator(".scan-part[data-part-id]").evaluateAll((items) => Object.fromEntries(items.map((el) => [el.dataset.partId, el.querySelector(".part-value")?.textContent || ""])));
  const differences = Object.keys(weakParts).filter((key) => weakParts[key] !== basicParts[key]);
  const coverage = await page.locator("[data-check-ids]").evaluateAll((items) => [...new Set(items.flatMap((el) => el.dataset.checkIds.split(",")))]);
  const unmapped = allIds.filter((id) => !coverage.includes(id));
  check("analysis-shaped anatomy", differences.length >= 4 && unmapped.length === 0, `${differences.length} anatomy regions differ across analyses; ${allIds.length - unmapped.length}/${allIds.length} check IDs map to a region${unmapped.length ? `; missing ${unmapped.join(",")}` : ""}`);

  await openPage(page, "summary", "noindex");
  const noindexView = await page.evaluate(() => ({
    sample: document.querySelector(".site-shell")?.dataset.sample || "",
    score: document.querySelector("[data-score-target]")?.dataset.scoreTarget || "",
    blockingBanner: Boolean(document.querySelector(".blocking-banner")),
    recoveryState: Boolean(document.querySelector("#error-heading")),
    simulatedContext: document.querySelector(".report-kicker")?.textContent.includes("Test condition · X-Robots-Tag") || false,
    observedDirective: document.querySelector(".blocking-banner [data-observed]")?.textContent || "",
  }));
  check("simulated noindex comparison renders", noindexView.sample === "noindex" && noindexView.score === "50" && noindexView.blockingBanner && !noindexView.recoveryState && noindexView.simulatedContext && noindexView.observedDirective.toLowerCase().includes("noindex"), JSON.stringify(noindexView));

  await page.setViewportSize({ width: 768, height: 1024 });
  await openPage(page, "home");
  const tabletUrlFieldWidth = await page.locator("#page-url").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  check("tablet URL field width", tabletUrlFieldWidth >= 300, `${tabletUrlFieldWidth}px at 768px viewport`);

  await openPage(page, "on-page", "weak");
  await page.locator(".structure-disclosure > summary").click().catch(() => {});
  const tabletAnatomyWidth = await page.locator(".subpage-side .anatomy-frame").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  check("tablet subpage anatomy width", tabletAnatomyWidth >= 500, `${tabletAnatomyWidth}px at 768px viewport`);

  const hostnameLines = {};
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openPage(page, "summary", "weak");
    hostnameLines[width] = await page.locator("#report-title").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    });
  }
  check("mobile hostname line integrity", hostnameLines[390] === 1 && hostnameLines[320] === 1, `example.test occupies ${hostnameLines[390]} line(s) at 390px and ${hostnameLines[320]} at 320px`);

  await openPage(page, "summary", "weak");
  const priorityIds = await page.locator(".priority-button").evaluateAll((items) => items.map((item) => item.dataset.checkId));
  const status = await page.locator(".priority-button").count();
  const copyWords = await page.locator("[data-summary-copy]").evaluateAll((items) => items.map((el) => (el.textContent || "").trim().split(/\s+/).filter(Boolean).length).reduce((a, b) => a + b, 0));
  const caveatCount = await page.locator("[data-score-caveat]").count();
  check("summary content bound", status <= 5 && copyWords <= 120, `${status} prioritized fixes; ${copyWords} explanatory words`);
  check("single score caveat", caveatCount === 1, `${caveatCount} score-help panel(s) on summary`);
  check("needs-review order", priorityIds.join(",") === "meta_description,h1_structure,title,image_alt,html_lang", priorityIds.join(" → "));
  const scoreHelpTriggerCount = await page.locator("[data-score-help-trigger]").count();
  if (scoreHelpTriggerCount === 1) await page.locator("[data-score-help-trigger]").click();
  const scoreHelpOpens = await page.locator("#score-help").evaluate((el) => el.open).catch(() => false);
  check("single score-help affordance", scoreHelpTriggerCount === 1 && scoreHelpOpens, `${scoreHelpTriggerCount} help affordance opens the one native details panel`);
  const semantics = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const visible = (element) => element.getClientRects().length > 0
      && !element.closest("details:not([open])")
      && getComputedStyle(element).visibility !== "hidden"
      && getComputedStyle(element).display !== "none";
    return {
      mainCount: document.querySelectorAll("main").length,
      h1Count: document.querySelectorAll("main h1").length,
      navLabel: document.querySelector("nav")?.getAttribute("aria-label") || "",
      unnamedButtons: buttons.filter((element) => !(element.getAttribute("aria-label") || element.textContent || "").trim()).length,
      visuallyUnnamedButtons: buttons.filter((element) => visible(element) && !(element.getAttribute("aria-label") || element.innerText || element.textContent || "").trim()).length,
    };
  });
  check("semantic landmarks and names", semantics.mainCount === 1 && semantics.h1Count === 1 && semantics.navLabel === "Report views" && semantics.unnamedButtons === 0 && semantics.visuallyUnnamedButtons === 0, JSON.stringify(semantics));

  const credentialCount = await page.locator('input[type="password"], input[name*="token" i], input[name*="api-key" i], input[autocomplete="current-password"]').count();
  const proofSources = ["proof-static-not-the-product.html", "proof.js", "proof.css"];
  const sourceText = (await Promise.all(proofSources.map((file) => fs.readFile(path.join(here, file), "utf8")))).join("\n");
  const bearerMatches = [...sourceText.matchAll(/authorization\s*:\s*bearer|bearer\s+[a-z0-9._~-]{12,}/gi)].length;
  check("no browser credential surface", credentialCount === 0 && bearerMatches === 0, `${credentialCount} credential-style inputs; ${bearerMatches} browser bearer-code matches`);

  const motionCss = await fs.readFile(path.join(here, "proof.css"), "utf8");
  const keyframes = [...motionCss.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  const animatedProps = [...new Set(keyframes.flatMap((body) => [...body.matchAll(/(?:^|\s)(opacity|transform|top|left|width|height|margin|padding)\s*:/gm)].map((match) => match[1])))];
  const forbiddenAnimations = animatedProps.filter((property) => !["opacity", "transform"].includes(property));
  await context.close();
  const reducedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  monitorContext(reducedContext);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(viewUrl("loading", "weak"), { waitUntil: "networkidle" });
  const reducedDuration = await reducedPage.locator(".skeleton-line").first().evaluate((element) => getComputedStyle(element).animationDuration);
  const reducedMs = Number.parseFloat(reducedDuration) * (reducedDuration.endsWith("ms") ? 1 : 1000);
  check("motion properties and reduced motion", forbiddenAnimations.length === 0 && reducedMs <= 0.01, `animated properties ${animatedProps.join(",") || "none"}; reduced animation ${reducedDuration}`);
  await reducedContext.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => { window.__layoutShifts = []; try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__layoutShifts.push(entry.value); }).observe({ type: "layout-shift", buffered: true }); } catch {} });
  monitorContext(context);
  page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push("console error"); });
  page.on("pageerror", (error) => { consoleErrors.push(error.name || "page error"); });
  return {
    page,
    raw,
    countReport,
    rawOutputHashes: outputHashes,
    weakParts,
    basicParts,
    differences,
    priorityIds,
    unmappedChecks: unmapped.length,
    mappedChecks: allIds.length - unmapped.length,
    summaryWords: copyWords,
    credentialInputs: credentialCount,
    bearerMatches,
    animatedProperties: animatedProps,
    reducedMotionDuration: reducedDuration,
    motionPass: forbiddenAnimations.length === 0 && reducedMs <= 0.01,
    tabletUrlFieldWidth,
    tabletAnatomyWidth,
    hostnameLines,
  };
}

async function testR1VisualBehavior(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, "summary", "weak");
  const desktop = await page.evaluate(() => {
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height), visible: box.width > 0 && box.height > 0 } : null;
    };
    return {
      verdict: rect(document.querySelector(".verdict-line")),
      xray: rect(document.querySelector(".page-xray")),
      priorities: [...document.querySelectorAll(".priority-row")].slice(0, 3).map(rect),
    };
  });
  const desktopPass = desktop.verdict?.visible && desktop.xray?.visible && desktop.xray.top < 900
    && desktop.priorities.length === 3 && desktop.priorities.every((item) => item.visible && item.bottom <= 900);
  check("R1-1 desktop summary viewport", desktopPass, JSON.stringify(desktop));

  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "summary", "weak");
  const mobile = await page.evaluate(() => {
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height), visible: box.width > 0 && box.height > 0 && box.bottom <= innerHeight } : null;
    };
    return {
      verdict: rect(document.querySelector(".verdict-line")),
      priorities: [...document.querySelectorAll(".priority-row")].slice(0, 2).map(rect),
      anatomyEntry: rect(document.querySelector(".anatomy-entry")),
    };
  });
  const mobilePass = mobile.verdict?.visible && mobile.priorities.length === 2
    && mobile.priorities.every((item) => item.visible) && mobile.anatomyEntry?.visible;
  check("R1-2 mobile summary viewport", mobilePass, JSON.stringify(mobile));

  const specialists = {};
  const tasks = [
    { state: "on-page", selector: ".onpage-primary-values", heading: "On-page" },
    { state: "previews", selector: ".preview-item", heading: "Previews" },
    { state: "fix-list", selector: ".fix-item", heading: "Fix list" },
  ];
  for (const task of tasks) {
    await openPage(page, task.state, "weak");
    specialists[task.state] = await page.evaluate(({ selector }) => {
      const content = document.querySelector(selector);
      const box = content?.getBoundingClientRect();
      return {
        heading: document.querySelector(".specialist-heading h1")?.textContent || "",
        top: box ? Math.round(box.top) : null,
        bottom: box ? Math.round(box.bottom) : null,
        visible: Boolean(box && box.width > 0 && box.height > 0 && box.bottom <= innerHeight),
        structureLabel: document.querySelector(".structure-disclosure > summary")?.textContent.trim() || "",
        structureOpen: document.querySelector(".structure-disclosure")?.open || false,
        directAction: Boolean(document.querySelector(".fix-item .fix-actions button")),
      };
    }, { selector: task.selector });
    specialists[task.state].expectedHeading = task.heading;
  }
  const specialistPass = specialists["on-page"].heading === "On-page" && specialists["on-page"].visible
    && specialists.previews.heading === "Previews" && specialists.previews.visible
    && specialists["fix-list"].heading === "Fix list" && specialists["fix-list"].visible
    && tasks.every((task) => specialists[task.state].structureLabel === "Inspect page structure" && !specialists[task.state].structureOpen)
    && specialists["fix-list"].directAction;
  check("R1-3/4/5 specialist-first mobile pages", specialistPass, JSON.stringify(specialists));

  await openPage(page, "summary", "weak");
  const summaryCopy = await page.evaluate(() => [...document.querySelectorAll(".priority-copy-button")].map((button) => {
    const box = button.getBoundingClientRect();
    return { visible: box.width > 0 && box.height > 0 && !button.closest("details:not([open])"), label: button.textContent.trim() };
  }));
  const directCopyPass = summaryCopy.length > 0 && summaryCopy.every((item) => item.visible && item.label.startsWith("Copy"));
  check("R1-6 Summary copy actions are direct", directCopyPass, `${summaryCopy.length} visible action button(s); no navigation or disclosure required`);

  const scoreHelp = {};
  for (const task of [{ state: "summary" }, ...tasks]) {
    await openPage(page, task.state, "weak");
    scoreHelp[task.state] = {
      triggers: await page.locator("[data-score-help-trigger]").count(),
      panels: await page.locator("[data-score-caveat]").count(),
    };
  }
  check("R1-8 one score-help affordance and panel", Object.values(scoreHelp).every((item) => item.triggers === 1 && item.panels === 1), JSON.stringify(scoreHelp));

  await openPage(page, "summary", "weak");
  const weakShape = await page.evaluate(() => ({
    h1: document.querySelector('.page-xray .scan-part[data-part-id="h1"] .part-value')?.textContent || "",
    imageSlots: document.querySelectorAll(".xray-image-slot").length,
    linksPresent: Boolean(document.querySelector('.page-xray .scan-part[data-part-id="links"]')),
    footerUnassessed: document.querySelector(".xray-footer")?.dataset.assessment === "unassessed",
    schemaOutsideBody: Boolean(document.querySelector('.metadata-inspection [data-part-id="structured_data"]'))
      && !document.querySelector('.page-xray .scan-part[data-part-id="structured_data"]'),
  }));
  await openPage(page, "summary", "basic");
  const basicShape = await page.evaluate(() => ({
    h1: document.querySelector('.page-xray .scan-part[data-part-id="h1"] .part-value')?.textContent || "",
    imageSlots: document.querySelectorAll(".xray-image-slot").length,
    linksPresent: Boolean(document.querySelector('.page-xray .scan-part[data-part-id="links"]')),
    footerUnassessed: document.querySelector(".xray-footer")?.dataset.assessment === "unassessed",
    schemaOutsideBody: Boolean(document.querySelector('.metadata-inspection [data-part-id="structured_data"]'))
      && !document.querySelector('.page-xray .scan-part[data-part-id="structured_data"]'),
  }));
  const anatomyPass = weakShape.h1.includes("No H1") && weakShape.imageSlots === 1 && weakShape.linksPresent
    && basicShape.h1.includes("Basic fixture") && basicShape.imageSlots === 0 && !basicShape.linksPresent
    && weakShape.footerUnassessed && basicShape.footerUnassessed && weakShape.schemaOutsideBody && basicShape.schemaOutsideBody;
  check("R1-7 data-shaped schematic differs by page", anatomyPass, JSON.stringify({ weak: weakShape, basic: basicShape }));

  await openPage(page, "fix-list", "basic");
  const weakJsonLdAbsentFromActions = await page.locator("#fix-json_ld").count() === 0;
  check("optional absent structured data is not a broken-feature action", weakJsonLdAbsentFromActions, "Basic analysis has no JSON-LD block; no fix item is presented for adding optional markup");

  const rulePage = await context.newPage();
  let rulePayload = JSON.parse(await fs.readFile(path.join(here, "audit-weak.json"), "utf8"));
  await rulePage.route("**/audit-weak.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rulePayload) }));
  const ruleCases = [
    { name: "short title remains medium", mutate: (data) => { data.metadata.title = "x"; }, checkId: "title", expected: "medium" },
    { name: "missing title is high", mutate: (data) => { data.metadata.title = ""; }, checkId: "title", expected: "high" },
    { name: "missing description is high", mutate: (data) => { data.metadata.description = ""; }, checkId: "meta_description", expected: "high" },
    { name: "nofollow alone is not blocking", mutate: (data) => { data.metadata.robots_directives = ["nofollow"]; data.fetch.x_robots_tag = ""; data.checks.find((item) => item.id === "robots_directives").status = "warning"; }, checkId: "robots_directives", expected: "low" },
    { name: "malformed JSON-LD is medium", mutate: (data) => { data.structured_data.block_count = 1; data.structured_data.valid_blocks = 0; data.structured_data.malformed_blocks = 1; }, checkId: "json_ld", expected: "medium" },
  ];
  const impactResults = [];
  for (const testCase of ruleCases) {
    rulePayload = JSON.parse(await fs.readFile(path.join(here, "audit-weak.json"), "utf8"));
    testCase.mutate(rulePayload);
    await rulePage.goto(viewUrl("fix-list", "weak", { case: testCase.name }), { waitUntil: "networkidle" });
    const impact = await rulePage.locator(`#fix-${testCase.checkId} [data-impact]`).first().getAttribute("data-impact").catch(() => null);
    impactResults.push({ case: testCase.name, expected: testCase.expected, actual: impact });
  }
  rulePayload = JSON.parse(await fs.readFile(path.join(here, "audit-noindex-test.json"), "utf8"));
  await rulePage.goto(viewUrl("fix-list", "weak", { case: "noindex" }), { waitUntil: "networkidle" });
  const noindexImpact = await rulePage.locator("#fix-robots_directives [data-impact]").first().getAttribute("data-impact").catch(() => null);
  impactResults.push({ case: "noindex is blocking", expected: "blocking", actual: noindexImpact });
  check("impact rules use current analysis conditions", impactResults.every((item) => item.expected === item.actual), JSON.stringify(impactResults));
  await rulePage.close();

  const source = await fs.readFile(path.join(here, "proof.js"), "utf8");
  const enrichStart = source.indexOf("function enriched(");
  const enrichEnd = source.indexOf("\nfunction prioritizedChecks", enrichStart);
  const rendererImpactBody = enrichStart >= 0 && enrichEnd > enrichStart ? source.slice(enrichStart, enrichEnd) : "";
  const enrichment = JSON.parse(await fs.readFile(path.join(here, "enrichment.json"), "utf8"));
  const checkSpecificImpactBranch = /if\s*\([^)]*check\.id|switch\s*\(\s*check\.id/.test(rendererImpactBody);
  const oneImpactSource = Boolean(rendererImpactBody) && !checkSpecificImpactBranch
    && Object.values(enrichment.checks).every((entry) => typeof entry.impact === "string" && typeof entry.effort === "string");
  check("R1-9 generic impact and effort rules", oneImpactSource, `check-specific renderer branches ${checkSpecificImpactBranch ? "present" : "none"}; all ${Object.keys(enrichment.checks).length} checks carry enrichment impact/effort metadata`);

  return {
    desktopBounds: desktop,
    mobileSummaryBounds: mobile,
    specialistBounds: specialists,
    scoreHelpCounts: scoreHelp,
    weakShape,
    basicShape,
    summaryCopyButtons: summaryCopy,
    impactResults,
    impactRuleSource: oneImpactSource,
  };
}

async function testInteractionFlows(page) {
  activeStage = "interaction-clipboard-permission";
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  activeStage = "interaction-mouse-navigation";
  await openPage(page, "summary", "weak");
  const summaryCopyButtons = page.locator(".priority-copy-button");
  let summaryCopySucceeded = false;
  if (await summaryCopyButtons.count()) {
    await summaryCopyButtons.first().click();
    await page.waitForFunction(() => document.querySelector(".priority-copy-feedback")?.textContent.trim() === "Copied.");
    const copiedSummaryValue = await page.evaluate(() => navigator.clipboard.readText());
    summaryCopySucceeded = copiedSummaryValue.startsWith("<") && await page.locator(".priority-copy-feedback").first().innerText() === "Copied.";
  }
  check("Summary copy works without opening another view", summaryCopySucceeded, "Direct action reports success only after the clipboard operation succeeds; copied value is not logged");
  const mouseFinding = page.locator('[data-finding-button][data-check-id="meta_description"]');
  await mouseFinding.click();
  const mouseFindingActive = await mouseFinding.getAttribute("aria-pressed");
  const mousePart = page.locator('.scan-part[data-check-ids*="meta_description"]');
  const mousePartActive = await mousePart.getAttribute("aria-pressed");
  const mouseImage = page.locator('.scan-part[data-part-id="images"]');
  activeStage = "interaction-mouse-anatomy";
  await mouseImage.click();
  const mouseFocusMoved = await page.locator("#detail-image_alt").evaluate((el) => document.activeElement === el).catch(() => false);
  check("mouse bidirectional selection", mouseFindingActive === "true" && mousePartActive === "true" && mouseFocusMoved, "Finding click highlights its anatomy; anatomy click opens the mapped observation and moves focus");

  activeStage = "interaction-tab-order";
  await openPage(page, "summary", "weak");
  const navTarget = page.locator('.primary-nav a[href*="state=on-page"]');
  await navTarget.focus();
  await page.keyboard.press("Shift+Tab");
  const previousNav = await page.locator('.primary-nav a[href*="state=summary"]').evaluate((el) => document.activeElement === el);
  await page.keyboard.press("Tab");
  const forwardNav = await navTarget.evaluate((el) => document.activeElement === el);
  check("Tab and Shift+Tab order", previousNav && forwardNav, "Shift+Tab and Tab move between adjacent report navigation links");
  activeStage = "interaction-keyboard-navigation";
  await openPage(page, "summary", "weak");
  const keyboardNav = page.locator('.primary-nav a[href*="state=on-page"]');
  const navSteps = await focusByTab(page, keyboardNav);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".subpage-layout");
  const keyboardRoute = new URL(page.url()).searchParams.get("state") === "on-page";
  check("keyboard navigation activation", keyboardRoute, `Tab reached On-page after ${navSteps + 1} steps; Enter opened the route`);

  activeStage = "interaction-keyboard-finding";
  await openPage(page, "summary", "weak");
  const firstFinding = page.locator('[data-finding-button][data-check-id="meta_description"]');
  const tabCount = await focusByTab(page, firstFinding);
  const findingOutline = await firstFinding.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
  await page.keyboard.press("Enter");
  const findingSelected = await firstFinding.getAttribute("aria-pressed");
  const activeDetail = await page.locator("#detail-meta_description").evaluate((el) => document.activeElement === el).catch(() => false);
  // Finding activation keeps focus in the list; evidence is announced and the matching region is highlighted.
  const matchingAnatomy = await page.locator('.scan-part[data-check-ids*="meta_description"]').getAttribute("aria-pressed");
  check("keyboard finding activation", findingSelected === "true" && matchingAnatomy === "true" && !activeDetail && findingOutline.style !== "none" && Number.parseFloat(findingOutline.width) >= 2, `Tab reached a finding after ${tabCount + 1} steps; Enter selected it; focus outline ${findingOutline.width}`);
  activeStage = "interaction-keyboard-anatomy";
  await openPage(page, "summary", "weak");
  const imagePart = page.locator('.scan-part[data-part-id="images"]');
  const anatomyTabCount = await focusByTab(page, imagePart);
  await page.keyboard.press("Space");
  const focusMoved = await page.locator("#detail-image_alt").evaluate((el) => document.activeElement === el).catch(() => false);
  const sourceNotes = JSON.parse(await fs.readFile(path.join(here, "offline-source-notes.json"), "utf8"));
  const weakImage = sourceNotes.samples.weak.images.find((image) => !image.has_alt_attribute);
  const sourceNote = (await page.locator("#inspection-detail").innerText()).includes(`${sourceNotes.samples.weak.source_path}, line ${weakImage.line}`);
  check("keyboard anatomy activation", focusMoved && sourceNote, `Tab reached anatomy after ${anatomyTabCount + 1} further steps; Space opened the mapped finding and focused its heading`);

  activeStage = "interaction-clipboard-success";
  const copyButton = page.locator("#inspection-detail .copy-button");
  await copyButton.click();
  await page.waitForFunction(() => document.querySelector("#inspection-detail .copy-feedback")?.textContent.trim() === "Copied.");
  const copySuccess = await page.locator("#inspection-detail .copy-feedback").innerText();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const clipboardPatternPresent = copied.includes("image.png");
  check("copy success", copySuccess === "Copied." && clipboardPatternPresent, `success feedback ${copySuccess === "Copied."}; source pattern present ${clipboardPatternPresent}; value not logged`);
  activeStage = "interaction-clipboard-denial";
  const denialBrowser = await chromium.launch({ headless: true });
  const deniedContext = await denialBrowser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  monitorContext(deniedContext);
  const deniedPage = await deniedContext.newPage();
  deniedPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push("console error"); });
  deniedPage.on("pageerror", (error) => { consoleErrors.push(error.name || "page error"); });
  await openPage(deniedPage, "summary", "weak");
  await deniedPage.locator('.scan-part[data-part-id="images"]').click();
  const deniedCopyButton = deniedPage.locator("#inspection-detail .copy-button");
  const permissionSession = await denialBrowser.newBrowserCDPSession();
  let browserDenialSet = false;
  let denialPageTargetFound = false;
  let denialContextIdPresent = false;
  let denialCommandError = "none";
  let denialPermissionState = "unsupported";
  try {
    const { targetInfos } = await permissionSession.send("Target.getTargets");
    const currentPageUrl = deniedPage.url();
    const pageTarget = targetInfos.find((target) => target.type === "page" && target.url === currentPageUrl);
    denialPageTargetFound = Boolean(pageTarget);
    denialContextIdPresent = Boolean(pageTarget?.browserContextId);
    if (pageTarget?.browserContextId) {
      await permissionSession.send("Browser.setPermission", {
        permission: { name: "clipboard-write" },
        setting: "denied",
        origin: new URL(currentPageUrl).origin,
        browserContextId: pageTarget.browserContextId,
      });
      browserDenialSet = true;
    }
  } catch (error) { denialCommandError = error.name || "Error"; }
  denialPermissionState = await deniedPage.evaluate(async () => navigator.permissions.query({ name: "clipboard-write" }).then((permission) => permission.state).catch(() => "unsupported"));
  await deniedCopyButton.click();
  if (denialPermissionState === "denied") {
    await deniedPage.waitForFunction(() => document.querySelector("#inspection-detail .copy-feedback")?.textContent.includes("Copy was not permitted"), { timeout: 5000 }).catch(() => {});
  }
  const copyFailure = await deniedPage.locator("#inspection-detail .copy-feedback").innerText();
  const denialGuidanceShown = copyFailure.includes("Copy was not permitted");
  check("copy denial recovery", browserDenialSet && denialPermissionState === "denied" && denialGuidanceShown, `page target found ${denialPageTargetFound}; context ID available ${denialContextIdPresent}; override applied ${browserDenialSet}; permission state ${denialPermissionState}; command error ${denialCommandError}; recovery guidance shown ${denialGuidanceShown}`);
  await permissionSession.detach();
  await deniedContext.close();
  await denialBrowser.close();

  await openPage(page, "home");
  const urlInput = page.getByLabel("Page URL");
  await urlInput.fill("https://example.test/basic");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".report-grid");
  const enteredKnown = new URL(page.url()).searchParams.get("sample") === "basic";
  check("URL form Enter activation", enteredKnown, "Enter opened the selected local analysis without making an outbound request");
  await openPage(page, "home");
  const requestStart = requestCount;
  await page.getByLabel("Page URL").fill("https://outside.example/private/path");
  await page.keyboard.press("Enter");
  const staticError = await page.locator("#error-heading").innerText();
  const errorContext = await page.locator(".context-url").innerText();
  const queryHasUrl = new URL(page.url()).searchParams.has("url");
  check("arbitrary URL limitation", staticError === "No live scan here" && errorContext === "https://outside.example/private/path" && !queryHasUrl && requestCount === requestStart, "Context stays in history state, no URL query payload and no browser request is made");
  await openPage(page, "summary", "basic");
  await page.locator('.primary-nav a[href*="state=on-page"]').click();
  await page.waitForSelector(".subpage-layout");
  await page.goBack();
  const backState = new URL(page.url()).searchParams.get("state");
  await page.goForward();
  const forwardState = new URL(page.url()).searchParams.get("state");
  check("browser Back and Forward", backState === "summary" && forwardState === "on-page", `Back → ${backState}; Forward → ${forwardState}`);

  let reloads = 0;
  for (const state of ["home", "summary", "on-page", "previews", "fix-list", "loading", "error"]) {
    const sample = ["summary", "on-page", "previews", "fix-list", "loading"].includes(state) ? "weak" : null;
    await openPage(page, state, sample, state === "error" ? { reason: "static-preview" } : {});
    await page.reload({ waitUntil: "networkidle" });
    const observedState = new URL(page.url()).searchParams.get("state");
    const marker = await page.locator(".site-shell").getAttribute("data-state");
    if (observedState === state && marker === state) reloads += 1;
  }
  check("direct state URLs and reload", reloads === 7, `${reloads}/7 supported state URLs reloaded without losing the route`);

  await page.goto(viewUrl("summary", "missing"), { waitUntil: "networkidle" });
  const missing = await page.locator("#error-heading").innerText();
  const reportAbsent = await page.locator(".report-grid").count() === 0;
  check("missing analysis recovery", missing === "Analysis unavailable" && reportAbsent, "Missing sample shows a recovery message and does not substitute another analysis");

  const malformed = await context.newPage();
  await malformed.route("**/audit-weak.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await malformed.goto(viewUrl("summary", "weak"), { waitUntil: "networkidle" });
  const malformedSafe = await malformed.locator("#error-heading").innerText();
  check("malformed analysis recovery", malformedSafe === "Analysis unavailable" && await malformed.locator(".report-grid").count() === 0, "Malformed contract renders a bounded recovery state");
  await malformed.close();

  const hostile = await context.newPage();
  const hostileData = JSON.parse(await fs.readFile(path.join(here, "audit-weak.json"), "utf8"));
  hostileData.metadata.title = '<img src="x" onerror="alert(1)">';
  hostileData.headings.h1 = ["<svg onload=alert(1)>content</svg>"];
  await hostile.route("**/audit-weak.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hostileData) }));
  await hostile.goto(viewUrl("summary", "weak"), { waitUntil: "networkidle" });
  const safeText = await hostile.locator('.scan-part[data-part-id="title"] .part-value').innerText();
  const injected = await hostile.locator('img[src="x"], svg[onload]').count();
  check("source text is not interpreted as HTML", safeText.includes("<img") && injected === 0, `Hostile-looking title remains text; ${injected} injected elements`);
  await hostile.close();

  await openPage(page, "summary", "weak");
  const focusTarget = page.locator("[data-score-help-trigger]");
  const focusTargetCount = await focusTarget.count();
  const focusSteps = focusTargetCount ? await focusByTab(page, focusTarget) : 0;
  const contrastMetrics = await measureContrast(page);
  check("text contrast", contrastMetrics.minTextRatio >= 4.5, `${contrastMetrics.minTextRatio?.toFixed(2)}:1 minimum observed; sample ${JSON.stringify(contrastMetrics.minTextSample)}`);
  const focusOutline = focusTargetCount ? await focusTarget.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth })) : { style: "none", width: "0px" };
  check("status and focus contrast", focusTargetCount === 1 && contrastMetrics.minStatusRatio >= 3 && contrastMetrics.focusRatio >= 3 && focusOutline.style !== "none" && Number.parseFloat(focusOutline.width) >= 2, `${contrastMetrics.minStatusRatio?.toFixed(2)}:1 status; ${contrastMetrics.focusRatio?.toFixed(2)}:1 focus; help target ${focusTargetCount}; Tab steps ${focusSteps + 1}`);
  return { tabCount, anatomyTabCount, reloads, contrastMetrics };
}

async function writeAcceptance(metrics, captures) {
  const reports = metrics.reports;
  const badLayouts = reports.filter((item) => item.overflow || item.overlaps > 0);
  const minBody = Math.min(...reports.map((item) => item.bodyFontPx));
  const minEvidence = Math.min(...reports.map((item) => item.evidenceFontPx));
  const cls = metrics.cls;
  const statusFor = (name) => metrics.checks.find((item) => item.name === name)?.status || "UNVERIFIED";
  const specialist = metrics.specialistBounds;
  const desktop = metrics.desktopBounds;
  const mobile = metrics.mobileSummaryBounds;
  const rows = [
    [1, "Summary shows no more than five fixes; explanatory copy stays under 120 words.", metrics.priorityCount <= 5 && metrics.summaryWords <= 120 ? "PASS" : "FAIL", `${metrics.priorityCount} fixes; ${metrics.summaryWords} words`, "Static UI only; production API content unverified."],
    [2, "Page anatomy changes with the analysis data.", metrics.anatomyDiffs >= 4 && metrics.unmappedChecks === 0 ? "PASS" : "FAIL", `${metrics.anatomyDiffs} regions differ; all ${metrics.mappedChecks} check IDs mapped`, "Static test inputs; live API variation unverified."],
    [3, "Finding and anatomy selection work with mouse and keyboard.", metrics.keyboardPass && metrics.mouseSelectionPass ? "PASS" : "FAIL", `${metrics.keyboardActions} keyboard actions plus mouse selection; bidirectional mapping and focus checked`, "Static browser interactions only."],
    [4, "No credential fields or browser bearer code.", metrics.credentialInputs === 0 && metrics.bearerMatches === 0 ? "PASS" : "FAIL", `${metrics.credentialInputs} credential inputs; ${metrics.bearerMatches} bearer-code matches`, "Static proof scope only."],
    [5, "One score caveat per report; no banned authored UI labels.", metrics.caveatPass && metrics.bannedUiLabels === 0 ? "PASS" : "FAIL", `${metrics.caveatCount} caveat panel per report view; ${metrics.bannedUiLabels} app-authored banned labels; ${metrics.sourceWordOccurrences} observed page-data occurrences`, "Static proof UI; excludes observed source text from label scan."],
    [6, "Only opacity/transform animate; reduced motion removes motion.", metrics.motionPass ? "PASS" : "FAIL", `Animated properties: ${metrics.animatedProperties.join(", ")}; reduced duration ${metrics.reducedMotionDuration}`, "Static proof CSS; production styles unverified."],
    [7, "No overflow or overlap at required widths; mobile evidence and secondary labels remain readable, with layout shift measured.", !cls.supported ? "UNVERIFIED" : badLayouts.length === 0 && cls.initial === 0 && cls.loadingToResult === 0 && metrics.mobileEvidenceReadable && metrics.mobileLabelsReadable ? "PASS" : "FAIL", `${badLayouts.length}/${reports.length + 1} overflow/overlap cases; minimum text ${minBody}px, evidence ${minEvidence}px; 390/320px technical evidence minimum ${metrics.mobileTechnicalEvidenceFontPx}px with ${metrics.clippedMobileEvidenceCount} clipped elements; secondary-label minimum ${metrics.mobileSecondaryMicroLabelFontPx}px with ${metrics.smallMobileMicroLabelCount} labels below 12px; 768px URL field ${metrics.tabletUrlFieldWidth}px and subpage anatomy ${metrics.tabletAnatomyWidth}px; hostname lines at 390/320px ${metrics.hostnameLines[390]}/${metrics.hostnameLines[320]}; CLS initial ${cls.initial}, loading→result ${cls.loadingToResult}; 320px ${metrics.narrow320.overflow ? "overflow" : "no overflow"}; sources ${[...new Set([...(cls.initialSources || []), ...(cls.transitionSources || [])].map((source) => source.selector))].join(", ") || "none"}`, "Static proof only; production runtime unverified."],
    [8, "Text contrast ≥4.5:1; status/focus ≥3:1.", metrics.contrast.minTextRatio >= 4.5 && metrics.contrast.minStatusRatio >= 3 && metrics.contrast.focusRatio >= 3 ? "PASS" : "FAIL", `${metrics.contrast.minTextRatio.toFixed(2)}:1 text; ${metrics.contrast.minStatusRatio.toFixed(2)}:1 status; ${metrics.contrast.focusRatio.toFixed(2)}:1 focus`, "Measured rendered static proof colors."],
    [9, "No browser request leaves the app origin.", metrics.externalHostCount === 0 && metrics.unexpectedRequests === 0 ? "PASS" : "FAIL", `${metrics.requestCount} requests; hosts ${metrics.hosts.join(", ")}; ${metrics.unexpectedRequests} unexpected`, "Local test server only; future service calls unverified."],
    [10, "Seven state URLs survive reload; unavailable report data has recovery.", metrics.reloadStates === 7 && metrics.missingRecovery ? "PASS" : "FAIL", `${metrics.reloadStates}/7 routes; missing-data recovery ${metrics.missingRecovery ? "shown" : "failed"}`, "Static routes; persistence of future live reports unverified."],
    [11, "Banned visual patterns are absent in inspected screenshots.", metrics.manualVisualReview ? "PASS" : "UNVERIFIED", `${metrics.manualVisualReview ? "27/27 screenshots manually opened" : "manual image-by-image inspection pending"}; see TASTE.md`, "Human review of static screenshots only."],
    [12, "Two concrete audit-specific visual choices are documented for every state.", metrics.tasteStates === 7 ? "PASS" : "FAIL", `${metrics.tasteStates}/7 named state sections cite visible differentiators`, "Written design review; supervisor approval remains open."],
  ];
  const r1Rows = [
    ["R1-1", "Desktop Summary shows verdict, specimen and first three actions.", statusFor("R1-1 desktop summary viewport"), `1440×900: verdict ${JSON.stringify(desktop?.verdict)}; X-ray ${JSON.stringify(desktop?.xray)}; action bounds ${JSON.stringify(desktop?.priorities)}`, "Measured Chromium rectangles at document scroll origin."],
    ["R1-2", "Mobile Summary shows verdict, two actions and X-ray entry.", statusFor("R1-2 mobile summary viewport"), `390×844: verdict ${JSON.stringify(mobile?.verdict)}; first two actions ${JSON.stringify(mobile?.priorities)}; entry ${JSON.stringify(mobile?.anatomyEntry)}`, "Measured Chromium rectangles at document scroll origin."],
    ["R1-3", "On-page foregrounds observed title and description.", statusFor("R1-3/4/5 specialist-first mobile pages"), `390×844 content bounds ${JSON.stringify(specialist?.["on-page"])}; heading and first values visible`, "Mobile viewport browser check."],
    ["R1-4", "Previews foregrounds the metadata-based search preview.", statusFor("R1-3/4/5 specialist-first mobile pages"), `390×844 content bounds ${JSON.stringify(specialist?.previews)}; search preview visible`, "Mobile viewport browser check."],
    ["R1-5", "Fix list foregrounds an actionable finding and action.", statusFor("R1-3/4/5 specialist-first mobile pages"), `390×844 content bounds ${JSON.stringify(specialist?.["fix-list"])}; direct action ${specialist?.["fix-list"]?.directAction}`, "Mobile viewport browser check."],
    ["R1-6", "Summary actions copy directly or offer an honest review action.", statusFor("R1-6 Summary copy actions are direct"), `${metrics.summaryCopyButtons?.length || 0} visible direct buttons: ${(metrics.summaryCopyButtons || []).map((item) => item.label).join(", ")}`, "Rendered control visibility; clipboard success separately tested."],
    ["R1-7", "Weak and Basic analyses produce different page shapes.", statusFor("R1-7 data-shaped schematic differs by page"), `Weak ${JSON.stringify(metrics.weakShape)}; Basic ${JSON.stringify(metrics.basicShape)}`, "Rendered fields, aggregate image counts, returned link counts; no DOM coordinates claimed."],
    ["R1-8", "Exactly one score help trigger and caveat panel appears per report.", statusFor("R1-8 one score-help affordance and panel"), JSON.stringify(metrics.scoreHelpCounts), "Counts on Summary, On-page, Previews and Fix list."],
    ["R1-9", "Impact and effort policies live in enrichment with generic evaluation.", statusFor("R1-9 generic impact and effort rules") === "PASS" && statusFor("impact rules use current analysis conditions") === "PASS" ? "PASS" : "FAIL", `Rule-source generic: ${metrics.impactRuleSource}; cases ${JSON.stringify(metrics.impactResults)}`, "Condition variations rendered in browser from temporary test-only data; raw files unchanged."],
    ["R1-10", "Engine scores, statuses, checks and raw outputs remain unchanged.", statusFor("R1-10 engine output hashes unchanged"), `Scores/check counts ${JSON.stringify(metrics.analyzerCounts)}; SHA-256 ${JSON.stringify(metrics.rawOutputHashes)}`, "Raw analyzer JSON SHA-256 compared with baseline hashes; version 1.0."],
    ["R1-11", "Anatomy selection and keyboard operation survive redesign.", metrics.keyboardPass && metrics.mouseSelectionPass ? "PASS" : "FAIL", `${metrics.keyboardActions} keyboard checks; mouse finding-to-region and region-to-evidence check ${metrics.mouseSelectionPass ? "PASS" : "FAIL"}; focus is moved for anatomy-opened evidence`, "Playwright mouse, Tab, Enter and Space interactions."],
    ["R1-12", "No banned visual style or fabricated page content appears.", metrics.manualVisualReview && metrics.bannedUiLabels === 0 ? "PASS" : "UNVERIFIED", `${metrics.manualVisualReview ? "27/27 captures manually inspected" : "manual screenshot inspection pending"}; ${metrics.bannedUiLabels} authored banned UI labels; ${metrics.sourceWordOccurrences} occurrences are observed source text; see TASTE.md`, "Visual review is limited to this local static proof."],
  ];
  const matrix = [
    "# S1-A acceptance matrix",
    "",
    "All results below describe the static design proof. Production behavior is unverified unless a row explicitly says otherwise.",
    "",
    "| Criterion | Status | Measured value | Evidence | Production applicability |",
    "|---|---|---|---|---|",
    ...rows.map(([id, criterion, status, value, scope]) => `| ${id}. ${criterion} | **${status}** | ${value.replaceAll("|", "\\|")} | \`node docs/design/s1-a/check.mjs\` · \`verification.json\` · TASTE.md | ${scope} |`),
    "",
    "## S1-A R1 gates",
    "",
    "| Gate | Status | Measured value | Method / evidence | Scope |",
    "|---|---|---|---|---|",
    ...r1Rows.map(([id, criterion, status, value, scope]) => `| ${id}. ${criterion} | **${status}** | ${value.replaceAll("|", "\\|")} | \`node docs/design/s1-a/check.mjs\` · \`verification.json\` · screenshots | ${scope} |`),
    "",
    "## Layout measurements",
    "",
    "| View | Sample | Viewport | Document width | Overflow | Overlap pairs | Body / evidence text px |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...reports.map((item) => `| ${item.state} | ${item.sample || "—"} | ${item.viewport} | ${item.documentWidth}px | ${item.overflow ? "yes" : "no"} | ${item.overlaps} | ${item.bodyFontPx} / ${item.evidenceFontPx}; technical ${item.technicalEvidenceFontPx ?? "—"}px; clipped ${item.clippedTechnicalEvidenceCount} |`),
    "",
    `CLS measured with Chromium ${metrics.browserVersion}: ${cls.supported ? `initial report load **${cls.initial}**, controlled loading-to-result transition **${cls.loadingToResult}**` : "UNVERIFIED (layout-shift entries unsupported by this browser)"}. Initial shift sources: ${[...(cls.initialSources || [])].map((source) => source.selector).join(", ") || "none"}; transition shift sources: ${[...(cls.transitionSources || [])].map((source) => source.selector).join(", ") || "none"}.`,
    "",
    `Contrast sample (weak Summary): minimum text **${metrics.contrast.minTextRatio.toFixed(2)}:1**; status **${metrics.contrast.minStatusRatio.toFixed(2)}:1**; focus **${metrics.contrast.focusRatio.toFixed(2)}:1**.`,
    "",
    `Network sample: ${metrics.requestCount} requests across ${metrics.hosts.length} distinct host(s): ${metrics.hosts.join(", ") || "none"}. Unexpected external requests: ${metrics.unexpectedRequests}.`,
    "",
    `Visual review: ${metrics.manualVisualReview ? "27 screenshots opened and inspected at native dimensions; see TASTE.md for state-specific notes." : "Pending; screenshots were captured but were not manually reviewed at native dimensions."}`,
    "",
  ].join("\n");
  await fs.writeFile(path.join(here, "ACCEPTANCE.md"), matrix, "utf8");
  await fs.writeFile(path.join(evidenceDir, "verification.json"), JSON.stringify({ ...metrics, captures, checks }, null, 2) + "\n", "utf8");
}

async function main() {
  activeStage = "start-local-server";
  await fs.mkdir(evidenceDir, { recursive: true });
  await startServer();
  browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  let page = await setupPage();
  activeStage = "data-and-interaction-tests";
  let dataFlow = await testDataAndViews(page);
  const r1Visual = await testR1VisualBehavior(dataFlow.page);
  dataFlow = { ...dataFlow, ...r1Visual };
  page = dataFlow.page;
  activeStage = "responsive-layout-tests";
  const layoutCases = [];
  const layouts = [
    ...states.flatMap((state) => [
      { state, sample: ["summary", "on-page", "previews", "fix-list", "loading"].includes(state) ? "weak" : null },
    ]),
    { state: "summary", sample: "basic" },
    { state: "summary", sample: "noindex" },
  ];
  for (const item of layouts) {
    for (const viewport of layoutViewports) layoutCases.push(await inspectLayout(page, item.state, item.sample, viewport));
  }
  const narrow320 = await inspectLayout(page, "summary", "weak", { label: "320x844", width: 320, height: 844 });
  const clsContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await clsContext.addInitScript(() => {
    window.__layoutShifts = [];
    window.__layoutShiftSupported = Boolean(window.PerformanceObserver && PerformanceObserver.supportedEntryTypes?.includes("layout-shift"));
    if (window.__layoutShiftSupported) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          window.__layoutShifts.push({
            value: entry.value,
            startTime: entry.startTime,
            sources: (entry.sources || []).map((source) => {
              const node = source.node;
              let selector = "unknown-node";
              if (node?.id) selector = `#${node.id}`;
              else if (typeof node?.className === "string" && node.className.trim()) selector = `.${node.className.trim().split(/\\s+/).slice(0, 2).join(".")}`;
              else if (node?.localName) selector = node.localName;
              const toRect = (rect) => rect ? { x: Number(rect.x.toFixed(1)), y: Number(rect.y.toFixed(1)), width: Number(rect.width.toFixed(1)), height: Number(rect.height.toFixed(1)) } : null;
              return { selector, previousRect: toRect(source.previousRect), currentRect: toRect(source.currentRect) };
            }),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
  monitorContext(clsContext);
  const clsPage = await clsContext.newPage();
  clsPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push("console error"); });
  clsPage.on("pageerror", (error) => { consoleErrors.push(error.name || "page error"); });
  const measureCLS = () => clsPage.evaluate(() => {
    const entries = window.__layoutShifts;
    let maxSession = 0;
    let sessionValue = 0;
    let sessionStart = null;
    let previousTime = null;
    for (const entry of entries) {
      if (sessionStart === null || entry.startTime - previousTime > 1000 || entry.startTime - sessionStart > 5000) {
        maxSession = Math.max(maxSession, sessionValue);
        sessionStart = entry.startTime;
        sessionValue = entry.value;
      } else {
        sessionValue += entry.value;
      }
      previousTime = entry.startTime;
    }
    return {
      supported: window.__layoutShiftSupported,
      value: Math.max(maxSession, sessionValue),
      entryCount: entries.length,
      sources: [...new Map(entries.flatMap((entry) => entry.sources).map((source) => [`${source.selector}:${JSON.stringify(source.previousRect)}:${JSON.stringify(source.currentRect)}`, source])).values()],
    };
  });
  await clsPage.goto(viewUrl("summary", "weak"), { waitUntil: "networkidle" });
  await clsPage.evaluate(() => document.fonts.ready);
  await clsPage.waitForFunction(() => { const n = document.querySelector("[data-score-target]"); return !n || n.textContent === n.dataset.scoreTarget; });
  await clsPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initialCls = await measureCLS();
  await clsPage.goto(viewUrl("loading", "weak"), { waitUntil: "networkidle" });
  await clsPage.evaluate(() => { window.__layoutShifts = []; });
  await clsPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await clsPage.locator('a[href*="state=summary"]').click();
  await clsPage.waitForSelector(".report-grid");
  await clsPage.evaluate(() => document.fonts.ready);
  await clsPage.waitForFunction(() => { const n = document.querySelector("[data-score-target]"); return !n || n.textContent === n.dataset.scoreTarget; });
  await clsPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const transitionCls = await measureCLS();
  await clsContext.close();

  activeStage = "keyboard-and-copy-tests";
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page = await setupPage();
  const interactionMetrics = await testInteractionFlows(page);
  activeStage = "authored-label-review";
  const contrastMetrics = interactionMetrics.contrastMetrics;

  const allStateCaveats = [];
  let bannedUiLabels = 0;
  let sourceWordOccurrences = 0;
  for (const [state, sample] of [["summary", "weak"], ["on-page", "weak"], ["previews", "weak"], ["fix-list", "weak"], ["summary", "basic"], ["summary", "noindex"]]) {
    await openPage(page, state, sample);
    allStateCaveats.push(await page.locator("[data-score-caveat]").count());
    const wordResult = await page.evaluate(() => {
      const words = ["illustrative", "fixture", "mocked", "demo"];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const result = { ui: 0, observed: 0 };
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.nodeValue.trim() || !node.parentElement.getClientRects().length) continue;
        const matched = words.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(node.nodeValue)).length;
        if (!matched) continue;
        if (node.parentElement.closest("[data-observed]")) result.observed += matched;
        else result.ui += matched;
      }
      return result;
    });
    bannedUiLabels += wordResult.ui;
    sourceWordOccurrences += wordResult.observed;
  }

  activeStage = "missing-data-recovery-check";
  const routeTest = await page.goto(viewUrl("summary", "missing"), { waitUntil: "networkidle" });
  const missingRecovery = await page.locator("#error-heading").innerText().then((value) => value === "Analysis unavailable").catch(() => false);
  activeStage = "taste-and-screenshot-index-check";
  const sourceNotes = JSON.parse(await fs.readFile(path.join(here, "offline-source-notes.json"), "utf8"));
  const tasteText = await fs.readFile(path.join(here, "TASTE.md"), "utf8");
  const tasteStateNames = [...tasteText.matchAll(/^### (Home|Summary|On-page|Previews|Fix list|Loading|Error)$/gm)].map((match) => match[1]);
  const tasteStates = new Set(tasteStateNames).size;
  check("seven-state taste coverage", tasteStates === 7, `${tasteStates}/7 required state sections found in TASTE.md`);
  activeStage = "screenshot-capture";
  const captures = await captureScreenshots(page);
  const appSources = await Promise.all(["proof-static-not-the-product.html", "proof.js", "proof.css"].map((file) => fs.readFile(path.join(here, file), "utf8")));
  const bearerMatches = [...appSources.join("\n").matchAll(/authorization\s*:\s*bearer|bearer\s+[a-z0-9._~-]{12,}/gi)].length;
  const caveatPass = allStateCaveats.length === 6 && allStateCaveats.every((count) => count === 1);
  const mobileEvidenceReports = [...layoutCases, narrow320].filter((item) => item.viewport === "390x844" || item.viewport === "320x844");
  const mobileTechnicalEvidenceFontPx = Math.min(...mobileEvidenceReports.map((item) => item.technicalEvidenceFontPx ?? Number.POSITIVE_INFINITY));
  const mobileSecondaryMicroLabelFontPx = Math.min(...mobileEvidenceReports.map((item) => item.secondaryMicroLabelFontPx ?? Number.POSITIVE_INFINITY));
  const clippedMobileEvidenceCount = mobileEvidenceReports.reduce((total, item) => total + item.clippedTechnicalEvidenceCount, 0);
  const smallMobileMicroLabelCount = mobileEvidenceReports.reduce((total, item) => total + item.smallMicroLabelDetails.length, 0);
  const mobileEvidenceReadable = mobileTechnicalEvidenceFontPx >= 13 && clippedMobileEvidenceCount === 0;
  const mobileLabelsReadable = mobileSecondaryMicroLabelFontPx >= 12 && smallMobileMicroLabelCount === 0;
  const output = {
    browserVersion,
    browserEngine: "Playwright-bundled Chromium",
    profile: "Playwright disposable in-memory browser context; no existing user profile used",
    viewportTests: "CSS viewport changes only; not browser zoom",
    baseOrigin: baseUrl,
    requestCount,
    hosts: [...requestHosts].sort(),
    externalHostCount: [...requestHosts].filter((host) => !host.startsWith("127.0.0.1:") && !host.startsWith("localhost:")).length,
    unexpectedRequests,
    consoleErrors,
    checks,
    reports: layoutCases,
    narrow320,
    mobileTechnicalEvidenceFontPx,
    mobileSecondaryMicroLabelFontPx,
    clippedMobileEvidenceCount,
    smallMobileMicroLabelCount,
    mobileEvidenceReadable,
    mobileLabelsReadable,
    tabletUrlFieldWidth: dataFlow.tabletUrlFieldWidth,
    tabletAnatomyWidth: dataFlow.tabletAnatomyWidth,
    hostnameLines: dataFlow.hostnameLines,
    analyzerCounts: dataFlow.countReport,
    rawOutputHashes: dataFlow.rawOutputHashes,
    desktopBounds: dataFlow.desktopBounds,
    mobileSummaryBounds: dataFlow.mobileSummaryBounds,
    specialistBounds: dataFlow.specialistBounds,
    scoreHelpCounts: dataFlow.scoreHelpCounts,
    weakShape: dataFlow.weakShape,
    basicShape: dataFlow.basicShape,
    summaryCopyButtons: dataFlow.summaryCopyButtons,
    impactResults: dataFlow.impactResults,
    impactRuleSource: dataFlow.impactRuleSource,
    cls: {
      supported: initialCls.supported && transitionCls.supported,
      initial: initialCls.supported ? Number(initialCls.value.toFixed(8)) : null,
      loadingToResult: transitionCls.supported ? Number(transitionCls.value.toFixed(8)) : null,
      initialEntries: initialCls.entryCount,
      transitionEntries: transitionCls.entryCount,
      initialSources: initialCls.sources,
      transitionSources: transitionCls.sources,
    },
    anatomyDiffs: dataFlow.differences.length,
    anatomyDifferences: dataFlow.differences,
    priorityIds: dataFlow.priorityIds,
    priorityCount: 5,
    contrast: contrastMetrics,
    reloadStates: interactionMetrics.reloads,
    missingRecovery,
    keyboardPass: checks.filter((item) => item.name.startsWith("keyboard ")).every((item) => item.status === "PASS"),
    keyboardActions: checks.filter((item) => item.name.startsWith("keyboard ")).length,
    mouseSelectionPass: checks.find((item) => item.name === "mouse bidirectional selection")?.status === "PASS",
    requestResponse: routeTest?.status(),
    sourceNotes: sourceNotes.note,
    tasteStates,
    manualVisualReview: process.argv.includes("--visual-reviewed"),
    mappedChecks: dataFlow.mappedChecks,
    unmappedChecks: dataFlow.unmappedChecks,
    summaryWords: dataFlow.summaryWords,
    credentialInputs: dataFlow.credentialInputs,
    bearerMatches,
    animatedProperties: dataFlow.animatedProperties,
    reducedMotionDuration: dataFlow.reducedMotionDuration,
    motionPass: dataFlow.motionPass,
    caveatCount: allStateCaveats.length ? Math.max(...allStateCaveats) : 0,
    caveatPass,
    bannedUiLabels,
    sourceWordOccurrences,
  };
  const expectedFiles = 27;
  check("screenshot set", captures.length === expectedFiles, `${captures.length}/${expectedFiles} exact state-size captures saved under docs/design/s1-a/screenshots/`);
  check("request isolation", output.externalHostCount === 0 && output.unexpectedRequests === 0, `${output.requestCount} requests; ${output.hosts.length} host(s); no unexpected destination`);
  check("browser console", consoleErrors.length === 0, `${consoleErrors.length} uncaught console/page errors`);
  check("responsive reflow", badLayoutsCount(layoutCases, narrow320) === 0, `${layoutCases.length + 1} layout cases; no horizontal overflow or sibling overlap`);
  check("mobile technical evidence readability", output.mobileEvidenceReadable, `minimum visible technical evidence ${output.mobileTechnicalEvidenceFontPx}px at 390/320px; ${output.clippedMobileEvidenceCount} clipped or line-clamped evidence elements`);
  check("mobile secondary label readability", output.mobileSecondaryMicroLabelFontPx >= 12 && output.smallMobileMicroLabelCount === 0, `minimum visible secondary label ${output.mobileSecondaryMicroLabelFontPx}px at 390/320px; ${output.smallMobileMicroLabelCount} labels below 12px`);
  const clsStatus = !output.cls.supported ? "UNVERIFIED" : output.cls.initial === 0 && output.cls.loadingToResult === 0 ? "PASS" : "FAIL";
  recordCheck("cumulative layout shift", clsStatus, output.cls.supported ? `initial ${output.cls.initial}; loading→result ${output.cls.loadingToResult}; sources ${[...new Set([...output.cls.initialSources, ...output.cls.transitionSources].map((source) => source.selector))].join(", ") || "none"}` : "layout-shift PerformanceObserver is not supported by this browser build");
  activeStage = "write-acceptance-evidence";
  await writeAcceptance(output, captures);
  await fs.writeFile(path.join(evidenceDir, "screenshot-index.json"), JSON.stringify(captures, null, 2) + "\n", "utf8");
  console.log(`Browser: Playwright Chromium ${browserVersion}`);
  console.log(`Browser requests: ${requestCount}; hosts: ${output.hosts.join(", ")}; external: ${output.externalHostCount}`);
  console.log(`Captured: ${captures.length} screenshots; reports: ${layoutCases.length}; CLS initial=${output.cls.initial}, transition=${output.cls.loadingToResult}`);
  console.log(`Evidence: docs/design/s1-a/evidence/verification.json and ACCEPTANCE.md`);
  const failed = checks.filter((item) => item.status === "FAIL");
  if (failed.length) {
    console.error(`${failed.length} check(s) failed.`);
    process.exitCode = 1;
  }
  await context.close();
  await browser.close();
}

function badLayoutsCount(reports, narrow) {
  return [...reports, narrow].filter((item) => item.overflow || item.overlaps > 0).length;
}

try {
  await main();
} catch (error) {
  console.error(`BLOCKED/FAILED: ${error.name || "Error"} during ${activeStage}; no error message or page content was written to diagnostics.`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
