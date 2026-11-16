const STATES = new Set(["home", "summary", "fix-list", "xray", "on-page", "previews", "loading", "error"]);
const REPORT_STATES = new Set(["summary", "fix-list", "xray", "on-page", "previews"]);
const SAMPLE_FILES = {
  northstar: "audit-northstar.json",
  weak: "audit-weak.json",
  basic: "audit-basic.json",
  noindex: "audit-noindex-test.json",
};
const CATEGORY_LABELS = {
  technical_indexability: "Technical",
  metadata: "Page details",
  headings_content_structure: "Headings and content",
  links: "Links",
  images: "Images",
  structured_data: "Structured data",
  social_metadata: "Sharing previews",
  html_signals: "HTML setup",
};
const IMPACT_ORDER = { blocking: 0, high: 1, medium: 2, low: 3 };
const EFFORT_ORDER = { quick: 0, moderate: 1, heavy: 2 };
const NAV_GROUPS = [
  { label: "Overview", pages: [["summary", "Summary"], ["fix-list", "Fix list"], ["xray", "Page X-ray"]] },
  { label: "Checks", pages: [["technical", "Technical"], ["on-page", "On-page"], ["links-images", "Links and images"], ["structured-data", "Structured data"], ["speed", "Speed"]] },
  { label: "Share", pages: [["previews", "Previews"]] },
  { label: "Other", pages: [["history", "History"]] },
];
const BUILT_PAGES = new Set(["summary", "fix-list", "xray", "on-page", "previews"]);
const $ = (selector, root = document) => root.querySelector(selector);
const app = $("#app");
const doneBySample = Object.create(null);
let currentAnalysis = null;
let currentEnrichment = null;
let currentNotes = null;
let currentViewModel = null;
let currentSample = null;
let selectedCheckId = null;
let expandedCheckIds = new Set();
let activeFilter = "all";
let renderGeneration = 0;
let moreOpener = null;

function make(tag, className = "", text = null, attrs = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null && text !== undefined) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (name === "dataset") {
      for (const [key, dataValue] of Object.entries(value)) element.dataset[key] = String(dataValue);
    } else if (name === "class") element.className = String(value);
    else if (value === true) element.setAttribute(name, "");
    else if (value !== false) element.setAttribute(name, String(value));
  }
  return element;
}

function append(parent, ...children) {
  for (const child of children) if (child) parent.append(child);
  return parent;
}

function icon(name) {
  const shapes = {
    blocking: "M12 3v10m0 4v.01M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07",
    high: "M12 4v10m0 4v.01M5 19h14",
    medium: "M12 4v9m0 4v.01M5 19h14",
    low: "M5 12h14",
    passed: "m5 12 4 4L19 6",
    effort: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("severity-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", shapes[name] || shapes.low);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function severityBadge(level) {
  const name = level === "pass" ? "Passed" : ({ blocking: "Blocking", high: "High", medium: "Medium", low: "Low" })[level] || "Low";
  const className = level === "pass" ? "passed" : level;
  const badge = make("span", "severity-badge badge--" + className);
  append(badge, icon(level === "pass" ? "passed" : className), make("span", "", name));
  return badge;
}

function effortChip(effort) {
  const label = ({ quick: "Quick", moderate: "Moderate", heavy: "Larger job" })[effort] || "Moderate";
  const chip = make("span", "effort-chip");
  append(chip, icon("effort"), make("span", "", label));
  return chip;
}

function readRoute() {
  const query = new URLSearchParams(window.location.search);
  const requested = query.get("state") || "home";
  return {
    state: STATES.has(requested) ? requested : "error",
    sample: Object.hasOwn(SAMPLE_FILES, query.get("sample") || "") ? query.get("sample") : null,
    checkId: query.get("check"),
    reason: query.get("reason"),
  };
}

function routeUrl(state, sample = null, checkId = null, reason = null) {
  const params = new URLSearchParams({ state });
  if (sample) params.set("sample", sample);
  if (checkId) params.set("check", checkId);
  if (reason) params.set("reason", reason);
  return "?" + params.toString();
}

function navigate(state, sample = null, checkId = null, reason = null) {
  window.history.pushState({}, "", routeUrl(state, sample, checkId, reason));
  render();
}

function navLink(page, label, active, count = null) {
  const link = make("a", "nav-link" + (active ? " is-active" : ""), null, {
    href: routeUrl(page, currentSample),
    "aria-current": active ? "page" : null,
    dataset: { pageId: page, ui: "true", navLink: "true" },
  });
  append(link, make("span", "nav-link-label", label));
  if (count !== null && count !== undefined) link.append(make("span", "nav-count", String(count), { "aria-hidden": "true", dataset: { navCount: page } }));
  return link;
}

function pageCount(page, model) {
  if (!model) return null;
  if (page === "summary" || page === "fix-list") return model.remaining.length;
  if (page === "xray") return model.raw.total;
  if (page === "on-page") return model.pageCounts.onPage;
  if (page === "previews") return model.pageCounts.previews;
  return null;
}

function buildPageNavigation(route, model, inMoreSheet = false) {
  const nav = make("nav", inMoreSheet ? "more-page-list" : "page-navigation", null, { "aria-label": "Audit pages" });
  for (const group of NAV_GROUPS) {
    const section = make("section", "nav-group");
    append(section, make("h2", "nav-group-title", group.label));
    const list = make("div", "nav-group-items");
    for (const [page, label] of group.pages) {
      if (BUILT_PAGES.has(page)) {
        list.append(navLink(page, label, route.state === page, pageCount(page, model)));
      } else {
        list.append(make("button", "nav-link nav-link-disabled", label, {
          type: "button",
          disabled: true,
          "aria-disabled": "true",
          dataset: { pageId: page, ui: "true" },
        }));
      }
    }
    section.append(list);
    nav.append(section);
  }
  return nav;
}

function buildMoreSheet(route, model, mobile) {
  if (!mobile) return null;
  const dialog = make("dialog", "more-sheet", null, { "aria-labelledby": "more-heading" });
  dialog.append(make("div", "more-sheet-head"));
  const head = $(".more-sheet-head", dialog);
  append(head, make("h2", "", "Audit pages", { id: "more-heading" }), make("button", "icon-button", "Close", { type: "button", "data-close-more": "true" }));
  dialog.append(buildPageNavigation(route, model, true));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    if (moreOpener?.isConnected) moreOpener.focus();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("a[href], button:not(:disabled)")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $("[data-close-more]", dialog).addEventListener("click", () => dialog.close());
  return dialog;
}

function buildHeader(route, model) {
  const header = make("header", "topbar");
  const brand = make("a", "wordmark", null, { href: routeUrl("home"), dataset: { ui: "true", navLink: "true" }, "aria-label": "SEO Sensei home" });
  append(brand, make("span", "brand-mark", "S"), make("span", "wordmark-name", "SEO Sensei"));
  const actions = make("div", "topbar-actions");
  const newAudit = make("a", "new-audit-button button-link", null, { href: routeUrl("home"), dataset: { ui: "true", navLink: "true" } });
  append(newAudit, make("span", "new-audit-icon", "+", { "aria-hidden": "true" }), make("span", "new-audit-label", "New audit"));
  actions.append(newAudit);
  append(header, brand, actions);
  if (window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches) {
    const tabletNav = make("nav", "tablet-nav", null, { "aria-label": "Audit pages" });
    for (const [page, label] of [["summary", "Summary"], ["fix-list", "Fix list"], ["xray", "Page X-ray"], ["on-page", "On-page"], ["previews", "Previews"]]) {
      tabletNav.append(navLink(page, label, route.state === page, pageCount(page, model)));
    }
    header.append(tabletNav);
  }
  return header;
}

function buildShell(route, model, content) {
  const frame = make("div", "proof-app", null, { dataset: { shell: "true" } });
  if (window.matchMedia("(min-width: 1024px)").matches) {
    const sidebar = make("aside", "desktop-sidebar", null, { "aria-label": "Audit navigation" });
    const sidebarBrand = make("a", "sidebar-brand", null, { href: routeUrl("home"), dataset: { ui: "true", navLink: "true" }, "aria-label": "SEO Sensei home" });
    append(sidebarBrand, make("span", "brand-mark", "S"), make("span", "wordmark-name", "SEO Sensei"));
    append(sidebar, sidebarBrand, buildPageNavigation(route, model));
    frame.append(sidebar);
  }
  const column = make("div", "app-column");
  column.append(buildHeader(route, model));
  if (content) column.append(content);
  frame.append(column);
  const bottom = make("nav", "mobile-tabs", null, { "aria-label": "Main pages" });
  bottom.append(navLink("summary", "Summary", route.state === "summary", pageCount("summary", model)));
  bottom.append(navLink("fix-list", "Fix list", route.state === "fix-list", pageCount("fix-list", model)));
  bottom.append(navLink("xray", "X-ray", route.state === "xray", pageCount("xray", model)));
  bottom.append(make("button", "mobile-tab mobile-more-button", "More", { type: "button", "aria-haspopup": "dialog", dataset: { ui: "true", openMore: "true" } }));
  frame.append(bottom);
  const dialog = buildMoreSheet(route, model, window.matchMedia("(max-width: 767px)").matches);
  if (dialog) frame.append(dialog);
  const strip = make("p", "proof-strip", "Static, local design proof · no live analysis.");
  app.replaceChildren(frame, strip);
  return frame;
}

function internalAnchor(page, sample, label, className = "button-link", checkId = null) {
  return make("a", className, label, {
    href: routeUrl(page, sample, checkId),
    dataset: { ui: "true", navLink: "true" },
  });
}

function validateAnalysis(data) {
  if (!data || typeof data !== "object" || typeof data.requested_url !== "string" || typeof data.final_url !== "string") throw new Error("analysis identity");
  if (!data.deterministic_score || data.deterministic_score.version !== "1.0" || !Number.isInteger(data.deterministic_score.overall_score)) throw new Error("score contract");
  if (!Array.isArray(data.deterministic_score.categories) || !Array.isArray(data.checks)) throw new Error("check contract");
  if (!data.metadata || !data.headings || !data.images || !data.links || !data.structured_data || !data.social_metadata || !data.fetch || !data.lexical_signals) throw new Error("analysis sections");
  const seen = new Set();
  for (const check of data.checks) {
    if (!check || typeof check.id !== "string" || seen.has(check.id) || !["pass", "warning", "fail", "not_applicable"].includes(check.status)) throw new Error("check item");
    if (typeof check.evidence?.observed !== "string" || typeof check.recommendation !== "string") throw new Error("check evidence");
    seen.add(check.id);
  }
  for (const check of data.checks) if (!data.deterministic_score.categories.some((item) => item.check_ids.includes(check.id))) throw new Error("unscored check");
  return data;
}

async function loadData(sample) {
  const response = await fetch(SAMPLE_FILES[sample], { cache: "no-store" });
  const enrichmentResponse = await fetch("enrichment.json", { cache: "no-store" });
  const notesResponse = await fetch("offline-source-notes.json", { cache: "no-store" });
  if (!response.ok || !enrichmentResponse.ok || !notesResponse.ok) throw new Error("local data unavailable");
  const [analysisRaw, enrichment, notes] = await Promise.all([response.json(), enrichmentResponse.json(), notesResponse.json()]);
  const analysis = validateAnalysis(analysisRaw);
  const sourceSample = sample === "noindex" ? "weak" : sample;
  if (!notes.samples?.[sourceSample] || Object.keys(enrichment.checks || {}).length !== analysis.checks.length) throw new Error("presentation data incomplete");
  for (const check of analysis.checks) if (!enrichment.checks[check.id]) throw new Error("check mapping missing");
  return { analysis, enrichment, notes: notes.samples[sourceSample] };
}

function pathValue(context, path) {
  return path.split(".").reduce((value, key) => value?.[key], context);
}

function conditionMatches(condition, context) {
  if (Array.isArray(condition.all)) return condition.all.every((item) => conditionMatches(item, context));
  if (Array.isArray(condition.any)) return condition.any.some((item) => conditionMatches(item, context));
  const actual = pathValue(context, condition.path);
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "in": return Array.isArray(condition.value) && condition.value.includes(actual);
    case "greater_than": return typeof actual === "number" && actual > condition.value;
    case "empty": return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "contains_ci": {
      const values = Array.isArray(actual) ? actual : [actual];
      return values.some((value) => String(value ?? "").toLowerCase().includes(String(condition.value).toLowerCase()));
    }
    default: return false;
  }
}

function enriched(check, analysis, enrichment) {
  const rule = enrichment.checks[check.id];
  const context = { analysis, check };
  let impact = rule.impact;
  for (const candidate of rule.impact_rules || []) {
    if (conditionMatches(candidate.when, context)) {
      impact = candidate.impact;
      break;
    }
  }
  let title = rule.title;
  let reason = rule.reason;
  let verdict = rule.verdict || "";
  for (const candidate of rule.copy_rules || []) {
    if (conditionMatches(candidate.when, context)) {
      title = candidate.title || title;
      reason = candidate.reason || reason;
      verdict = candidate.verdict || verdict;
      break;
    }
  }
  const ignored = (rule.ignore_when || []).find((candidate) => conditionMatches(candidate.when, context));
  return {
    ...rule,
    title,
    reason,
    verdict,
    impact,
    actionable: rule.actionable_statuses.includes(check.status) && !ignored,
    exclusionReason: ignored?.reason || rule.exclusion_reason || "",
  };
}

function compareChecks(a, b) {
  return IMPACT_ORDER[a.entry.impact] - IMPACT_ORDER[b.entry.impact]
    || EFFORT_ORDER[a.entry.effort] - EFFORT_ORDER[b.entry.effort]
    || a.sourceOrder - b.sourceOrder;
}

function buildViewModel(analysis, enrichment, sample) {
  const checks = analysis.checks.map((check, sourceOrder) => ({ check, sourceOrder, entry: enriched(check, analysis, enrichment) }));
  const raw = checks.reduce((total, item) => {
    total[item.check.status] += 1;
    total.total += 1;
    return total;
  }, { pass: 0, warning: 0, fail: 0, not_applicable: 0, total: 0 });
  const rawOpen = raw.warning + raw.fail;
  const actionable = checks.filter((item) => item.entry.actionable).sort(compareChecks);
  const doneMap = doneBySample[sample] || Object.create(null);
  const done = actionable.filter((item) => Boolean(doneMap[item.check.id]));
  const remaining = actionable.filter((item) => !doneMap[item.check.id]);
  const excluded = checks.filter((item) =>
    (item.check.status === "warning" || item.check.status === "fail") && !item.entry.actionable)
    .map((item) => ({ ...item, reason: item.entry.exclusionReason || "No action rule is defined for this returned check." }));
  const notApplicable = checks.filter((item) => item.check.status === "not_applicable")
    .map((item) => ({ ...item, reason: item.entry.exclusionReason || "The analyzer did not apply this check to the returned page." }));
  const categoryMap = new Map();
  for (const item of checks) {
    const category = item.check.category;
    const result = categoryMap.get(category) || { category, total: 0, pass: 0 };
    result.total += 1;
    if (item.check.status === "pass") result.pass += 1;
    categoryMap.set(category, result);
  }
  const categoryTotals = [...categoryMap.values()].map((item) => ({ ...item, label: CATEGORY_LABELS[item.category] || item.category }));
  const pagePartCount = (ids) => actionable.filter((item) => ids.includes(item.check.id)).length;
  const partChecks = Object.create(null);
  for (const item of checks) {
    const part = item.entry.anatomy_part;
    if (part) (partChecks[part] ||= []).push(item.check.id);
  }
  return {
    checks,
    raw,
    rawOpen,
    actionable,
    done,
    remaining,
    excluded,
    notApplicable,
    passChecks: checks.filter((item) => item.check.status === "pass"),
    bySeverity: Object.fromEntries(["blocking", "high", "medium", "low"].map((level) => [level, actionable.filter((item) => item.entry.impact === level).length])),
    byEffort: Object.fromEntries(["quick", "moderate", "heavy"].map((level) => [level, actionable.filter((item) => item.entry.effort === level).length])),
    categories: categoryTotals,
    partChecks,
    pageCounts: {
      onPage: pagePartCount(["title", "meta_description", "canonical", "h1_structure", "heading_hierarchy", "visible_text"]),
      previews: pagePartCount(["open_graph", "twitter_metadata", "title", "meta_description"]),
    },
    doneCount: done.length,
    remainingCount: remaining.length,
    sample,
  };
}

function itemFor(model, checkId) {
  return model.checks.find((item) => item.check.id === checkId) || null;
}

function badgeForItem(item) {
  if (item.check.status === "pass") return severityBadge("pass");
  return severityBadge(item.entry.impact);
}

function actionTitle(item) {
  return item.entry.title;
}

function formatObservedEvidence(check) {
  return check.evidence.observed
    .replace(/\b(\d+) characters\b/g, (_, count) => count + (Number(count) === 1 ? " character" : " characters"))
    .replace(/\b(\d+)\s+([A-Za-z][A-Za-z -]*?)\(s\)/g, (_, count, noun) => count + " " + noun.trim() + (Number(count) === 1 ? "" : "s"))
    .replace(/\b(\d+) internal and (\d+) external link\(s\)/g, (_, internal, external) => {
      const total = Number(internal) + Number(external);
      return internal + " internal and " + external + " external " + (total === 1 ? "link" : "links");
    });
}

function countSummary(model) {
  return "Need attention: " + model.rawOpen
    + " · Suggested actions: " + model.actionable.length
    + " · Set aside: " + model.excluded.length
    + " · Marked done here: " + model.done.length
    + " · Still open: " + model.remaining.length
    + " · Passed: " + model.raw.pass
    + " · Not applicable: " + model.raw.not_applicable;
}

function scoreHelp(analysis) {
  const details = make("details", "score-info");
  details.append(make("summary", "score-info-trigger", "About this score", { dataset: { scoreHelpTrigger: "true" } }));
  const panel = make("div", "score-info-panel", null, { dataset: { scoreHelpPanel: "true" } });
  const weights = analysis.deterministic_score.categories.map((item) =>
    (CATEGORY_LABELS[item.category] || item.category) + " " + Number(item.weight).toFixed(0)).join(" · ");
  append(panel,
    make("p", "", "This deterministic heuristic uses observed page HTML and fetch information across eight weighted areas."),
    make("p", "score-weights", weights),
    make("p", "", "It describes the checks available here. It does not establish rankings, traffic, or whether a search engine has indexed the page."));
  details.append(panel);
  return details;
}

function priorityCard(item, index, sample) {
  const card = make("article", "priority-card", null, { dataset: { checkId: item.check.id } });
  const lead = make("div", "priority-lead");
  append(lead,
    make("span", "priority-index", String(index + 1)),
    make("h3", "priority-title", actionTitle(item)));
  const why = make("p", "priority-reason", item.entry.reason);
  const meta = make("div", "priority-meta");
  append(meta, badgeForItem(item), effortChip(item.entry.effort));
  const action = internalAnchor("fix-list", sample, "See the fix", "text-action", item.check.id);
  append(card, lead, why, meta, action);
  return card;
}

function miniXray(model, sample) {
  const section = make("section", "xray-preview", null, { "aria-labelledby": "xray-preview-title" });
  const analysis = currentAnalysis;
  const shape = [
    analysis.headings.h1.length ? "h1" : "no-h1",
    analysis.images.total > 0 ? "image" : "no-image",
    analysis.links.total > 0 ? "links" : "no-links",
    "h2-" + analysis.headings.h2.length,
  ].join("|");
  section.dataset.shape = shape;
  append(section,
    make("h2", "", "A page-shaped view", { id: "xray-preview-title" }),
    make("p", "", "See what the analysis found in the page structure."));
  const specimen = make("div", "mini-page", null, { "aria-hidden": "true" });
  const metaTitle = make("i", "mini-meta-title");
  metaTitle.textContent = analysis.metadata.title ? analysis.metadata.title.slice(0, 50) : "No page title";
  const metaDescription = make("i", "mini-meta-description");
  metaDescription.textContent = analysis.metadata.description ? analysis.metadata.description.slice(0, 68) : "No description";
  const h1 = make("i", "mini-h1");
  h1.textContent = analysis.headings.h1[0] || "No main heading";
  const paragraphs = make("i", "mini-copy");
  const subheadings = make("i", "mini-subheadings");
  const image = analysis.images.total ? make("i", "mini-image") : null;
  const links = analysis.links.total ? make("i", "mini-links") : null;
  append(specimen, metaTitle, metaDescription, h1, subheadings, paragraphs, image, links);
  section.append(specimen, internalAnchor("xray", sample, "Open page X-ray", "button-link xray-open"));
  return section;
}

function summaryView(route, model) {
  const analysis = currentAnalysis;
  const main = make("main", "view summary-view", null, {
    "aria-labelledby": "page-title",
    dataset: {
      state: "summary",
      sample: route.sample,
      rawOpen: model.rawOpen,
      actionableTotal: model.actionable.length,
      remainingTotal: model.remaining.length,
      passedTotal: model.raw.pass,
      excludedTotal: model.excluded.length,
      notApplicableTotal: model.raw.not_applicable,
      rawTotal: model.raw.total,
      score: currentAnalysis.deterministic_score.overall_score,
    },
  });
  const host = new URL(analysis.final_url).hostname;
  const identity = make("header", "summary-identity");
  append(identity,
    make("h1", "page-heading", host, { id: "page-title", dataset: { observed: "true" } }),
    make("p", "page-url", analysis.final_url, { dataset: { observed: "true", role: "code" } }));
  const blockingFinding = model.actionable.find((item) => item.entry.impact === "blocking");
  const verdict = blockingFinding
    ? blockingFinding.entry.verdict || "A blocking issue needs attention."
    : model.remaining.length >= 4
      ? "Start with these practical fixes."
      : model.remaining.length
        ? "A few clear improvements are ready."
        : "No open fixes remain in this view.";
  const verdictBlock = make("section", "summary-verdict");
  append(verdictBlock, make("h2", "verdict", verdict, { dataset: { severity: model.actionable.some((item) => item.entry.impact === "blocking") ? "blocking" : "normal" } }));
  const score = make("div", "summary-score", null, { "data-score": analysis.deterministic_score.overall_score });
  append(score,
    make("span", "score-number", String(analysis.deterministic_score.overall_score)),
    make("span", "score-out-of", "/ 100"),
    make("span", "score-version", "v" + analysis.deterministic_score.version),
    scoreHelp(analysis));
  verdictBlock.append(score);

  const content = make("div", "summary-work");
  const priority = make("section", "summary-priorities", null, { "aria-labelledby": "priority-heading" });
  const priorityHead = make("div", "section-head");
  append(priorityHead, make("h2", "", "Do these first", { id: "priority-heading" }), make("span", "section-count", "Up to 3 actions"));
  const cards = make("div", "priority-list");
  for (const [index, item] of model.remaining.slice(0, 3).entries()) cards.append(priorityCard(item, index + 1, route.sample));
  if (!model.remaining.length) cards.append(make("p", "empty-note", "The current analysis has no remaining suggested actions."));
  priority.append(priorityHead, cards);

  const xray = miniXray(model, route.sample);
  append(content, priority, xray);
  const reconciliation = make("p", "count-reconciliation");
  reconciliation.textContent = countSummary(model);
  reconciliation.dataset.countSummary = "true";

  const categories = make("section", "category-section", null, { "aria-labelledby": "category-title" });
  const categoryHead = make("div", "section-head");
  append(categoryHead, make("h2", "", "By category", { id: "category-title" }));
  const categoryList = make("div", "category-list");
  for (const item of model.categories) {
    const row = make("div", "category-row");
    const label = make("span", "category-name", item.label);
    const total = make("span", "category-total", item.pass + " of " + item.total + " passed");
    const bar = make("span", "category-track", null, { role: "img", "aria-label": item.label + ": " + item.pass + " of " + item.total + " passed" });
    bar.append(make("i", "", null, { style: "width:" + (item.total ? item.pass / item.total * 100 : 0) + "%" }));
    append(row, label, total, bar);
    categoryList.append(row);
  }
  categories.append(categoryHead, categoryList);

  const good = make("section", "good-section", null, { "aria-labelledby": "good-title" });
  const goodHead = make("div", "section-head");
  append(goodHead, make("h2", "", "Already good", { id: "good-title" }), make("span", "section-count", model.passChecks.length + " passed"));
  const goodList = make("ul", "good-list");
  for (const item of model.passChecks.slice(0, 5)) {
    const li = make("li", "good-item");
    append(li, severityBadge("pass"), make("span", "", item.check.title));
    goodList.append(li);
  }
  const extraGood = make("div", "good-extra", null, { hidden: true });
  for (const item of model.passChecks.slice(5)) {
    const li = make("p", "good-item");
    append(li, severityBadge("pass"), make("span", "", item.check.title));
    extraGood.append(li);
  }
  const showAll = make("button", "text-button", "Show all passed checks", { type: "button", dataset: { showAllPassed: "true" } });
  showAll.hidden = model.passChecks.length <= 5;
  showAll.addEventListener("click", () => {
    extraGood.hidden = !extraGood.hidden;
    showAll.textContent = extraGood.hidden ? "Show all passed checks" : "Show fewer passed checks";
  });
  good.append(goodHead, goodList, extraGood, showAll);
  append(main, identity, verdictBlock, content, reconciliation, categories, good);
  return main;
}

function findSourceImage(notes) {
  return notes?.images?.find((image) => !image.has_alt_attribute && image.src) || null;
}

function snippetFor(item, analysis, notes) {
  const rule = item.entry;
  if (!rule.snippet_template) return null;
  const image = findSourceImage(notes);
  const values = {
    final_url: analysis.final_url,
    page_title: analysis.metadata.title,
    h1: analysis.headings.h1[0] || "",
    image_src: image?.src || "",
    og_title: analysis.social_metadata.og_title || "",
    og_image: analysis.social_metadata.og_image || "",
  };
  if ((rule.snippet_requires || []).some((key) => !values[key])) return null;
  let value = rule.snippet_template;
  value = value.replace(/{{([a-z_]+)}}/g, (match, key) => Object.hasOwn(values, key) ? values[key] : "");
  if (value.includes("{{")) return null;
  return { value, note: rule.snippet_note || "Review this pattern against the page before using it.", review: Boolean(rule.review_required) };
}

function selectedForXray(checkId) {
  selectedCheckId = checkId;
  render();
  requestAnimationFrame(() => {
    const region = document.querySelector('.xray-region[data-check-ids*="' + CSS.escape(checkId) + '"]');
    if (region) {
      region.classList.add("is-selected");
      region.focus({ preventScroll: true });
      region.scrollIntoView({ block: "nearest" });
    }
  });
}

function buildXrayRegion(part, label, value, checkIds, model, classes = "") {
  const items = checkIds.map((id) => itemFor(model, id)).filter(Boolean);
  const ranked = items.filter((item) => item.entry.actionable).sort(compareChecks);
  const primary = ranked[0] || items.find((item) => item.check.status === "pass") || items[0] || null;
  const region = make("button", "xray-region " + classes, null, {
    type: "button",
    "data-xray-region": part,
    "data-part-id": part,
    "data-check-id": primary?.check.id || "",
    "data-check-ids": checkIds.join(","),
    "data-status": primary?.check.status || "not_applicable",
    "aria-pressed": String(Boolean(selectedCheckId && checkIds.includes(selectedCheckId))),
    "aria-label": label + ": " + (value || "not present") + (primary ? ". " + actionTitle(primary) : ""),
  });
  region.append(make("span", "xray-region-label", label));
  region.append(make("span", "xray-region-value" + (!value ? " is-missing" : ""), value || "Not present in the analysis."));
  if (primary) {
    region.append(severityBadge(primary.check.status === "pass" ? "pass" : primary.entry.impact));
    if (primary.entry.actionable) region.append(make("span", "xray-hover-note", primary.entry.title));
  }
  region.addEventListener("mouseenter", () => region.classList.add("is-hovered"));
  region.addEventListener("mouseleave", () => region.classList.remove("is-hovered"));
  region.addEventListener("focus", () => region.classList.add("is-hovered"));
  region.addEventListener("blur", () => region.classList.remove("is-hovered"));
  region.addEventListener("click", () => {
    selectedCheckId = primary?.check.id || null;
    for (const other of document.querySelectorAll(".xray-region")) other.classList.toggle("is-selected", other === region);
    fillXrayDetail($("#xray-finding-detail"), primary?.check.id, currentViewModel);
  });
  return region;
}

function buildXray(route, model) {
  const analysis = currentAnalysis;
  const main = make("main", "view xray-view", null, { "aria-labelledby": "page-title", dataset: { state: "xray", sample: route.sample } });
  const head = pageIntro("Page X-ray", "See the parts the analysis could assess, and where it found something to check.", analysis);
  const caption = make("p", "xray-caption", "A simplified drawing of your page, not an exact layout.");
  const canvas = make("section", "xray-canvas", null, { "aria-label": "Page structure drawing" });
  const browserBar = make("div", "xray-browser-bar");
  append(browserBar, make("span", "browser-dot"), make("span", "browser-dot"), make("span", "browser-dot"), make("span", "browser-label", "Page structure"));
  const pageFrame = make("div", "xray-page-frame");
  const titleRegion = buildXrayRegion("title", "Page title", analysis.metadata.title, model.partChecks.title || [], model, "xray-title-region");
  const descriptionRegion = buildXrayRegion("description", "Description", analysis.metadata.description, model.partChecks.description || [], model, "xray-description-region");
  const pageHeader = make("div", "xray-page-head");
  append(pageHeader, titleRegion, descriptionRegion);
  const pageBody = make("div", "xray-page-body");
  const headerSlot = make("div", "xray-unassessed", "Header area · not assessed", { "aria-label": "Header area not assessed; the analyzer does not return page landmark positions." });
  const h1Value = analysis.headings.h1.join(" · ");
  const h1Region = buildXrayRegion("h1", "Main heading · H1", h1Value, model.partChecks.h1 || [], model, "xray-h1-region");
  const headingsValue = [...analysis.headings.h2.map((value) => "H2 · " + value), ...analysis.headings.h3.map((value) => "H3 · " + value)].join("  /  ");
  const headingsRegion = buildXrayRegion("subheadings", "Subheadings", headingsValue, model.partChecks.subheadings || [], model, "xray-subheadings-region");
  const contentRegion = buildXrayRegion("content", "Page text", analysis.lexical_signals.visible_word_count + " visible words counted", model.partChecks.content || [], model, "xray-content-region");
  const contentLines = make("div", "xray-content-lines", null, { "aria-hidden": "true" });
  append(contentLines, make("i"), make("i"), make("i"), make("i"));
  const bodyMiddle = make("div", "xray-body-middle");
  append(bodyMiddle, headingsRegion, contentRegion, contentLines);
  append(pageBody, headerSlot, h1Region, bodyMiddle);
  if (analysis.images.total > 0) {
    const slots = make("div", "xray-image-slots");
    for (let index = 0; index < Math.min(analysis.images.total, 3); index += 1) slots.append(make("i", "xray-image-slot"));
    if (analysis.images.total > 3) slots.append(make("span", "xray-more-images", "+" + (analysis.images.total - 3)));
    append(pageBody, buildXrayRegion("images", "Images", analysis.images.total + " image" + (analysis.images.total === 1 ? "" : "s") + " observed", model.partChecks.images || [], model, "xray-images-region"), slots);
  }
  if (analysis.links.total > 0) {
    append(pageBody, buildXrayRegion("links", "Links", analysis.links.total + " link" + (analysis.links.total === 1 ? "" : "s") + " observed", model.partChecks.links || [], model, "xray-links-region"));
  }
  const footerSlot = make("div", "xray-unassessed", "Footer area · not assessed", { "aria-label": "Footer area not assessed; the analyzer does not return footer landmark positions." });
  append(pageBody, footerSlot);
  append(pageFrame, browserBar, pageHeader, pageBody);
  canvas.append(pageFrame);
  const metadata = buildHeadMetadata(model, analysis);
  const detail = make("section", "xray-finding-detail", null, { "aria-live": "polite", "aria-atomic": "true", "aria-label": "Selected page finding" });
  detail.id = "xray-finding-detail";
  if (selectedCheckId && itemFor(model, selectedCheckId)) fillXrayDetail(detail, selectedCheckId, model);
  else detail.append(make("p", "empty-note", "Select or focus a marked part to see its evidence and suggested next step."));
  append(main, head, caption, canvas, metadata, detail);
  return main;
}

function buildHeadMetadata(model, analysis) {
  const details = make("details", "head-metadata");
  details.append(make("summary", "", "Other page information"));
  const list = make("div", "head-metadata-list");
  const values = [
    ["Robots directive", analysis.metadata.robots_directives.join(", ") || analysis.fetch.x_robots_tag || "No directive returned", ["robots_directives"]],
    ["Canonical address", analysis.metadata.canonical || "No canonical value returned", ["canonical"]],
    ["Structured data", analysis.structured_data.block_count + " JSON-LD block" + (analysis.structured_data.block_count === 1 ? "" : "s") + " found", ["json_ld"]],
    ["Sharing information", "Open Graph " + presentSocialCount(analysis, "og_") + " of 4 · X " + presentSocialCount(analysis, "twitter_") + " of 4", ["open_graph", "twitter_metadata"]],
  ];
  for (const [label, value, ids] of values) {
    const item = make("div", "head-metadata-item");
    const action = ids.map((id) => itemFor(model, id)).find((found) => found?.entry.actionable);
    append(item, make("span", "head-metadata-label", label), make("span", "head-metadata-value", value));
    if (action) {
      const button = make("button", "text-button", action.entry.title, { type: "button", "data-check-id": action.check.id });
      button.addEventListener("click", () => { selectedCheckId = action.check.id; fillXrayDetail($("#xray-finding-detail"), action.check.id, model); });
      item.append(button);
    }
    list.append(item);
  }
  details.append(list);
  return details;
}

function presentSocialCount(analysis, prefix) {
  return Object.entries(analysis.social_metadata).filter(([key, value]) => key.startsWith(prefix) && Boolean(value)).length;
}

function fillXrayDetail(root, checkId, model) {
  if (!root) return;
  root.replaceChildren();
  const item = itemFor(model, checkId);
  if (!item) return;
  const check = item.check;
  const heading = make("h2", "xray-detail-title", item.entry.title);
  const reason = make("p", "finding-reason", item.entry.reason);
  const evidence = make("p", "finding-evidence", formatObservedEvidence(check), { dataset: { observed: "true" } });
  const action = make("p", "finding-action", item.entry.action);
  append(root, badgeForItem(item), effortChip(item.entry.effort), heading, reason, make("h3", "detail-label", "What we saw"), evidence, make("h3", "detail-label", "Next step"), action);
  if (item.entry.actionable) {
    root.append(internalAnchor("fix-list", currentSample, "Open this fix", "text-action", check.id));
  } else {
    root.append(make("p", "passed-note", "The engine marked this check as passed; the stored result is unchanged."));
  }
}

function pageIntro(title, description, analysis) {
  const head = make("header", "page-intro");
  const context = make("div", "page-context");
  append(context,
    make("span", "page-host", new URL(analysis.final_url).hostname),
    make("span", "page-url", analysis.final_url, { dataset: { observed: "true", role: "code" } }));
  append(head, make("h1", "page-heading", title, { id: "page-title" }), make("p", "page-subtitle", description), context);
  return head;
}

function onPageView(route, model) {
  const analysis = currentAnalysis;
  const main = make("main", "view specialist-view", null, { "aria-labelledby": "page-title", dataset: { state: "on-page", sample: route.sample, pagePrimaryContent: "true" } });
  const intro = pageIntro("On-page content", "Read the title, description, and headings found in the page.", analysis);
  const primary = make("section", "page-primary-content onpage-content", null, { "aria-label": "Page title, description, and headings" });
  const meta = make("article", "content-sheet", null, { "aria-labelledby": "title-section" });
  append(meta, make("h2", "content-heading", "Page title", { id: "title-section" }));
  meta.append(make("p", "observed-copy" + (analysis.metadata.title ? "" : " is-empty"), analysis.metadata.title || "No page title was found.", { dataset: { observed: "true" } }));
  addFindingSummary(meta, model, ["title"]);
  const description = make("article", "content-sheet", null, { "aria-labelledby": "description-section" });
  append(description, make("h2", "content-heading", "Description", { id: "description-section" }));
  description.append(make("p", "observed-copy" + (analysis.metadata.description ? "" : " is-empty"), analysis.metadata.description || "No description was found.", { dataset: { observed: "true" } }));
  addFindingSummary(description, model, ["meta_description"]);
  const headings = make("article", "content-sheet", null, { "aria-labelledby": "headings-section" });
  append(headings, make("h2", "content-heading", "Headings", { id: "headings-section" }));
  for (const level of ["h1", "h2", "h3"]) {
    for (const text of analysis.headings[level]) {
      const tagName = make("span", "tag-name", level.toUpperCase(), { dataset: { role: "code" } });
      const row = make("p", "heading-value");
      append(row, tagName, make("span", "", text, { dataset: { observed: "true" } }));
      headings.append(row);
    }
  }
  if (!analysis.headings.h1.length && !analysis.headings.h2.length && !analysis.headings.h3.length) headings.append(make("p", "is-empty", "No headings were found in the returned page."));
  addFindingSummary(headings, model, ["h1_structure", "heading_hierarchy"]);
  const content = make("article", "content-sheet", null, { "aria-labelledby": "content-section" });
  append(content, make("h2", "content-heading", "Visible text", { id: "content-section" }), make("p", "observed-copy", "About " + analysis.lexical_signals.visible_word_count + " words were counted.", { dataset: { observed: "true" } }));
  addFindingSummary(content, model, ["visible_text"]);
  append(primary, meta, description, headings, content);
  append(main, intro, primary);
  return main;
}

function addFindingSummary(parent, model, checkIds) {
  const entries = checkIds.map((id) => itemFor(model, id)).filter((item) => item?.entry.actionable);
  for (const item of entries) {
    const note = make("div", "inline-finding");
    append(note, badgeForItem(item), make("strong", "inline-finding-title", item.entry.title), make("p", "finding-reason", item.entry.reason));
    note.append(internalAnchor("fix-list", currentSample, "See the fix", "text-action", item.check.id));
    parent.append(note);
  }
}

function previewCard(title, label, titleValue, descriptionValue, imageValue = null, first = false, finalUrl = "") {
  const card = make("article", "preview-card" + (first ? " preview-first" : ""));
  append(card, make("h2", "preview-title", title), make("p", "preview-label", label));
  const surface = make("div", first ? "search-preview" : "social-preview");
  if (first) surface.append(make("p", "search-brand", new URL(finalUrl).hostname));
  surface.append(make("p", "preview-result-title" + (titleValue ? "" : " is-empty"), titleValue || "No title was found."));
  if (first) surface.append(make("p", "preview-result-url", finalUrl, { dataset: { observed: "true", role: "code" } }));
  surface.append(make("p", "preview-result-description" + (descriptionValue ? "" : " is-empty"), descriptionValue || "No description was found."));
  if (!first && imageValue) surface.append(make("p", "preview-image-value", "Image address: " + imageValue, { dataset: { observed: "true", role: "code" } }));
  if (!first && !imageValue) surface.append(make("p", "preview-image-missing", "No image address was returned."));
  append(card, surface, make("p", "preview-estimate", "The appearance is an estimate based on page metadata."));
  return card;
}

function previewsView(route) {
  const analysis = currentAnalysis;
  const main = make("main", "view specialist-view previews-view", null, { "aria-labelledby": "page-title", dataset: { state: "previews", sample: route.sample, pagePrimaryContent: "true" } });
  append(main, pageIntro("Search and social previews", "Compare the page details returned for common sharing formats.", analysis));
  const list = make("section", "page-primary-content preview-list", null, { "aria-label": "Metadata previews" });
  const social = analysis.social_metadata;
  list.append(previewCard("Search result", "Page title and description", analysis.metadata.title, analysis.metadata.description, null, true, analysis.final_url));
  list.append(previewCard("Facebook share", "Open Graph details", social.og_title, social.og_description, social.og_image));
  list.append(previewCard("X share", "X details with page metadata fallback", social.twitter_title || analysis.metadata.title, social.twitter_description || analysis.metadata.description, social.twitter_image));
  list.append(previewCard("LinkedIn share", "Open Graph details", social.og_title, social.og_description, social.og_image));
  main.append(list);
  const findings = make("section", "preview-findings", null, { "aria-labelledby": "preview-finding-heading" });
  findings.append(make("h2", "content-heading", "Related fixes", { id: "preview-finding-heading" }));
  addFindingSummary(findings, currentViewModel, ["meta_description", "open_graph", "twitter_metadata", "title"]);
  main.append(findings);
  return main;
}

function filterItems(model) {
  let items = activeFilter === "done" ? model.done : model.remaining;
  if (activeFilter === "blocking") items = items.filter((item) => item.entry.impact === "blocking");
  else if (activeFilter === "high") items = items.filter((item) => item.entry.impact === "high");
  else if (activeFilter === "quick") items = items.filter((item) => item.entry.effort === "quick");
  return items;
}

function groupFor(item) {
  if (item.entry.impact === "blocking" || item.entry.impact === "high") return "Do first";
  if (item.entry.impact === "medium") return "Next";
  return "Later";
}

function filterButton(key, label) {
  const button = make("button", "filter-chip" + (activeFilter === key ? " is-selected" : ""), label, {
    type: "button",
    "aria-pressed": String(activeFilter === key),
    dataset: { filter: key, ui: "true" },
  });
  button.addEventListener("click", () => {
    activeFilter = key;
    render();
    requestAnimationFrame(() => $('[data-filter="' + key + '"]')?.focus({ preventScroll: true }));
  });
  return button;
}

function fixRow(item, model) {
  const check = item.check;
  const open = expandedCheckIds.has(check.id);
  const row = make("article", "fix-row" + (open ? " is-expanded" : ""), null, {
    "aria-expanded": String(open),
    dataset: { checkId: check.id, group: groupFor(item) },
  });
  const head = make("div", "fix-row-head");
  const done = make("input", "done-check", null, {
    type: "checkbox",
    checked: Boolean(doneBySample[currentSample]?.[check.id]),
    "aria-label": "Mark as done here: " + item.entry.title,
    dataset: { doneId: check.id },
  });
  done.checked = Boolean(doneBySample[currentSample]?.[check.id]);
  done.addEventListener("click", (event) => event.stopPropagation());
  done.addEventListener("change", () => {
    doneBySample[currentSample] ||= Object.create(null);
    doneBySample[currentSample][check.id] = done.checked;
    const id = check.id;
    render();
    requestAnimationFrame(() => $('[data-done-id="' + CSS.escape(id) + '"]')?.focus({ preventScroll: true }));
  });
  const toggle = make("button", "fix-row-toggle", null, {
    type: "button",
    "aria-expanded": String(open),
    "aria-controls": "fix-detail-" + check.id,
    dataset: { fixToggle: check.id, ui: "true" },
  });
  const titleArea = make("span", "fix-row-primary");
  append(titleArea, make("span", "fix-row-title", item.entry.title), make("span", "fix-row-subtitle", item.entry.reason));
  const labels = make("span", "fix-row-labels");
  append(labels, badgeForItem(item), effortChip(item.entry.effort), make("span", "chevron", open ? "−" : "+", { "aria-hidden": "true" }));
  append(toggle, titleArea, labels);
  toggle.addEventListener("click", () => {
    if (expandedCheckIds.has(check.id)) expandedCheckIds.delete(check.id);
    else expandedCheckIds.add(check.id);
    render();
    requestAnimationFrame(() => $('[data-fix-toggle="' + CSS.escape(check.id) + '"]')?.focus({ preventScroll: true }));
  });
  append(head, done, toggle);
  row.append(head);
  if (open) {
    const detail = make("div", "fix-detail", null, { id: "fix-detail-" + check.id });
    append(detail, make("p", "fix-evidence", formatObservedEvidence(check), { dataset: { observed: "true" } }));
    append(detail, make("p", "fix-action", item.entry.action));
    const show = make("button", "ghost-action", "Show on page", { type: "button", dataset: { showOnPage: check.id } });
    show.addEventListener("click", () => navigate("xray", currentSample, check.id));
    detail.append(show);
    const snippet = snippetFor(item, currentAnalysis, currentNotes);
    if (snippet) {
      const template = make("div", "snippet-panel");
      const code = make("pre", "code-sample", snippet.value, { dataset: { role: "code" } });
      const note = make("p", "snippet-note", snippet.note);
      if (snippet.review) note.append(make("span", "template-warning", "Editable template, not your real copy."));
      const copy = make("button", "button-secondary copy-snippet", snippet.review ? "Copy editable template" : "Copy fix", {
        type: "button",
        dataset: { copySnippet: "true" },
      });
      copy.addEventListener("click", () => copyText(snippet.value, copy));
      append(template, code, note, copy, make("p", "copy-feedback", "", { "aria-live": "polite" }));
      detail.append(template);
    } else {
      detail.append(make("p", "review-required", item.entry.snippet_reason || "Review the page context before changing this item."));
    }
    row.append(detail);
  }
  return row;
}

async function copyText(value, button) {
  const parent = button.parentElement;
  const feedback = $(".copy-feedback", parent);
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(value);
    if (button.isConnected) feedback.textContent = "Copied.";
  } catch {
    if (button.isConnected) feedback.textContent = "Copy was not permitted. Select the code and copy it manually.";
  }
}

function fixListView(route, model) {
  const main = make("main", "view specialist-view fix-list-view", null, {
    "aria-labelledby": "page-title",
    dataset: {
      state: "fix-list",
      sample: route.sample,
      rawOpen: model.rawOpen,
      actionableTotal: model.actionable.length,
      remainingTotal: model.remaining.length,
      passedTotal: model.raw.pass,
      excludedTotal: model.excluded.length,
      notApplicableTotal: model.raw.not_applicable,
      rawTotal: model.raw.total,
      score: currentAnalysis.deterministic_score.overall_score,
    },
  });
  main.append(pageIntro("Fix list", "Open one item at a time to see why it matters and what you can safely change.", currentAnalysis));
  const status = make("p", "fix-count-reconciliation");
  status.textContent = countSummary(model);
  status.dataset.countSummary = "true";
  main.append(status);
  const filters = make("div", "filter-list", null, { role: "group", "aria-label": "Filter findings" });
  append(filters, filterButton("all", "All"), filterButton("blocking", "Blocking"), filterButton("high", "High"), filterButton("quick", "Quick wins"), filterButton("done", "Done"));
  main.append(filters);
  const items = filterItems(model);
  for (const groupName of ["Do first", "Next", "Later", "Done"]) {
    let groupItems;
    if (groupName === "Done") groupItems = model.done;
    else groupItems = items.filter((item) => groupFor(item) === groupName);
    if (activeFilter !== "all" && activeFilter !== "done" && groupName !== "Do first" && groupItems.length === 0) continue;
    if (!groupItems.length && groupName !== "Do first" && groupName !== "Done") continue;
    const group = make("section", "fix-group", null, { "aria-labelledby": "group-" + groupName.replaceAll(" ", "-") });
    const heading = make("h2", "fix-group-heading", groupName, { id: "group-" + groupName.replaceAll(" ", "-") });
    const list = make("div", "fix-group-list");
    for (const item of groupItems) list.append(fixRow(item, model));
    if (groupName === "Do first" && !groupItems.length && activeFilter !== "done") list.append(make("p", "empty-note", "No blocking or high-priority actions remain."));
    if (groupName === "Done") {
      for (const item of model.passChecks.slice(0, 5)) {
        const passed = make("div", "passed-row");
        append(passed, severityBadge("pass"), make("span", "passed-row-title", item.check.title), make("span", "passed-row-note", "Engine status: passed"));
        list.append(passed);
      }
    }
    group.append(heading, list);
    main.append(group);
  }
  if (activeFilter !== "all" && !items.length && activeFilter !== "done") main.append(make("p", "empty-note", "No findings match this filter."));
  if (model.excluded.length || model.notApplicable.length) {
    const excluded = make("details", "excluded-findings");
    excluded.append(make("summary", "", "Checks without a suggested action (" + (model.excluded.length + model.notApplicable.length) + ")"));
    const list = make("ul", "excluded-list");
    for (const item of [...model.excluded, ...model.notApplicable]) {
      const row = make("li", "excluded-item");
      append(row, make("strong", "", item.check.title), make("span", "", item.reason));
      list.append(row);
    }
    excluded.append(list);
    main.append(excluded);
  }
  main.append(make("p", "done-note", "Done marks are kept only in this open page session. They do not change the score or say the website was checked again."));
  return main;
}

function loadingView() {
  const main = make("main", "view loading-view", null, { "aria-labelledby": "page-title", dataset: { state: "loading" } });
  append(main, make("h1", "page-heading", "Building your report", { id: "page-title" }), make("p", "page-subtitle", "A short sequence shows the space reserved while a page is read."));
  const steps = make("ol", "loading-steps");
  const labels = ["Fetching the page", "Reading the HTML", "Running 23 checks", "Building your report"];
  labels.forEach((label, index) => {
    const item = make("li", "loading-step" + (index === 1 ? " is-active" : ""), label, { "aria-current": index === 1 ? "step" : null });
    steps.append(item);
  });
  const cancel = make("button", "text-button cancel-action", "Cancel", { type: "button", dataset: { cancel: "true" } });
  cancel.addEventListener("click", () => navigate("home"));
  append(main, steps, cancel);
  return main;
}

function errorView() {
  const main = make("main", "view error-view", null, { "aria-labelledby": "page-title", dataset: { state: "error" } });
  append(main,
    make("h1", "page-heading", "If a check cannot open a page", { id: "page-title" }),
    make("p", "page-subtitle", "Choose the message that best matches what happened, then return to a supported page."));
  const causes = [
    ["Can't reach the site", "The site did not respond to the request.", "Check the address or try again later."],
    ["The site blocked the check", "The destination may refuse automated page requests.", "Check whether the page is publicly reachable."],
    ["The page took too long", "The page did not finish responding within the allowed time.", "Try a lighter page or try again later."],
    ["That address isn't a web page", "The address may use an unsupported format or point to a non-page resource.", "Enter a complete HTTPS page address."],
  ];
  const list = make("div", "error-cause-list");
  for (const [title, explanation, next] of causes) {
    const cause = make("article", "error-cause");
    append(cause,
      make("h2", "", title),
      make("p", "error-explanation", explanation),
      make("p", "error-next", "Try this: " + next));
    const actions = make("div", "error-actions");
    const retry = make("button", "button-primary", "Try again", { type: "button", dataset: { tryAgain: "true" } });
    retry.addEventListener("click", () => navigate("home"));
    const back = make("button", "button-secondary", "Back", { type: "button", dataset: { errorBack: "true" } });
    back.addEventListener("click", () => {
      if (window.history.length > 1) window.history.back();
      else navigate("home");
    });
    append(actions, retry, back);
    cause.append(actions);
    list.append(cause);
  }
  main.append(list);
  return main;
}

function missingView() {
  const main = make("main", "view missing-view", null, { "aria-labelledby": "page-title", dataset: { state: "missing" } });
  append(main,
    make("h1", "page-heading", "No page analysis is open", { id: "page-title" }),
    make("p", "page-subtitle", "This address does not contain a saved report. Choose a supported example to open its analysis."),
    internalAnchor("home", null, "Choose an example", "button-link missing-report-recovery"));
  return main;
}

function homeView() {
  const main = make("main", "view home-view", null, { "aria-labelledby": "home-title", dataset: { state: "home" } });
  const content = make("section", "home-content");
  append(content,
    make("h1", "home-title display", "Check a web page for SEO problems.", { id: "home-title" }),
    make("p", "home-support", "Paste a page address. You get a list of fixes, most important first."));
  const form = make("form", "home-form", null, { id: "audit-form" });
  append(form,
    make("label", "form-label", "Page address", { for: "page-address" }),
    make("input", "address-input", null, { id: "page-address", name: "url", type: "url", inputmode: "url", autocomplete: "url", placeholder: "https://your-site.example/page", required: true, dataset: { role: "code" } }));
  const keywordButton = make("button", "text-button keyword-toggle", "Add a target keyword", { type: "button", "aria-expanded": "false", dataset: { keywordToggle: "true" } });
  const keywordArea = make("div", "keyword-area", null, { hidden: true });
  append(keywordArea,
    make("label", "form-label", "Target keyword", { for: "target-keyword" }),
    make("input", "address-input keyword-input", null, { id: "target-keyword", name: "keyword", type: "text", placeholder: "Optional phrase" }),
    make("p", "field-note", "Keyword checks are not included in this page analysis."));
  const submit = make("button", "button-primary check-page-button", "Check page", { type: "submit" });
  const notice = make("p", "form-message", "", { id: "home-message", role: "status", "aria-live": "polite" });
  append(form, keywordButton, keywordArea, submit, notice);
  keywordButton.addEventListener("click", () => {
    const open = keywordArea.hidden;
    keywordArea.hidden = !open;
    keywordButton.setAttribute("aria-expanded", String(open));
    if (open) $("#target-keyword").focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = $("#page-address").value.trim();
    let parsed;
    try { parsed = new URL(raw); } catch { notice.textContent = "Enter a complete page address."; return; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      notice.textContent = "Enter a public HTTPS page address without sign-in details.";
      return;
    }
    let sample = null;
    if (parsed.hostname === "northstar.example" && parsed.pathname === "/guides/home-solar/" && !parsed.search && !parsed.hash) sample = "northstar";
    if (parsed.hostname === "example.test" && parsed.pathname === "/weak" && !parsed.search && !parsed.hash) sample = "weak";
    if (parsed.hostname === "example.test" && parsed.pathname === "/basic" && !parsed.search && !parsed.hash) sample = "basic";
    if (sample) navigate("summary", sample);
    else navigate("error", null, null, "unavailable");
  });
  const examples = make("section", "example-section", null, { "aria-labelledby": "example-heading" });
  examples.append(make("h2", "", "Choose an example"));
  const examplesRow = make("div", "example-chips");
  examplesRow.append(internalAnchor("summary", "northstar", "Example: Northstar Solar", "example-chip"));
  examplesRow.append(internalAnchor("summary", "weak", "Example: a weak page", "example-chip"));
  examples.append(examplesRow);
  append(content, form, examples, make("p", "trust-line", "We read the page's public HTML only. No sign-up."));
  main.append(content);
  return main;
}

function pageView(route, model) {
  if (route.state === "summary") return summaryView(route, model);
  if (route.state === "fix-list") return fixListView(route, model);
  if (route.state === "xray") return buildXray(route, model);
  if (route.state === "on-page") return onPageView(route, model);
  if (route.state === "previews") return previewsView(route);
  return missingView();
}

function bindNavigation(root = document) {
  for (const link of root.querySelectorAll("a[data-nav-link]")) {
    if (link.dataset.bound) continue;
    link.dataset.bound = "true";
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = new URL(link.href);
      const query = new URLSearchParams(target.search);
      navigate(query.get("state") || "home", query.get("sample"), query.get("check"), query.get("reason"));
    });
  }
  for (const button of root.querySelectorAll("[data-open-more]")) {
    button.addEventListener("click", () => {
      const dialog = $(".more-sheet");
      if (!dialog) return;
      moreOpener = button;
      dialog.showModal();
      $(".more-page-list a, .more-page-list button:not(:disabled)", dialog)?.focus();
    });
  }
}

function reportLoadingShell(route) {
  const content = loadingView();
  const frame = buildShell(route, null, content);
  frame.dataset.loading = "true";
  bindNavigation();
  const cancel = $("[data-cancel]", frame);
  cancel?.addEventListener("click", () => navigate("home"));
}

async function render() {
  const generation = ++renderGeneration;
  const route = readRoute();
  currentSample = route.sample;
  currentAnalysis = null;
  currentEnrichment = null;
  currentNotes = null;
  currentViewModel = null;
  selectedCheckId = route.checkId;
  app.replaceChildren();
  if (route.state === "home") {
    buildShell(route, null, homeView());
    bindNavigation();
    return;
  }
  if (route.state === "loading") {
    buildShell(route, null, loadingView());
    bindNavigation();
    return;
  }
  if (route.state === "error") {
    buildShell(route, null, errorView());
    bindNavigation();
    return;
  }
  if (!REPORT_STATES.has(route.state) || !route.sample) {
    buildShell(route, null, missingView());
    bindNavigation();
    return;
  }
  reportLoadingShell(route);
  try {
    const loaded = await loadData(route.sample);
    if (generation !== renderGeneration) return;
    currentAnalysis = loaded.analysis;
    currentEnrichment = loaded.enrichment;
    currentNotes = loaded.notes;
    currentViewModel = buildViewModel(loaded.analysis, loaded.enrichment, route.sample);
    if (selectedCheckId && !itemFor(currentViewModel, selectedCheckId)) selectedCheckId = null;
    const content = pageView(route, currentViewModel);
    buildShell(route, currentViewModel, content);
    bindNavigation();
    if (route.state === "xray" && selectedCheckId) requestAnimationFrame(() => {
      const region = document.querySelector('.xray-region[data-check-ids*="' + CSS.escape(selectedCheckId) + '"]');
      if (region) {
        region.classList.add("is-selected");
        region.scrollIntoView({ block: "nearest" });
        region.focus({ preventScroll: true });
      }
    });
  } catch {
    if (generation !== renderGeneration) return;
    buildShell(route, null, missingView());
    bindNavigation();
  }
}

window.addEventListener("popstate", () => render());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $(".more-sheet[open]")) $(".more-sheet[open]").close();
});
render();
