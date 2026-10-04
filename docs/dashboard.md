# Streamlit Dashboard

The dashboard is a server-side presentation client for the FastAPI application. It does not import the crawler, SafeFetcher, deterministic analyzer, or Gemini service. Each operation crosses the typed `DashboardAPIClient` boundary and therefore uses the same authentication, SSRF protection, deterministic scoring, and AI failure handling as other API clients.

## Configuration

Set these variables in the dashboard process environment:

- `API_BASE_URL`: the FastAPI origin, such as the local value in `.env.example` or the deployed HTTPS origin.
- `DASHBOARD_API_ACCESS_TOKEN`: the server-to-server bearer token. It is read only by the Streamlit Python process and is never rendered into widgets, HTML, JavaScript, logs, or session state.

The dashboard shows a configuration error and does not attempt protected calls when either value is missing. Visitors do not enter or receive the deployment token. The browser extension remains a separate client and is not given this credential.

## Operations and errors

URL analysis, article generation, and SEO boost use authenticated API requests with bounded client timeouts and generated `X-Request-ID` values. The client has no retry loop; API rate limits and Gemini retry behavior remain server-side. API errors are converted into concise dashboard messages. `429` responses display the server-provided `Retry-After` value and are not retried automatically.

The deterministic report renders independently of Gemini. AI recommendations are displayed in a separate section with explicit available/unavailable states. Article output is shown as plain text in a disabled text area; generated content is never rendered as HTML.

## Rendering and state

Fetched page values and AI output are treated as untrusted text. The dashboard uses native Streamlit text, tables, expanders, metrics, and JSON viewers rather than interpolating page data into HTML. Per-user analysis state is held only in that Streamlit session; credentials are not stored in session state or global caches.

The public `/health` endpoint is available through the sidebar health check. A successful health response only proves API reachability; it does not prove that Gemini is configured or available.
