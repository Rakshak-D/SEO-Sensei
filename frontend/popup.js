(function () {
    "use strict";
    const api = globalThis.SeoSenseiApi;
    const $ = (id) => document.getElementById(id);
    let current = null;

    function addText(parent, className, text) {
        const node = document.createElement("span");
        node.className = className || "";
        node.textContent = String(text ?? "");
        parent.appendChild(node);
        return node;
    }

    function showError(error) {
        $("errorPanel").hidden = false;
        $("errorTitle").textContent = ["auth_required", "auth_invalid", "configuration_error"].includes(error.code) ? "API configuration needed" : "Analysis unavailable";
        $("errorMessage").textContent = error.message || "The API request could not be completed.";
        $("errorRequestId").textContent = error.requestId ? `Request ID: ${error.requestId}` : "";
        $("statusText").textContent = "No analysis loaded.";
    }

    function clearError() { $("errorPanel").hidden = true; $("errorMessage").textContent = ""; $("errorRequestId").textContent = ""; }

    function renderCategories(categories) {
        const grid = $("categoryGrid"); grid.replaceChildren();
        (Array.isArray(categories) ? categories : []).slice(0, 8).forEach((category) => {
            const card = document.createElement("div"); card.className = "category-card";
            addText(card, "category-name", String(category.category || "").replaceAll("_", " "));
            addText(card, "category-score", `${Number(category.points_earned || 0).toFixed(1)} / ${Number(category.max_points || 0).toFixed(0)}`);
            grid.appendChild(card);
        });
    }

    function renderChecks(checks) {
        const list = $("checksList"); list.replaceChildren();
        const important = (Array.isArray(checks) ? checks : []).filter((check) => check.status === "fail" || check.status === "warning").slice(0, 8);
        $("checkCount").textContent = String(important.length);
        if (!important.length) { addText(list, "muted", "No failed or warning checks recorded."); return; }
        important.forEach((check) => {
            const item = document.createElement("div"); item.className = `check ${check.status === "fail" ? "fail" : ""}`;
            addText(item, "check-title", `${String(check.status).toUpperCase()} · ${check.title || "Check"}`);
            addText(item, "check-evidence", check.evidence && check.evidence.observed ? check.evidence.observed : "No evidence supplied.");
            addText(item, "check-action", check.recommendation || "Review this finding.");
            list.appendChild(item);
        });
    }

    function detailRow(label, value) {
        const row = document.createElement("div"); row.className = "detail-row";
        addText(row, "", label);
        const strong = document.createElement("strong"); strong.textContent = String(value ?? "—"); row.appendChild(strong);
        return row;
    }

    function renderDetails(data) {
        const page = $("pageSignals"); page.replaceChildren();
        const metadata = data.metadata || {};
        [
            ["Title", metadata.title || "Missing"], ["Description", metadata.description || "Missing"],
            ["Canonical", metadata.canonical_resolved || metadata.canonical || "Missing"],
            ["Robots", Array.isArray(metadata.robots_directives) ? metadata.robots_directives.join(", ") || "None" : "None"],
            ["Visible words", data.lexical_signals && data.lexical_signals.visible_word_count],
            ["Images", data.images && data.images.total], ["Internal links", data.links && data.links.internal],
        ].forEach(([label, value]) => page.appendChild(detailRow(label, value)));
        const transport = $("transportSignals"); transport.replaceChildren();
        const fetch = data.fetch || {};
        [["HTTP status", fetch.status_code], ["Content type", fetch.content_type || "Unknown"], ["Bytes", fetch.bytes_read], ["Redirects", fetch.redirect_count], ["Final URL", data.final_url]].forEach(([label, value]) => transport.appendChild(detailRow(label, value)));
    }

    function renderAi(data) {
        const ai = data.ai_recommendations; const state = ai && ai.state;
        const list = $("aiList"); list.replaceChildren();
        if (!ai || state !== "available") { $("aiState").textContent = ai && ai.message ? ai.message : "AI recommendations were not requested."; return; }
        $("aiState").textContent = "Grounded in the deterministic findings above.";
        (Array.isArray(ai.recommendations) ? ai.recommendations : []).slice(0, 5).forEach((recommendation) => {
            const item = document.createElement("div"); item.className = "ai-item";
            addText(item, "ai-priority", `${String(recommendation.priority || "medium").toUpperCase()} · ${recommendation.issue || "Recommendation"}`);
            addText(item, "", recommendation.recommendation || recommendation.explanation || "Review the deterministic finding.");
            list.appendChild(item);
        });
    }

    function render(data, tab) {
        current = data; clearError(); $("results").hidden = false; $("statusText").textContent = "Analysis complete.";
        $("pageHost").textContent = new URL(data.final_url || tab.url).hostname;
        $("pageTitle").textContent = data.metadata && data.metadata.title ? data.metadata.title : tab.title;
        const score = Number(data.deterministic_score.overall_score); $("scoreValue").textContent = `${score}/100`; $("scoreRingValue").textContent = String(score); $("scoreRing").style.borderColor = score >= 80 ? "var(--mint)" : score >= 50 ? "var(--amber)" : "var(--coral)";
        renderCategories(data.deterministic_score.categories); renderChecks(data.checks); renderDetails(data); renderAi(data);
    }

    async function analyze() {
        const button = $("analyzeBtn"); button.disabled = true; clearError(); $("results").hidden = true; $("statusText").textContent = "Asking the API to inspect this page…";
        try { const result = await api.analyzeCurrentTab(); render(result.analysis, result.tab); }
        catch (error) { showError(error instanceof api.ExtensionApiError ? error : new api.ExtensionApiError("unknown", "The extension could not complete the request.")); }
        finally { button.disabled = false; }
    }

    function openOptions() { chrome.runtime.openOptionsPage(); }
    $("analyzeBtn").addEventListener("click", analyze); $("settingsBtn").addEventListener("click", openOptions); $("optionsLink").addEventListener("click", openOptions);
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => { const tab = tabs[0]; if (tab && tab.url) { try { $("pageHost").textContent = new URL(tab.url).hostname; } catch (_) {} $("pageTitle").textContent = tab.title || "Ready to analyze."; } });
}());
