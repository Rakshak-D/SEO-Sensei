(() => {
  "use strict";

  const categoryLabels = {
    technical_indexability: "Technical & indexability",
    metadata: "Metadata",
    headings_content_structure: "Headings & content",
    links: "Links",
    images: "Images",
    structured_data: "Structured data",
    social_metadata: "Social metadata",
    html_signals: "HTML signals",
  };

  const statusLabels = {
    fail: "Fail",
    warning: "Warning",
    pass: "Pass",
    not_applicable: "Not applicable",
  };

  const titleCase = (value) => value.replaceAll("_", " ");

  function make(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function statusChip(status) {
    return make("span", `status-chip status-${status}`, statusLabels[status] || status);
  }

  function statusCounts(checks) {
    return checks.reduce(
      (counts, check) => {
        counts[check.status] = (counts[check.status] || 0) + 1;
        return counts;
      },
      { fail: 0, warning: 0, pass: 0, not_applicable: 0 },
    );
  }

  function renderCategories(container, categories, checks) {
    if (!container) return;
    container.replaceChildren();
    categories.forEach((category) => {
      const categoryChecks = checks.filter((check) => check.category === category.category);
      const counts = statusCounts(categoryChecks);
      const row = make("article", "category-row");
      const heading = make("div", "category-heading");
      heading.append(
        make("span", "category-name", categoryLabels[category.category] || titleCase(category.category)),
        make("span", "category-points", `${category.points_earned.toFixed(category.points_earned % 1 ? 1 : 0)} / ${category.max_points.toFixed(0)}`),
      );
      const progress = make("progress", "category-progress");
      progress.max = category.max_points;
      progress.value = category.points_earned;
      progress.setAttribute("aria-label", `${categoryLabels[category.category]} heuristic points`);
      const summary = make("p", "category-statuses");
      const parts = [];
      if (counts.fail) parts.push(`${counts.fail} fail`);
      if (counts.warning) parts.push(`${counts.warning} warning`);
      if (counts.pass) parts.push(`${counts.pass} pass`);
      if (counts.not_applicable) parts.push(`${counts.not_applicable} not applicable`);
      summary.textContent = parts.join(" · ");
      row.append(heading, progress, summary);
      container.append(row);
    });
  }

  function renderFindings(container, checks, compact = false) {
    if (!container) return;
    container.replaceChildren();
    checks.forEach((check) => {
      const button = make("button", `finding-row${compact ? " finding-row-compact" : ""}`);
      button.type = "button";
      button.dataset.openDetail = check.id;
      button.setAttribute("aria-label", `${statusLabels[check.status]}: ${check.title}. Open evidence.`);

      const top = make("div", "finding-row-top");
      const title = make("strong", "finding-title", check.title);
      const label = statusChip(check.status);
      top.append(title, label);

      const meta = make("div", "finding-row-meta");
      meta.append(
        make("span", "finding-category", categoryLabels[check.category] || titleCase(check.category)),
        make("span", "finding-evidence", check.evidence.observed),
      );
      const arrow = make("span", "finding-arrow", "View evidence");
      arrow.setAttribute("aria-hidden", "true");
      button.append(top, meta, arrow);
      container.append(button);
    });
  }

  function renderDetail(check, reviewNotes) {
    if (!check) return;
    const note = reviewNotes[check.id] || {};
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value || "No additional guidance is included in this fixture.";
    };
    set("detail-title", check.title);
    set("detail-category", categoryLabels[check.category] || titleCase(check.category));
    set("detail-observation", check.evidence.observed);
    set("detail-explanation", note.why_it_matters || "This is an observation from the local HTML fixture and the supplied mock fetch metadata.");
    set("detail-fix", note.fix || check.recommendation);
    set("detail-verify", note.verify || "Re-run a review after the page has been changed and deployed.");

    const status = document.getElementById("detail-status");
    if (status) {
      status.className = `status-chip status-${check.status}`;
      status.textContent = statusLabels[check.status] || check.status;
    }
    const excerpt = document.getElementById("source-excerpt");
    if (excerpt) {
      const showExcerpt = check.id === "robots_directives";
      excerpt.hidden = !showExcerpt;
      if (showExcerpt) excerpt.textContent = '<meta name="robots" content="noindex, follow">';
    }
  }

  function init(loaded) {
    const { analysis, review_notes: reviewNotes, fixture_notice: fixtureNotice } = loaded;
    const checks = analysis.checks;
    const score = analysis.deterministic_score;
    const counts = statusCounts(checks);

    document.querySelectorAll("[data-fixture-notice]").forEach((node) => {
      node.textContent = fixtureNotice;
    });
    document.querySelectorAll("[data-audit-url]").forEach((node) => {
      node.textContent = analysis.requested_url;
    });
    document.querySelectorAll("[data-score]").forEach((node) => {
      node.textContent = String(score.overall_score);
    });
    document.querySelectorAll("[data-score-raw]").forEach((node) => {
      node.textContent = `${score.points_earned.toFixed(1)} / 100 raw points`;
    });
    document.querySelectorAll("[data-check-count]").forEach((node) => {
      node.textContent = `${checks.length} checks`;
    });
    document.querySelectorAll("[data-status-counts]").forEach((node) => {
      node.textContent = `${counts.fail} fail · ${counts.warning} warnings · ${counts.pass} pass · ${counts.not_applicable} not applicable`;
    });
    document.querySelectorAll("[data-category-breakdown]").forEach((node) => {
      renderCategories(node, score.categories, checks);
    });

    const needsReview = checks.filter((check) => check.status === "fail" || check.status === "warning");
    document.querySelectorAll("[data-overview-findings]").forEach((node) => {
      renderFindings(node, needsReview.slice(0, 4), true);
    });
    document.querySelectorAll("[data-all-findings]").forEach((node) => {
      renderFindings(node, checks, false);
    });

    const detailIds = new Set(checks.map((check) => check.id));
    const firstDetail = new URLSearchParams(window.location.hash.replace(/^#/, "?")).get("detail");
    let selectedId = detailIds.has(firstDetail) ? firstDetail : "robots_directives";
    const panels = [...document.querySelectorAll("[data-panel]")];
    const navItems = [...document.querySelectorAll("[data-nav]")];

    function showView(view, shouldScroll = false) {
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== view;
      });
      navItems.forEach((item) => {
        const active = item.dataset.nav === view;
        item.classList.toggle("is-active", active);
        item.classList.toggle("is-current", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      if (view === "detail") {
        renderDetail(checks.find((check) => check.id === selectedId), reviewNotes);
      }
      window.history.replaceState(null, "", `#${view}`);
      const main = document.getElementById("main-content");
      if (shouldScroll && main && window.matchMedia("(max-width: 720px)").matches) {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        main.scrollIntoView({ block: "start", behavior });
      }
    }

    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) {
        showView(nav.dataset.nav, true);
        return;
      }
      const opener = event.target.closest("[data-open-detail]");
      if (opener) {
        selectedId = opener.dataset.openDetail;
        showView("detail", true);
      }
    });

    const search = document.getElementById("finding-search");
    const filter = document.getElementById("finding-status-filter");
    const noResults = document.getElementById("no-results");
    function applyFilters() {
      const query = (search?.value || "").trim().toLowerCase();
      const wantedStatus = filter?.value || "all";
      const visible = checks.filter((check) => {
        const haystack = `${check.title} ${categoryLabels[check.category]} ${check.evidence.observed} ${check.id}`.toLowerCase();
        return (!query || haystack.includes(query)) && (wantedStatus === "all" || wantedStatus === check.status);
      });
      renderFindings(document.querySelector("[data-all-findings]"), visible, false);
      if (noResults) noResults.hidden = visible.length !== 0;
      const resultCount = document.getElementById("result-count");
      if (resultCount) resultCount.textContent = `${visible.length} of ${checks.length} checks`;
    }
    search?.addEventListener("input", applyFilters);
    filter?.addEventListener("change", applyFilters);

    const form = document.querySelector("[data-sample-form]");
    const urlInput = document.getElementById("sample-url");
    const message = document.getElementById("prototype-message");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = (urlInput?.value || "").trim();
      if (!value) {
        message.textContent = "Enter a page URL or restore the built-in sample. No request was made.";
        message.dataset.kind = "error";
        urlInput?.focus();
        return;
      }
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        parsed = null;
      }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        message.textContent = "Use a complete HTTP or HTTPS URL. This prototype does not send requests.";
        message.dataset.kind = "error";
        urlInput?.focus();
        return;
      }
      if (value.replace(/\/$/, "") !== analysis.requested_url.replace(/\/$/, "")) {
        message.textContent = "This prototype opens only its built-in example. The URL was not contacted.";
        message.dataset.kind = "error";
        return;
      }
      message.textContent = "Opening the local example…";
      message.dataset.kind = "loading";
      window.setTimeout(() => {
        message.textContent = "Local example open. No network request was made.";
        message.dataset.kind = "success";
        showView("overview", true);
      }, 280);
    });

    const clearButton = document.querySelector("[data-clear-url]");
    clearButton?.addEventListener("click", () => {
      if (urlInput) {
        urlInput.value = "";
        urlInput.focus();
      }
      if (message) {
        message.textContent = "Enter a page URL or restore the built-in sample. No request was made.";
        message.dataset.kind = "empty";
      }
    });

    const requestedView = window.location.hash.replace(/^#/, "");
    showView(["overview", "findings", "detail"].includes(requestedView) ? requestedView : "overview");
    renderDetail(checks.find((check) => check.id === selectedId), reviewNotes);
    if (message) {
      message.textContent = "Illustrative fixture loaded locally; no page request was made.";
      message.dataset.kind = "fixture";
    }
  }

  fetch("../fixtures/audit.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("fixture unavailable");
      return response.json();
    })
    .then(init)
    .catch(() => {
      document.querySelectorAll("[data-fixture-notice]").forEach((node) => {
        node.textContent = "The local demo fixture could not be loaded. No website request was made.";
      });
      const message = document.getElementById("prototype-message");
      if (message) message.textContent = "Demo data unavailable. Refresh the local prototype server.";
    });
})();
