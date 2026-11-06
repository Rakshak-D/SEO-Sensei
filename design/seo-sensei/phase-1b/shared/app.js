(() => {
  "use strict";

  const STATUS = {
    fail: "Fail",
    warning: "Warning",
    pass: "Pass",
    not_applicable: "Not applicable",
  };
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
  const sampleUrl = "https://northstar.example/guides/home-solar/";

  const text = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value == null ? "" : String(value);
    return node;
  };
  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  };
  const statusName = (status) => STATUS[status] || status.replaceAll("_", " ");
  const categoryName = (category) => CATEGORY[category] || category.replaceAll("_", " ");

  function countStatuses(checks) {
    return checks.reduce((result, check) => {
      result[check.status] = (result[check.status] || 0) + 1;
      return result;
    }, { fail: 0, warning: 0, pass: 0, not_applicable: 0 });
  }

  function renderCategories(categories, checks) {
    const list = document.querySelector("[data-categories]");
    if (!list) return;
    list.replaceChildren();
    categories.forEach((category) => {
      const members = checks.filter((check) => check.category === category.category);
      const counts = countStatuses(members);
      const row = make("li", "category-row");
      const name = make("span", "category-name", categoryName(category.category));
      const summary = make("span", "category-summary");
      const fragments = [];
      if (counts.fail) fragments.push(counts.fail + " fail");
      if (counts.warning) fragments.push(counts.warning + " warning");
      if (counts.pass) fragments.push(counts.pass + " pass");
      if (counts.not_applicable) fragments.push(counts.not_applicable + " N/A");
      summary.textContent = members.length + (members.length === 1 ? " check · " : " checks · ") + fragments.join(" · ");
      row.append(name, summary);
      list.append(row);
    });
  }

  function renderCheckRow(check) {
    const row = make("li", "check-row");
    const button = make("button", "check-open");
    button.type = "button";
    button.dataset.openDetail = check.id;
    button.setAttribute("aria-label", "Rule result: " + statusName(check.status) + ". " + check.title + ". Open evidence details.");

    const head = make("span", "check-head");
    const title = make("span", "check-title", check.title);
    const status = make("span", "rule-status rule-status-" + check.status, statusName(check.status));
    head.append(title, status);

    const category = make("span", "check-category", categoryName(check.category));
    const evidence = make("span", "check-evidence", check.evidence.observed);
    const sourceHint = make("span", "source-hint", "Analyzer evidence text");
    const body = make("span", "check-body");
    body.append(category, evidence, sourceHint);
    button.append(head, body);
    row.append(button);
    return row;
  }

  function renderChecks(checks) {
    const list = document.querySelector("[data-check-list]");
    const search = document.querySelector("#check-search");
    const filter = document.querySelector("#status-filter");
    const empty = document.querySelector("#no-matches");
    const count = document.querySelector("[data-filter-count]");
    if (!list) return;

    const query = (search && search.value || "").trim().toLocaleLowerCase();
    const status = filter && filter.value || "all";
    const visible = checks.filter((check) => {
      const haystack = [check.id, check.title, categoryName(check.category), check.evidence.observed].join(" ").toLocaleLowerCase();
      return (!query || haystack.includes(query)) && (status === "all" || check.status === status);
    });
    list.replaceChildren(...visible.map(renderCheckRow));
    if (empty) empty.hidden = visible.length > 0;
    if (count) count.textContent = "Showing " + visible.length + " of " + checks.length + " checks";
  }

  function findSourceLine(source, needle) {
    const lines = source.split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes(needle));
    return index < 0 ? null : { number: index + 1, line: lines[index].trim() };
  }

  function renderDetail(check, loaded) {
    if (!check) return;
    const note = loaded.review_notes[check.id] || {};
    text("[data-detail-title]", check.title);
    text("[data-detail-category]", categoryName(check.category));
    const status = text("[data-detail-status]", statusName(check.status));
    if (status) {
      status.className = "rule-status rule-status-" + check.status;
      status.setAttribute("aria-label", "Rule result: " + statusName(check.status));
    }
    text("[data-detail-observed]", check.evidence.observed);

    const sourceLabel = document.querySelector("[data-source-label]");
    const excerptWrap = document.querySelector("[data-fixture-excerpt-wrap]");
    const excerpt = document.querySelector("[data-fixture-excerpt]");
    const robotsLine = findSourceLine(loaded.fixtureHtml, '<meta name="robots"');
    if (check.id === "robots_directives" && robotsLine && excerptWrap && excerpt) {
      sourceLabel.textContent = "Fictional fixture source · northstar-solar.html · line " + robotsLine.number;
      excerpt.textContent = robotsLine.line;
      excerptWrap.hidden = false;
    } else {
      sourceLabel.textContent = "Analyzer response · checks[].evidence.observed; no source-node location is returned.";
      if (excerptWrap) excerptWrap.hidden = true;
    }
    text("[data-detail-explanation]", note.why_it_matters || "This status is the deterministic rule's classification of its input; it does not represent severity or a business priority.");
    text("[data-detail-next-step]", note.fix || check.recommendation);
    text("[data-detail-verify]", note.verify || "Review the deployed page after changes. This prototype does not perform a recheck.");
  }

  function init(loaded) {
    const analysis = loaded.analysis;
    const checks = analysis.checks;
    const score = analysis.deterministic_score;
    const counts = countStatuses(checks);
    const reviewCount = counts.fail + counts.warning;
    document.querySelectorAll("[data-page-url]").forEach((node) => { node.textContent = analysis.requested_url; });
    document.querySelectorAll("[data-score]").forEach((node) => { node.textContent = String(score.overall_score); });
    document.querySelectorAll("[data-total-checks]").forEach((node) => { node.textContent = String(checks.length); });
    document.querySelectorAll("[data-review-count]").forEach((node) => { node.textContent = String(reviewCount); });
    document.querySelectorAll("[data-status-summary]").forEach((node) => {
      node.textContent = counts.fail + " fail · " + counts.warning + " warnings · " + counts.pass + " pass · " + counts.not_applicable + " not applicable";
    });
    document.querySelectorAll("[data-fetch-context]").forEach((node) => {
      node.textContent = "Fixture supplied: HTTP " + analysis.fetch.status_code + " · " + analysis.fetch.content_type + " · " + analysis.fetch.bytes_read.toLocaleString() + " decoded bytes · " + analysis.fetch.redirect_count + " redirects · " + analysis.fetch.elapsed_time.toFixed(2) + " s";
    });
    document.querySelectorAll("[data-fixture-notice]").forEach((node) => {
      node.textContent = "Illustrative fixture · no page request made · transport values below are mocked.";
    });
    document.querySelectorAll("[data-url-message]").forEach((node) => {
      node.textContent = "Local illustrative data loaded. No page request was made.";
      node.dataset.kind = "info";
    });
    renderCategories(score.categories, checks);
    renderChecks(checks);

    let selectedId = "robots_directives";
    const panels = [...document.querySelectorAll("[data-view-panel]")];
    const navigation = [...document.querySelectorAll("[data-nav-view]")];
    function showView(view, shouldScroll) {
      panels.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
      text("[data-view-label]", { overview: "Overview", findings: "Findings", detail: "Evidence" }[view] || "Audit");
      navigation.forEach((item) => {
        const active = item.dataset.navView === view;
        item.classList.toggle("is-active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      if (view === "detail") renderDetail(checks.find((item) => item.id === selectedId), loaded);
      const route = new URLSearchParams();
      route.set("view", view);
      if (view === "detail") route.set("check", selectedId);
      window.history.replaceState(null, "", "?" + route.toString());
      if (shouldScroll) {
        const target = document.querySelector("#main-content");
        if (target && window.matchMedia("(max-width: 740px)").matches) {
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
        }
      }
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest("button, a");
      if (!target) return;
      if (target.matches("[data-nav-view]")) {
        showView(target.dataset.navView, true);
        if (target.dataset.navView === "findings") document.querySelector("#check-search")?.focus({ preventScroll: true });
        return;
      }
      if (target.matches("[data-open-detail]")) {
        selectedId = target.dataset.openDetail;
        showView("detail", true);
        document.querySelector("[data-detail-title]")?.focus({ preventScroll: true });
        return;
      }
      if (target.matches("[data-back-findings]")) {
        showView("findings", true);
        document.querySelector("#check-search")?.focus({ preventScroll: true });
      }
    });

    document.querySelector("#check-search")?.addEventListener("input", () => renderChecks(checks));
    document.querySelector("#status-filter")?.addEventListener("change", () => renderChecks(checks));

    document.querySelectorAll("[data-page-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = form.querySelector("input[type=url]");
        const notice = form.querySelector("[data-url-message]");
        const value = (input && input.value || "").trim();
        const setNotice = (message, kind) => {
          if (notice) {
            notice.textContent = message;
            notice.dataset.kind = kind;
          }
        };
        if (!value) {
          setNotice("Enter a URL or restore the local example. No request was made.", "error");
          input?.focus();
          return;
        }
        let parsed;
        try { parsed = new URL(value); } catch { parsed = null; }
        if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
          setNotice("Only a complete HTTP or HTTPS address is accepted by the form. This prototype does not fetch URLs.", "error");
          input?.focus();
          return;
        }
        if (value.replace(/\/+$/, "") !== sampleUrl.replace(/\/+$/, "")) {
          setNotice("This local demo only opens its built-in fixture. Other, blocked, private, or unreachable URLs are not contacted.", "error");
          return;
        }
        setNotice("Showing the offline fixture. No page request was sent.", "info");
        showView("overview", true);
      });
    });

    document.querySelectorAll("[data-clear-url]").forEach((button) => {
      button.addEventListener("click", () => {
        const form = button.closest("[data-page-form]");
        const input = form && form.querySelector("input[type=url]");
        const notice = form && form.querySelector("[data-url-message]");
        if (input) { input.value = ""; input.focus(); }
        if (notice) { notice.textContent = "Enter a URL or restore the local example. No request was made."; notice.dataset.kind = "empty"; }
      });
    });
    document.querySelectorAll("[data-fill-sample]").forEach((button) => {
      button.addEventListener("click", () => {
        const form = button.closest("[data-page-form]");
        const input = form && form.querySelector("input[type=url]");
        if (input) { input.value = sampleUrl; input.focus(); }
      });
    });

    document.querySelectorAll("[data-recheck]").forEach((button) => {
      button.addEventListener("click", () => {
        const message = document.querySelector("[data-recheck-message]");
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        if (message) message.textContent = "Simulation only: waiting briefly; no request will be sent and fixture data will not change.";
        window.setTimeout(() => {
          if (message) message.textContent = "No recheck was performed. The illustrative fixture remains unchanged.";
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }, 650);
      });
    });

    document.querySelectorAll("[data-ai-state]").forEach((node) => {
      node.textContent = "Optional AI suggestions are unavailable in this prototype. No provider was contacted.";
    });

    const query = new URLSearchParams(window.location.search);
    const requestedView = query.get("view");
    const requestedCheck = query.get("check");
    if (checks.some((check) => check.id === requestedCheck)) selectedId = requestedCheck;
    showView(["overview", "findings", "detail"].includes(requestedView) ? requestedView : "overview", false);
    const firstForm = document.querySelector("[data-page-form]");
    const firstInput = firstForm && firstForm.querySelector("input[type=url]");
    if (firstInput) firstInput.value = analysis.requested_url;
  }

  Promise.all([
    fetch("../../fixtures/audit.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Local audit fixture unavailable");
      return response.json();
    }),
    fetch("../../fixtures/northstar-solar.html", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Local source fixture unavailable");
      return response.text();
    }),
  ]).then((values) => {
    values[0].fixtureHtml = values[1];
    init(values[0]);
  }).catch(() => {
    document.querySelectorAll("[data-fixture-notice]").forEach((node) => {
      node.textContent = "Local illustrative data could not be loaded. No website request was attempted.";
    });
    document.querySelectorAll("[data-load-error]").forEach((node) => { node.hidden = false; });
  });
})();
