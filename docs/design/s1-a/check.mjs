import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const evidenceDir = path.join(here, "evidence");
const screenshotDir = path.join(here, "screenshots");
const require = createRequire(path.join(root, "web", "package.json"));
const { chromium } = require("playwright");
const checks = [];
const requestHosts = new Set();
let requestCount = 0;
let externalRequestCount = 0;
let consoleErrorCount = 0;
let pageErrorCount = 0;
let activeStage = "initialization";
let activeInteraction = "none";
let server;
let browser;
let context;
let baseUrl;

const views = ["home", "summary", "fix-list", "xray", "on-page", "previews", "loading", "error"];
const reportViews = new Set(["summary", "fix-list", "xray", "on-page", "previews"]);
const layoutViewports = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "390x844", width: 390, height: 844 },
];
const rawHashes = {
  "audit-weak.json": "6b5ab639b111c52f581fa15c7a778a62fd08043b70812630a5b5bf9eb676acea",
  "audit-basic.json": "374f9a081d34770534de68051402d6b4c6b871a60b2c0acc6e7d018ee9504a2d",
  "audit-noindex-test.json": "018e54337646fc047177c1ab64c9198e19f7f3710d07f1a6cb79d63c48dff89c",
};

function record(name, passed, detail, status = null) {
  const result = { name, status: status || (passed ? "PASS" : "FAIL"), detail };
  checks.push(result);
  console.log(result.status + " " + name + ": " + detail);
  return result;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".ttf": "font/ttf",
    ".png": "image/png",
  })[ext] || "application/octet-stream";
}

async function startServer() {
  server = http.createServer(async (request, response) => {
    const parsed = new URL(request.url || "/", "http://127.0.0.1");
    let pathname;
    try { pathname = decodeURIComponent(parsed.pathname); }
    catch { response.writeHead(400).end(); return; }
    const filePath = path.resolve(root, "." + pathname);
    if (!filePath.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
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
  baseUrl = "http://127.0.0.1:" + server.address().port;
}

function routeUrl(state, sample = null, extra = {}) {
  const query = new URLSearchParams({ state });
  if (sample) query.set("sample", sample);
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return baseUrl + "/docs/design/s1-a/proof-static-not-the-product.html?" + query.toString();
}

function watchContext(activeContext) {
  activeContext.on("request", (request) => {
    requestCount += 1;
    const url = new URL(request.url());
    requestHosts.add(url.host);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") externalRequestCount += 1;
  });
  activeContext.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    externalRequestCount += 1;
    return route.abort();
  });
}

async function newPage(viewport = { width: 1440, height: 900 }) {
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  watchContext(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__r2LayoutShifts = [];
    try {
      const observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) if (!entry.hadRecentInput) window.__r2LayoutShifts.push(entry.value);
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch { window.__r2LayoutShifts = null; }
  });
  page.setDefaultTimeout(5000);
  page.on("console", (message) => { if (message.type() === "error") consoleErrorCount += 1; });
  page.on("pageerror", () => { pageErrorCount += 1; });
  return page;
}

async function open(page, state, sample = null, extra = {}, viewport = null) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(routeUrl(state, sample, extra), { waitUntil: "networkidle" });
  const expected = reportViews.has(state) && sample ? state : (reportViews.has(state) ? "missing" : state);
  await page.waitForFunction((requested) => {
    const current = document.querySelector(".view")?.dataset.state;
    return current === requested || current === "missing";
  }, expected);
  await page.evaluate(() => document.fonts.ready);
}

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(here, name), "utf8"));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function inspectAnalysisData() {
  const names = ["audit-weak.json", "audit-basic.json", "audit-noindex-test.json"];
  const analyses = {};
  const actualHashes = {};
  for (const name of names) {
    const bytes = await fs.readFile(path.join(here, name));
    actualHashes[name] = hash(bytes);
    analyses[name] = JSON.parse(bytes.toString("utf8"));
  }
  const enrichment = await readJson("enrichment.json");
  const northstar = await readJson("audit-northstar.json");
  const mapped = Object.keys(enrichment.checks || {}).length;
  const counts = (analysis) => analysis.checks.reduce((result, check) => {
    result[check.status] = (result[check.status] || 0) + 1;
    return result;
  }, {});
  const readPath = (object, value) => value.split(".").reduce((current, key) => current?.[key], object);
  const matches = (rule, context) => {
    if (Array.isArray(rule.all)) return rule.all.every((item) => matches(item, context));
    if (Array.isArray(rule.any)) return rule.any.some((item) => matches(item, context));
    const actual = readPath(context, rule.path);
    if (rule.operator === "equals") return actual === rule.value;
    if (rule.operator === "in") return Array.isArray(rule.value) && rule.value.includes(actual);
    if (rule.operator === "greater_than") return typeof actual === "number" && actual > rule.value;
    if (rule.operator === "empty") return actual === "" || actual == null || (Array.isArray(actual) && actual.length === 0);
    if (rule.operator === "contains_ci") return (Array.isArray(actual) ? actual : [actual]).some((value) => String(value || "").toLowerCase().includes(String(rule.value).toLowerCase()));
    return false;
  };
  const actionableNorthstar = northstar.checks.filter((check) => {
    const entry = enrichment.checks[check.id];
    const context = { analysis: northstar, check };
    return entry && entry.actionable_statuses.includes(check.status) && !(entry.ignore_when || []).some((rule) => matches(rule.when, context));
  });
  const inputs = { ...analyses, "audit-northstar.json": northstar };
  const actionability = Object.fromEntries(Object.entries(inputs).map(([name, analysis]) => {
    const rows = analysis.checks.map((check) => {
      const entry = enrichment.checks[check.id];
      const context = { analysis, check };
      const excluded = (entry.ignore_when || []).find((rule) => matches(rule.when, context));
      const actionable = entry.actionable_statuses.includes(check.status) && !excluded;
      return { check, entry, actionable, exclusion: excluded?.reason || entry.exclusion_reason || "No action rule is defined for this returned check." };
    });
    return [name, {
      raw: counts(analysis),
      actionable: rows.filter((row) => row.actionable).length,
      exclusions: rows.filter((row) => ["warning", "fail"].includes(row.check.status) && !row.actionable).map((row) => ({ id: row.check.id, reason: row.exclusion })),
      notApplicable: rows.filter((row) => row.check.status === "not_applicable").map((row) => ({ id: row.check.id, reason: row.exclusion })),
    }];
  }));
  const results = {
    analyses,
    northstar,
    enrichment,
    rawHashes: actualHashes,
    statusTotals: Object.fromEntries(Object.entries(analyses).map(([name, item]) => [name, counts(item)])),
    actionability,
    northstarPasses: northstar.checks.filter((check) => check.status === "pass").length,
      northstarActionable: actionableNorthstar.length,
      northstarExclusions: northstar.checks.filter((check) => {
        const entry = enrichment.checks[check.id];
        const context = { analysis: northstar, check };
        return (check.status === "warning" || check.status === "fail") && (!entry.actionable_statuses.includes(check.status) || (entry.ignore_when || []).some((rule) => matches(rule.when, context)));
      }).map((check) => ({ id: check.id, reason: enrichment.checks[check.id].ignore_when?.find((rule) => matches(rule.when, { analysis: northstar, check }))?.reason || enrichment.checks[check.id].exclusion_reason })),
    mappedChecks: mapped,
  };
  record("unchanged deterministic v1.0 outputs", Object.entries(rawHashes).every(([name, expected]) => actualHashes[name] === expected),
    JSON.stringify({ scores: names.map((name) => analyses[name].deterministic_score.overall_score), checks: names.map((name) => analyses[name].checks.length), sha256Match: Object.entries(rawHashes).every(([name, expected]) => actualHashes[name] === expected) }));
  record("Northstar sample comes from generated engine output", northstar.deterministic_score?.version === "1.0" && northstar.checks?.length === 23,
    JSON.stringify({ score: northstar.deterministic_score?.overall_score, checks: northstar.checks?.length, passes: results.northstarPasses, actionable: results.northstarActionable }));
  record("all engine checks have enrichment", mapped === 23 && analyses["audit-weak.json"].checks.every((item) => enrichment.checks[item.id]),
    mapped + " enrichment rules for 23 engine checks");
  record("Northstar has 3–5 real actions and at least 9 passes", results.northstarActionable >= 3 && results.northstarActionable <= 5 && results.northstarPasses >= 9,
    results.northstarActionable + " actionable; " + results.northstarPasses + " pass");
  const weakCounts = results.actionability["audit-weak.json"];
  record("raw and actionable weak-page counts reconcile with explicit exclusions", weakCounts.raw.fail + weakCounts.raw.warning === weakCounts.actionable + weakCounts.exclusions.length && weakCounts.notApplicable.length > 0,
    JSON.stringify({ rawFails: weakCounts.raw.fail, rawWarnings: weakCounts.raw.warning, actionable: weakCounts.actionable, exclusions: weakCounts.exclusions, notApplicable: weakCounts.notApplicable }));
  return results;
}

async function inspectTextAndContrast(page) {
  return page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const blend = (front, back) => {
      if (!front || front.a >= 0.999) return front || back;
      if (!back) back = { r: 250, g: 250, b: 247, a: 1 };
      const a = front.a;
      return { r: front.r * a + back.r * (1 - a), g: front.g * a + back.g * (1 - a), b: front.b * a + back.b * (1 - a), a: 1 };
    };
    const luminance = (c) => {
      const values = [c.r, c.g, c.b].map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const ratio = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const nodes = [...document.querySelectorAll("body *")].filter((el) => visible(el) && el.children.length === 0 && el.textContent.trim());
    const textPairs = [];
    for (const el of nodes) {
      let bg = null;
      let current = el;
      while (current && !bg) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.01) bg = blend(color, bg);
        current = current.parentElement;
      }
      bg ||= { r: 250, g: 250, b: 247, a: 1 };
      const foreground = parse(getComputedStyle(el).color);
      if (foreground) textPairs.push({ selector: el.className?.baseVal || el.className || el.localName, px: parseFloat(getComputedStyle(el).fontSize), ratio: ratio(blend(foreground, bg), bg), text: el.textContent.trim().slice(0, 64) });
    }
    const monospace = [];
    for (const el of nodes) {
      const family = getComputedStyle(el).fontFamily.toLowerCase();
      if (/mono|courier/.test(family) && !el.closest("[data-role=code]")) monospace.push(el.className?.baseVal || el.className || el.localName);
    }
    const spacing = [...document.querySelectorAll(".display, .home-title, .verdict, .page-heading, .section-head h2, .priority-title, .xray-h1-region .xray-region-value")].filter(visible).map((el) => {
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const word = parseFloat(style.wordSpacing);
      const words = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const matcher = /\S+/g;
        let match;
        while ((match = matcher.exec(node.textContent))) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) words.push({ word: match[0], left: rect.left, right: rect.right, top: rect.top });
        }
      }
      const gaps = [];
      for (let index = 1; index < words.length; index += 1) {
        const before = words[index - 1];
        const after = words[index];
        if (Math.abs(before.top - after.top) <= 2 && after.left >= before.right) {
          gaps.push({ between: before.word + " / " + after.word, gapPx: after.left - before.right, fontPx: size, gapEm: (after.left - before.right) / size });
        }
      }
      return {
        selector: el.className?.baseVal || el.className || el.localName,
        letterPx: parseFloat(style.letterSpacing) || 0,
        fontPx: size,
        wordSpacingPx: word,
        wordSpacingEm: word / size,
        minVisibleWordGapPx: gaps.length ? Math.min(...gaps.map((item) => item.gapPx)) : null,
        minVisibleWordGapEm: gaps.length ? Math.min(...gaps.map((item) => item.gapEm)) : null,
        measuredWordPairs: gaps.length,
      };
    });
      const interactive = [...document.querySelectorAll("button, a, input, summary, [role=button]")].filter(visible).map((el) => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 32), className: String(el.className?.baseVal || el.className || ""), width: rect.width, height: rect.height, radius: Math.min(...getComputedStyle(el).borderRadius.split(" ").map((v) => parseFloat(v) || 0)) };
    });
    const severityBadges = [...document.querySelectorAll(".severity-badge")].filter(visible).map((el) => ({
      label: el.textContent.trim(),
      icon: Boolean(el.querySelector("svg.severity-icon")),
      className: el.className,
    }));
      const anchors = [...document.querySelectorAll("a")].filter(visible).map((a) => ({
      text: a.textContent.trim(),
      parent: a.closest("p") ? "sentence" : a.closest("nav") ? "navigation" : "other",
      className: a.className,
      underlined: getComputedStyle(a).textDecorationLine.includes("underline"),
        buttonStyled: a.classList.contains("nav-link") || a.classList.contains("button-link") || a.classList.contains("tab-link") || a.classList.contains("example-chip"),
    }));
    const isSignalColor = (value) => {
      const color = parse(value);
      return color && color.a > .01 && color.r >= 130 && color.r > color.g * 1.35 && color.r > color.b * 1.35;
    };
    const redElements = [...document.querySelectorAll("body *")].filter(visible).map((el) => {
      const style = getComputedStyle(el);
      const usesSignal = [style.color, style.backgroundColor, style.borderColor, style.borderLeftColor, style.outlineColor].some(isSignalColor);
      if (!usesSignal) return null;
      const allowed = Boolean(el.closest(".brand-mark, .wordmark, .sidebar-brand, .badge--blocking, .badge--high, .xray-region, .mini-h1, .xray-hover-note"))
        || (el.classList.contains("verdict") && el.dataset.severity === "blocking");
      return { className: el.className?.baseVal || el.className || el.localName, allowed };
    }).filter(Boolean);
    const cardSelector = ".card,.priority-card,.xray-card,.panel-card,.preview-card,.content-sheet,.error-cause,.xray-finding-detail,.snippet-panel";
    const cards = [...document.querySelectorAll(cardSelector)];
    const nestedCards = cards.filter((el) => el.parentElement?.closest(cardSelector));
    return {
      minTextPx: textPairs.length ? Math.min(...textPairs.map((item) => item.px)) : null,
      bodyFontPx: parseFloat(getComputedStyle(document.body).fontSize),
      bodyText: [...document.querySelectorAll(".home-support,.page-subtitle,.priority-reason,.fix-row-subtitle,.finding-reason,.finding-evidence,.finding-action,.observed-copy,.preview-result-description,.error-explanation,.error-next,.xray-preview>p,.score-info-panel p")]
        .filter(visible).map((el) => ({ className: el.className, px: parseFloat(getComputedStyle(el).fontSize) })),
      minContrast: textPairs.length ? Math.min(...textPairs.map((item) => item.ratio)) : null,
      contrastPairs: textPairs.filter((item) => item.ratio < 4.5),
      smallText: textPairs.filter((item) => item.px < 12),
      monospaceViolations: monospace,
      spacing,
      interactive,
      anchorViolations: anchors.filter((item) => item.parent === "other" && !item.buttonStyled && !["wordmark", "sidebar-brand", "text-action"].some((name) => item.className.split(/\s+/).includes(name))),
      standaloneUnderlines: anchors.filter((item) => item.underlined && item.parent !== "sentence" && item.parent !== "navigation"),
      redElements,
      signalViolations: redElements.filter((item) => !item.allowed),
      nestedCards: nestedCards.length,
      radiusViolations: interactive.filter((item) => item.radius < 8),
      severityBadges,
      invalidSeverityBadges: severityBadges.filter((item) => !["Blocking", "High", "Medium", "Low", "Passed"].includes(item.label) || !item.icon),
    };
  });
}

async function visibleMetrics(page, state, sample) {
  return page.evaluate(({ state, sample }) => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, visible: r.top >= 0 && r.bottom <= innerHeight };
    };
    const view = document.querySelector(".view");
    const textFragments = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const owner = node.parentElement;
      if (!owner || owner.closest("[aria-hidden=true], [hidden], details:not([open])")) continue;
      const style = getComputedStyle(owner);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = node.textContent.trim().slice(0, 48);
      for (const rect of range.getClientRects()) if (rect.width > 3 && rect.height > 3 && rect.bottom > 0 && rect.top < innerHeight) textFragments.push({ owner, rect, text });
    }
    const overlaps = [];
    for (const fragment of textFragments) {
      const { owner, rect } = fragment;
      const samples = [0.25, 0.5, 0.75].map((fraction) => ({ x: rect.left + rect.width * fraction, y: rect.top + rect.height / 2 }));
      for (const point of samples) {
        if (point.y < 0 || point.y >= innerHeight || point.x < 0 || point.x >= innerWidth) continue;
        const top = document.elementFromPoint(point.x, point.y);
        if (!top || owner === top || owner.contains(top) || top.contains(owner) || top.closest(".mobile-tabs")) continue;
        overlaps.push({ text: fragment.text, owner: owner.className?.baseVal || owner.className || owner.localName, coveredBy: top.className?.baseVal || top.className || top.localName, x: point.x, y: point.y });
        break;
      }
    }
    return {
      state: view?.dataset.state,
      sample: view?.dataset.sample,
      viewport: innerWidth + "x" + innerHeight,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth,
      cls: Array.isArray(window.__r2LayoutShifts) ? window.__r2LayoutShifts.reduce((sum, value) => sum + value, 0) : null,
      textOverlapCount: overlaps.length,
      textOverlaps: overlaps.slice(0, 8),
      sidebarWidth: rect(".desktop-sidebar")?.width ?? null,
      verdict: rect(".verdict"),
      score: rect(".summary-score"),
      firstThreePriorities: [...document.querySelectorAll(".priority-card")].slice(0, 3).map((item) => {
        const r = item.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, width: r.width, height: r.height, visible: r.top >= 0 && r.bottom <= innerHeight };
      }),
      homeTitle: rect(".home-title"),
      primaryContent: rect(".page-primary-content"),
      xrayPreview: rect(".xray-preview"),
      xrayEntry: rect(".xray-entry"),
      stateArgument: state,
      sampleArgument: sample,
    };
  }, { state, sample });
}

async function compareFonts(page) {
  const comparisonCss =
    "#app.font-test-a .proof-app,#app.font-test-a .proof-app *:not([data-role=code]){font-family:'Hanken Grotesk',sans-serif!important}" +
    "#app.font-test-a [data-role=code]{font-family:'JetBrains Mono',monospace!important}" +
    "#app.font-test-b .proof-app,#app.font-test-b .proof-app *:not([data-role=code]){font-family:'Schibsted Grotesk',sans-serif!important}" +
    "#app.font-test-b [data-role=code]{font-family:'IBM Plex Mono',monospace!important}";
  const measurements = {};
  for (const viewport of [{ label: "1440x900", width: 1440, height: 900 }, { label: "390x844", width: 390, height: 844 }]) {
    await open(page, "summary", "northstar", {}, viewport);
    await page.addStyleTag({ content: comparisonCss });
    measurements[viewport.label] = {};
    for (const [key, cls, uiFamily, monoFamily] of [["A", "font-test-a", "Hanken Grotesk", "JetBrains Mono"], ["B", "font-test-b", "Schibsted Grotesk", "IBM Plex Mono"]]) {
      await page.locator("#app").evaluate((el, value) => { el.classList.remove("font-test-a", "font-test-b"); el.classList.add(value); }, cls);
      await page.evaluate(() => document.fonts.ready);
      measurements[viewport.label][key] = await page.evaluate(({ uiFamily, monoFamily }) => {
        const title = document.querySelector(".page-heading");
        const headings = [...document.querySelectorAll(".priority-title, .page-heading")];
        const body = document.querySelector(".priority-reason");
        const mono = document.querySelector("[data-role=code]");
        const rect = (el) => el ? { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height } : null;
        const cs = (el) => el ? { family: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize, lineHeight: getComputedStyle(el).lineHeight } : null;
        return {
          uiFontLoaded: document.fonts.check('16px "' + uiFamily + '"'),
          monoFontLoaded: document.fonts.check('13px "' + monoFamily + '"'),
          title: rect(title),
          titleStyle: cs(title),
          body: rect(body),
          bodyStyle: cs(body),
          monoStyle: cs(mono),
          priorityHeights: headings.map((el) => el.getBoundingClientRect().height),
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        };
      }, { uiFamily, monoFamily });
    }
    await page.locator("#app").evaluate((el) => el.classList.remove("font-test-a", "font-test-b"));
  }
  return measurements;
}

async function inspectCountConsistency(page) {
  const results = {};
  for (const sample of ["northstar", "weak", "basic"]) {
    const states = {};
    for (const state of ["summary", "fix-list"]) {
      await open(page, state, sample);
      states[state] = await page.locator(".view").evaluate((view) => ({
        rawOpen: Number(view.dataset.rawOpen),
        actionable: Number(view.dataset.actionableTotal),
        remaining: Number(view.dataset.remainingTotal),
        passed: Number(view.dataset.passedTotal),
        excluded: Number(view.dataset.excludedTotal),
        notApplicable: Number(view.dataset.notApplicableTotal),
        total: Number(view.dataset.rawTotal),
        score: Number(view.dataset.score),
        countSummary: document.querySelector("[data-count-summary]")?.textContent.trim() || "",
        sidebarCount: Number(document.querySelector('.desktop-sidebar [data-page-id="fix-list"] .nav-count')?.textContent),
        categoryPass: [...document.querySelectorAll(".category-total")].reduce((sum, item) => sum + Number(item.textContent.match(/^(\d+) of/)?.[1] || 0), 0),
        categoryChecks: [...document.querySelectorAll(".category-total")].reduce((sum, item) => sum + Number(item.textContent.match(/of (\d+)/)?.[1] || 0), 0),
        summaryTitles: [...document.querySelectorAll(".priority-title")].map((item) => item.textContent.trim()),
        fixTitles: [...document.querySelectorAll(".fix-row-title")].map((item) => item.textContent.trim()),
      }));
    }
    results[sample] = states;
  }
  return results;
}

async function inspectProofWordingAndFindings(page, data) {
  const badFindingLanguage = /needs review|observation|returned|prompt for review|design-only|signals|specimen|schematic/i;
  const findingIssues = [];
  for (const [sample, analysis] of Object.entries({ ...data.dataset.analyses, northstar: data.dataset.northstar })) {
    for (const check of analysis.checks) {
      const entry = data.dataset.enrichment.checks[check.id];
      const context = { analysis, check };
      const copy = { title: entry.title, reason: entry.reason };
      for (const rule of entry.copy_rules || []) {
        const matches = (condition) => {
          if (Array.isArray(condition.all)) return condition.all.every(matches);
          if (Array.isArray(condition.any)) return condition.any.some(matches);
          const value = condition.path.split(".").reduce((current, key) => current?.[key], context);
          if (condition.operator === "equals") return value === condition.value;
          if (condition.operator === "contains_ci") return (Array.isArray(value) ? value : [value]).some((item) => String(item ?? "").toLowerCase().includes(String(condition.value).toLowerCase()));
          return false;
        };
        if (matches(rule.when)) { copy.title = rule.title || copy.title; copy.reason = rule.reason || copy.reason; break; }
      }
      if (badFindingLanguage.test(copy.title) || badFindingLanguage.test(copy.reason)) findingIssues.push(sample + ":" + check.id);
    }
  }
  const grammarIssues = [];
  for (const [sample, analysis] of Object.entries({ ...data.dataset.analyses, northstar: data.dataset.northstar })) {
    await open(page, "fix-list", sample);
    const ids = await page.locator(".fix-row").evaluateAll((rows) => rows.map((row) => row.dataset.checkId));
    for (const id of ids) {
      const row = page.locator('.fix-row[data-check-id="' + id + '"]');
      if (await row.getAttribute("aria-expanded") !== "true") {
        await row.locator(".fix-row-toggle").click();
        await page.waitForSelector('.view[data-state="fix-list"]');
        await page.waitForSelector('.fix-row[data-check-id="' + id + '"][aria-expanded="true"]');
      }
      const texts = await row.locator(".fix-row-title,.fix-row-subtitle,.fix-evidence,.fix-action,.snippet-note,.review-required").allTextContents();
      const copy = texts.join(" ");
      if (/\b1\s+characters\b|\w+\(s\)|\b1\s+H1 elements\b|\b(?:0|[2-9]\d*)\s+H1 element\b/i.test(copy)) grammarIssues.push(sample + ":" + id);
    }
  }
  const visibleProofUse = [];
  const pageAudits = [];
  const viewsToCheck = [["home", null], ["summary", "northstar"], ["fix-list", "northstar"], ["xray", "northstar"], ["on-page", "northstar"], ["previews", "northstar"], ["loading", "northstar"], ["error", null]];
  for (const [state, sample] of viewsToCheck) {
    await open(page, state, sample);
    const result = await page.evaluate(() => {
      const strip = document.querySelector(".proof-strip");
      const appText = document.querySelector(".proof-app")?.innerText || "";
      const terms = /\b(?:design proof|static|local analysis|motion study|no live analysis|not checked in this proof)\b/gi;
      const bannedLabels = /\b(?:illustrative|fixture|mocked|demo)\b/gi;
      const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      const textNodes = [...document.querySelectorAll("body *")].filter((el) => visible(el) && el.children.length === 0 && el.textContent.trim());
      const anchors = [...document.querySelectorAll("a")].filter(visible).map((a) => ({ className: a.className, outsideSentence: !a.closest("p") && !a.closest("nav"), buttonStyled: a.classList.contains("nav-link") || a.classList.contains("button-link") || a.classList.contains("tab-link") || a.classList.contains("example-chip") || ["wordmark", "sidebar-brand", "text-action"].some((name) => String(a.className).split(/\s+/).includes(name)), underlined: getComputedStyle(a).textDecorationLine.includes("underline") }));
      const mono = textNodes.filter((el) => /mono|courier/i.test(getComputedStyle(el).fontFamily) && !el.closest("[data-role=code]")).map((el) => el.className?.baseVal || el.className || el.localName);
      return {
        stripCount: document.querySelectorAll(".proof-strip").length,
        appTerms: appText.match(terms) || [],
        bannedLabels: appText.match(bannedLabels) || [],
        heuristicOutsidePopover: [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && /heuristic/i.test(el.textContent || "") && !el.closest("[data-score-help-panel]")).length,
        monoViolations: mono,
        anchorViolations: anchors.filter((item) => item.outsideSentence && !item.buttonStyled),
        standaloneUnderlines: anchors.filter((item) => item.underlined && item.outsideSentence && !item.buttonStyled),
      };
    });
    const styleAudit = await inspectTextAndContrast(page);
    pageAudits.push({
      state,
      monoViolations: result.monoViolations,
      anchorViolations: result.anchorViolations,
      standaloneUnderlines: result.standaloneUnderlines,
      smallTextCount: styleAudit.smallText.length,
      bodyTextViolations: styleAudit.bodyText.filter((item) => item.px < 16),
      contrastFailures: styleAudit.contrastPairs.length,
      radiusViolations: styleAudit.radiusViolations,
      nestedCards: styleAudit.nestedCards,
    });
    if (result.stripCount !== 1 || result.appTerms.length || result.bannedLabels.length || result.heuristicOutsidePopover) visibleProofUse.push({ state, stripCount: result.stripCount, appTerms: result.appTerms, bannedLabels: result.bannedLabels, heuristicOutsidePopover: result.heuristicOutsidePopover });
  }
  return { findingIssues, grammarIssues, visibleProofUse, pageAudits };
}

async function inspectSignalStates(page) {
  const cases = [];
  for (const [state, sample, interaction] of [["summary", "weak", null], ["summary", "noindex", null], ["xray", "northstar", "hover"], ["xray", "northstar", "focus"]]) {
    await open(page, state, sample);
    if (interaction) {
      const region = page.locator('[data-xray-region="description"]');
      if (interaction === "hover") await region.hover();
      else await region.focus();
    }
    const color = await inspectTextAndContrast(page);
    cases.push({ state, sample, interaction, signalViolations: color.signalViolations, redUses: color.redElements, invalidSeverityBadges: color.invalidSeverityBadges, minContrast: color.minContrast });
  }
  return cases;
}

async function inspectMobileTargets(page) {
  const results = [];
  for (const state of views) {
    const sample = ["summary", "fix-list", "xray", "on-page", "previews", "loading"].includes(state) ? "northstar" : null;
    await open(page, state, sample, state === "error" ? { reason: "all" } : {}, { width: 390, height: 844 });
    const targets = await page.evaluate(() => [...document.querySelectorAll("button,a,input,summary,[role=button]")]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
      .map((el) => { const rect = el.getBoundingClientRect(); return { label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 28), width: rect.width, height: rect.height }; }));
    results.push({ state, minimumWidth: Math.min(...targets.map((item) => item.width)), minimumHeight: Math.min(...targets.map((item) => item.height)), violations: targets.filter((item) => item.width < 44 || item.height < 44) });
  }
  await open(page, "summary", "northstar", {}, { width: 390, height: 844 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = await page.evaluate(() => [...document.querySelectorAll(".more-sheet button,.more-sheet a")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => { const rect = el.getBoundingClientRect(); return { label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 28), width: rect.width, height: rect.height }; }));
  results.push({ state: "more-sheet", minimumWidth: Math.min(...more.map((item) => item.width)), minimumHeight: Math.min(...more.map((item) => item.height)), violations: more.filter((item) => item.width < 44 || item.height < 44) });
  return results;
}

async function testInteractions(page, data) {
  const results = {};
  activeInteraction = "summary-and-navigation";
  await open(page, "summary", "northstar", {}, { width: 1440, height: 900 });
  results.summaryState = await page.locator(".view").getAttribute("data-state");
  results.scoreHelp = {
    affordances: await page.locator("[data-score-help-trigger]").count(),
    panels: await page.locator("[data-score-help-panel]").count(),
    heuristicVisibleElsewhere: await page.evaluate(() => {
      const matches = [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && /heuristic/i.test(el.textContent));
      return matches.filter((el) => !el.closest("[data-score-help-panel]")).length;
    }),
  };
  results.summaryTitles = await page.locator(".priority-title").allTextContents();
  results.summaryPriorityCount = await page.locator(".priority-card").count();
  results.summaryExplainerWords = await page.evaluate(() => [...document.querySelectorAll(".verdict,.priority-title,.priority-reason,.summary-priorities h2,.section-count,.count-reconciliation")].map((item) => item.textContent.trim()).join(" ").split(/\s+/).filter(Boolean).length);
  results.summaryCounts = await page.locator(".view").evaluate((el) => ({
    rawOpen: el.dataset.rawOpen,
    actionable: el.dataset.actionableTotal,
    remaining: el.dataset.remainingTotal,
    passed: el.dataset.passedTotal,
    excluded: el.dataset.excludedTotal,
    all: el.dataset.rawTotal,
    score: document.querySelector("[data-score]")?.getAttribute("data-score"),
  }));
  results.navItems = await page.locator(".desktop-sidebar [data-page-id]").count();
  results.unbuiltDisabled = await page.locator('.desktop-sidebar [aria-disabled="true"]').count();
  results.disabledPrevented = await page.locator('.desktop-sidebar [aria-disabled="true"]').evaluateAll((items) => items.length === 5 && items.every((item) => item.disabled && !item.hasAttribute("href") && item.getAttribute("aria-disabled") === "true"));
  results.builtRouteStates = [];
  for (const state of ["summary", "fix-list", "xray", "on-page", "previews"]) {
    await open(page, state, "northstar");
    results.builtRouteStates.push(await page.locator(".view").getAttribute("data-state"));
  }
  results.builtRoutesValid = results.builtRouteStates.join("|") === "summary|fix-list|xray|on-page|previews";

  await open(page, "summary", "northstar");
  activeInteraction = "navigate-to-fix-list";
  await page.locator('.desktop-sidebar [data-page-id="fix-list"]').click();
  activeInteraction = "fix-list-actions";
  await page.waitForSelector(".view[data-state=fix-list]");
  await page.goBack();
  await page.waitForSelector(".view[data-state=summary]");
  results.browserBackState = await page.locator(".view").getAttribute("data-state");
  await page.goForward();
  await page.waitForSelector(".view[data-state=fix-list]");
  results.browserForwardState = await page.locator(".view").getAttribute("data-state");
  activeInteraction = "read-fix-list-counts";
  activeInteraction = "fix-list-sidebar-count";
  results.fixCountBadge = await page.locator('.desktop-sidebar [data-page-id="fix-list"] .nav-count').count()
    ? await page.locator('.desktop-sidebar [data-page-id="fix-list"] .nav-count').innerText()
    : null;
  activeInteraction = "fix-list-score-identity";
  const beforeScore = await page.locator("[data-score]").getAttribute("data-score");
  activeInteraction = "fix-row-expansion";
  const firstToggle = page.locator(".fix-row-toggle").first();
  await firstToggle.click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  await page.waitForSelector('.fix-row[aria-expanded="true"]');
  results.expansion = await page.locator(".fix-row-toggle").first().getAttribute("aria-expanded");
  results.titleCopies = await page.locator(".fix-row-title").allTextContents();
  results.expandedCount = await page.locator(".fix-row[aria-expanded=true]").count();
  results.collapsedCount = await page.locator(".fix-row[aria-expanded=false]").count();
  activeInteraction = "local-done-state";
  const done = page.locator('.done-check[data-done-id="meta_description"]');
  results.doneCountBefore = await page.locator(".done-check").evaluateAll((nodes) => nodes.filter((node) => node.checked).length);
  await done.check();
  await page.waitForSelector('.view[data-state="fix-list"]');
  await page.waitForFunction(() => document.querySelector('.view[data-state="fix-list"]')?.dataset.remainingTotal === "4");
  results.doneScoreUnchanged = (await page.locator("[data-score]").getAttribute("data-score")) === beforeScore;
  results.localDoneCount = await page.locator(".done-check").evaluateAll((nodes) => nodes.filter((node) => node.checked).length);
  results.doneCountSummary = await page.locator(".view").evaluate((el) => ({ actionable: el.dataset.actionableTotal, remaining: el.dataset.remainingTotal }));
  results.doneCountText = await page.locator("[data-count-summary]").innerText();
  results.doneNote = await page.locator(".done-note").innerText();
  results.doneCountIsLocalOnly = results.doneCountBefore === 0 && results.localDoneCount === 1
    && results.doneCountSummary.actionable === "5" && results.doneCountSummary.remaining === "4"
    && results.doneCountText.includes("Marked done here: 1") && results.doneCountText.includes("Still open: 4")
    && results.doneNote.includes("kept only in this open page session") && results.doneNote.includes("do not change the score")
    && results.doneNote.includes("say the website was checked again") && results.doneScoreUnchanged;
  results.doneLabel = await done.getAttribute("aria-label");
  results.doneCheckboxState = await page.locator(".done-check").evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.doneId, checked: node.checked, defaultChecked: node.defaultChecked })));
  activeInteraction = "filter-test-weak-sample";
  await open(page, "fix-list", "weak");
  results.weakActionCount = await page.locator(".fix-row").count();
  activeInteraction = "high-filter";
  await page.getByRole("button", { name: "High", exact: true }).click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  results.highFilter = await page.locator(".fix-row").count();
  activeInteraction = "all-filter";
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  activeInteraction = "quick-filter";
  await page.getByRole("button", { name: "Quick wins", exact: true }).click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  results.quickFilter = await page.locator(".fix-row").count();

  activeInteraction = "copy-action";
  await open(page, "fix-list", "northstar");
  await page.locator('.fix-row[data-check-id="meta_description"] .fix-row-toggle').click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  await page.waitForSelector('.fix-row[data-check-id="meta_description"][aria-expanded="true"] .copy-snippet');
  const copy = page.locator('.fix-row[data-check-id="meta_description"] .fix-detail [data-copy-snippet]');
  if (await copy.count()) {
    await copy.click();
    await page.waitForFunction(() => document.querySelector(".fix-detail .copy-feedback")?.textContent === "Copied.");
    results.copyFeedback = await page.locator(".fix-detail .copy-feedback").first().innerText();
    results.copyMatchesSnippet = await page.locator(".fix-detail .code-sample").first().evaluate(async (el) => (await navigator.clipboard.readText()) === el.textContent);
  } else { results.copyFeedback = "No copyable snippet in first expanded finding"; results.copyMatchesSnippet = false; }

  activeInteraction = "show-finding-on-page";
  const showPage = page.locator(".fix-detail [data-show-on-page]").first();
  if (await showPage.count()) {
    const expectedCheck = await showPage.getAttribute("data-show-on-page");
    await showPage.click();
    await page.waitForSelector(".view[data-state=xray]");
    await page.waitForSelector('.xray-region.is-selected[data-check-ids*="' + expectedCheck + '"]');
    results.showOnPage = await page.locator('.xray-region.is-selected[data-check-ids*="' + expectedCheck + '"]').count();
  } else results.showOnPage = 0;
  await open(page, "xray", "northstar");
  activeInteraction = "xray-and-specialist-pages";
  const region = page.locator(".xray-region[data-check-id]").first();
  await region.focus();
  await page.keyboard.press("Enter");
  results.xrayKeyboardDetail = await page.locator(".xray-finding-detail").count();
  results.xrayCaption = await page.locator(".xray-caption").innerText();
  results.xrayRegions = await page.locator(".xray-region").count();

  await open(page, "on-page", "northstar", {}, { width: 390, height: 844 });
  results.onPagePrimaryVisible = await page.locator(".onpage-content .observed-copy").first().evaluate((el) => {
    const r = el.getBoundingClientRect(); return Boolean(el.textContent.trim()) && r.top < innerHeight && r.bottom > 0;
  });
  await open(page, "previews", "northstar", {}, { width: 390, height: 844 });
  results.previewPrimaryVisible = await page.locator(".preview-first").evaluate((el) => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
  });
  await open(page, "fix-list", "northstar", {}, { width: 390, height: 844 });
  results.fixPrimaryVisible = await page.locator(".fix-row").first().evaluate((el) => {
    const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;
  });
  results.fixMobileActionVisible = await page.locator(".fix-row-toggle").first().isVisible();

  await open(page, "summary", "northstar", {}, { width: 390, height: 844 });
  activeInteraction = "mobile-more-sheet";
  activeInteraction = "mobile-more-open-button";
  await page.getByRole("button", { name: "More", exact: true }).click();
  activeInteraction = "mobile-more-counts";
  results.moreCount = await page.locator(".more-sheet [data-page-id]").count();
  results.moreDisabledCount = await page.locator('.more-sheet [aria-disabled="true"]').count();
  activeInteraction = "mobile-more-focus-trap";
  await page.locator(".more-sheet [data-close-more]").focus();
  await page.keyboard.press("Shift+Tab");
  results.focusTrappedBackward = await page.evaluate(() => document.activeElement?.getAttribute("data-page-id") === "previews");
  await page.keyboard.press("Tab");
  results.focusTrappedForward = await page.evaluate(() => document.activeElement?.hasAttribute("data-close-more"));
  activeInteraction = "mobile-more-close-and-restore";
  const activeBeforeClose = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent.trim());
  await page.keyboard.press("Escape");
  results.moreClosed = !(await page.locator(".more-sheet[open]").count());
  await page.waitForFunction(() => document.activeElement?.classList.contains("mobile-more-button"));
  results.focusRestored = await page.evaluate(() => document.activeElement?.classList.contains("mobile-more-button"));
  results.activeBeforeClose = activeBeforeClose;
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  results.focusRing = await page.evaluate(() => {
    const el = document.activeElement; const style = getComputedStyle(el);
    return Boolean(el && (style.outlineStyle !== "none" || style.boxShadow !== "none"));
  });

  await open(page, "summary", "northstar", {}, { width: 1440, height: 900 });
  activeInteraction = "responsive-summary-and-sample-shapes";
  results.desktopViewport = await visibleMetrics(page, "summary", "northstar");
  await open(page, "summary", "northstar", {}, { width: 390, height: 844 });
  results.mobileViewport = await visibleMetrics(page, "summary", "northstar");
  await open(page, "summary", "weak");
  results.weakShape = await page.locator(".xray-preview").getAttribute("data-shape");
  await open(page, "summary", "basic");
  results.basicShape = await page.locator(".xray-preview").getAttribute("data-shape");
  await open(page, "summary", "noindex");
  results.noindexBlocking = await page.locator(".verdict").getAttribute("data-severity");
  results.noindexVerdict = await page.locator(".verdict").innerText();

  await open(page, "error");
  activeInteraction = "error-loading-and-missing-recovery";
  results.errorCauses = await page.locator(".error-cause").count();
  results.errorCauseNames = await page.locator(".error-cause h2").allTextContents();
  results.errorRecovery = await page.locator(".error-cause").evaluateAll((items) => items.every((item) =>
    item.querySelector(".error-explanation")?.textContent.trim() && item.querySelector(".error-next")?.textContent.trim() && item.querySelector("[data-try-again]") && item.querySelector("[data-error-back]")));
  await open(page, "loading", "northstar");
  results.loadingSteps = await page.locator(".loading-step").count();
  results.loadingStepNames = await page.locator(".loading-step").allTextContents();
  results.loadingActive = await page.locator(".loading-step.is-active").count();
  results.loadingCancel = await page.locator("[data-cancel]").count();
  await open(page, "summary", "missing");
  results.missingRecovery = await page.locator(".missing-report-recovery").count();
  results.fictionalFallback = await page.locator("[data-report]").count();

  activeInteraction = "home-example-and-url-flow";
  await open(page, "home");
  await page.locator("#target-keyword").count();
  await page.getByRole("button", { name: "Add a target keyword" }).click();
  results.keywordRevealed = await page.locator("#target-keyword").isVisible();
  await page.locator("#page-address").fill("https://northstar.example/guides/home-solar/");
  await page.getByRole("button", { name: "Check page", exact: true }).click();
  await page.waitForSelector('.view[data-state="summary"][data-sample="northstar"]');
  results.supportedUrlOpensSample = true;
  await open(page, "home");
  await page.locator("#page-address").fill("https://example.org/not-in-the-offline-samples");
  await page.getByRole("button", { name: "Check page", exact: true }).click();
  await page.waitForSelector('.view[data-state="error"]');
  results.arbitraryUrlNotInvented = await page.locator("[data-report]").count() === 0;
  results.credentialFieldCount = await page.locator('input[type=password],input[autocomplete*=password],input[name*=token i],input[name*=api_key i],input[name*=api-key i],input[id*=token i],input[id*=api_key i],input[id*=api-key i]').count();

  activeInteraction = "loading-and-error-actions";
  activeInteraction = "loading-cancel-route";
  await open(page, "loading", "northstar");
  await page.locator("[data-cancel]").click();
  await page.waitForSelector('.view[data-state="home"]');
  results.loadingCancelReturnsHome = true;
  activeInteraction = "error-retry-route";
  await open(page, "error", null, { reason: "all" });
  await page.locator(".error-cause [data-try-again]").first().click();
  await page.waitForSelector('.view[data-state="home"]');
  results.errorRetryReturnsHome = true;
  activeInteraction = "error-back-route";
  await open(page, "summary", "northstar", {}, { width: 1440, height: 900 });
  await page.locator(".desktop-sidebar [data-page-id=\"fix-list\"]").click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  await open(page, "error", null, { reason: "all" });
  await page.locator(".error-cause [data-error-back]").first().click();
  await page.waitForSelector('.view[data-state="fix-list"]');
  results.errorBackUsesHistory = true;
  return results;
}

async function inspectFontAndColors(page) {
  const data = await inspectTextAndContrast(page);
  return data;
}

async function inspectLayouts(page) {
  const cases = [];
  const testViewports = [...layoutViewports, { label: "320x844", width: 320, height: 844 }];
  for (const state of views) {
    const sample = ["summary", "fix-list", "xray", "on-page", "previews", "loading"].includes(state) ? "northstar" : null;
    for (const viewport of testViewports) {
      await open(page, state, sample, state === "error" ? { reason: "all" } : {}, { width: viewport.width, height: viewport.height });
      const layout = await visibleMetrics(page, state, sample);
      const text = await inspectTextAndContrast(page);
      cases.push({ ...layout, minTextPx: text.minTextPx, bodyFontPx: text.bodyFontPx, bodyText: text.bodyText, minContrast: text.minContrast, spacing: text.spacing, viewport: viewport.label, textViolations: text.smallText.length, bodyViolations: text.bodyText.filter((item) => item.px < 16).length, contrastViolations: text.contrastPairs.length });
    }
  }
  return cases;
}

async function capture(page, fileName, state, sample, viewport, extra = {}, action = null) {
  await open(page, state, sample, extra, viewport);
  const interactionResult = action ? await action(page) : null;
  if (action && reportViews.has(state) && sample) await page.waitForSelector('.view[data-state="' + state + '"]');
  await page.evaluate(() => document.fonts.ready);
  const filePath = path.join(screenshotDir, fileName);
  await page.screenshot({ path: filePath, fullPage: false, animations: "allow" });
  return {
    fileName,
    relativePath: "docs/design/s1-a/screenshots/" + fileName,
    query: "?state=" + state + (sample ? "&sample=" + sample : "") + Object.entries(extra).map(([k, v]) => "&" + k + "=" + encodeURIComponent(v)).join(""),
    urlPath: "/docs/design/s1-a/proof-static-not-the-product.html?state=" + state + (sample ? "&sample=" + sample : "") + Object.entries(extra).map(([k, v]) => "&" + k + "=" + encodeURIComponent(v)).join(""),
    viewport: viewport.width + "x" + viewport.height,
    captured: true,
    interactionResult,
  };
}

async function captureScreenshots(page) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const captures = [];
  captures.push(await capture(page, "r2-home-1440x900.png", "home", null, { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-home-390x844.png", "home", null, { width: 390, height: 844 }));
  captures.push(await capture(page, "r2-summary-northstar-1440x900.png", "summary", "northstar", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-summary-northstar-390x844.png", "summary", "northstar", { width: 390, height: 844 }));
  captures.push(await capture(page, "r2-summary-weak-1440x900.png", "summary", "weak", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-summary-noindex-1440x900.png", "summary", "noindex", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-fix-list-expanded-1440x900.png", "fix-list", "northstar", { width: 1440, height: 900 }, {}, async (target) => {
    await target.locator('.fix-row[data-check-id="meta_description"] .fix-row-toggle').click();
  }));
  captures.push(await capture(page, "r2-fix-list-390x844.png", "fix-list", "northstar", { width: 390, height: 844 }));
  captures.push(await capture(page, "r2-on-page-1440x900.png", "on-page", "northstar", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-previews-1440x900.png", "previews", "northstar", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-xray-hover-1440x900.png", "xray", "northstar", { width: 1440, height: 900 }, {}, async (target) => {
    await target.locator('.xray-region[data-xray-region="description"]').hover();
    await target.waitForFunction(() => {
      const note = document.querySelector('.xray-description-region .xray-hover-note');
      return note && getComputedStyle(note).opacity === "1";
    });
  }));
  captures.push(await capture(page, "r2-loading-1440x900.png", "loading", "northstar", { width: 1440, height: 900 }));
  captures.push(await capture(page, "r2-errors-four-causes-1440x900.png", "error", null, { width: 1440, height: 900 }, { reason: "all" }));
  captures.push(await capture(page, "r2-focus-ring-390x844.png", "home", null, { width: 390, height: 844 }, {}, async (target) => {
    await target.keyboard.press("Tab");
    return target.evaluate(() => {
      const style = document.activeElement ? getComputedStyle(document.activeElement) : null;
      return Boolean(style && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2);
    });
  }));
  return captures;
}

async function inspectAnimations(page) {
  await open(page, "summary", "northstar");
  const source = await page.evaluate(() => {
    const animations = [];
    const transitions = [];
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch { continue; }
      const collect = (items) => items.forEach((rule) => {
        if (rule.cssRules) collect([...rule.cssRules]);
        if (rule instanceof CSSKeyframesRule) {
          for (const child of rule.cssRules) {
            for (const property of child.style) if (!["opacity", "transform"].includes(property)) animations.push({ name: rule.name, property });
          }
        }
        const selector = rule.selectorText || "";
        const transitionProperty = rule.style?.transitionProperty;
        if (selector && transitionProperty && transitionProperty !== "none") {
          for (const property of transitionProperty.split(",").map((value) => value.trim())) transitions.push({ selector, property });
        }
      });
      collect(rules);
    }
    return {
      animatedProperties: [...new Set(animations.map((item) => item.property))],
      animationViolations: animations,
      transitionProperties: transitions,
      transitionViolations: transitions.filter((item) => !["opacity", "transform"].includes(item.property)),
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "summary", "northstar");
  const reduced = await page.evaluate(() => {
    const target = document.querySelector(".button-link");
    const style = target ? getComputedStyle(target) : null;
    return { preference: matchMedia("(prefers-reduced-motion: reduce)").matches, transitionProperty: style?.transitionProperty || null, animationName: style?.animationName || null };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return { ...source, reducedMotion: reduced };
}

async function testFontComparison(page) {
  return compareFonts(page);
}

async function writeEvidence(data) {
  const captures = data.captures || [];
  const report = {
    milestone: "S1-A-R2",
    browserEngine: "Playwright-bundled Chromium",
    browserVersion: browser.version(),
    profile: "Task-owned in-memory browser context; no user profile used",
    baseOrigin: baseUrl,
    requestCount,
    requestHosts: [...requestHosts],
    externalRequestCount,
    consoleErrorCount,
    pageErrorCount,
    rawOutputHashes: data.dataset.rawHashes,
    dataset: {
      scores: Object.fromEntries(Object.entries(data.dataset.analyses).map(([name, item]) => [name, item.deterministic_score.overall_score])),
      checkCounts: Object.fromEntries(Object.entries(data.dataset.analyses).map(([name, item]) => [name, item.checks.length])),
      northstarScore: data.dataset.northstar.deterministic_score.overall_score,
      northstarCheckCount: data.dataset.northstar.checks.length,
      northstarPasses: data.dataset.northstarPasses,
      northstarActionable: data.dataset.northstarActionable,
      actionability: data.dataset.actionability,
      countMismatchExplanation: "The old 3 fails + 11 warnings included one optional empty-JSON-LD warning excluded from actions; link_relationships was not_applicable. The central R2 model reports raw statuses and excluded actions separately.",
    },
    fontComparison: data.fontComparison,
    interaction: data.interaction,
    countConsistency: data.countConsistency,
    proofAudit: data.proofAudit,
    signalStates: data.signalStates,
    mobileTargets: data.mobileTargets,
    layouts: data.layouts,
    contrast: data.contrast,
    animations: data.animations,
    checks,
    captures,
    manualVisualReview: process.argv.includes("--visual-reviewed"),
  };
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, "verification.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(evidenceDir, "screenshot-index.json"), JSON.stringify(captures, null, 2) + "\n", "utf8");
  const rows = checks.filter((item) => /^R2-\d+/.test(item.name)).map((item) => {
    const id = item.name.match(/^R2-\d+/)?.[0] || "";
    const viewports = id === "R2-10" ? "1440x900" : id === "R2-13" ? "390x844; 320x844 regression" : id === "R2-7" || id === "R2-8" || id === "R2-9" || id === "R2-11" || id === "R2-14" || id === "R2-15" || id === "R2-16" ? "All relevant states" : "1440, 1024, 768, 390; 320 regression where measured";
    return `| ${id} | ${item.status} | ${item.detail.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${viewports} | \`node docs/design/s1-a/check.mjs\` and native screenshot inspection | [verification.json](evidence/verification.json) |`;
  });
  const acceptance = [
    "# S1-A R2 Acceptance",
    "",
    "Measured in Playwright-bundled Chromium with a loopback-only static server. The report does not establish production readiness.",
    "",
    "| Criterion | Status | Measured value | Viewport | Method | Evidence |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "The complete raw measurements, count reconciliation, font comparison, request-host audit, and screenshot inventory are in [verification.json](evidence/verification.json). Captured screenshots are listed in [screenshot-index.json](evidence/screenshot-index.json).",
    "",
    "Unverified items are identified explicitly in each row and in the final review report. This proof uses only generated offline analyzer output and does not call external websites or an API.",
    "",
  ].join("\n");
  await fs.writeFile(path.join(here, "ACCEPTANCE.md"), acceptance, "utf8");
  return report;
}

async function main() {
  activeStage = "start-local-server";
  await startServer();
  browser = await chromium.launch({ headless: true });
  activeStage = "offline-analyzer-data";
  const dataset = await inspectAnalysisData();
  activeStage = "browser-page-setup";
  const page = await newPage();
  activeStage = "font-pair-comparison";
  const fontComparison = await testFontComparison(page);
  activeStage = "interaction-tests";
  const interaction = await testInteractions(page, dataset);
  activeStage = "count-consistency";
  const countConsistency = await inspectCountConsistency(page);
  activeStage = "copy-language-and-page-audit";
  const proofAudit = await inspectProofWordingAndFindings(page, { dataset });
  activeStage = "signal-color-states";
  const signalStates = await inspectSignalStates(page);
  activeStage = "mobile-touch-targets";
  const mobileTargets = await inspectMobileTargets(page);
  activeStage = "responsive-layout-measurements";
  const layouts = await inspectLayouts(page);
  activeStage = "contrast-and-motion-measurements";
  await open(page, "summary", "northstar", {}, { width: 1440, height: 900 });
  const contrast = await inspectFontAndColors(page);
  const animations = await inspectAnimations(page);
  activeStage = "capture-r2-screenshots";
  const captures = await captureScreenshots(page);
  const captureFocus = captures.find((item) => item.fileName === "r2-focus-ring-390x844.png")?.interactionResult;

  await open(page, "home");
  const homeCopy = await page.evaluate(() => ({
    heading: document.querySelector(".home-title")?.textContent.trim() || "",
    support: document.querySelector(".home-support")?.textContent.trim() || "",
    primary: document.querySelector(".check-page-button")?.textContent.trim() || "",
    credentialInputs: document.querySelectorAll('input[type=password],input[autocomplete*=password],input[name*=token i],input[name*=api_key i],input[name*=api-key i],input[id*=token i],input[id*=api_key i],input[id*=api-key i]').length,
  }));
  const proofSource = await fs.readFile(path.join(here, "proof.js"), "utf8");
  const bearerCodeMatches = (proofSource.match(/authorization\s*[:=][^\n]{0,80}bearer|bearer\s+[a-z0-9_-]{8,}/gi) || []).length;
  const fontPairsLoaded = ["1440x900", "390x844"].every((viewport) => fontComparison[viewport]?.A?.uiFontLoaded && fontComparison[viewport]?.A?.monoFontLoaded && fontComparison[viewport]?.B?.uiFontLoaded && fontComparison[viewport]?.B?.monoFontLoaded && fontComparison[viewport]?.A?.titleStyle?.family.includes("Hanken Grotesk") && fontComparison[viewport]?.B?.titleStyle?.family.includes("Schibsted Grotesk") && fontComparison[viewport]?.A?.monoStyle?.family.includes("JetBrains Mono") && fontComparison[viewport]?.B?.monoStyle?.family.includes("IBM Plex Mono"));
  record("Font comparison: both local pairs load on desktop and mobile", fontPairsLoaded, JSON.stringify(fontComparison));
  const minTextPx = Math.min(...layouts.map((item) => item.minTextPx).filter(Number.isFinite));
  const minBodyPx = Math.min(...layouts.flatMap((item) => item.bodyText.map((body) => body.px)).filter(Number.isFinite));
  const minContrast = Math.min(...layouts.map((item) => item.minContrast).filter(Number.isFinite));
  const bodyViolations = layouts.flatMap((item) => item.bodyText.filter((body) => body.px < 16).map((body) => ({ state: item.state, viewport: item.viewport, ...body })));
  record("R2-1 Typography: labels >=12px, body >=16px, text contrast >=4.5:1", layouts.every((item) => item.textViolations === 0 && item.contrastViolations === 0) && bodyViolations.length === 0 && minTextPx >= 12 && minBodyPx >= 16 && minContrast >= 4.5,
    JSON.stringify({ minTextPx, minBodyPx, minContrast, bodyViolations, viewportCases: layouts.length }));
  const allMono = proofAudit.pageAudits.flatMap((item) => item.monoViolations.map((name) => ({ state: item.state, name })));
  record("R2-2 Monospace is used only for URLs, tags, and code blocks", allMono.length === 0,
    JSON.stringify({ violations: allMono, auditedPages: proofAudit.pageAudits.length }));
  const measuredSpacing = layouts.flatMap((item) => item.spacing.map((spacing) => ({ ...spacing, state: item.state, viewport: item.viewport }))).filter((item) => item.measuredWordPairs > 0);
  const minimumVisibleGap = Math.min(...measuredSpacing.map((item) => item.minVisibleWordGapEm));
  record("R2-3 Display spacing is no tighter than -.02em with measured word gaps >=.2em", measuredSpacing.length > 0 && measuredSpacing.every((item) => item.letterPx >= -0.02 * item.fontPx - 0.01 && item.minVisibleWordGapEm >= 0.2),
    JSON.stringify({ minimumVisibleGapEm: minimumVisibleGap, minimumVisibleGapPx: Math.min(...measuredSpacing.map((item) => item.minVisibleWordGapPx)), measurements: measuredSpacing.length, violations: measuredSpacing.filter((item) => item.letterPx < -0.02 * item.fontPx - 0.01 || item.minVisibleWordGapEm < 0.2) }));
  const linkViolations = proofAudit.pageAudits.flatMap((item) => item.anchorViolations.map((name) => ({ state: item.state, name }))).concat(proofAudit.pageAudits.flatMap((item) => item.standaloneUnderlines.map((name) => ({ state: item.state, name }))));
  record("R2-4 No credentials or bearer code; standalone links use button-like styling", homeCopy.heading === "Check a web page for SEO problems." && homeCopy.support === "Paste a page address. You get a list of fixes, most important first." && homeCopy.primary === "Check page" && homeCopy.credentialInputs === 0 && interaction.credentialFieldCount === 0 && bearerCodeMatches === 0 && linkViolations.length === 0,
    JSON.stringify({ heading: homeCopy.heading, supportingCopy: homeCopy.support, primaryAction: homeCopy.primary, credentialInputs: interaction.credentialFieldCount, bearerCodeMatches, linkViolations, auditedPages: proofAudit.pageAudits.length }));
  const signalViolations = signalStates.flatMap((item) => item.signalViolations.map((use) => ({ state: item.state, sample: item.sample, className: use.className })));
  const signalContrast = Math.min(...signalStates.map((item) => item.minContrast));
  const badgeViolations = signalStates.flatMap((item) => item.invalidSeverityBadges.map((badge) => ({ state: item.state, badge })));
  record("R2-5 Vermilion is limited to logo, blocking/high marks, and X-ray inspection; severity badges use words/icons", signalViolations.length === 0 && signalContrast >= 4.5 && badgeViolations.length === 0,
    JSON.stringify({ redUses: signalStates.map((item) => ({ state: item.state, sample: item.sample, interaction: item.interaction, uses: item.redUses.length })), signalViolations, badgeViolations, minContrast: signalContrast }));
  record("R2-6 Action-first finding language and one score caveat", proofAudit.findingIssues.length === 0 && proofAudit.visibleProofUse.length === 0 && interaction.scoreHelp.affordances === 1 && interaction.scoreHelp.panels === 1 && interaction.scoreHelp.heuristicVisibleElsewhere === 0 && interaction.noindexVerdict === "This page tells search engines not to index it.",
    JSON.stringify({ forbiddenFindingCopy: proofAudit.findingIssues, phraseOrCaveatViolations: proofAudit.visibleProofUse, noindexVerdict: interaction.noindexVerdict }));
  const countGrammarIssues = Object.entries(countConsistency).flatMap(([sample, states]) => Object.entries(states).flatMap(([state, details]) => /\b\w+\(s\)|\b1\s+(?:items|checks|links|characters|elements)\b/i.test(details.countSummary) ? [sample + ":" + state + ":" + details.countSummary] : []));
  record("R2-7 Rendered analyzer and count copy has no tested plural errors", proofAudit.grammarIssues.length === 0 && countGrammarIssues.length === 0,
    JSON.stringify({ findingGrammarViolations: proofAudit.grammarIssues, countGrammarViolations: countGrammarIssues }));
  const sampleNames = { northstar: "audit-northstar.json", weak: "audit-weak.json", basic: "audit-basic.json" };
  const countFailures = [];
  for (const [sample, name] of Object.entries(sampleNames)) {
    const states = countConsistency[sample];
    const expected = dataset.actionability[name];
    const summary = states?.summary; const fixList = states?.["fix-list"];
    const warning = Number(expected.raw.warning || 0); const fail = Number(expected.raw.fail || 0);
    const equalFields = ["rawOpen", "actionable", "remaining", "passed", "excluded", "notApplicable", "total", "score", "countSummary"];
    if (!summary || !fixList || equalFields.some((field) => summary[field] !== fixList[field]) || summary.sidebarCount !== summary.remaining || summary.sidebarCount !== fixList.sidebarCount || summary.rawOpen !== warning + fail || summary.rawOpen !== summary.actionable + summary.excluded || summary.actionable !== expected.actionable || summary.excluded !== expected.exclusions.length || summary.notApplicable !== expected.notApplicable.length || summary.passed !== Number(expected.raw.pass || 0) || summary.total !== 23 || summary.categoryChecks !== summary.total || summary.categoryPass !== summary.passed) countFailures.push({ sample, summary, fixList, expected });
  }
  record("R2-8 One findings model reconciles raw, actionable, category, sidebar, and Fix list counts", countFailures.length === 0,
    JSON.stringify({ samples: countConsistency, mismatches: countFailures, expectedExclusions: dataset.actionability }));
  record("R2-9 Each finding title appears once per page including expanded rows", new Set(interaction.summaryTitles).size === interaction.summaryTitles.length && new Set(interaction.titleCopies).size === interaction.titleCopies.length,
    JSON.stringify({ summary: interaction.summaryTitles.length, fixList: interaction.titleCopies.length, duplicates: interaction.titleCopies.filter((value, index, values) => values.indexOf(value) !== index) }));
  record("R2-10 Desktop and mobile Summary show verdict and priority work in the first viewport", Boolean(interaction.desktopViewport?.verdict?.visible && interaction.desktopViewport?.score?.visible && interaction.desktopViewport?.firstThreePriorities?.length === 3 && interaction.desktopViewport.firstThreePriorities.every((item) => item.visible) && interaction.mobileViewport?.verdict?.visible && interaction.mobileViewport?.firstThreePriorities?.[0]?.visible && interaction.mobileViewport?.xrayPreview?.top < 844),
    JSON.stringify({ desktop: interaction.desktopViewport, mobile: interaction.mobileViewport }));
  record("R2-11 Desktop and mobile navigation list ten pages, route five built pages, and disable five others", interaction.navItems === 10 && interaction.unbuiltDisabled === 5 && interaction.disabledPrevented && interaction.builtRoutesValid && interaction.moreCount === 10 && interaction.moreDisabledCount === 5 && interaction.moreClosed && interaction.focusTrappedBackward && interaction.focusTrappedForward && interaction.focusRestored,
    JSON.stringify({ desktopPages: interaction.navItems, disabledPages: interaction.unbuiltDisabled, disabledPrevented: interaction.disabledPrevented, builtRoutesValid: interaction.builtRoutesValid, mobileItems: interaction.moreCount, mobileDisabled: interaction.moreDisabledCount, focusTrappedBackward: interaction.focusTrappedBackward, focusTrappedForward: interaction.focusTrappedForward, focusRestored: interaction.focusRestored }));
  const radiusViolations = [...contrast.radiusViolations, ...proofAudit.pageAudits.flatMap((item) => item.radiusViolations.map((node) => ({ ...node, state: item.state })))];
  const nestedCardViolations = proofAudit.pageAudits.filter((item) => item.nestedCards).map((item) => ({ state: item.state, count: item.nestedCards }));
  record("R2-12 Controls/cards have 8px radius minimum; no nested bordered cards", radiusViolations.length === 0 && nestedCardViolations.length === 0,
    JSON.stringify({ radiusViolations, nestedCardViolations, xrayFrameExempt: true }));
  const mobileTargetFailures = mobileTargets.flatMap((item) => item.violations.map((target) => ({ state: item.state, target })));
  record("R2-13 Mobile controls are >=44x44px without horizontal overflow", mobileTargetFailures.length === 0 && layouts.filter((item) => ["390x844", "320x844"].includes(item.viewport)).every((item) => !item.overflow),
    JSON.stringify({ targetMinimums: mobileTargets.map(({ state, minimumWidth, minimumHeight }) => ({ state, minimumWidth, minimumHeight })), mobileTargetFailures, overflow: layouts.filter((item) => ["390x844", "320x844"].includes(item.viewport) && item.overflow).map((item) => ({ state: item.state, viewport: item.viewport })) }));
  record("R2-14 Proof-related wording is confined to one strip below the app", proofAudit.visibleProofUse.length === 0,
    JSON.stringify({ violations: proofAudit.visibleProofUse, stripPerState: "1" }));
  record("R2-15 Four error causes and four named loading steps have working recovery", interaction.errorCauses === 4 && interaction.errorRecovery && interaction.loadingSteps === 4 && interaction.loadingStepNames.join("|") === "Fetching the page|Reading the HTML|Running 23 checks|Building your report" && interaction.loadingActive === 1 && interaction.loadingCancel === 1 && interaction.loadingCancelReturnsHome && interaction.errorRetryReturnsHome && interaction.errorBackUsesHistory,
    JSON.stringify({ causes: interaction.errorCauseNames, recovery: interaction.errorRecovery, loadingSteps: interaction.loadingStepNames, active: interaction.loadingActive, cancel: interaction.loadingCancel, cancelReturnsHome: interaction.loadingCancelReturnsHome, retryReturnsHome: interaction.errorRetryReturnsHome, backUsesHistory: interaction.errorBackUsesHistory }));
  const transitionFailure = animations.transitionViolations.length > 0 || animations.animationViolations.length > 0 || !animations.reducedMotion.preference || animations.reducedMotion.transitionProperty !== "none" || animations.reducedMotion.animationName !== "none";
  record("R2-16 Focus ring is visible; only opacity/transform animate; reduced motion disables animation", interaction.focusRing && captureFocus === true && !transitionFailure,
    JSON.stringify({ focusRingMeasured: interaction.focusRing, focusScreenshotRing: captureFocus, transitionProperties: animations.transitionProperties, transitionViolations: animations.transitionViolations, animationViolations: animations.animationViolations, reducedMotion: animations.reducedMotion, focusScreenshot: "r2-focus-ring-390x844.png" }));
  record("retained interaction: finding and X-ray selection work in both directions", interaction.showOnPage === 1 && interaction.xrayKeyboardDetail === 1,
    JSON.stringify({ findingToXray: interaction.showOnPage, xrayToFinding: interaction.xrayKeyboardDetail }));
  record("retained Summary limit: at most three priority cards, five actions overall, and 120 explanatory words", interaction.summaryPriorityCount <= 3 && dataset.northstarActionable <= 5 && interaction.summaryExplainerWords <= 120,
    JSON.stringify({ summaryPriorityCards: interaction.summaryPriorityCount, allActions: dataset.northstarActionable, explanatoryWords: interaction.summaryExplainerWords }));
  record("retained interaction: supported URL opens only its offline result; arbitrary URL fabricates none", interaction.supportedUrlOpensSample && interaction.arbitraryUrlNotInvented && interaction.keywordRevealed,
    JSON.stringify({ supportedSample: interaction.supportedUrlOpensSample, arbitraryUrlNoReport: interaction.arbitraryUrlNotInvented, keywordToggle: interaction.keywordRevealed }));
  record("retained history behavior: browser Back and Forward preserve route state", interaction.browserBackState === "summary" && interaction.browserForwardState === "fix-list",
    JSON.stringify({ back: interaction.browserBackState, forward: interaction.browserForwardState }));
  record("retained Copy behavior: expanded item copies only its available template", interaction.copyFeedback === "Copied." && interaction.copyMatchesSnippet,
    JSON.stringify({ feedback: interaction.copyFeedback, copiedValueMatchesRenderedSnippet: interaction.copyMatchesSnippet }));
  record("R2 local Done state marks only the selected item and does not change analysis", interaction.doneCountIsLocalOnly,
    JSON.stringify({ checkedBefore: interaction.doneCountBefore, checkedAfter: interaction.localDoneCount, counts: interaction.doneCountSummary, visibleCountSummary: interaction.doneCountText, localOnlyNote: interaction.doneNote, scoreUnchanged: interaction.doneScoreUnchanged }));
  record("Fix-list filters show only matching findings", interaction.highFilter > 0 && interaction.quickFilter > 0 && interaction.highFilter < interaction.weakActionCount,
    JSON.stringify({ weakActions: interaction.weakActionCount, high: interaction.highFilter, quick: interaction.quickFilter }));
  record("retained CLS, no overlap, and no narrow-layout overflow", layouts.every((item) => item.cls === 0 && item.textOverlapCount === 0 && !item.overflow),
    JSON.stringify({ cases: layouts.length, nonzeroCLS: layouts.filter((item) => item.cls !== 0).map((item) => ({ state: item.state, viewport: item.viewport, cls: item.cls })), overlaps: layouts.filter((item) => item.textOverlapCount).map((item) => ({ state: item.state, viewport: item.viewport, count: item.textOverlapCount, examples: item.textOverlaps })), overflow: layouts.filter((item) => item.overflow).map((item) => ({ state: item.state, viewport: item.viewport })) }));
  record("retained raw engine outputs remain v1.0 with original scores and check counts", dataset.rawHashes["audit-weak.json"] === rawHashes["audit-weak.json"] && dataset.rawHashes["audit-basic.json"] === rawHashes["audit-basic.json"] && dataset.rawHashes["audit-noindex-test.json"] === rawHashes["audit-noindex-test.json"] && ["audit-weak.json", "audit-basic.json", "audit-noindex-test.json"].every((name) => dataset.analyses[name].deterministic_score.version === "1.0" && dataset.analyses[name].checks.length === 23),
    JSON.stringify({ hashesUnchanged: true, scores: Object.fromEntries(Object.entries(dataset.analyses).map(([name, item]) => [name, item.deterministic_score.overall_score])) }));
  record("local request boundary and runtime errors", externalRequestCount === 0 && consoleErrorCount === 0 && pageErrorCount === 0,
    JSON.stringify({ requestCount, hosts: [...requestHosts], externalRequestCount, consoleErrorCount, pageErrorCount }));
  record("exact R2 screenshot set", captures.length === 14 && new Set(captures.map((item) => item.fileName)).size === 14,
    captures.length + " uniquely named Chromium viewport captures");

  const report = await writeEvidence({ dataset, fontComparison, interaction, countConsistency, proofAudit, signalStates, mobileTargets, layouts, contrast, animations, captures });
  const failed = checks.filter((item) => item.status === "FAIL");
  const unverified = checks.filter((item) => item.status === "UNVERIFIED");
  console.log("Browser: Playwright Chromium " + browser.version());
  console.log("Requests: " + requestCount + "; local host count: " + requestHosts.size + "; outside origin: " + externalRequestCount);
  console.log("Screenshots: " + captures.length + "; layout cases: " + layouts.length + "; CLS measurement is recorded separately.");
  console.log("Checks: " + checks.length + "; pass=" + (checks.length - failed.length - unverified.length) + "; fail=" + failed.length + "; unverified=" + unverified.length);
  console.log("Evidence: " + path.relative(root, path.join(evidenceDir, "verification.json")));
  if (failed.length) process.exitCode = 1;
  await context.close();
  await browser.close();
  void report;
}

try {
  await main();
} catch (error) {
  const safeError = String(error?.message || "").replace(/https?:\/\/[^\s]+/gi, "[address]").replace(/northstar/gi, "[sample]").replace(/[\r\n]+/g, " ").slice(0, 160);
  console.error("BLOCKED/FAILED in R2 checker at " + activeStage + "/" + activeInteraction + " (" + (error?.name || "Error") + (safeError ? ": " + safeError : "") + "); diagnostics omit page content.");
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
