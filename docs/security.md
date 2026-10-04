# SEO-Sensei Fetch Security Model

This document describes the URL-fetching boundary implemented for the SEO crawler. It is intentionally limited to transport safety; it does not claim that the crawler is a general web browser or that the rest of the application is authenticated.

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

`/health` and `/` are public lightweight endpoints. URL analysis, AI recommendations, SEO boost, and article generation require `Authorization: Bearer <API_ACCESS_TOKEN>`. Tokens are compared with a constant-time comparison, are never accepted in query parameters, and are never included in logs, responses, or browser-extension source. Production startup fails when `API_ACCESS_TOKEN` is missing; development and tests must supply an explicit local/test token.

Protected operations use an in-process limiter keyed by a non-reversible token fingerprint and the direct peer IP address. Default limits are configured separately for analysis, AI work, article generation, and boost operations with per-minute and per-hour windows. Rejections return `429`, `Retry-After`, and the standard request-ID error contract. Expired entries are cleaned up and the key store is bounded. The limiter is intentionally single-instance; multiple API instances require a shared limiter in a future phase.

Forwarded client-IP headers are trusted only through the explicit proxy policy documented below. Direct or untrusted peers use the direct socket address. CORS origins are configuration-driven, wildcard origins are rejected, and the `Authorization` header is explicitly allowed for configured origins. Authenticated API responses are marked `Cache-Control: no-store`.

The Chrome extension contains no bundled deployment credential. It can be configured by an operator with a locally stored token for a self-hosted/private deployment, but it is not a multi-user identity system and should not distribute one shared token to an untrusted public audience. The extension requests access only for its configured API origin.

## Reverse proxy headers

Production Compose places Caddy at the public boundary. FastAPI accepts
`X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` only when the
immediate peer belongs to `TRUSTED_PROXY_NETWORKS`. The supplied deployment
configuration trusts only Caddy's static private address (`172.30.0.2/32`).
Direct clients and untrusted peers cannot spoof client IP or HTTPS state through
forwarded headers. The rate limiter continues to combine the bearer-token
fingerprint with the verified client IP and remains process-local.

Authentication errors use `auth_required` or `auth_invalid`; rate-limit errors use `rate_limited`. All preserve the request ID and expose no token, hash, limiter state, or internal diagnostics.
