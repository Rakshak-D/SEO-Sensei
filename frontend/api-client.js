(function (root) {
    "use strict";

    const STORAGE_KEY = "seoSenseiApiConfig";
    const REQUEST_TIMEOUT_MS = 10000;

    class ExtensionApiError extends Error {
        constructor(code, message, details) {
            super(message);
            this.name = "ExtensionApiError";
            this.code = code;
            this.status = details && details.status;
            this.requestId = details && details.requestId;
            this.retryAfter = details && details.retryAfter;
        }
    }

    function normalizeBaseUrl(value) {
        const trimmed = String(value || "").trim().replace(/\/+$/, "");
        let parsed;
        try { parsed = new URL(trimmed); } catch (_) { throw new ExtensionApiError("invalid_configuration", "Enter a valid API URL."); }
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new ExtensionApiError("invalid_configuration", "The API URL must be a credential-free HTTP or HTTPS origin.");
        }
        return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
    }

    function originPermission(baseUrl) {
        return `${new URL(baseUrl).origin}/*`;
    }

    async function getConfig() {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const config = stored[STORAGE_KEY] || {};
        return { baseUrl: config.baseUrl || "", hasToken: Boolean(config.token) };
    }

    async function getPrivateConfig() {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        return stored[STORAGE_KEY] || {};
    }

    async function saveConfig(baseUrl, token) {
        const normalized = normalizeBaseUrl(baseUrl);
        if (!String(token || "").trim()) throw new ExtensionApiError("invalid_configuration", "Enter an API access token.");
        await chrome.storage.local.set({ [STORAGE_KEY]: { baseUrl: normalized, token: String(token).trim() } });
        return { baseUrl: normalized, hasToken: true };
    }

    async function clearConfig() {
        await chrome.storage.local.remove(STORAGE_KEY);
    }

    async function ensurePermission(baseUrl) {
        const pattern = originPermission(baseUrl);
        if (await chrome.permissions.contains({ origins: [pattern] })) return;
        const granted = await chrome.permissions.request({ origins: [pattern] });
        if (!granted) throw new ExtensionApiError("permission_denied", "Allow API access for the configured origin, then try again.");
    }

    function validateAnalysis(data) {
        const score = data && data.deterministic_score && data.deterministic_score.overall_score;
        let finalUrl;
        try { finalUrl = new URL(data && data.final_url); } catch (_) { finalUrl = null; }
        if (!data || !finalUrl || !["http:", "https:"].includes(finalUrl.protocol) || !Number.isInteger(score) || score < 0 || score > 100 || !Array.isArray(data.checks) || !Array.isArray(data.deterministic_score.categories) || !data.metadata || !data.fetch) {
            throw new ExtensionApiError("malformed_response", "The API returned an invalid analysis response.");
        }
        return data;
    }

    async function requestJson(path, options) {
        const config = await getPrivateConfig();
        if (!config.baseUrl) throw new ExtensionApiError("configuration_error", "Configure the API URL in extension settings.");
        if (options.authenticated !== false && !config.token) throw new ExtensionApiError("configuration_error", "Configure the API access token in extension settings.");
        const baseUrl = normalizeBaseUrl(config.baseUrl);
        await ensurePermission(baseUrl);
        const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const headers = { "Accept": "application/json", "X-Request-ID": requestId };
        if (options.authenticated !== false) headers.Authorization = `Bearer ${config.token || ""}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method: options.method || "GET",
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });
            const responseRequestId = response.headers.get("x-request-id") || requestId;
            let payload = null;
            try { payload = await response.json(); } catch (_) { throw new ExtensionApiError("malformed_response", "The API returned an invalid JSON response.", { status: response.status, requestId: responseRequestId }); }
            if (!response.ok) {
                const error = payload && payload.error;
                const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
                throw new ExtensionApiError(error && error.code ? error.code : "api_error", error && error.message ? error.message : "The API request failed.", { status: response.status, requestId: error && error.request_id ? error.request_id : responseRequestId, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
            }
            return { payload, requestId: responseRequestId };
        } catch (error) {
            if (error instanceof ExtensionApiError) throw error;
            if (error && error.name === "AbortError") throw new ExtensionApiError("timeout", "The API request timed out.", { requestId });
            throw new ExtensionApiError("network_error", "The API could not be reached.", { requestId });
        } finally { clearTimeout(timer); }
    }

    async function getActiveTab() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab || !tab.url) throw new ExtensionApiError("invalid_tab", "The current tab does not expose an analyzable URL.");
        let parsed;
        try { parsed = new URL(tab.url); } catch (_) { throw new ExtensionApiError("invalid_url", "The current tab URL is invalid."); }
        if (!["http:", "https:"].includes(parsed.protocol) || tab.url.length > 2048) throw new ExtensionApiError("unsupported_url", "Only ordinary HTTP and HTTPS pages can be analyzed.");
        return { url: tab.url, title: tab.title || parsed.hostname };
    }

    async function analyzeCurrentTab() {
        const tab = await getActiveTab();
        const result = await requestJson("/analyse-url", { method: "POST", body: { url: tab.url, include_ai_recommendations: true } });
        return { analysis: validateAnalysis(result.payload), tab, requestId: result.requestId };
    }

    async function boost(url) {
        const result = await requestJson("/boost-seo", { method: "POST", body: { url } });
        if (!result.payload || typeof result.payload.suggested_description !== "string") throw new ExtensionApiError("malformed_response", "The API returned an invalid boost response.", { requestId: result.requestId });
        return result;
    }

    async function health() {
        return requestJson("/health", { authenticated: false });
    }

    root.SeoSenseiApi = { ExtensionApiError, normalizeBaseUrl, getConfig, saveConfig, clearConfig, analyzeCurrentTab, boost, health };
}(globalThis));
