(function () {
    "use strict";
    const api = globalThis.SeoSenseiApi;
    const base = document.getElementById("apiBaseUrl");
    const token = document.getElementById("apiToken");
    const message = document.getElementById("message");
    const state = document.getElementById("connectionState");
    const origin = document.getElementById("savedOrigin");

    function showMessage(text, error) { message.textContent = text; message.style.color = error ? "var(--coral)" : "var(--amber)"; }
    async function refresh() {
        const config = await api.getConfig();
        base.value = config.baseUrl || "";
        token.value = "";
        state.textContent = config.baseUrl && config.hasToken ? "Configured locally" : "Not configured";
        origin.textContent = config.baseUrl || "No API origin saved.";
    }
    document.getElementById("settingsForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try { const saved = await api.saveConfig(base.value, token.value); token.value = ""; state.textContent = "Configured locally"; origin.textContent = saved.baseUrl; showMessage("Saved. The token will not be displayed.", false); }
        catch (error) { showMessage(error.message || "Could not save configuration.", true); }
    });
    document.getElementById("clearBtn").addEventListener("click", async () => { await api.clearConfig(); await refresh(); showMessage("Local API configuration cleared.", false); });
    document.getElementById("testBtn").addEventListener("click", async () => {
        try { const result = await api.health(); showMessage(`API reachable · ${result.payload.status || "unknown status"}`, false); }
        catch (error) { showMessage(error.message || "The API could not be reached.", true); }
    });
    refresh().catch(() => showMessage("Could not read local extension settings.", true));
}());
