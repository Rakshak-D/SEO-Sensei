# SEO-Sensei operations

## Liveness and readiness

`GET /health` is the liveness probe. It is public, cheap, and reports that the
API process can answer requests. It does not crawl a URL, call Gemini, resolve
DNS, or expose provider state.

`GET /ready` is the readiness probe. It is also public and only verifies that
the process-scoped SafeFetcher has been initialized. It performs no external
network operation. A response with `status: "not_ready"` means the container
should not receive normal traffic yet.

The API and Caddy Compose healthchecks use local, lightweight endpoints. The
dashboard uses Streamlit's `/_stcore/health` endpoint. No healthcheck requires
the bearer token or consumes crawler/AI capacity.

## Logging and request IDs

Application logs are one JSON object per line on stdout. Records include the
timestamp, level, logger, request ID, endpoint, method, status, duration, and
bounded operational fields where relevant. `APP_VERSION` is exposed as a
controlled build identifier in health responses; update it as part of a
release/deployment change.

Every request receives a bounded `X-Request-ID`, preserving a valid supplied ID
or generating one otherwise. The same ID is returned in responses and included
in server logs.

Logs intentionally exclude bearer tokens, authorization headers, cookies,
Gemini keys, request bodies, prompts, generated content, complete fetched HTML,
and full target URLs. SafeFetcher logs only transport metadata such as status,
duration, bytes, redirects, and a bounded error category.

## Troubleshooting a failed request

1. Copy the request ID from the response `X-Request-ID` header or error body.
2. Search API/container logs for that exact request ID.
3. Inspect the associated sanitized error code and HTTP status.
4. Classify the failure as authentication, rate limiting, URL/fetch policy,
   AI availability, validation, or an internal error.
5. Check the relevant configuration and upstream/container health without
   recording credentials or user content.

Unexpected failures include a safe exception type in server logs and a
sanitized `internal_server_error` response to clients. Traceback text is never
returned by the API.

## Operational signals

The application maintains bounded, process-local counters for request handling,
SafeFetcher calls, Gemini calls/failures, and rate-limit rejections. They are
not exposed through an HTTP endpoint and use only fixed operation categories;
there are no URL, hostname, topic, request-ID, or credential labels. This is a
small diagnostic aid rather than a Prometheus replacement.

Rate limiting remains process-local. If the application is later scaled to
multiple API processes or hosts, a shared limiter and centralized metrics/log
pipeline will be required.

## Startup and shutdown

Configuration is validated before the application starts. Startup creates one
SafeFetcher connection pool, one in-memory limiter, bounded metrics, and an
optional Gemini service. Startup never crawls a URL or calls Gemini. The
SafeFetcher pool is closed during application shutdown, and Uvicorn receives a
configurable graceful-shutdown timeout through
`GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS`.

Cancelled requests are not retried by the application. SafeFetcher and Gemini
operations have bounded timeouts, and Gemini retries remain limited by the
existing `AI_RETRY_COUNT` setting.

## Common configuration signals

- `LOG_LEVEL` controls application log verbosity; `INFO` is the default.
- `APP_VERSION` is a safe release/build identifier.
- `METRICS_ENABLED` enables the bounded in-process counters.
- `GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS` controls the Uvicorn shutdown budget.
- `REQUEST_TIMEOUT_SECONDS` bounds SafeFetcher operations.
- `AI_REQUEST_TIMEOUT_SECONDS` and `AI_RETRY_COUNT` bound Gemini behavior.

Never put secrets in logs or health responses. `API_ACCESS_TOKEN`,
`DASHBOARD_API_ACCESS_TOKEN`, and `GEMINI_API_KEY` remain deployment-side
configuration only.
