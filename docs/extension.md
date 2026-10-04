# Chrome Extension

SEO-Sensei's Chrome extension is a thin Manifest V3 client:

`active tab URL → authenticated extension API client → FastAPI → SafeFetcher → deterministic analysis → optional Gemini`

The extension never fetches the active page, parses page HTML, calculates SEO scores, calls Gemini, or contains crawler logic. The API remains authoritative.

## Configuration and authentication

Open the extension's **API settings** page and enter:

- `API base URL`: an HTTP or HTTPS FastAPI origin without credentials, query strings, or fragments.
- `API access token`: the operator credential for that private/self-hosted API.

The values are stored in `chrome.storage.local`. The token is cleared from the settings form after saving and is never rendered into the popup, URL, DOM, logs, or source code. It is sent only in an `Authorization: Bearer` header to the configured API origin.

This is a self-configured private-deployment model, not a multi-user identity system. Anyone who can inspect an extension profile may be able to access its local credential, so do not use one shared token for an untrusted public audience. User accounts, OAuth, and per-user credentials are intentionally deferred.

The extension requests optional host access only for the configured API origin. It does not request `<all_urls>`, history, cookies, scripting, or page host permissions. `activeTab` is used only to read the current tab URL after the user invokes the extension.

## Local and deployed use

1. Start the FastAPI server with an explicit `API_ACCESS_TOKEN`.
2. Load `frontend/` as an unpacked extension at `chrome://extensions`.
3. Open the extension settings and enter the local API origin, for example `http://127.0.0.1:8000`, plus the same local token.
4. Save the settings and approve optional access for that origin when Chrome asks.
5. Open an HTTP(S) webpage and select **Analyze current page**.

For a deployed API, enter its HTTPS origin and deployment token in the options page. No production URL or token is bundled in the extension.

## Response and failure handling

The popup validates the bounded response shape before rendering the deterministic score, categories, checks, evidence, metadata, and transport signals. AI recommendations are labeled separately and may show `available`, `unavailable`, `timed_out`, `invalid_response`, or `configuration_error` without hiding deterministic findings.

401/403 responses show a credential message, 429 responses respect the server's `Retry-After` value without automatic retries, and network, timeout, malformed-response, SSRF, and server failures show sanitized messages. API request IDs are displayed when available for support.

All API-returned values are rendered through `textContent` or explicit DOM nodes. The extension has no inline scripts, `eval`, dynamic code, `innerHTML`, or executable remote content.
