const STATES = new Set(["home", "summary", "on-page", "previews", "fix-list", "loading", "error"]);
const REPORT_STATES = new Set(["summary", "on-page", "previews", "fix-list"]);
const SAMPLE_FILES = {
  weak: "audit-weak.json",
  basic: "audit-basic.json",
  noindex: "audit-noindex-test.json",
};
const IMPACT_ORDER = { blocking: 0, high: 1, medium: 2, low: 3 };
const EFFORT_ORDER = { quick: 0, moderate: 1, heavy: 2 };
const CATEGORY_LABELS = {
  technical_indexability: "Technical / indexability",
  metadata: "Metadata",
  headings_content_structure: "Headings / content",
  links: "Links",
  images: "Images",
  structured_data: "Structured data",
  social_metadata: "Social metadata",
  html_signals: "HTML signals",
};
const PARTS = [
  { id: "document", label: "Document", checkIds: ["retrieval_success", "http_status", "https", "content_type", "redirects", "fetch_duration", "html_lang", "viewport", "charset"] },
  { id: "robots", label: "Robots", checkIds: ["robots_directives"] },
  { id: "title", label: "Title", checkIds: ["title"] },
  { id: "description", label: "Description", checkIds: ["meta_description"] },
  { id: "canonical", label: "Canonical", checkIds: ["canonical"] },
  { id: "h1", label: "H1", checkIds: ["h1_structure"] },
  { id: "headings", label: "Headings", checkIds: ["heading_hierarchy"] },
  { id: "body", label: "Visible text", checkIds: ["visible_text"] },
  { id: "links", label: "Links", checkIds: ["internal_links", "anchor_text", "link_relationships"] },
  { id: "images", label: "Images", checkIds: ["image_alt"] },
  { id: "structured_data", label: "JSON-LD", checkIds: ["json_ld"] },
  { id: "social_metadata", label: "Social metadata", checkIds: ["open_graph", "twitter_metadata"] },
];
const $ = (selector, root = document) => root.querySelector(selector);
const app = $("#app");
let currentAnalysis = null;
let currentEnrichment = null;
let currentSourceNotes = null;
let currentSample = null;
let selectedCheckId = null;
let renderGeneration = 0;

function make(tag, className = "", text = null, attrs = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null && text !== undefined) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (name === "dataset") {
      for (const [key, dataValue] of Object.entries(value)) element.dataset[key] = String(dataValue);
    } else if (name === "class") {
      element.className = String(value);
    } else if (name in element && !["role", "aria-label", "aria-live", "aria-current", "aria-pressed", "aria-expanded", "aria-controls", "data-state", "data-sample", "data-check-id", "data-part-id", "data-status", "data-impact", "data-observed", "data-ui", "tabindex", "type", "href", "name", "value", "placeholder", "autocomplete", "inputmode", "required", "for", "id", "title", "rel"].includes(name)) {
      element[name] = value;
    } else {
      element.setAttribute(name, String(value));
    }
  }
  return element;
}

function append(parent, ...children) {
  for (const child of children) if (child) parent.append(child);
  return parent;
}

function textNode(parent, text, className = "") {
  return parent.appendChild(make("span", className, text));
}

function readRoute() {
  const query = new URLSearchParams(window.location.search);
  const requestedState = query.get("state") || "home";
  return {
    state: STATES.has(requestedState) ? requestedState : "error",
    requestedState,
    sample: query.get("sample"),
    reason: query.get("reason"),
    checkId: query.get("check"),
    contextUrl: window.history.state?.contextUrl || "",
  };
}

function routeUrl(state, sample = null, extras = {}) {
  const query = new URLSearchParams();
  query.set("state", state);
  if (sample) query.set("sample", sample);
  for (const [key, value] of Object.entries(extras)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, value);
  }
  return `?${query.toString()}`;
}

function navigate(state, sample = null, { reason = null, checkId = null, contextUrl = "" } = {}) {
  const extras = { reason, check: checkId };
  window.history.pushState({ contextUrl }, "", routeUrl(state, sample, extras));
  render();
}

function internalLink(state, sample, label, active = false, extras = {}) {
  const link = make("a", "", label, {
    href: routeUrl(state, sample, extras),
    "data-nav": "true",
    "aria-current": active ? "page" : null,
    dataset: { ui: "true" },
  });
  return link;
}

function buildMasthead(route) {
  const header = make("header", "masthead");
  const brand = make("a", "wordmark", null, { href: routeUrl("home"), "data-nav": "true", dataset: { ui: "true" }, "aria-label": "SEO Sensei home" });
  append(brand, make("span", "wordmark-mark", "S", { "aria-hidden": "true" }), make("span", "", "SEO SENSEI", { dataset: { ui: "true" } }));
  header.append(brand);
  if (REPORT_STATES.has(route.state)) {
    const nav = make("nav", "primary-nav", null, { "aria-label": "Report views" });
    append(nav,
      internalLink("summary", route.sample, "Summary", route.state === "summary"),
      internalLink("on-page", route.sample, "On-page", route.state === "on-page"),
      internalLink("previews", route.sample, "Previews", route.state === "previews"),
      internalLink("fix-list", route.sample, "Fix list", route.state === "fix-list"));
    header.append(nav);
    header.append(internalLink("home", null, "START", false));
  } else {
    header.append(make("div", "masthead-meta", null, { dataset: { ui: "true" } }).appendChild(make("span", "offline-tag", "Offline design proof · no live analysis", { dataset: { ui: "true" } })).parentElement);
  }
  return header;
}

function buildFooter() {
  const footer = make("footer", "site-footer");
  footer.append(make("p", "", "SEO Sensei · static design proof", { dataset: { ui: "true" } }));
  footer.append(make("p", "", "No remote request · no page changes", { dataset: { ui: "true" } }));
  return footer;
}

function buildShell(route) {
  const shell = make("div", "site-shell", null, { dataset: { state: route.state, sample: route.sample || "" } });
  shell.append(buildMasthead(route));
  return shell;
}

function normalizeSample(sample) {
  return Object.hasOwn(SAMPLE_FILES, sample || "") ? sample : null;
}

function validateAnalysis(data) {
  const statuses = new Set(["pass", "warning", "fail", "not_applicable"]);
  const categories = new Set(Object.keys(CATEGORY_LABELS));
  if (!data || typeof data !== "object" || typeof data.requested_url !== "string" || typeof data.final_url !== "string") throw new Error("invalid analysis identity");
  if (!data.fetch || typeof data.fetch !== "object" || !data.deterministic_score || typeof data.deterministic_score.overall_score !== "number" || typeof data.deterministic_score.version !== "string") throw new Error("invalid fetch or score");
  if (!Array.isArray(data.deterministic_score.categories) || !Array.isArray(data.checks)) throw new Error("invalid check collection");
  if (!data.metadata || !data.headings || !data.images || !data.links || !data.structured_data || !data.social_metadata || !data.lexical_signals) throw new Error("missing analysis section");
  const ids = new Set();
  for (const check of data.checks) {
    if (!check || typeof check.id !== "string" || ids.has(check.id) || !categories.has(check.category) || !statuses.has(check.status)) throw new Error("invalid check contract");
    if (typeof check.title !== "string" || typeof check.recommendation !== "string" || typeof check.evidence?.observed !== "string") throw new Error("invalid check evidence");
    ids.add(check.id);
  }
  for (const category of data.deterministic_score.categories) {
    if (!categories.has(category.category) || typeof category.weight !== "number" || typeof category.points_earned !== "number") throw new Error("invalid category contract");
  }
  if (typeof data.metadata.title !== "string" || typeof data.metadata.description !== "string" || !Array.isArray(data.headings.h1) || !Array.isArray(data.headings.h2) || !Array.isArray(data.headings.h3)) throw new Error("invalid page metadata");
  if (!Number.isInteger(data.lexical_signals.visible_word_count) || !Number.isInteger(data.images.total) || !Number.isInteger(data.links.total)) throw new Error("invalid observed counts");
  return data;
}

async function loadData(sample) {
  const actualSample = normalizeSample(sample);
  if (!actualSample) throw new Error("unknown analysis selection");
  const [analysisResponse, enrichmentResponse, notesResponse] = await Promise.all([
    fetch(SAMPLE_FILES[actualSample], { cache: "no-store" }),
    fetch("enrichment.json", { cache: "no-store" }),
    fetch("offline-source-notes.json", { cache: "no-store" }),
  ]);
  if (!analysisResponse.ok || !enrichmentResponse.ok || !notesResponse.ok) throw new Error("local analysis assets unavailable");
  const [analysis, enrichment, notes] = await Promise.all([analysisResponse.json(), enrichmentResponse.json(), notesResponse.json()]);
  const validated = validateAnalysis(analysis);
  const notesSample = actualSample === "noindex" ? "weak" : actualSample;
  if (!enrichment?.checks || !notes?.samples?.[notesSample]) throw new Error("local presentation data unavailable");
  for (const check of validated.checks) if (!enrichment.checks[check.id]) throw new Error("check presentation mapping unavailable");
  return { analysis: validated, enrichment, notes: notes.samples[notesSample] };
}

function checkById(analysis, id) { return analysis.checks.find((check) => check.id === id) || null; }

function readRulePath(context, path) {
  return path.split(".").reduce((value, key) => value?.[key], context);
}

function conditionMatches(condition, context) {
  if (Array.isArray(condition.all)) return condition.all.every((item) => conditionMatches(item, context));
  if (Array.isArray(condition.any)) return condition.any.some((item) => conditionMatches(item, context));
  const actual = readRulePath(context, condition.path);
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "in": return Array.isArray(condition.value) && condition.value.includes(actual);
    case "greater_than": return typeof actual === "number" && actual > condition.value;
    case "contains_ci": {
      const values = Array.isArray(actual) ? actual : [actual];
      return values.some((value) => String(value ?? "").toLowerCase().includes(String(condition.value).toLowerCase()));
    }
    case "empty": return actual === null || actual === undefined || actual === "";
    default: return false;
  }
}

function ruleApplies(rule, context) {
  return Boolean(rule?.when) && conditionMatches(rule.when, context);
}

function enriched(check, analysis, enrichment) {
  const entry = enrichment.checks[check.id];
  const context = { analysis, check };
  let impact = entry.impact;
  for (const rule of entry.impact_rules || []) {
    if (ruleApplies(rule, context)) { impact = rule.impact; break; }
  }
  const ignored = (entry.ignore_when || []).some((rule) => ruleApplies(rule, context));
  return { ...entry, impact, actionable: entry.actionable_statuses.includes(check.status) && !ignored };
}

function prioritizedChecks(analysis, enrichment) {
  return analysis.checks
    .map((check, sourceOrder) => ({ check, sourceOrder, entry: enriched(check, analysis, enrichment) }))
    .filter(({ entry }) => entry.actionable)
    .sort((a, b) => IMPACT_ORDER[a.entry.impact] - IMPACT_ORDER[b.entry.impact]
      || EFFORT_ORDER[a.entry.effort] - EFFORT_ORDER[b.entry.effort]
      || a.sourceOrder - b.sourceOrder);
}

function counts(analysis) {
  return analysis.checks.reduce((result, check) => { result[check.status] = (result[check.status] || 0) + 1; return result; }, {});
}

function pageHost(value) {
  try { return new URL(value).hostname; } catch { return value; }
}

function pagePath(value) {
  try { return `${new URL(value).pathname}${new URL(value).search}` || "/"; } catch { return value; }
}

function scoreHelpPanel() {
  const help = make("details", "score-help", null, { id: "score-help", dataset: { scoreCaveat: "true" } });
  append(help,
    make("summary", "", "How to read the score", { dataset: { ui: "true", scoreHelpTrigger: "true" } }),
    make("p", "", "This deterministic v1.0 heuristic describes returned HTML and fetch signals. It does not predict rankings, measure traffic, or confirm index state.", { dataset: { ui: "true", summaryCopy: "true" } }));
  return help;
}

function makeAnatomyEntry(analysis) {
  const button = make("button", "anatomy-entry", null, {
    type: "button",
    "aria-label": "Open the schematic page X-ray",
    dataset: { ui: "true", anatomyEntry: "true" },
  });
  const preview = make("span", "entry-specimen", null, { "aria-hidden": "true" });
  append(preview,
    make("i", "entry-header"),
    make("i", `entry-h1${analysis.headings.h1.length ? " is-observed" : " is-missing"}`),
    make("i", "entry-copy"),
    analysis.images.total > 0 ? make("i", "entry-image") : null,
    make("i", "entry-footer"));
  append(button, preview, make("span", "entry-label", "Open page X-ray", { dataset: { ui: "true" } }), make("span", "entry-count", `${analysis.checks.length} signals`, { dataset: { ui: "true" } }));
  button.addEventListener("click", () => {
    const heading = $("#anatomy-heading");
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  });
  return button;
}

function reportHead(route, analysis, enrichment) {
  const head = make("section", "report-head", null, { "aria-labelledby": "report-title" });
  const reportKicker = make("div", "report-kicker");
  append(reportKicker,
    make("p", "eyebrow", "Page inspection", { dataset: { ui: "true" } }),
    make("span", "small-label", "·", { "aria-hidden": "true" }),
    make("span", "small-label", route.sample === "noindex" ? "Test condition · X-Robots-Tag" : "Local analysis output", { dataset: { ui: "true" } }));
  const identity = make("div", "report-identity");
  const titleBox = make("div", "report-title");
  const title = make("h1", "", pageHost(analysis.final_url), { id: "report-title", dataset: { observed: "true" } });
  const url = make("p", "report-url data-observed", analysis.final_url, { dataset: { observed: "true" } });
  append(titleBox, title, url);
  const scoreBox = make("div", "report-score");
  const scoreValue = make("span", "score-value", "0", { "data-score-target": analysis.deterministic_score.overall_score, "aria-label": `${analysis.deterministic_score.overall_score} out of 100`, "aria-live": "off" });
  append(scoreBox, scoreValue, make("span", "score-caption", `HEURISTIC · v${analysis.deterministic_score.version}`, { dataset: { ui: "true" } }));
  scoreBox.append(scoreHelpPanel());
  append(identity, titleBox, scoreBox);
  const scores = counts(analysis);
  const failed = scores.fail || 0;
  const warnings = scores.warning || 0;
  const blockingItem = prioritizedChecks(analysis, enrichment).find((item) => item.entry.impact === "blocking");
  const verdict = make("p", "verdict-line", blockingItem ? "Blocking observation" : failed ? `${failed} checks failed` : warnings ? `${warnings} checks need review` : "No open checks need review", { id: "report-verdict" });
  const sub = make("p", "verdict-sub", `${failed} failed · ${warnings} warnings · ${analysis.checks.length} checks returned`, { dataset: { ui: "true", summaryCopy: "true" } });
  append(head, reportKicker, identity, verdict, sub);
  if (blockingItem) {
    const banner = make("div", "blocking-banner", null, { role: "status", "aria-live": "polite" });
    const content = make("div");
    append(content,
      make("strong", "", blockingItem.entry.finding, { dataset: { ui: "true" } }),
      make("p", "data-observed", blockingItem.check.evidence.observed, { dataset: { observed: "true" } }),
      make("p", "", blockingItem.entry.action, { dataset: { ui: "true", summaryCopy: "true" } }));
    banner.append(content);
    head.append(banner);
  }
  head.append(makeAnatomyEntry(analysis));
  return head;
}

function partValue(partId, analysis, sourceNotes) {
  switch (partId) {
    case "document": return `${analysis.fetch.status_code} · ${analysis.fetch.content_type || "content type not returned"} · ${analysis.fetch.redirect_count} redirects`;
    case "title": return analysis.metadata.title || "No title value returned";
    case "description": return analysis.metadata.description || "No description value returned";
    case "canonical": return analysis.metadata.canonical || "No canonical URL returned";
    case "h1": return analysis.headings.h1.length ? analysis.headings.h1.join(" · ") : "No H1 values returned";
    case "headings": {
      const labels = [];
      for (const level of ["h2", "h3"]) for (const value of analysis.headings[level]) labels.push(`${level.toUpperCase()} ${value}`);
      return labels.length ? labels.join(" · ") : "No H2 or H3 values returned";
    }
    case "body": return `Approx. ${analysis.lexical_signals.visible_word_count} visible words`;
    case "links": return `${analysis.links.total} links · ${analysis.links.empty_anchors} empty labels`;
    case "images": {
      const noteImage = sourceNotes?.images?.find((image) => !image.has_alt_attribute);
      return `${analysis.images.total} image(s) · ${analysis.images.with_alt}/${analysis.images.total} with non-empty alt${noteImage?.src ? ` · ${noteImage.src}` : ""}`;
    }
    case "structured_data": return `${analysis.structured_data.block_count} JSON-LD block(s) · ${analysis.structured_data.valid_blocks} valid · ${analysis.structured_data.malformed_blocks} malformed`;
    case "social_metadata": return `Open Graph ${socialCount(analysis, "og_")}/4 · X ${socialCount(analysis, "twitter_")}/4`;
    default: return "No value returned";
  }
}

function socialCount(analysis, prefix) {
  return Object.entries(analysis.social_metadata).filter(([key, value]) => key.startsWith(prefix) && Boolean(value)).length;
}

function partStatus(part, analysis) {
  const checkList = part.checkIds.map((id) => checkById(analysis, id)).filter(Boolean);
  if (!checkList.length) return "not_applicable";
  if (checkList.some((check) => check.status === "fail")) return "fail";
  if (checkList.some((check) => check.status === "warning")) return "warning";
  if (checkList.every((check) => check.status === "not_applicable")) return "not_applicable";
  return "pass";
}

function statusWord(status) {
  return ({ fail: "Needs attention", warning: "Review", pass: "Clear", not_applicable: "Not checked" })[status] || "Review";
}

function makeAnatomy(route, analysis, enrichment, sourceNotes, compact = false) {
  const headingId = compact ? "anatomy-heading-compact" : "anatomy-heading";
  const section = make("section", compact ? "anatomy-section anatomy-compact" : "anatomy-section", null, { "aria-labelledby": headingId, id: compact ? "anatomy-compact" : "anatomy-summary" });
  const heading = make("div", "section-heading");
  append(heading,
    make("h2", "", "Page X-ray", { id: headingId, tabindex: "-1", dataset: { ui: "true" } }),
    make("span", "small-label", "Schematic · not DOM geometry", { dataset: { ui: "true" } }));

  const onPart = (parent, partId, checkId, label, value, status, { missing = false, classes = "", checkIds = null } = {}) => {
    const part = PARTS.find((item) => item.id === partId);
    const partCheckIds = checkIds || part?.checkIds || [checkId];
    const openChecks = partCheckIds.map((id) => checkById(analysis, id)).filter((check) => check && (check.status === "fail" || check.status === "warning"));
    const rankedForPart = prioritizedChecks(analysis, enrichment).filter((item) => partCheckIds.includes(item.check.id));
    const primaryCheckId = rankedForPart[0]?.check.id || checkId;
    const region = make("div", "scan-region");
    const button = make("button", `scan-part ${classes}`.trim(), null, {
      type: "button",
      "data-part-id": partId,
      "data-check-id": primaryCheckId,
      "data-check-ids": partCheckIds.join(","),
      "data-status": status,
      "aria-pressed": String(partCheckIds.includes(selectedCheckId)),
      "aria-label": `${label}: ${value}. ${statusWord(status)}. Open observed evidence.`,
      dataset: { ui: "true" },
    });
    const mark = make("span", "scan-mark");
    mark.append(make("i", "status-dot", null, { "aria-hidden": "true" }));
    mark.append(make("span", "status-word", statusWord(status), { dataset: { ui: "true" } }));
    append(button,
      make("span", "part-tag", label, { dataset: { ui: "true" } }),
      make("span", `part-value${missing ? " is-missing" : ""} data-observed`, value, { dataset: { observed: "true" } }),
      mark);
    button.addEventListener("click", () => selectFinding(primaryCheckId, { focusDetail: true, detailRoot: section }));
    region.append(button);
    if (openChecks.length > 1) {
      const related = make("details", "region-related");
      const summary = make("summary", "", `${openChecks.length} related observations`, { dataset: { ui: "true" } });
      const list = make("div", "region-links", null, { role: "group", "aria-label": `${label} observations` });
      const rankedIds = rankedForPart.map((item) => item.check.id);
      const orderedChecks = [...openChecks].sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
      for (const relatedCheck of orderedChecks) {
        const relatedEntry = enriched(relatedCheck, analysis, enrichment);
        const relatedButton = make("button", "", `${relatedEntry.finding} · ${statusWord(relatedCheck.status)}`, { type: "button", "data-related-check": relatedCheck.id, dataset: { ui: "true" } });
        relatedButton.addEventListener("click", () => selectFinding(relatedCheck.id, { focusDetail: true, detailRoot: section }));
        list.append(relatedButton);
      }
      append(related, summary, list);
      region.append(related);
    }
    parent.append(region);
  };

  const passiveSignal = (parent, partId, checkIds, label, value, status, note) => {
    const signal = make("p", "metadata-observation", null, { "data-part-id": partId, "data-check-ids": checkIds.join(","), "data-status": status });
    append(signal,
      make("span", "part-tag", label, { dataset: { ui: "true" } }),
      make("span", "metadata-value data-observed", value, { dataset: { observed: "true" } }),
      make("span", "metadata-note", note, { dataset: { ui: "true" } }));
    parent.append(signal);
  };

  const map = make("div", "anatomy-map");
  const specimen = make("div", "page-xray", null, { role: "group", "aria-label": "Schematic page structure", dataset: { xray: "true" } });
  const chrome = make("div", "xray-browser-bar", null, { "aria-hidden": "true" });
  append(chrome, make("i", ""), make("i", ""), make("i", ""), make("span", "", "PAGE SPECIMEN"));
  const headZone = make("section", "xray-head-zone", null, { "aria-label": "Observed page title and description metadata" });
  append(headZone, make("p", "xray-zone-label", "HEAD · METADATA", { dataset: { ui: "true" } }));
  const headSignals = make("div", "xray-head-signals");
  const titleCheck = checkById(analysis, "title");
  const descriptionCheck = checkById(analysis, "meta_description");
  onPart(headSignals, "title", titleCheck.id, "Page title", analysis.metadata.title || "No title value returned", titleCheck.status, { missing: !analysis.metadata.title });
  onPart(headSignals, "description", descriptionCheck.id, "Description", analysis.metadata.description || "No description value returned", descriptionCheck.status, { missing: !analysis.metadata.description });
  headZone.append(headSignals);

  const documentBody = make("div", "xray-document-body");
  const siteHeader = make("div", "xray-site-header", null, { "aria-label": "Header position not assessed; the analyzer does not return header landmarks", dataset: { assessment: "unassessed" } });
  append(siteHeader,
    make("span", "xray-unassessed-label", "Header · not returned", { dataset: { ui: "true" } }),
    make("i", "xray-header-mark", null, { "aria-hidden": "true" }));
  documentBody.append(siteHeader);

  const h1Check = checkById(analysis, "h1_structure");
  onPart(documentBody, "h1", h1Check.id, "Primary heading · H1", analysis.headings.h1.join(" · ") || "No H1 returned", h1Check.status, { missing: analysis.headings.h1.length === 0, classes: "xray-block xray-h1" });
  const contentRegion = make("section", "xray-content-region", null, { "aria-label": "Observed heading and text structure" });
  const headingCheck = checkById(analysis, "heading_hierarchy");
  onPart(contentRegion, "headings", headingCheck.id, "Subheadings · H2 / H3", partValue("headings", analysis, sourceNotes), headingCheck.status, { missing: !analysis.headings.h2.length && !analysis.headings.h3.length, classes: "xray-block xray-subheadings" });
  const textCheck = checkById(analysis, "visible_text");
  onPart(contentRegion, "body", textCheck.id, "Text area", `${analysis.lexical_signals.visible_word_count} visible words · copy not returned`, textCheck.status, { classes: "xray-block xray-body-copy" });
  const abstractText = make("span", "xray-text-lines", null, { "aria-hidden": "true" });
  append(abstractText, make("i", ""), make("i", ""), make("i", ""));
  contentRegion.append(abstractText);
  documentBody.append(contentRegion);

  if (analysis.images.total > 0) {
    const imageCheck = checkById(analysis, "image_alt");
    const imageGroup = make("div", "xray-image-group");
    onPart(imageGroup, "images", imageCheck.id, "Image area", `${analysis.images.total} image(s) observed · aggregate count`, imageCheck.status, { classes: "xray-block xray-images" });
    const slots = make("div", "xray-image-slots", null, { "aria-hidden": "true" });
    for (let index = 0; index < Math.min(analysis.images.total, 3); index += 1) slots.append(make("i", "xray-image-slot"));
    if (analysis.images.total > 3) slots.append(make("span", "xray-more-images", `+${analysis.images.total - 3}`));
    imageGroup.append(slots);
    documentBody.append(imageGroup);
  }

  if (analysis.links.total > 0) {
    const linksCheckIds = PARTS.find((part) => part.id === "links").checkIds;
    const linksStatus = partStatus(PARTS.find((part) => part.id === "links"), analysis);
    onPart(documentBody, "links", "anchor_text", "Link area", `${analysis.links.total} link(s) observed · individual labels not returned`, linksStatus, { classes: "xray-block xray-links", checkIds: linksCheckIds });
  }
  const footerZone = make("div", "xray-footer", null, { dataset: { assessment: "unassessed" }, "aria-label": "Footer position not assessed; the analyzer does not return footer landmarks" });
  append(footerZone, make("span", "xray-unassessed-label", "Footer position · not assessed", { dataset: { ui: "true" } }), make("i", "xray-footer-mark", null, { "aria-hidden": "true" }));
  documentBody.append(footerZone);
  append(specimen, chrome, headZone, documentBody);

  const signals = make("aside", "metadata-inspection", null, { "aria-label": "Head and response metadata signals" });
  append(signals,
    make("p", "xray-zone-label", "HEAD + RESPONSE SIGNALS", { dataset: { ui: "true" } }));
  const fetchPart = PARTS.find((part) => part.id === "document");
  onPart(signals, "document", "https", "Response", partValue("document", analysis, sourceNotes), partStatus(fetchPart, analysis), { classes: "metadata-signal" });
  const robotsCheck = checkById(analysis, "robots_directives");
  const directiveValues = [...(analysis.metadata.robots_directives || []), analysis.fetch.x_robots_tag || ""].filter(Boolean);
  onPart(signals, "robots", robotsCheck.id, "Robots directive", directiveValues.join(" · ") || "No directive returned", robotsCheck.status, { missing: directiveValues.length === 0, classes: "metadata-signal" });
  const canonicalCheck = checkById(analysis, "canonical");
  onPart(signals, "canonical", canonicalCheck.id, "Canonical", analysis.metadata.canonical || "No canonical value returned", canonicalCheck.status, { missing: !analysis.metadata.canonical, classes: "metadata-signal" });

  const schemaCheck = checkById(analysis, "json_ld");
  if (analysis.structured_data.block_count === 0 && analysis.structured_data.malformed_blocks === 0) {
    passiveSignal(signals, "structured_data", [schemaCheck.id], "Structured data", "No JSON-LD block returned", schemaCheck.status, "Optional · no addition suggested");
  } else {
    onPart(signals, "structured_data", schemaCheck.id, "Structured data", partValue("structured_data", analysis, sourceNotes), schemaCheck.status, { classes: "metadata-signal" });
  }

  const socialPart = PARTS.find((part) => part.id === "social_metadata");
  const socialCheckIds = socialPart.checkIds;
  const socialValuesPresent = Object.entries(analysis.social_metadata).some(([key, value]) => (key.startsWith("og_") || key.startsWith("twitter_")) && Boolean(value));
  if (!socialValuesPresent) {
    passiveSignal(signals, "social_metadata", socialCheckIds, "Sharing metadata", partValue("social_metadata", analysis, sourceNotes), partStatus(socialPart, analysis), "No share fields returned · optional");
  } else {
    const socialCheck = checkById(analysis, "open_graph") || checkById(analysis, "twitter_metadata");
    onPart(signals, "social_metadata", socialCheck.id, "Sharing metadata", partValue("social_metadata", analysis, sourceNotes), partStatus(socialPart, analysis), { classes: "metadata-signal", checkIds: socialCheckIds });
  }

  const linkChecks = PARTS.find((part) => part.id === "links");
  if (analysis.links.total === 0) passiveSignal(signals, "links", linkChecks.checkIds, "Link signals", "No links observed", partStatus(linkChecks, analysis), "No body link area is drawn");
  const imageCheck = checkById(analysis, "image_alt");
  if (analysis.images.total === 0) passiveSignal(signals, "images", [imageCheck.id], "Image signal", "No image elements returned", imageCheck.status, "No image area is drawn");

  const frame = make("div", "anatomy-frame");
  append(map, specimen, signals);
  frame.append(map);
  const detail = make("div", "inspection-detail", null, { "aria-live": "polite", "aria-atomic": "true", id: compact ? "inspection-detail-compact" : "inspection-detail" });
  if (selectedCheckId && checkById(analysis, selectedCheckId)) fillInspectionDetail(detail, selectedCheckId, analysis, enrichment, sourceNotes);
  else detail.append(make("p", "", "Select a marked observation to inspect its returned evidence.", { dataset: { ui: "true" } }));
  const footnote = make("p", "anatomy-footnote", "Schematic grouping from returned fields; element positions, header landmarks and footer content were not returned.", { dataset: { ui: "true" } });
  append(section, heading, frame, footnote, detail);
  return section;
}

function matchingPart(checkId) {
  return PARTS.find((part) => part.checkIds.includes(checkId)) || PARTS[0];
}

function snippetFor(check, analysis, enrichment, sourceNotes) {
  const entry = enrichment.checks[check.id];
  if (check.id === "canonical" && !analysis.metadata.canonical) {
    return { value: `<link rel="canonical" href="${escapeAttribute(analysis.final_url)}">`, note: "Draft target from final_url · confirm the preferred URL before applying.", review: true };
  }
  if (check.id === "title" && !analysis.metadata.title && analysis.headings.h1[0]) {
    return { value: `<title>${escapeText(analysis.headings.h1[0])}</title>`, note: "Uses the returned H1 text · review for page accuracy.", review: true };
  }
  if (check.id === "image_alt") {
    const missing = sourceNotes?.images?.find((image) => !image.has_alt_attribute);
    if (missing?.src) {
      return { value: `<img src="${escapeAttribute(missing.src)}" alt="[Describe the image if informative]">`, note: `Supplementary offline source note · ${sourceNotes.source_path}:${missing.line}. Empty alt can be correct for decorative images.`, review: true };
    }
  }
  if (check.id === "robots_directives" && (analysis.fetch.x_robots_tag || "").toLowerCase().includes("noindex")) {
    return { value: "X-Robots-Tag: noindex", note: "Response-header condition · verify owner intent before changing.", review: true };
  }
  if (!entry.snippet) return null;
  return { value: entry.snippet, note: entry.snippet_reason || "Review this pattern against the page context.", review: Boolean(entry.review_required) };
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fillInspectionDetail(panel, checkId, analysis, enrichment, sourceNotes) {
  panel.replaceChildren();
  const check = checkById(analysis, checkId);
  if (!check) {
    panel.append(make("p", "", "This observation is not available in the loaded analysis.", { dataset: { ui: "true" } }));
    return;
  }
  const entry = enriched(check, analysis, enrichment);
  const h3 = make("h3", "", entry.finding, { tabindex: "-1", id: `detail-${check.id}`, dataset: { ui: "true" } });
  append(panel,
    make("p", "eyebrow", "Observed", { dataset: { ui: "true" } }),
    h3,
    make("span", "evidence-value data-observed", check.evidence.observed, { dataset: { observed: "true" } }),
    make("p", "", entry.action, { dataset: { ui: "true" } }),
    make("p", "", `Analyzer recommendation: ${check.recommendation}`, { dataset: { ui: "true" } }));
  const snippet = snippetFor(check, analysis, currentEnrichment, sourceNotes);
  if (snippet) {
    const wrap = make("div", "snippet-wrap");
    const head = make("div", "snippet-head");
    const code = make("pre", "", snippet.value, { class: "data-observed", dataset: { observed: "true" } });
    const copy = make("button", "copy-button", snippet.review ? "Copy editable template" : "Copy fix", { type: "button", dataset: { copyValue: "true" } });
    copy.addEventListener("click", () => copySnippet(snippet.value, copy));
    append(head, make("span", "evidence-label", snippet.review ? "REVIEW REQUIRED · EDITABLE TEMPLATE" : "COPYABLE FIX", { dataset: { ui: "true" } }), copy);
    const feedback = make("p", "copy-feedback", "", { "aria-live": "polite", "aria-atomic": "true" });
    append(wrap, head, code);
    if (snippet.review) wrap.append(make("p", "review-note", snippet.note, { dataset: { ui: "true" } }));
    else wrap.append(make("p", "", snippet.note, { dataset: { ui: "true" } }));
    append(wrap, feedback);
    panel.append(wrap);
  } else {
    const noPattern = enrichment.checks[check.id].snippet_reason || "No safe code pattern can be drafted from this observation.";
    panel.append(make("p", "review-note", noPattern, { dataset: { ui: "true" } }));
  }
  const sourceNote = check.id === "image_alt" ? sourceNotes?.images?.find((image) => !image.has_alt_attribute) : null;
  if (sourceNote) panel.append(make("p", "", `Supplementary offline source path: ${sourceNotes.source_path}, line ${sourceNote.line}. This per-image detail is not returned by SEOAnalysis.`, { dataset: { observed: "true" } }));
}

async function copySnippet(value, button) {
  const parent = button.closest(".snippet-wrap, .priority-actions");
  const feedback = $(".copy-feedback, .priority-copy-feedback", parent);
  feedback.classList.remove("is-error");
  feedback.textContent = "";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(value);
    if (button.isConnected) feedback.textContent = "Copied.";
  } catch {
    if (button.isConnected) {
      feedback.textContent = "Copy was not permitted. Select the pattern and copy it manually.";
      feedback.classList.add("is-error");
    }
  }
}

function selectFinding(checkId, { focusDetail = false, detailRoot = null } = {}) {
  if (!currentAnalysis || !checkById(currentAnalysis, checkId)) return;
  selectedCheckId = checkId;
  const root = detailRoot || document;
  for (const part of root.querySelectorAll(".scan-part")) {
    const pressed = part.dataset.checkIds.split(",").includes(checkId);
    part.classList.toggle("is-active", pressed);
    part.setAttribute("aria-pressed", String(pressed));
  }
  for (const finding of document.querySelectorAll("[data-finding-button]")) {
    finding.setAttribute("aria-pressed", String(finding.dataset.checkId === checkId));
  }
  const details = root.querySelector(".inspection-detail") || document.querySelector(".inspection-detail");
  if (details) fillInspectionDetail(details, checkId, currentAnalysis, currentEnrichment, currentSourceNotes);
  const announce = $("#selection-announcement");
  const check = checkById(currentAnalysis, checkId);
  if (announce) announce.textContent = `${enriched(check, currentAnalysis, currentEnrichment).finding}. ${check.evidence.observed}`;
  if (focusDetail) {
    const heading = details?.querySelector("h3");
    if (heading) heading.focus({ preventScroll: true });
  }
}

function categoryRows(analysis) {
  const section = make("section", "category-section", null, { "aria-labelledby": "category-heading" });
  const heading = make("div", "section-heading");
  append(heading, make("h2", "", "Category distribution", { id: "category-heading", dataset: { ui: "true" } }), make("span", "small-label", "Engine values", { dataset: { ui: "true" } }));
  const list = make("div", "category-list");
  for (const category of analysis.deterministic_score.categories) {
    const max = category.weight || 0;
    const ratio = max ? Math.max(0, Math.min(100, category.points_earned / max * 100)) : 0;
    const row = make("div", "category-row");
    const top = make("div", "category-top");
    append(top, make("span", "", CATEGORY_LABELS[category.category]), make("span", "category-points", `${category.points_earned.toFixed(1)} / ${category.weight.toFixed(1)}`));
    const track = make("div", "bar-track", null, { role: "img", "aria-label": `${CATEGORY_LABELS[category.category]}: ${category.points_earned.toFixed(1)} of ${category.weight.toFixed(1)} weighted points` });
    track.append(make("div", "bar-value", null, { style: `width:${ratio}%` }));
    append(row, top, track);
    list.append(row);
  }
  append(section, heading, list);
  return section;
}

function buildPriorityList(analysis, enrichment, maxCount = 5) {
  const ranked = prioritizedChecks(analysis, enrichment);
  const section = make("section", "priority-section", null, { "aria-labelledby": "priority-heading" });
  const heading = make("div", "section-heading");
  append(heading, make("h2", "", ranked.length ? "Fix these 5 first" : "Nothing to fix", { id: "priority-heading", dataset: { ui: "true" } }), make("span", "small-label", `${Math.min(maxCount, ranked.length)} of ${ranked.length}`, { dataset: { ui: "true" } }));
  const list = make("ol", "priority-list");
  for (const [index, item] of ranked.slice(0, maxCount).entries()) {
    const li = make("li", "priority-row");
    const check = item.check;
    const entry = item.entry;
    li.dataset.checkId = check.id;
    const top = make("div", "priority-top");
    const button = make("button", "priority-button", null, {
      type: "button",
      id: `finding-${check.id}`,
      "data-finding-button": "true",
      "data-check-id": check.id,
      "aria-pressed": String(selectedCheckId === check.id),
      "aria-label": `${index + 1}. ${entry.impact} impact. ${entry.finding}. ${check.evidence.observed}`,
    });
    const number = make("span", "priority-number", String(index + 1).padStart(2, "0"), { "aria-hidden": "true" });
    const title = make("span", "finding-title", entry.finding, { dataset: { ui: "true" } });
    append(button, number, title);
    const evidence = make("p", "finding-evidence data-observed", check.evidence.observed, { dataset: { observed: "true" } });
    const action = make("p", "priority-action", entry.action, { dataset: { ui: "true", summaryCopy: "true" } });
    const meta = make("span", "priority-meta");
    append(meta,
      make("span", "status-label", statusWord(check.status), { "data-status": check.status, dataset: { ui: "true" } }),
      make("span", "effort-label", `${entry.effort} effort`, { dataset: { ui: "true" } }));
    button.addEventListener("click", () => selectFinding(check.id));
    top.append(button, make("span", "impact-tag", entry.impact, { "data-impact": entry.impact, dataset: { ui: "true" } }));
    const actions = make("div", "priority-actions");
    const snippet = snippetFor(check, analysis, enrichment, currentSourceNotes);
    if (snippet) {
      const copy = make("button", "priority-copy-button", snippet.review ? "Copy editable template" : "Copy fix", {
        type: "button",
        "data-check-id": check.id,
        "aria-label": `${snippet.review ? "Copy editable template" : "Copy fix"} for ${entry.finding}`,
      });
      copy.addEventListener("click", () => copySnippet(snippet.value, copy));
      actions.append(copy);
    } else {
      const review = make("button", "priority-review-button", "Review fix", { type: "button", "data-check-id": check.id });
      review.addEventListener("click", () => reviewFinding(check.id));
      actions.append(review);
    }
    actions.append(make("p", "priority-copy-feedback", "", { "aria-live": "polite", "aria-atomic": "true" }));
    append(li, top, evidence, action, meta, actions);
    list.append(li);
  }
  if (!ranked.length) list.append(make("li", "empty-list", "No actionable non-passing checks were returned."));
  const note = make("p", "section-footnote", "Order is a design-only review cue, not business severity. The score and check statuses are unchanged.", { dataset: { ui: "true", summaryCopy: "true" } });
  append(section, list, note);
  return section;
}

function reviewFinding(checkId) {
  const structure = $(".structure-disclosure");
  if (structure) structure.open = true;
  const anatomy = $(".anatomy-section");
  selectFinding(checkId, { focusDetail: true, detailRoot: anatomy || document });
  anatomy?.scrollIntoView({ block: "nearest" });
}

function buildSummary(route, analysis, enrichment, notes) {
  const main = make("main");
  const grid = make("div", "report-grid");
  const priorities = buildPriorityList(analysis, enrichment, 5);
  const anatomy = makeAnatomy(route, analysis, enrichment, notes);
  append(grid, anatomy, priorities, categoryRows(analysis));
  const announce = make("p", "live-region", "", { id: "selection-announcement", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const state = make("div", "state-bar", null, { role: "note" });
  append(state, make("i", "status-dot", null, { "aria-hidden": "true" }), make("span", "", "Static analysis output · no website request was made.", { dataset: { ui: "true" } }));
  append(main, reportHead(route, analysis, enrichment), grid, state, announce);
  return main;
}

function scoreSide(route, analysis, enrichment, notes) {
  const section = make("aside", "subpage-side", null, { "aria-label": "Analysis context and page structure" });
  const scoreContext = make("section", "score-context", null, { "aria-label": "Heuristic score" });
  append(scoreContext,
    make("p", "small-label", "HEURISTIC SCORE", { dataset: { ui: "true" } }),
    make("p", "score-context-value", `${analysis.deterministic_score.overall_score}/100 · v${analysis.deterministic_score.version}`, { dataset: { observed: "true" } }),
    scoreHelpPanel());
  const structure = make("details", "structure-disclosure", null, { open: window.matchMedia("(min-width: 901px)").matches });
  append(structure, make("summary", "", "Inspect page structure", { dataset: { ui: "true" } }), makeAnatomy(route, analysis, enrichment, notes, true));
  append(section, scoreContext, structure);
  return section;
}

function buildCheckRows(analysis, enrichment, relevantIds = null) {
  const rows = make("div", "check-list");
  const checks = relevantIds ? analysis.checks.filter((check) => relevantIds.includes(check.id)) : analysis.checks;
  for (const check of checks) {
    const entry = enriched(check, analysis, enrichment);
    const row = make("div", "subcheck");
    const text = make("p", "");
    append(text,
      make("strong", "", entry.finding, { dataset: { ui: "true" } }),
      make("span", "finding-evidence data-observed", check.evidence.observed, { dataset: { observed: "true" } }));
    const button = make("button", "inspect-structure-button", "Inspect page structure", { type: "button", "data-check-id": check.id, dataset: { ui: "true" } });
    button.addEventListener("click", () => reviewFinding(check.id));
    append(row, text, button);
    rows.append(row);
  }
  return rows;
}

function pageHeaderForSubstate(route, analysis, title) {
  const heading = make("header", "specialist-heading", null, { "aria-labelledby": "specialist-title" });
  append(heading,
    make("p", "eyebrow", route.sample === "noindex" ? "Page inspection · test condition" : "Page inspection · local analysis", { dataset: { ui: "true" } }),
    make("h1", "", title, { id: "specialist-title", dataset: { ui: "true" } }),
    make("p", "specialist-url data-observed", analysis.final_url, { dataset: { observed: "true" } }));
  return heading;
}

function buildOnPage(route, analysis, enrichment, notes) {
  const main = make("main", "specialist-page");
  const layout = make("div", "subpage-layout");
  const content = make("div", "subpage-main");
  const metadata = make("section", "data-block onpage-primary-values");
  append(metadata,
    make("h2", "", "Title and description", { dataset: { ui: "true" } }),
    make("p", "small-label", `Observed page metadata · ${analysis.lexical_signals.visible_word_count} visible words reported`, { dataset: { observed: "true" } }));
  const title = make("p", `observed-value${analysis.metadata.title ? "" : " is-empty"} data-observed`, analysis.metadata.title || "No title value returned.", { dataset: { observed: "true" } });
  const description = make("p", `observed-value${analysis.metadata.description ? "" : " is-empty"} data-observed`, analysis.metadata.description || "No description value returned.", { dataset: { observed: "true" } });
  append(metadata, make("h3", "eyebrow", "TITLE", { dataset: { ui: "true" } }), title, make("h3", "eyebrow", "META DESCRIPTION", { dataset: { ui: "true" } }), description);
  metadata.append(buildCheckRows(analysis, enrichment, ["title", "meta_description"]));
  content.append(metadata);
  const headings = make("section", "data-block");
  headings.append(make("h2", "", "Headings observed", { dataset: { ui: "true" } }));
  let headingIndex = 0;
  for (const level of ["h1", "h2", "h3"]) {
    for (const value of analysis.headings[level]) {
      headingIndex += 1;
      const row = make("div", "heading-line");
      append(row, make("span", "tag", `${level.toUpperCase()} · ${headingIndex}`), make("span", "data-observed", value, { dataset: { observed: "true" } }));
      headings.append(row);
    }
  }
  if (!headingIndex) headings.append(make("p", "observed-value is-empty", "No heading values returned.", { dataset: { observed: "true" } }));
  headings.append(buildCheckRows(analysis, enrichment, ["h1_structure", "heading_hierarchy"]));
  content.append(headings);
  const body = make("section", "data-block");
  append(body, make("h2", "", "Visible text", { dataset: { ui: "true" } }), make("p", "observed-value data-observed", `Approx. ${analysis.lexical_signals.visible_word_count} visible words.`, { dataset: { observed: "true" } }), buildCheckRows(analysis, enrichment, ["visible_text"]));
  content.append(body);
  const canonical = make("section", "data-block");
  append(canonical, make("h2", "", "Canonical value", { dataset: { ui: "true" } }), make("p", `observed-value${analysis.metadata.canonical ? "" : " is-empty"} data-observed`, analysis.metadata.canonical || "No canonical URL returned.", { dataset: { observed: "true" } }), buildCheckRows(analysis, enrichment, ["canonical"]));
  content.append(canonical);
  const aside = scoreSide(route, analysis, enrichment, notes);
  append(layout, content, aside);
  append(main, pageHeaderForSubstate(route, analysis, "On-page"), layout);
  return main;
}

function previewItem(title, label, values, finalUrl, imageUrl = null, search = false) {
  const item = make("article", "preview-item");
  append(item, make("h2", "", title, { dataset: { ui: "true" } }), make("p", "preview-meta", label, { dataset: { ui: "true" } }));
  const surface = make("div", search ? "preview-surface preview-search" : "preview-surface");
  if (!search && !imageUrl) surface.append(make("div", "preview-image-missing", "No image value returned", { dataset: { observed: "true" } }));
  if (!search && imageUrl) surface.append(make("p", "data-observed", `Image URL returned: ${imageUrl}`, { dataset: { observed: "true" } }));
  const displayedTitle = values.title || values.titleMissing || "No title value returned";
  const displayedDescription = values.description || values.descriptionMissing || "No description value returned";
  surface.append(make("p", search ? "preview-title data-observed" : "preview-social-title data-observed", displayedTitle, { dataset: { observed: "true" } }));
  if (search) surface.append(make("p", "preview-url data-observed", finalUrl, { dataset: { observed: "true" } }));
  surface.append(make("p", search ? "preview-description data-observed" : "preview-social-description data-observed", displayedDescription, { dataset: { observed: "true" } }));
  append(item, surface, make("p", "preview-disclosure", "Metadata sketch only · presentation can differ by platform.", { dataset: { ui: "true" } }));
  return item;
}

function buildPreviews(route, analysis, enrichment, notes) {
  const main = make("main", "specialist-page");
  const layout = make("div", "subpage-layout");
  const content = make("div", "subpage-main");
  const previewList = make("div", "preview-list");
  const metadata = analysis.metadata;
  const social = analysis.social_metadata;
  previewList.append(previewItem("Search result sketch", "PAGE METADATA · LENGTH IS AN ESTIMATE", { title: metadata.title, titleMissing: "No page title returned", description: metadata.description, descriptionMissing: "No page description returned" }, analysis.final_url, null, true));
  previewList.append(previewItem("Facebook share", "OPEN GRAPH VALUES", { title: social.og_title, titleMissing: "No Open Graph title returned", description: social.og_description, descriptionMissing: "No Open Graph description returned" }, analysis.final_url, social.og_image));
  previewList.append(previewItem("X card sketch", "X VALUES · PAGE METADATA FALLBACK", { title: social.twitter_title || metadata.title, titleMissing: "No X or page title returned", description: social.twitter_description || metadata.description, descriptionMissing: "No X or page description returned" }, analysis.final_url, social.twitter_image));
  previewList.append(previewItem("LinkedIn share", "OPEN GRAPH VALUES", { title: social.og_title, titleMissing: "No Open Graph title returned", description: social.og_description, descriptionMissing: "No Open Graph description returned" }, analysis.final_url, social.og_image));
  content.append(previewList);
  const aside = scoreSide(route, analysis, enrichment, notes);
  append(layout, content, aside);
  append(main, pageHeaderForSubstate(route, analysis, "Previews"), layout);
  return main;
}

function buildFixList(route, analysis, enrichment, notes) {
  const main = make("main", "specialist-page");
  const layout = make("div", "subpage-layout");
  const content = make("div", "subpage-main");
  const ranked = prioritizedChecks(analysis, enrichment);
  content.append(make("p", "fix-list-intro", `${ranked.length} open findings · ordered by design-only impact, effort, then source order.`, { dataset: { ui: "true" } }));
  if (!ranked.length) content.append(make("p", "empty-list", "No actionable non-passing checks were returned."));
  for (const { check, entry } of ranked) {
    const item = make("article", "fix-item", null, { id: `fix-${check.id}` });
    const header = make("header");
    const title = make("div");
    append(title, make("span", "status-label", statusWord(check.status), { "data-status": check.status, dataset: { ui: "true" } }), make("h3", "", entry.finding, { dataset: { ui: "true" } }));
    header.append(title, make("span", "impact-tag", entry.impact, { "data-impact": entry.impact, dataset: { ui: "true" } }));
    append(item,
      header,
      make("p", "finding-evidence data-observed", check.evidence.observed, { dataset: { observed: "true" } }),
      make("p", "fix-action", entry.action, { dataset: { ui: "true" } }),
      make("p", "", `Effort · ${entry.effort}`, { dataset: { ui: "true" } }),
      buildCheckRows(analysis, enrichment, [check.id]));
    const snippet = snippetFor(check, analysis, enrichment, notes);
    if (snippet) item.append(snippetBlock(snippet.value, snippet.note, snippet.review));
    content.append(item);
  }
  const aside = scoreSide(route, analysis, enrichment, notes);
  append(layout, content, aside);
  append(main, pageHeaderForSubstate(route, analysis, "Fix list"), layout);
  return main;
}

function snippetBlock(value, note, review) {
  const wrap = make("div", "snippet-wrap fix-actions");
  const head = make("div", "snippet-head");
  const pre = make("pre", "data-observed", value, { dataset: { observed: "true" } });
  const copy = make("button", "copy-button", review ? "Copy editable template" : "Copy fix", { type: "button" });
  copy.addEventListener("click", () => copySnippet(value, copy));
  append(head, make("span", "evidence-label", review ? "REVIEW REQUIRED · EDITABLE TEMPLATE" : "COPYABLE FIX", { dataset: { ui: "true" } }), copy);
  append(wrap, head, pre, make("p", review ? "review-note" : "", note, { dataset: { ui: "true" } }), make("p", "copy-feedback", "", { "aria-live": "polite" }));
  return wrap;
}

function buildHome() {
  const main = make("main", "home-main");
  const copy = make("section", "home-copy");
  const eyebrow = make("p", "eyebrow", "Page structure · observed evidence", { dataset: { ui: "true" } });
  const h1 = make("h1", "");
  h1.append(document.createTextNode("See what your "), make("em", "", "page says"), document.createTextNode(" to search."));
  const intro = make("p", "home-intro", "A focused inspection of page metadata, headings, links and other returned HTML signals.", { dataset: { ui: "true" } });
  const form = make("form", "entry-form", null, { id: "url-form", novalidate: "true" });
  const urlGroup = make("div", "field-group");
  append(urlGroup, make("label", "", "Page URL", { for: "page-url", dataset: { ui: "true" } }), make("input", "", null, { id: "page-url", name: "url", type: "text", inputmode: "url", autocomplete: "url", placeholder: "https://example.test/weak", required: true, "aria-describedby": "url-hint" }));
  const keywordGroup = make("div", "field-group");
  append(keywordGroup, make("label", "", "Target keyword · optional", { for: "target-keyword", dataset: { ui: "true" } }), make("input", "", null, { id: "target-keyword", name: "keyword", type: "text", placeholder: "Not checked in this proof", "aria-describedby": "keyword-hint" }));
  const actions = make("div", "entry-actions");
  const submit = make("button", "button-primary", "Open local analysis", { type: "submit", dataset: { ui: "true" } });
  append(actions, submit, make("p", "live-region", "", { id: "form-announcement", role: "status", "aria-live": "polite" }));
  append(form, urlGroup, keywordGroup, actions);
  const note = make("div", "home-note", null, { id: "url-hint" });
  append(note, make("i", "status-dot", null, { "aria-hidden": "true" }), make("span", "", "This offline design proof opens only the two bundled analyses. It makes no website request.", { dataset: { ui: "true" } }));
  const keywordNote = make("p", "home-side-note", "Target-keyword checks are not part of this design proof.", { id: "keyword-hint", dataset: { ui: "true" } });
  append(copy, eyebrow, h1, intro, form, note, keywordNote);
  const side = make("aside", "home-side", null, { "aria-labelledby": "known-heading" });
  append(side, make("h2", "", "Open an offline analysis", { id: "known-heading", dataset: { ui: "true" } }));
  const list = make("ul", "known-inputs");
  const weak = make("li");
  weak.append(internalLink("summary", "weak", null));
  weak.firstChild.replaceChildren(make("span", "known-url data-observed", "https://example.test/weak", { dataset: { observed: "true" } }), make("span", "known-meta", "Short document · missing description, H1 and image alt", { dataset: { ui: "true" } }));
  const basic = make("li");
  basic.append(internalLink("summary", "basic", null));
  basic.firstChild.replaceChildren(make("span", "known-url data-observed", "https://example.test/basic", { dataset: { observed: "true" } }), make("span", "known-meta", "Metadata present · short-copy warnings", { dataset: { ui: "true" } }));
  append(list, weak, basic);
  append(side, list, make("p", "home-side-note", "Entering another address shows a static-preview message. No remote page is fetched.", { dataset: { ui: "true" } }));
  append(main, copy, side);
  return main;
}

function attachHomeForm() {
  const form = $("#url-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const urlText = $("#page-url").value.trim();
    const keyword = $("#target-keyword").value.trim();
    const announcement = $("#form-announcement");
    const setError = (message) => { announcement.textContent = message; };
    if (!urlText) { setError("Enter a URL to choose an offline analysis."); $("#page-url").focus(); return; }
    let parsed;
    try { parsed = new URL(urlText); } catch { setError("Enter a complete URL, such as https://example.test/weak."); $("#page-url").focus(); return; }
    if (parsed.username || parsed.password) { setError("URLs containing credentials are not accepted."); $("#page-url").focus(); return; }
    if (parsed.protocol !== "https:") { setError("This proof accepts only its reserved HTTPS example addresses."); $("#page-url").focus(); return; }
    if (keyword) setError("Target-keyword checks are not included. Opening the selected page analysis only.");
    const sample = parsed.hostname === "example.test" && parsed.pathname === "/weak" && !parsed.search && !parsed.hash ? "weak"
      : parsed.hostname === "example.test" && parsed.pathname === "/basic" && !parsed.search && !parsed.hash ? "basic" : null;
    if (sample) navigate("summary", sample);
    else navigate("error", null, { reason: "static-preview", contextUrl: urlText });
  });
}

function buildError(route) {
  const main = make("main", "error-layout");
  const reason = route.reason || "unknown-state";
  const title = reason === "static-preview" ? "No live scan here" : reason === "missing-data" ? "Analysis unavailable" : "This view needs an offline analysis";
  const message = reason === "static-preview"
    ? "This design proof does not fetch websites. Choose one of the two available local analyses to continue."
    : reason === "missing-data"
      ? "The selected analysis file is missing or could not be read. Nothing has been substituted. Return to the start and choose an available analysis."
      : "This report address does not contain an available analysis selection. Choose a local analysis to continue.";
  append(main,
    make("div", "error-mark", "!", { "aria-hidden": "true" }),
    make("p", "eyebrow", "No report loaded", { dataset: { ui: "true" } }),
    make("h1", "", title, { id: "error-heading", tabindex: "-1", dataset: { ui: "true" } }),
    make("p", "error-copy", message, { dataset: { ui: "true" } }));
  if (route.contextUrl) main.append(make("p", "context-url data-observed", route.contextUrl, { dataset: { observed: "true" } }));
  const actions = make("div", "entry-actions");
  append(actions, internalLink("home", null, "Back to URL entry"), internalLink("summary", "weak", "Open an available analysis"));
  main.append(actions);
  return main;
}

function buildLoading(route) {
  const main = make("main", "loading-layout", null, { "aria-busy": "true" });
  append(main,
    make("p", "eyebrow", "Reserved layout · local motion study", { dataset: { ui: "true" } }),
    make("h1", "", "Reading page structure", { dataset: { ui: "true" } }),
    make("p", "loading-copy", "This screen demonstrates space reserved for an analysis in progress. It does not start a crawl or call a service.", { dataset: { ui: "true" } }));
  const grid = make("div", "loading-grid", null, { "aria-hidden": "true" });
  const wire = make("div", "skeleton-sheet");
  append(wire, make("div", "skeleton-line"), make("div", "skeleton-line"), make("div", "skeleton-line"), make("div", "skeleton-line"), make("div", "skeleton-line"), make("div", "skeleton-line"));
  const findings = make("div", "skeleton-sheet");
  append(findings, make("div", "skeleton-line"), make("div", "skeleton-part"), make("div", "skeleton-part"), make("div", "skeleton-part"), make("div", "skeleton-part"));
  append(grid, wire, findings);
  const actions = make("div", "loading-actions");
  append(actions, internalLink("summary", normalizeSample(route.sample) || "weak", "See completed analysis"), internalLink("home", null, "Cancel and return"));
  append(main, grid, actions);
  return main;
}

function scoreAnimation() {
  const score = $("[data-score-target]");
  if (!score) return;
  const target = Number(score.dataset.scoreTarget);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !Number.isFinite(target)) { score.textContent = String(target); return; }
  const start = performance.now();
  const duration = 480;
  const tick = (time) => {
    if (!score.isConnected) return;
    const progress = Math.min(1, (time - start) / duration);
    score.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function render() {
  const generation = ++renderGeneration;
  const route = readRoute();
  currentAnalysis = null;
  currentEnrichment = null;
  currentSourceNotes = null;
  currentSample = route.sample;
  selectedCheckId = route.checkId;
  const shellRoute = REPORT_STATES.has(route.state) && !normalizeSample(route.sample)
    ? { ...route, state: "error", sample: null }
    : route;
  const shell = buildShell(shellRoute);
  const mainHost = make("div", "view-host");
  shell.append(mainHost);
  app.replaceChildren(shell);

  if (REPORT_STATES.has(route.state)) {
    if (!normalizeSample(route.sample)) {
      mainHost.replaceChildren(buildError({ ...route, reason: "missing-data", contextUrl: "" }));
      shell.append(buildFooter());
      return;
    }
    mainHost.replaceChildren(buildLoading({ ...route, state: "loading" }));
    attachNavigation();
    try {
      const loaded = await loadData(route.sample);
      if (generation !== renderGeneration || readRoute().state !== route.state || readRoute().sample !== route.sample) return;
      currentAnalysis = loaded.analysis;
      currentEnrichment = loaded.enrichment;
      currentSourceNotes = loaded.notes;
      if (selectedCheckId && !checkById(currentAnalysis, selectedCheckId)) selectedCheckId = null;
      let page;
      if (route.state === "summary") page = buildSummary(route, currentAnalysis, currentEnrichment, currentSourceNotes);
      else if (route.state === "on-page") page = buildOnPage(route, currentAnalysis, currentEnrichment, currentSourceNotes);
      else if (route.state === "previews") page = buildPreviews(route, currentAnalysis, currentEnrichment, currentSourceNotes);
      else page = buildFixList(route, currentAnalysis, currentEnrichment, currentSourceNotes);
      mainHost.replaceChildren(page);
      shell.append(buildFooter());
      scoreAnimation();
      if (route.checkId && checkById(currentAnalysis, route.checkId)) {
        const structure = $(".structure-disclosure");
        if (structure) structure.open = true;
        selectFinding(route.checkId, { focusDetail: true, detailRoot: $(".anatomy-section") || document });
      }
      attachNavigation();
    } catch {
      if (generation !== renderGeneration) return;
      mainHost.replaceChildren(buildError({ ...route, reason: "missing-data", contextUrl: "" }));
      shell.append(buildFooter());
      attachNavigation();
    }
    return;
  }

  if (route.state === "home") {
    mainHost.replaceChildren(buildHome());
    attachHomeForm();
  } else if (route.state === "loading") {
    mainHost.replaceChildren(buildLoading(route));
  } else {
    mainHost.replaceChildren(buildError({ ...route, reason: route.reason || "unknown-state" }));
  }
  shell.append(buildFooter());
  attachNavigation();
}

function attachNavigation() {
  for (const link of document.querySelectorAll("a[data-nav]")) {
    if (link.dataset.bound) continue;
    link.dataset.bound = "true";
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const url = new URL(link.href);
      const query = new URLSearchParams(url.search);
      const state = query.get("state") || "home";
      const sample = query.get("sample");
      const checkId = query.get("check");
      navigate(state, sample, { reason: query.get("reason"), checkId });
    });
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-finding-button]");
  if (button && currentAnalysis) selectFinding(button.dataset.checkId);
});
window.addEventListener("popstate", () => render());
render();
