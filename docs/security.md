# SEO-Sensei Fetch Security Model

This document describes the URL-fetching boundary implemented for the SEO crawler and the authentication boundaries around API work. It does not claim that the crawler is a general web browser or that the dashboard is authenticated.

## Supported URLs

Only `http` and `https` URLs are accepted. URLs with credentials/userinfo, malformed authorities, invalid ports, control characters, or unsupported schemes are rejected. Hostnames are normalized with IDNA/punycode handling. Fragments are stripped because browsers do not send them to an HTTP origin and they cannot affect the fetched HTML.

## SSRF and DNS/IP validation

Before each connection, the hostname is resolved with `getaddrinfo`. Every returned address is inspected with Python's `ipaddress` module. The request is rejected if any answer is private, loopback, link-local, multicast, reserved, unspecified, documentation/test-only, or an IPv4-mapped address whose IPv4 destination is unsafe. Numeric and alternate textual IP representations are rejected when they cannot be safely canonicalized.

The fetcher pins the first validated global address into a custom `httpcore` network backend. The TCP connection uses that literal address; the original hostname remains the HTTP origin used for the Host header and HTTPS TLS SNI/certificate validation. The fetcher serializes the complete redirect chain while that pin is active, so another request cannot replace the mapping during connection establishment. `trust_env=False` prevents an environment proxy from bypassing this direct-destination policy.

This is a process-local mitigation. It assumes the selected HTTP client/httpcore transport and the operating system route traffic directly to the requested literal address. It does not protect against a compromised host kernel, a malicious network middlebox, or future code that bypasses `SafeFetcher`. Any new outbound HTTP feature must use this fetcher or implement an equivalent reviewed policy.

## Redirect policy

Automatic redirects are disabled. Redirects are followed manually up to `MAX_REDIRECTS` (default three). Each `Location` is resolved relative to the current URL and revalidated. Cross-host redirects are rejected by default, as are unsupported schemes, credentials, unsafe destinations, malformed locations, and redirect loops that exhaust the limit. The returned redirect chain is bounded.

## Response limits

The fetcher rejects a declared `Content-Length` above `MAX_CRAWL_RESPONSE_SIZE_BYTES` and then streams the response with `stream=True`. The actual decoded bytes returned by HTTPX are counted, so chunked responses and decompressed content cannot exceed the same budget. The body is abandoned and classified as `response_too_large` once the limit is crossed.

## Content types

Only `text/html` and `application/xhtml+xml` are processed. A missing or unknown `Content-Type` is rejected rather than guessed from bytes. Images, PDFs, archives, executables, audio, video, and arbitrary binary content therefore never reach BeautifulSoup.

## Timeouts and resource limits

`REQUEST_TIMEOUT_SECONDS` is used as the overall operation deadline and HTTPX connect/read/write/pool timeout budget. A bounded connection pool is kept for the application lifetime. No automatic retries are enabled. The client does not follow redirects automatically and clears cookies before and after each request so one caller cannot seed state for another request.

## Error handling and logging

Fetch failures use typed internal categories such as `blocked_destination`, `dns_resolution_failed`, `connection_timeout`, `unsafe_redirect`, `unsupported_content_type`, and `response_too_large`. The crawler returns only bounded status/error metadata to its callers; the API maps failures to safe public errors. Raw exception text, response bodies, arbitrary remote headers, credentials, and query strings are not returned or logged by the fetcher.

## No arbitrary proxy behavior

The analysis API accepts a target URL only to obtain bounded HTML for SEO analysis. It does not return arbitrary response objects, headers, binary payloads, redirect histories beyond the bounded internal result, or unrestricted network protocols. The Streamlit dashboard calls the authenticated FastAPI API through its typed client; only the API path reaches the crawler and `SafeFetcher`. There is no second `requests`, `urllib`, or direct page-fetching implementation in the dashboard.

## API access and resource limits

`/health` and `/` are public lightweight endpoints. The existing URL analysis, AI recommendation, SEO boost, and article-generation operations require `Authorization: Bearer <API_ACCESS_TOKEN>`. Tokens are compared with a constant-time comparison, are never accepted in query parameters, and are never included in logs, responses, or browser-extension source. Production startup fails when `API_ACCESS_TOKEN` is missing; development and tests must supply an explicit local/test token.

Protected operations use an in-process limiter keyed by a non-reversible token fingerprint and the direct peer IP address. Default limits are configured separately for analysis, AI work, article generation, and boost operations with per-minute and per-hour windows. Rejections return `429`, `Retry-After`, and the standard request-ID error contract. Expired entries are cleaned up and the key store is bounded. The limiter is intentionally single-instance; multiple API instances require a shared limiter in a future phase.

Forwarded client-IP headers are trusted only through the explicit proxy policy documented below. Direct or untrusted peers use the direct socket address. CORS origins are configuration-driven, wildcard origins are rejected, and the `Authorization` header is explicitly allowed for configured origins. Authenticated API responses are marked `Cache-Control: no-store`.

The Chrome extension contains no bundled deployment credential. It can be configured by an operator with a locally stored token for a self-hosted/private deployment, but it is not a multi-user identity system and should not distribute one shared token to an untrusted public audience. The extension requests access only for its configured API origin.

## Restricted browser-session foundation

Browser authentication is **disabled by default**. With `BROWSER_AUTH_ENABLED=false`, the `/api/browser/v1/session` routes are not mounted and the existing bearer routes retain their prior behavior. Enabling it requires all of the following: `BROWSER_AUTH_ENABLED=true`, an absolute `BROWSER_AUTH_ACCOUNTS_FILE` path outside the repository, and one canonical HTTPS `BROWSER_APP_ORIGIN`. The browser origin is an exact configured value; wildcards, paths, default ports written explicitly, non-HTTPS schemes, and malformed authorities are rejected. Secure cookies are used in every environment. Local development therefore needs local HTTPS with a trusted certificate; no HTTP cookie fallback exists.

The account source is operator-managed JSON with version `1` and at most 64 records. Each record contains a normalized ASCII `username` and an Argon2id `password_hash`; plaintext passwords are never stored. The source is loaded and validated during startup, and changing it requires restarting the API process. Keep the file outside the Git worktree. On POSIX systems, use a private parent directory (for example mode `0700`), make the file readable by the API service identity, and use mode `0600` (the loader also accepts owner-read-only `0400`); the application rejects group/world access, executable or special permission bits, and files without owner-read access. On Windows, grant read access to the API service identity and write access only to the operator using a restricted NTFS ACL. The provisioning utility does not attempt to rewrite Windows ACLs.

`tools/provision_browser_user.py` accepts the account identifier as an argument and reads the password twice using a non-echoing prompt. It adds accounts atomically and refuses to replace an existing username. Example:

```bash
python tools/provision_browser_user.py site-editor \
  --accounts-file /etc/seo-sensei/browser-users.json
```

The utility requires an existing, protected parent directory. It sets POSIX account-file permissions to `0600`; operators must create the parent directory with restrictive permissions. Never commit the resulting account file or copy real verifiers into fixtures.

Password verifiers use the pinned `argon2-cffi` implementation with Argon2id `m=19456 KiB`, `t=2`, `p=1`, matching the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). The loader accepts only bounded Argon2id parameters, capped at 32 MiB per verifier. The API permits at most two simultaneous verifier operations; hashes created by the utility use about 19 MiB each (about 38 MiB of KDF working memory at maximum concurrency), while the loader's upper bound permits about 64 MiB, in addition to normal process memory. Do not increase concurrency or accepted verifier bounds without measuring the deployed container memory limit.

Sessions are opaque 32-byte random values in the `__Host-seo_sensei_session` Secure, HttpOnly, SameSite=Lax, Path=/ cookie. The process-local session map stores only the SHA-256 digest of that value, a username, timestamps, and the synchronizer CSRF token. Idle expiry defaults to 30 minutes, absolute expiry to 8 hours, and capacity to 64 sessions. Expiry is enforced by the API; capacity exhaustion rejects a new login and does not evict an active session. Restarting the single API process invalidates sessions. Multiple workers or instances are unsupported.

Login and logout require the exact configured `Origin`. Logout also requires the session's synchronizer token in `X-CSRF-Token`. Missing, `null`, or mismatched origins and missing or incorrect CSRF tokens are rejected. This follows the [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) guidance; SameSite and CORS are not treated as authorization. Login attempts are bounded to five per minute per trusted client IP, five per normalized account identifier, and 30 process-wide, with at most 4,096 IP/account limiter keys and at most two simultaneous Argon2 operations. The session-bootstrap GET does not refresh the idle deadline. The browser-analysis operation refreshes only after authorization, request validation, and successful budget admission.

The browser namespace is mounted only when `BROWSER_AUTH_ENABLED=true`. When enabled, `POST /api/browser/v1/analyse-url` accepts a URL-only JSON object, requires HTTPS, the exact configured Origin, a live browser session, and that session's CSRF token. It calls the existing `SafeFetcher` and deterministic SEO engine, returns the existing `SEOAnalysis` contract, and never requests Gemini. Unknown or extra request fields are rejected; browser sessions still do not authenticate the legacy bearer routes, and a bearer token does not authenticate browser-session routes.

Browser analysis reads at most 4 KiB from the ASGI request stream and checks actual received bytes even when `Content-Length` is absent or inaccurate. This enforcement applies only to the new browser-analysis endpoint. The existing global middleware still checks the `Content-Length` hint; streamed-body enforcement across the legacy endpoints remains open and must be completed before a publicly reachable analysis feature.

Admitted browser analysis is limited to 6 requests/minute and 30/hour per configured username, 12/minute and 60/hour per trusted client IP, and 30/minute and 150/hour process-wide. At most two analyses run at once, with one per user. Admission is atomic and non-queuing, tracking is bounded, and a denied request does not refresh session idle activity. A request admitted to work refreshes idle activity without extending its absolute expiry. Budgets and sessions are process-local: restarts clear them, and multiple workers/instances are unsupported. The existing `SafeFetcher` serialization is unchanged.

The browser namespace rejects requests carrying an Origin other than the configured browser origin before the global CORS middleware can expose a response. This prevents the legacy extension CORS allowlist from exposing browser-session bootstrap data; CORS is not authentication. The browser-analysis route exposes only deterministic `SEOAnalysis` fields, not AI recommendations, business severity, ranking/index status, DOM locations, saved reports, or external performance measurements. `blocked_destination` is returned only for fetcher categories that explicitly identify blocked destinations or unsafe redirects; other fetch failures use a generic unavailable response.

## Same-origin browser ingress

The production Caddyfile serves the built React assets on `APP_DOMAIN`. It forwards `/api/browser/v1` and nested paths to FastAPI without stripping the prefix and applies an 8 KiB proxy body ceiling; FastAPI still enforces the stricter 4 KiB actual streamed-body limit for URL analysis. Unknown `/api/*` paths on the app host return 404 rather than the SPA fallback. Static HTML and browser API responses use `Cache-Control: no-store`; fingerprinted Vite assets may be cached as immutable.

`API_DOMAIN` continues to proxy the legacy bearer API for the separately configured extension, but Caddy rejects `/api/browser/v1*` before it reaches FastAPI. FastAPI's session authorization and browser-origin middleware remain independent of this ingress rule. The browser namespace has no API-domain CORS path. App-domain access logging is disabled to avoid recording user-supplied route/search state. API-domain logs remove Authorization, Cookie, CSRF, and selected credential-like query values.

The normal Compose configuration sets `BROWSER_AUTH_ENABLED=false` and mounts no account source. `compose.browser-auth.yaml` is an explicit opt-in overlay that mounts an external account file read-only. It must meet the API's existing owner/mode checks; do not relax those checks for Windows bind-mount behavior. The API is exposed only on the Compose network. The dashboard remains an internal service without a Caddy route; the development Compose overlay binds its optional port to host loopback.

`compose.integration.yaml` binds only `127.0.0.1:8443`, uses Caddy's internal CA, and supplies a disposable runtime account plus a test-only controlled SafeFetcher. This validates browser → HTTPS Caddy → FastAPI session and analysis → deterministic engine → React result rendering without contacting an external host, DNS resolver, or Gemini. The API test container runs with UID `10001`; its account verifier is generated in a temporary filesystem. This harness does not prove public deployment safety or test a public website fetch.

Application-wide actual streamed-body enforcement remains incomplete on legacy routes. Session, login, analysis budgets and active-work limits remain process-local and do not support multiple workers or instances. Public multi-user use remains unapproved.

## Reverse proxy headers

Production Compose places Caddy at the public boundary. FastAPI accepts
`X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` only when the
immediate peer belongs to `TRUSTED_PROXY_NETWORKS`. The supplied deployment
configuration trusts only Caddy's static private address (`172.30.0.2/32`).
Direct clients and untrusted peers cannot spoof client IP or HTTPS state through
forwarded headers. The rate limiter continues to combine the bearer-token
fingerprint with the verified client IP and remains process-local.

Authentication errors use `auth_required` or `auth_invalid`; rate-limit errors use `rate_limited`. All preserve the request ID and expose no token, hash, limiter state, or internal diagnostics.

The public `/health` and `/ready` endpoints expose only service status,
environment label, and the configured application version. They do not expose
credentials, filesystem paths, network addresses, environment variables, or
provider diagnostics.
