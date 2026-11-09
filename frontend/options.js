(function () {
    "use strict";
    const api = globalThis.SeoSenseiApi;
    const base = document.getElementById("apiBaseUrl");
    const token = document.getElementById("apiToken");
    const message = document.getElementById("message");
    const state = document.getElementById("connectionState");
    const origin = document.getElementById("savedOrigin");
    const form = document.getElementById("settingsForm");
    const testButton = document.getElementById("testBtn");
    let savedBaseUrl = "";
    let settingsReady = false;

    function showMessage(text, error) { message.textContent = text; message.style.color = error ? "var(--coral)" : "var(--amber)"; }
    function setSettingsReady(ready) {
        settingsReady = ready;
        form.dataset.settingsReady = String(ready);
        form.setAttribute("aria-busy", String(!ready));
        for (const control of form.querySelectorAll("input, button")) control.disabled = !ready;
        testButton.disabled = !ready;
    }
    async function refresh() {
        setSettingsReady(false);
        state.textContent = "Loading local settings…";
        try {
            const config = await api.getConfig();
            savedBaseUrl = config.baseUrl || "";
            base.value = config.baseUrl || "";
            token.value = "";
            state.textContent = config.baseUrl && config.hasToken ? "Configured locally" : "Not configured";
            origin.textContent = config.baseUrl || "No API origin saved.";
        } catch (_) {
            savedBaseUrl = "";
            state.textContent = "Unavailable";
            showMessage("Could not read local extension settings.", true);
        } finally {
            setSettingsReady(true);
        }
    }
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!settingsReady) { showMessage("Local settings are still loading. Try again shortly.", true); return; }
        try {
            const saved = await api.saveConfig(base.value, token.value);
            savedBaseUrl = saved.baseUrl;
            token.value = "";
            state.textContent = "Configured locally";
            origin.textContent = saved.baseUrl;
            showMessage("Saved. The token will not be displayed.", false);
        } catch (error) {
            if (error instanceof api.ExtensionApiError && error.code === "invalid_configuration") {
                showMessage(error.message, true);
            } else {
                showMessage("Could not save configuration. Check browser storage and try again.", true);
            }
        }
    });
    document.getElementById("clearBtn").addEventListener("click", async () => {
        try {
            await api.clearConfig();
            await refresh();
            showMessage("Local API configuration cleared.", false);
        } catch (_) {
            showMessage("Could not clear local extension settings. Try again.", true);
        }
    });
    testButton.addEventListener("click", () => {
        if (!settingsReady) { showMessage("Local settings are still loading. Try again shortly.", true); return; }
        try {
            const permission = savedBaseUrl ? api.requestOriginPermission(savedBaseUrl) : Promise.resolve();
            permission.then(() => api.health())
                .then((result) => showMessage(`API reachable · ${result.payload.status || "unknown status"}`, false))
                .catch((error) => showMessage(error.message || "The API could not be reached.", true));
        } catch (error) { showMessage(error.message || "The API could not be reached.", true); }
    });
    setSettingsReady(false);
    void refresh();
}());
