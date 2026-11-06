(() => {
  "use strict";

  const CATEGORY = {
    technical_indexability: "Technical & indexability",
    metadata: "Metadata",
    headings_content_structure: "Headings & content",
    links: "Links",
    images: "Images",
    structured_data: "Structured data",
    social_metadata: "Social metadata",
    html_signals: "HTML signals",
  };
  const STATUS = { fail: "Fail", warning: "Warning", pass: "Pass", not_applicable: "Not applicable" };
  const SAMPLE_URL = "https://northstar.example/guides/home-solar/";
  const CATEGORY_ORDER = Object.keys(CATEGORY);
  const app = document.querySelector("#app");
  const main = document.querySelector("#main-content");
  const globalSource = document.querySelector("[data-global-source]");
  let loaded = null;
  let focusAfterRender = null;
  let returnedCheck = null;
  let recheckTimer = null;

  const node = (tag, className, value) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined && value !== null) result.textContent = String(value);
    return result;
  };
  const button = (label, action, className = "") => {
    const result = node("button", className, label);
    result.type = "button";
    result.dataset.action = action;
    return result;
  };
  const statusLabel = (status) => STATUS[status] || String(status).replaceAll("_", " ");
  const categoryLabel = (category) => CATEGORY[category] || String(category).replaceAll("_", " ");
  const analysis = () => loaded?.fixture?.analysis;
  const checks = () => analysis()?.checks || [];
  const selectedCheck = (id) => checks().find((check) => check.id === id);
  const countStatuses = (items) => items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });

  function readRoute() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "entry";
    const mode = params.get("mode") === "all" ? "all" : "review";
    const allowedStatuses = ["all", "fail", "warning", "pass", "not_applicable"];
    const status = allowedStatuses.includes(params.get("status")) ? params.get("status") : "all";
    return {
      view: ["entry", "overview", "findings", "detail"].includes(view) ? view : "entry",
      mode,
      q: params.get("q") || "",
      status,
      check: params.get("check") || "",
    };
  }

  function writeRoute(route, { replace = false, parent = null } = {}) {
    const params = new URLSearchParams();
    params.set("view", route.view);
    if (route.view === "findings" || route.view === "detail") params.set("mode", route.mode);
    if ((route.view === "findings" || route.view === "detail") && route.q) params.set("q", route.q);
    if ((route.view === "findings" || route.view === "detail") && route.status !== "all") params.set("status", route.status);
    if (route.view === "detail" && route.check) params.set("check", route.check);
    const state = parent ? { seoParent: parent } : (window.history.state || null);
    const method = replace ? "replaceState" : "pushState";
    window.history[method](state, "", `${window.location.pathname}?${params.toString()}`);
  }

  function transition(route, { focus = "heading", parent = null, replace = false } = {}) {
    writeRoute(route, { replace, parent });
    focusAfterRender = focus;
    render();
  }

  function focusTarget() {
    if (!focusAfterRender) return;
    let target = null;
    if (focusAfterRender === "heading") target = app.querySelector("h1[tabindex='-1']");
    if (focusAfterRender === "entry") target = app.querySelector("#page-url");
    if (focusAfterRender === "fixture-status") target = app.querySelector("#form-message");
    if (focusAfterRender === "returned") target = app.querySelector(`[data-open-check="${CSS.escape(returnedCheck || "")}"]`);
    if (target) target.focus({ preventScroll: true });
    else if (focusAfterRender === "returned") app.querySelector("h1[tabindex='-1']")?.focus({ preventScroll: true });
    focusAfterRender = null;
  }

  function reportChrome(route) {
    const context = node("div", "report-context");
    context.setAttribute("aria-label", "Current page");
    context.append(node("span", "context-brand", "Northstar Solar"));
    context.append(node("span", "context-separator", "/"));
    const path = node("span", "context-path", new URL(analysis().requested_url).pathname);
    path.title = analysis().requested_url;
    context.append(path);
    context.append(button("Change page", "change-page", "context-change"));

    const nav = node("nav", "report-nav");
    nav.setAttribute("aria-label", "Report sections");
    const overview = button("Overview", "overview");
    const findings = button("Findings", "findings");
    findings.append(node("span", "nav-count", String(checks().length)));
    const activeView = route.view === "detail" ? "findings" : route.view;
    for (const [view, item] of [["overview", overview], ["findings", findings]]) {
      if (activeView === view) item.setAttribute("aria-current", "page");
    }
    nav.append(overview, findings);
    return [context, nav];
  }

  function renderEntry() {
    globalSource.textContent = loaded?.error ? "Fixture unavailable" : (loaded?.fixture ? "Local example" : "Loading local example");
    const section = node("section", "entry-shell");
    section.setAttribute("aria-labelledby", "entry-title");
    section.append(node("p", "entry-kicker", "A page inspection, from evidence to verification"));
    const h1 = node("h1", "", "Review one page at a time.");
    h1.id = "entry-title";
    h1.tabIndex = -1;
    section.append(h1);
    const intro = node("p", "entry-intro", "Enter the example address to open its bundled report. This design sample does not crawl submitted URLs or connect to a service.");
    section.append(intro);

    const form = node("form", "entry-form");
    form.noValidate = true;
    form.dataset.form = "url";
    const field = node("div", "field-wrap");
    const label = node("label", "", "Page address");
    label.htmlFor = "page-url";
    const input = node("input", "text-input");
    input.id = "page-url";
    input.type = "url";
    input.inputMode = "url";
    input.autocomplete = "url";
    input.placeholder = "https://northstar.example/guides/home-solar/";
    input.setAttribute("aria-describedby", "entry-help form-message");
    field.append(label, input);
    const submit = node("button", "button-primary", "Open this report");
    submit.type = "submit";
    submit.disabled = !loaded?.fixture;
    form.append(field, submit);
    const help = node("p", "entry-help", "Only the fictional Northstar Solar fixture is available here. No URL entered in this form is requested.");
    help.id = "entry-help";
    form.append(help);
    const message = node("p", "form-message", loaded?.error ? "The bundled fixture could not be loaded from local files. Restore it and try again; no website was requested." : (loaded?.fixture ? "No report is open. Use the bundled example to continue." : "Loading the local example files…"));
    message.id = "form-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.tabIndex = -1;
    if (!loaded && !loaded?.error) message.dataset.kind = "loading";
    form.append(message);
    section.append(form);

    const actions = node("div", "entry-actions");
    const sample = button("Use the Northstar example", "fill-sample", "button-secondary");
    sample.disabled = !loaded?.fixture;
    actions.append(sample);
    const clear = button("Clear address", "clear-address", "button-link");
    actions.append(clear);
    section.append(actions);

    const scope = node("div", "entry-scope");
    scope.append(node("p", "eyebrow", "What this sample shows"));
    const scopeText = node("p", "", "A static HTML observation, deterministic rule statuses, editorial explanation, suggested next step, and a separate verification path. The example is illustrative; transport values are mocked.");
    scope.append(scopeText);
    section.append(scope);
    if (loaded?.error) {
      const retry = button("Try local fixture again", "retry-fixture", "button-link");
      section.append(retry);
    }
    app.replaceChildren(section);
  }

  function categoryRows() {
    const list = node("ul", "category-list");
    for (const category of analysis().deterministic_score.categories) {
      const members = checks().filter((check) => check.category === category.category);
      const counts = countStatuses(members);
      const item = node("li", "category-item");
      item.append(node("span", "category-name", categoryLabel(category.category)));
      const parts = [];
      if (counts.fail) parts.push(`${counts.fail} fail`);
      if (counts.warning) parts.push(`${counts.warning} warning`);
      if (counts.pass) parts.push(`${counts.pass} pass`);
      if (counts.not_applicable) parts.push(`${counts.not_applicable} not applicable`);
      const summary = node("span", "category-counts");
      summary.append(node("strong", "", `${members.length} ${members.length === 1 ? "check" : "checks"}`));
      summary.append(document.createTextNode(` · ${parts.join(" · ")}`));
      item.append(summary);
      list.append(item);
    }
    return list;
  }

  function statusTag(status) {
    const tag = node("span", `status-tag ${status}`, statusLabel(status));
    tag.setAttribute("aria-label", `Rule status: ${statusLabel(status)}`);
    return tag;
  }

  function renderOverview(route) {
    const overview = node("section", "view overview-view");
    overview.setAttribute("aria-labelledby", "overview-title");
    const titleRow = node("div", "view-title-row");
    const titleMain = node("div", "view-title-main");
    titleMain.append(node("p", "eyebrow", "Illustrative static HTML review"));
    const h1 = node("h1", "page-title", analysis().metadata.title.replace(" | Northstar", ""));
    h1.id = "overview-title";
    h1.tabIndex = -1;
    titleMain.append(h1);
    titleMain.append(node("p", "page-url", analysis().requested_url));
    const scoreBox = node("div", "score-note");
    scoreBox.append(node("span", "score-label", "Heuristic score"));
    scoreBox.append(node("span", "score-value", `${analysis().deterministic_score.overall_score} / 100`));
    scoreBox.append(node("span", "score-caveat", "Weighted rule output. Not a Google ranking or index score."));
    titleRow.append(titleMain, scoreBox);
    overview.append(titleRow);

    const robots = selectedCheck("robots_directives");
    const lead = node("section", "lead-finding");
    lead.setAttribute("aria-labelledby", "lead-title");
    const statusSide = node("div", "lead-status");
    statusSide.append(node("span", "status-caption", "Rule result"), statusTag(robots.status));
    const copy = node("div", "lead-copy");
    copy.append(node("span", "source-marker", "Observed in static HTML"));
    const leadTitle = node("h2", "", "A noindex directive is present.");
    leadTitle.id = "lead-title";
    const leadExplanation = node("p", "", "If this page is meant to appear in search, review the publishing setting. This single fetch does not show whether Google has indexed or processed the page.");
    copy.append(leadTitle, leadExplanation);
    const inspect = button("Inspect evidence", "open-check", "lead-action");
    inspect.dataset.check = robots.id;
    lead.append(statusSide, copy, inspect);
    overview.append(lead);

    const meta = node("div", "overview-meta");
    const fetchBlock = node("div", "meta-block");
    fetchBlock.append(node("span", "meta-label", "Fixture transport context · mocked"));
    const fetchInfo = node("p", "meta-value");
    const f = analysis().fetch;
    fetchInfo.textContent = `HTTP ${f.status_code} · ${f.content_type} · ${f.bytes_read.toLocaleString()} decoded bytes · ${f.redirect_count} redirects · ${f.elapsed_time.toFixed(2)} s`;
    fetchBlock.append(fetchInfo);
    const outcomes = node("div", "meta-block");
    outcomes.append(node("span", "meta-label", "Rule outcomes · not severity"));
    const counts = countStatuses(checks());
    const statuses = node("div", "meta-statuses");
    for (const [key, labelText] of [["fail", "Fail"], ["warning", "Warning"], ["pass", "Pass"], ["not_applicable", "Not applicable"]]) {
      const item = node("span", "meta-status");
      const strong = node("strong", "", counts[key]);
      item.append(strong, document.createTextNode(` ${labelText}`));
      statuses.append(item);
    }
    outcomes.append(statuses);
    meta.append(fetchBlock, outcomes);
    overview.append(meta);

    const tools = node("div", "secondary-tools");
    const ai = node("p", "ai-note", "Optional AI suggestions are unavailable here. No provider was contacted.");
    tools.append(ai);
    const recheck = button("Show recheck simulation", "recheck", "button-link");
    const recheckNote = node("span", "recheck-note", "No recheck has been performed.");
    recheckNote.dataset.recheckMessage = "true";
    tools.append(recheck, recheckNote);
    overview.append(tools);

    const categories = node("section", "category-overview");
    categories.setAttribute("aria-labelledby", "category-heading");
    const categoryHeading = node("div", "section-heading");
    const headingGroup = node("div");
    headingGroup.append(node("p", "eyebrow", "Coverage by category"));
    const h2 = node("h2", "", "What the checks cover");
    h2.id = "category-heading";
    headingGroup.append(h2);
    const browse = button(`Review ${counts.fail + counts.warning} checks`, "findings", "button-link");
    categoryHeading.append(headingGroup, browse);
    categories.append(categoryHeading, categoryRows());
    categories.append(node("p", "score-footnote", "The 0–100 value is SEO Sensei’s weighted heuristic only. It does not measure rankings, indexing, traffic, content quality, backlinks, or Core Web Vitals."));
    overview.append(categories);
    return overview;
  }

  function reviewOrdered(route) {
    if (route.mode === "all") return checks().map((check, index) => ({ check, index }));
    const indexed = checks().map((check, index) => ({ check, index }));
    return ["fail", "warning"].flatMap((status) => indexed.filter(({ check }) => check.status === status));
  }

  function matching(route) {
    const query = route.q.trim().toLocaleLowerCase();
    return reviewOrdered(route).filter(({ check }) => {
      const haystack = [check.id, check.title, categoryLabel(check.category), check.evidence.observed, check.recommendation].join(" ").toLocaleLowerCase();
      return (!query || haystack.includes(query)) && (route.status === "all" || check.status === route.status);
    });
  }

  function findingRow(check) {
    const item = node("li", "finding-item");
    const open = button("", "open-check", "finding-open");
    open.dataset.check = check.id;
    open.dataset.openCheck = check.id;
    open.setAttribute("aria-label", `${statusLabel(check.status)} rule status. ${check.title}. Open evidence details.`);
    const mainText = node("span", "finding-main");
    mainText.append(node("span", "finding-name", check.title), statusTag(check.status));
    mainText.append(node("span", "finding-category", categoryLabel(check.category)));
    const evidence = node("span", "finding-evidence");
    evidence.append(node("span", "", check.evidence.observed));
    evidence.append(node("span", "finding-source", check.id === "robots_directives" ? "Source: static HTML directive" : "Source: analyzer evidence text"));
    open.append(mainText, evidence);
    item.append(open);
    return item;
  }

  function resultsContainer(route) {
    const area = node("div", "results-area");
    area.id = "findings-results";
    const visible = matching(route);
    const baseLength = reviewOrdered(route).filter(({ check }) => route.status === "all" || check.status === route.status).length;
    const count = node("p", "result-count", `Showing ${visible.length} of ${baseLength} ${route.mode === "all" ? "available" : "review"} checks`);
    count.id = "result-count";
    count.setAttribute("role", "status");
    count.setAttribute("aria-live", "polite");
    area.append(count);
    const empty = node("div", "empty-results");
    empty.hidden = visible.length > 0;
    empty.append(node("h2", "", "No checks match this view."));
    empty.append(node("p", "", "Clear the search or choose a different rule status. Your current view and filters are unchanged."));
    area.append(empty);

    const list = node("ol", "finding-list");
    list.setAttribute("aria-label", route.mode === "all" ? "All analyzer checks in fixture order" : "Failed checks followed by warnings, stable within each status");
    if (route.mode === "review" && route.status === "all" && !route.q) {
      for (const status of ["fail", "warning"]) {
        const group = visible.filter(({ check }) => check.status === status);
        if (!group.length) continue;
        const section = node("li", `status-group status-group-${status}`);
        const heading = node("div", "status-group-heading");
        heading.append(node("h2", "", status === "fail" ? "Failed rules" : "Warnings"));
        heading.append(node("span", "", `${group.length} ${group.length === 1 ? "check" : "checks"} · rule outcome`));
        section.append(heading);
        const groupList = node("ol", "finding-list");
        groupList.setAttribute("aria-label", `${statusLabel(status)} checks`);
        group.forEach(({ check }) => groupList.append(findingRow(check)));
        section.append(groupList);
        list.append(section);
      }
    } else {
      visible.forEach(({ check }) => list.append(findingRow(check)));
    }
    area.append(list);
    area.append(node("p", "findings-disclosure", "Needs review includes failed and warning rules, in that order. All checks follows fixture order and includes pass and not-applicable results. Status does not represent severity or business priority."));
    return area;
  }

  function renderFindings(route) {
    const section = node("section", "view findings-view");
    section.setAttribute("aria-labelledby", "findings-title");
    const header = node("header", "findings-heading");
    const copy = node("div", "heading-copy");
    copy.append(node("p", "eyebrow", "Deterministic rule results"));
    const h1 = node("h1", "", "Findings investigation");
    h1.id = "findings-title";
    h1.tabIndex = -1;
    copy.append(h1);
    copy.append(node("p", "", `${checks().length} checks are included in this fixture. Search findings and use rule status to narrow the list.`));
    const semantics = node("p", "status-semantics", "Fail and warning are analyzer statuses. They are not severity, urgency, or business value.");
    header.append(copy, semantics);
    section.append(header);

    const switcher = node("div", "review-switch");
    switcher.setAttribute("role", "group");
    switcher.setAttribute("aria-label", "Finding list scope");
    for (const [mode, label, count] of [["review", "Needs review", countStatuses(checks()).fail + countStatuses(checks()).warning], ["all", "All checks", checks().length]]) {
      const tab = button("", "mode", "");
      tab.dataset.mode = mode;
      tab.setAttribute("aria-pressed", String(route.mode === mode));
      tab.append(document.createTextNode(label));
      tab.append(node("span", "count", count));
      switcher.append(tab);
    }
    section.append(switcher);
    const explanation = route.mode === "review"
      ? "Failed rules appear first, followed by warnings. Order within each status follows the analyzer response."
      : "All 23 results are shown in the fixture’s original response order, including pass and not-applicable checks.";
    section.append(node("p", "review-explainer", explanation));

    const filters = node("div", "filter-row");
    const searchControl = node("div", "filter-control");
    const searchLabel = node("label", "", "Search findings");
    searchLabel.htmlFor = "finding-search";
    const search = node("input", "search-input");
    search.id = "finding-search";
    search.type = "search";
    search.placeholder = "Title, category, rule, observed text";
    search.value = route.q;
    search.setAttribute("aria-controls", "findings-results");
    searchControl.append(searchLabel, search);
    const filterControl = node("div", "filter-control");
    const statusLabelNode = node("label", "", "Rule status");
    statusLabelNode.htmlFor = "finding-status";
    const select = node("select", "status-select");
    select.id = "finding-status";
    select.setAttribute("aria-controls", "findings-results");
    for (const [value, label] of [["all", "All statuses"], ["fail", "Fail"], ["warning", "Warning"], ["pass", "Pass"], ["not_applicable", "Not applicable"]]) {
      const option = node("option", "", label);
      option.value = value;
      option.selected = route.status === value;
      select.append(option);
    }
    filterControl.append(statusLabelNode, select);
    const filterNote = node("p", "result-count", "");
    filterNote.textContent = "Filters apply to the selected list view.";
    filters.append(searchControl, filterControl, filterNote);
    section.append(filters, resultsContainer(route));

    search.addEventListener("input", () => {
      const next = readRoute();
      next.q = search.value;
      writeRoute(next, { replace: true });
      const area = section.querySelector("#findings-results");
      area.replaceWith(resultsContainer(next));
    });
    select.addEventListener("change", () => {
      const next = readRoute();
      next.status = select.value;
      writeRoute(next, { replace: true });
      const area = section.querySelector("#findings-results");
      area.replaceWith(resultsContainer(next));
    });
    return section;
  }

  function fixtureSourceLine(needle) {
    const lines = loaded.html.split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes(needle));
    return index < 0 ? null : { number: index + 1, line: lines[index].trim() };
  }

  function renderDetail(route) {
    const check = selectedCheck(route.check) || selectedCheck("robots_directives");
    const note = loaded.fixture.review_notes[check.id] || {};
    const section = node("section", "view detail-view");
    section.setAttribute("aria-labelledby", "detail-title");
    const back = button("← Back to findings", "back-findings", "detail-return");
    section.append(back);

    const header = node("header", "detail-head");
    const copy = node("div", "detail-head-copy");
    copy.append(node("p", "eyebrow", categoryLabel(check.category)));
    const h1 = node("h1", "", check.title);
    h1.id = "detail-title";
    h1.tabIndex = -1;
    copy.append(h1);
    header.append(copy, statusTag(check.status));
    section.append(header);
    section.append(node("p", "detail-meta", "Rule status describes this check only; no severity or business priority is supplied."));

    const grid = node("div", "detail-grid");
    const mainColumn = node("div", "detail-main");
    const observation = node("section", "detail-section");
    observation.append(node("p", "eyebrow", "01 · Observation returned"));
    observation.append(node("p", "evidence-value", check.evidence.observed));
    const provenance = node("div", "source-provenance");
    if (check.id === "robots_directives") {
      const line = fixtureSourceLine('<meta name="robots"');
      provenance.append(node("span", "source-type", "Static HTML · fictional fixture"));
      provenance.append(node("span", "", `northstar-solar.html · line ${line?.number || "not located"}`));
      observation.append(provenance);
      if (line) observation.append(node("pre", "source-excerpt", line.line));
      observation.append(node("p", "provenance-caveat", "This exact excerpt is from the bundled fictional HTML file. The production API returns typed evidence text, but no arbitrary source excerpt or DOM location."));
    } else {
      provenance.append(node("span", "source-type", "Analyzer evidence text"));
      provenance.append(node("span", "", "No source-node location returned"));
      observation.append(provenance);
      observation.append(node("p", "provenance-caveat", "The API field is checks[].evidence.observed. It does not identify the HTML node or line that produced this text."));
    }
    mainColumn.append(observation);

    const interpretation = node("section", "detail-section");
    interpretation.append(node("p", "eyebrow", "02 · Interpretation"));
    interpretation.append(node("p", "", note.why_it_matters || "This is the deterministic analyzer’s classification of the available input. It does not establish impact, search performance, or Google indexing."));
    if (check.id === "robots_directives") {
      interpretation.append(node("p", "provenance-caveat", "Google says crawlers must be able to fetch a page to read its robots meta or header directive. A single fetch cannot show whether Google has processed the instruction."));
    }
    mainColumn.append(interpretation);

    const aside = node("aside", "detail-aside");
    aside.setAttribute("aria-label", "Suggested action and verification");
    aside.append(node("span", "suggestion-label", "Suggested · not applied"));
    const suggestion = node("section", "detail-section");
    suggestion.append(node("p", "eyebrow", "03 · Possible next step"));
    suggestion.append(node("p", "", note.fix || check.recommendation));
    suggestion.append(node("p", "not-applied", "SEO Sensei has not changed the page or its publishing settings."));
    aside.append(suggestion);
    const verification = node("section", "detail-section");
    verification.append(node("p", "eyebrow", "04 · Verify after a change"));
    verification.append(node("p", "", note.verify || "Re-fetch the published page and compare the returned analyzer evidence. This prototype does not perform that recheck."));
    aside.append(verification);

    const routeChecks = matching(route).map((item) => item.check);
    const index = routeChecks.findIndex((item) => item.id === check.id);
    const switcher = node("div", "detail-switch");
    const previous = button(index > 0 ? `← ${routeChecks[index - 1].title}` : "No earlier match", "step-check");
    previous.dataset.direction = "previous";
    previous.disabled = index <= 0;
    const next = button(index >= 0 && index < routeChecks.length - 1 ? `${routeChecks[index + 1].title} →` : "No later match", "step-check");
    next.dataset.direction = "next";
    next.disabled = index < 0 || index >= routeChecks.length - 1;
    switcher.append(previous, next);
    aside.append(switcher);
    grid.append(mainColumn, aside);
    section.append(grid);
    return section;
  }

  function renderError(message) {
    const panel = node("section", "error-panel");
    panel.setAttribute("aria-labelledby", "error-title");
    panel.append(node("p", "eyebrow", "Address not opened"));
    const h1 = node("h1", "", "This sample cannot open that address.");
    h1.id = "error-title";
    h1.tabIndex = -1;
    panel.append(h1, node("p", "", message));
    panel.append(button("Return to URL entry", "change-page", "button-primary"));
    panel.append(node("p", "prototype-note", "No website request was made. Only the bundled Northstar Solar example can be shown."));
    app.replaceChildren(panel);
  }

  function render() {
    if (!loaded?.fixture) {
      globalSource.textContent = loaded?.error ? "Fixture unavailable" : "Loading local example";
      renderEntry();
      focusTarget();
      return;
    }
    const route = readRoute();
    globalSource.textContent = route.view === "entry" ? "Local example" : "Fixture report";
    if (route.view === "entry") {
      renderEntry();
      focusTarget();
      return;
    }
    const [context, nav] = reportChrome(route);
    let view;
    if (route.view === "overview") view = renderOverview(route);
    else if (route.view === "findings") view = renderFindings(route);
    else view = renderDetail(route);
    app.replaceChildren(context, nav, view);
    focusTarget();
  }

  function openCheck(checkId) {
    const route = readRoute();
    const target = selectedCheck(checkId);
    if (!target) return;
    route.view = "detail";
    route.check = checkId;
    const parent = `${window.location.pathname}${window.location.search}`;
    transition(route, { focus: "heading", parent });
  }

  function openSample(value) {
    const normalized = value.replace(/\/+$/, "");
    const expected = SAMPLE_URL.replace(/\/+$/, "");
    if (normalized !== expected) {
      const parsed = (() => { try { return new URL(value); } catch { return null; } })();
      const message = !value.trim()
        ? "Enter the Northstar example address or choose the bundled example. Nothing was requested."
        : (!parsed || !["http:", "https:"].includes(parsed.protocol)
          ? "Enter a complete HTTP or HTTPS address. This prototype does not contact addresses."
          : "This address is unsupported in the local design sample. Only the bundled Northstar example can be opened; the address was not contacted.");
      const route = { view: "error", mode: "review", q: "", status: "all", check: "" };
      writeRoute({ ...route, view: "entry" }, { replace: true });
      focusAfterRender = null;
      renderError(message);
      app.querySelector("h1")?.focus({ preventScroll: true });
      return false;
    }
    if (!loaded?.fixture) return false;
    const route = { view: "overview", mode: "review", q: "", status: "all", check: "" };
    transition(route, { focus: "heading" });
    return true;
  }

  app.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-form='url']")) return;
    event.preventDefault();
    const input = event.target.querySelector("#page-url");
    openSample(input.value.trim());
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "fill-sample") {
      const input = app.querySelector("#page-url");
      if (input) { input.value = SAMPLE_URL; input.focus(); }
      const message = app.querySelector("#form-message");
      if (message) { message.textContent = "Bundled example address filled. Select Open this report to display local fixture data."; message.dataset.kind = "info"; }
    } else if (action === "clear-address") {
      const input = app.querySelector("#page-url");
      if (input) { input.value = ""; input.focus(); }
      const message = app.querySelector("#form-message");
      if (message) { message.textContent = "Address cleared. You can restore the local example."; message.dataset.kind = ""; }
    } else if (action === "retry-fixture") {
      loadFixtures({ fromRetry: true });
    } else if (action === "change-page") {
      transition({ view: "entry", mode: "review", q: "", status: "all", check: "" }, { focus: "entry" });
    } else if (action === "overview" || action === "findings") {
      const route = readRoute();
      route.view = action;
      route.check = "";
      transition(route, { focus: "heading" });
    } else if (action === "mode") {
      const route = readRoute();
      route.view = "findings";
      route.mode = target.dataset.mode;
      route.check = "";
      transition(route, { focus: "heading" });
    } else if (action === "open-check") {
      openCheck(target.dataset.check);
    } else if (action === "back-findings") {
      returnedCheck = readRoute().check;
      const parent = window.history.state?.seoParent;
      const parentView = parent ? new URL(parent, window.location.href).searchParams.get("view") : null;
      if (parentView === "findings") window.history.back();
      else {
        const route = readRoute();
        route.view = "findings";
        route.check = "";
        transition(route, { focus: "heading", replace: Boolean(parent) });
      }
    } else if (action === "step-check") {
      const route = readRoute();
      const ordered = matching(route).map((item) => item.check);
      const at = ordered.findIndex((item) => item.id === route.check);
      const next = target.dataset.direction === "next" ? ordered[at + 1] : ordered[at - 1];
      if (next) {
        route.check = next.id;
        const parent = window.history.state?.seoParent || null;
        transition(route, { focus: "heading", parent, replace: true });
      }
    } else if (action === "recheck") {
      if (recheckTimer) window.clearTimeout(recheckTimer);
      const message = app.querySelector("[data-recheck-message]");
      target.disabled = true;
      target.setAttribute("aria-busy", "true");
      target.textContent = "Simulation running…";
      if (message) message.textContent = "Prototype simulation only. No request is sent and report data does not change.";
      recheckTimer = window.setTimeout(() => {
        target.disabled = false;
        target.removeAttribute("aria-busy");
        target.textContent = "Show recheck simulation";
        if (message) message.textContent = "No recheck was performed. The illustrative fixture remains unchanged.";
      }, 700);
    }
  });

  window.addEventListener("popstate", () => {
    const route = readRoute();
    focusAfterRender = route.view === "findings" && returnedCheck ? "returned" : "heading";
    render();
    returnedCheck = null;
  });

  function loadFixtures({ fromRetry = false } = {}) {
    loaded = null;
    focusAfterRender = fromRetry ? "fixture-status" : null;
    globalSource.textContent = "Loading local example";
    render();
    Promise.all([
      fetch("../fixtures/audit.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("Bundled audit fixture unavailable");
        return response.json();
      }),
      fetch("../fixtures/northstar-solar.html", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("Bundled HTML fixture unavailable");
        return response.text();
      }),
    ]).then(([fixture, html]) => {
      if (!Array.isArray(fixture.analysis?.checks) || fixture.analysis.checks.length !== 23) throw new Error("Expected the existing 23-check sample");
      loaded = { fixture, html };
      if (fromRetry) focusAfterRender = readRoute().view === "entry" ? "entry" : "heading";
      render();
    }).catch(() => {
      loaded = { error: true };
      focusAfterRender = "fixture-status";
      render();
    });
  }

  const initial = readRoute();
  if (initial.view === "error") initial.view = "entry";
  render();
  loadFixtures();
})();
