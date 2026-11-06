# SEO Sensei — Phase 0 Baseline Audit

Audit date: 2026-11-06 (Asia/Kolkata)

Repository: https://github.com/Rakshak-D/SEO-Sensei

Expected and verified starting commit: eefd2393cb3447d15e4068159b5c1bdd6dd1605c

## 1. Baseline and execution environment

Local HEAD and GitHub origin/main both returned eefd2393cb3447d15e4068159b5c1bdd6dd1605c. The initial worktree was clean on main. The requested audit branch did not exist locally or remotely and was created at that same commit: audit/phase-0-baseline. Main had not advanced.

The complete tracked tree was enumerated with git ls-files. It contains the FastAPI application, deterministic SEO engine, SafeFetcher and URL policy, typed Gemini boundary, Streamlit dashboard, Manifest V3 extension, Python tests and fixtures, GitHub Actions, Dockerfiles, Compose/Caddy deployment, scripts and documentation.

AUDIT.md is a historical report and is not a reliable description of this tree. Its claims that the crawler calls requests.get, work endpoints lack authentication/rate limits, CORS is wildcard, the dashboard directly crawls/calls Gemini and renders untrusted HTML, and tests/CI/deployment files do not exist are contradicted by current code and tests. Its concerns about one shared operator credential, public dashboard access, missing dependency scanning, and the need to restrict public dashboard access remain relevant.

Environment: Windows 11 Home Single Language 10.0.26300, 64-bit; PowerShell; system Python 3.14.2 (outside the declared >=3.11,<3.13 range); working Python 3.11.7; Node v24.14.0/npm 11.12.1; Docker CLI 29.7.2 and Compose v5.4.0. A temporary Python 3.11.7 environment was installed from requirements-dev.txt and pip upgraded as documented. The py -3.11 launcher pointed at a stale path, so the verified interpreter was invoked directly. Direct dependencies are pinned in requirements files, but no lockfile pins transitive dependencies.

Python bytecode, pytest/coverage, Ruff and Mypy caches were directed to the temporary environment. Runtime checks used APP_ENV=test, dummy bearer tokens and an empty GEMINI_API_KEY. Local .env values were not emitted or sent to a provider.

At the initial audit run Docker Desktop was stopped, so the daemon check and container validations were blocked. On 2026-11-06, after Docker Desktop was started, docker info exited 0 and reported Docker Desktop Linux Server 29.7.2. Caddy validation and both requested image builds then completed successfully. The Caddy image was pulled from Docker Hub. The local .env is excluded by .dockerignore; no credential values were displayed or passed as build arguments. Compose syntax had already passed using a temporary copy of .env.example.

## 2. Architecture and repository inventory

| Area | Verified responsibility and boundary | Dependencies and maintenance notes |
|---|---|---|
| API | backend/app/main.py owns FastAPI lifespan, CORS, request-ID/no-store middleware, error handlers and routes. GET /, /health and /ready are public. POST /analyse-url, /generate-article and /boost-seo require bearer auth and operation rate limits. Readiness checks SafeFetcher initialization; liveness does not report Gemini state. | Pydantic v2 request/response models reject extra fields. Errors are bounded, carry request IDs and avoid provider/transport details. RequestContextMiddleware only rejects an oversized declared Content-Length; see SEC-02. |
| Auth, rate limits, proxy identity | api/auth.py compares one configured bearer token with secrets.compare_digest; rate-limit identity is a short SHA-256 token fingerprint. api/rate_limit.py maintains bounded per-process minute/hour windows for token fingerprint and peer IP. api/proxy.py trusts forwarded values only from configured proxy networks. | No users, roles, token rotation API or distributed state. Single process/container is the documented limit. Dashboard requests share its operator token and API peer address. |
| Fetch and URL policy | security/url_policy.py allows HTTP(S), rejects URL credentials/malformed numeric hosts, IDNA-normalizes names, resolves all addresses and rejects any non-global address. security/fetcher.py pins a validated IP to a custom httpcore transport while retaining the HTTP origin for TLS, disables environment proxies and automatic redirects, revalidates each same-host redirect, and bounds redirects, elapsed time, content type and decoded bytes. | Defaults are 10 s, 3 redirects and 2 MB. The custom transport imports private HTTPX helpers and uses low-level httpcore interfaces (fetcher.py:14-16,49-120); dependency upgrades need focused regression tests. A lock spans the complete fetch, serializing crawls in one process (PERF-01). |
| Analyzer and contracts | seo/engine.py is a deterministic standard-library HTML parser/scorer; it performs no network, AI, clock or ranking API calls. seo/models.py defines bounded Pydantic result/evidence/check/category/score schemas. backend/seo_crawler.py adapts FetchResult to FetchMetadata and calls analyze_html. | Page source is response HTML, not a browser-rendered DOM. backend/seo_crawler.py is actively used by routes/tests and is not dead code. |
| Gemini | ai/gemini.py is the only provider boundary. It constructs bounded prompts, treats page data as untrusted, disables function calling, projects typed schemas, validates complete JSON, and bounds input/output/time/retries/concurrency with explicit failure states. Article and boost results are typed. | Default model name is gemini-3.8-flash. No live provider call was made, so availability and quota are unverified. Recommendation output is type/length checked but claims are not independently verified. AI never affects scoring. |
| Dashboard | backend/dashboard.py is a Streamlit presentation client using DashboardAPIClient; it does not import crawler, SafeFetcher or Gemini. The client sends a server-side bearer token, validates Pydantic responses, has bounded timeout/no retries, and converts API errors. Results are held in Streamlit session state. Text/JSON components are used; article output is plain text. | No user sign-in is present in dashboard source or Caddy config. The documented production Caddy route makes this an unauthenticated public UI unless access is restricted outside this repository; SEC-01. |
| Extension | frontend/manifest.json is MV3 with an action popup and options page; no background worker/content script. Permissions are activeTab/storage plus optional HTTP(S) host access. The client stores operator config in chrome.storage.local, requests only the configured API origin and renders with text nodes/textContent. | The local bearer token is inspectable in the browser profile, as docs disclose. Requests have a 10 s timeout. The popup calls analysis with AI enabled; api-client.js has a boost() helper with no popup caller. No production API URL is embedded. |
| Runtime/deployment | API and dashboard use separate Python 3.11.11 non-root images and service-specific dependencies. Production Compose exposes only Caddy on ports 80/443; API/dashboard remain on the private Compose network. Containers are read-only with tmpfs, dropped capabilities and no-new-privileges. compose.dev.yaml binds API/dashboard to loopback. Caddy routes app domain to dashboard and API domain to API, with TLS/security headers and filtered request logs. | No database or persistent user/content store. Rate limits/metrics are process-local. Deployment script avoids printing env values and waits for health. Caddy validation and both image builds passed locally; no full Compose service startup or public TLS flow was run. |
| Quality/docs | GitHub Actions tests Python 3.11/3.12, runs Ruff/Mypy/security checks, Node syntax/manifest checks and a Compose/Caddy/build job. tools/security_checks.py is a source-regression guard, not a vulnerability scanner. Docs cover scoring, security, dashboard, extension, operations and deployment. | No dependency lockfile or blocking vulnerability scan; docs/development.md calls scanning future work. Tests cover auth/rate limits, fetch policy, API client, Gemini service, SEO engine and static extension invariants, but not a Chrome-installed extension flow. |

Compatibility/dead-code candidates: backend/main.py preserves uvicorn main:app; backend/models.py preserves historical aliases; backend/utils/gemini_helper.py re-exports the typed Gemini service. Their docstrings state compatibility intent, so do not remove without checking external imports. ResponseText, ShortText and api.observability.record_metric/log_event have no in-repository callsites. The extension boost helper has no UI caller. Treat these as investigation candidates, not confirmed dead code. MAX_TOPIC_LENGTH, MAX_KEYWORD_COUNT and MAX_KEYWORD_LENGTH are loaded into settings but the request schema hard-codes 500/20/80; changing env values does not change validation (OPS-01).

## 3. Implemented feature inventory

| Feature | Purpose, path, inputs/output and data provenance | Auth, dependencies, tests/failures | Decision and limits |
|---|---|---|---|
| Deterministic URL analysis | Dashboard or extension → POST /analyse-url; HTTP(S) URL plus include_ai_recommendations (API default false) → SafeFetcher HTML/transport facts, extracted metadata and versioned 0–100 heuristic. Observed HTML/HTTP plus heuristic classifications; not external ranking data. | Bearer token; SafeFetcher; optional AI limit only when requested. Tests: foundation, auth_rate_limit, safe_fetcher, seo_engine, dashboard_api_client. Invalid input 422; fetch failure usually 502; blocked loopback also 502. | Preserve; improve score semantics/error classification. Static HTML only, not JS-rendered DOM or indexing state. Dashboard/extension default AI on. |
| AI recommendations | Optional part of analysis. Sends the first 20 failed/warning checks and bounded metadata/counts/terms to Gemini; returns typed priorities/evidence and availability state. AI interpretation, never score input. | Bearer and AI rate limit; needs server key/network/quota. Gemini service tests use fakes. Missing config → configuration_error; provider errors degrade without losing deterministic results. | Preserve as optional. No live provider check. Output is not independently fact-checked. No full page body is sent, but title/description, terms, findings and final-URL evidence may go to Google. |
| Article generation | Dashboard form → POST /generate-article; topic, up to 20 keywords and fixed tone → title, plain-text article and suggestions. AI-generated, not measured from a website, not persisted/published. | Bearer, article limit and Gemini key/quota. Gemini tests cover schemas/retries/failures; API returned 503 without key. | Keep secondary/optional. No originality, factuality or ranking validation. |
| SEO boost | Dashboard meta-description form → POST /boost-seo; accepts URL, re-fetches/re-analyzes and asks Gemini for one <=320-character description. AI suggestion, not measured improvement. | Bearer, boost limit, crawler and Gemini. Provider tests plus no-key API check; failures sanitize; missing Gemini → 503. | Improve or consolidate: second fetch repeats work. Preserve endpoint until clients are inventoried. |
| Health/readiness | GET /, /health, /ready for operators. Health reports process response; readiness reports SafeFetcher initialized. | Public/no auth/provider/network dependency; foundation/observability/container tests. 200/ok after startup; does not show Gemini state. | Preserve; do not present as downstream/provider readiness. Metrics are not exposed over HTTP. |
| Dashboard | Streamlit analysis, article and boost forms render typed API output as text, metrics and JSON. | Needs API_BASE_URL and DASHBOARD_API_ACCESS_TOKEN server-side. Dashboard client tests; local page/health button verified in browser. Content tools fail gracefully without Gemini. | Retain temporarily for private use; gate before public use. All visitors share the service token and rate-limit identity. |
| Chrome extension | Options page stores API origin/token; popup submits current active HTTP(S) tab URL to analysis. It does not read page DOM, crawl or call Gemini directly. | Operator token, optional origin permission; CORS must include installed extension origin. Static tests, syntax and manifest pass. Chrome installation/runtime not tested. | Preserve for private/self-hosted use; add visible heuristic disclaimer. Boost helper is unwired; decide to expose or remove after review. |

Not implemented: competitor discovery, backlink indexes, rank tracking, traffic/authority, keyword volume, Search Console, PageSpeed/Core Web Vitals, actual index status or whole-site crawling. README/scoring docs correctly identify these as out of scope; earlier AUDIT.md claims that they exist are stale.

## 4. Deterministic SEO scoring review

seo/engine.py:38-53,294-316 defines v1.0 category weights and normalizes earned points by applicable max before applying each category weight. CheckStatus is pass/warning/fail/not_applicable; there is no separate severity field. Checks include textual evidence and recommendations, generally not the source element/snippet.

| Check / category | Trigger and status/points | Evidence and recommendation |
|---|---|---|
| retrieval_success / technical | HTML and status <400: pass 5/5; otherwise fail 0/5. | Decoded bytes/status; ensure bounded HTML returns successfully. |
| http_status / technical | 2xx pass 5/5; 3xx warning 3/5; otherwise fail 0/5. | HTTP status; return success for canonical page. |
| https / technical | Final scheme HTTPS: pass 5/5; else warning 3/5. | Final scheme; prefer HTTPS for transport privacy/browser security. |
| content_type / technical | Exact text/html or application/xhtml+xml: pass 4/4; else fail 0/4. | Content type; serve an accepted HTML type. |
| redirects / technical | Zero: pass 3/3; any: warning 2/3. | Count/final URL; keep chain short and link directly to final URL. |
| fetch_duration / technical | SafeFetcher elapsed <=1 s: pass 3/3; >1 s: warning 2/3. | Bounded fetch time; recommendation explicitly says not page speed/Core Web Vitals. |
| robots_directives / technical | Any merged noindex: fail 0/5; else any nofollow/noarchive: warning 3/5; else pass 5/5. | robots/googlebot/googlebot-news meta plus X-Robots-Tag; review intended crawler/index behavior. |
| title / metadata | Empty fail 0/8; 1–9 chars warning 5/8; 10–29 or >60 warning 6/8; 30–60 inclusive pass 8/8. | Character length; add one clear title; lengths are heuristic. |
| meta_description / metadata | Empty fail 0/8; <20 chars warning 5/8; 20–49 or >160 warning 6/8; 50–160 inclusive pass 8/8. | Character length; add concise useful description; thresholds are heuristic. |
| canonical / metadata | Malformed fail 0/4; missing, relative or other-host warning 2/4; parseable absolute same-host pass 4/4. | Relationship; use one parseable canonical and verify intended host. |
| h1_structure / headings-content | No H1 or any empty H1/H2/H3: fail 0/6; >1 H1 warning 4/6; else pass 6/6. | H1/empty counts; use clear primary heading and avoid empty headings. |
| heading_hierarchy / headings-content | Detected jump: warning 2/4; none: pass 4/4. | Reported jumps; organize headings without skipping levels. |
| visible_text / headings-content | 0 words fail 0/5; 1–99 warning 3/5; 100–299 warning 4/5; >=300 pass 5/5. | Approximate word count; review meaning because count is not quality. |
| internal_links / links | At least one same-host link pass 6/6; otherwise warning 2/6, including zero links. | Internal/external counts; add useful navigation links. |
| anchor_text / links | No empty/placeholder anchor pass 2/2; any empty text or href empty/# warning 1/2. | Empty count; use descriptive link text. |
| link_relationships / links | Always not_applicable, 0/0; no score. | Reports nofollow/sponsored/ugc counts; review attributes by purpose. |
| image_alt / images | No images: not_applicable 0/0. Otherwise all alt present/nonempty pass 10/10; coverage >=80% warning 7/10; <80% fail 0/10. | Total/with/missing/empty/coverage; add useful alt, with empty alt for decorative images. |
| json_ld / structured-data | Any malformed block fail 0/5; else >=1 valid block pass 5/5; none warning 3/5. | Block counts/types; parse JSON, separately validate schema/eligibility. |
| open_graph / social | All four title/description/image/url non-None pass 3/3; partial warning 1.5/3; none warning 1/3. | Present count; add sharing fields; not a core ranking factor. |
| twitter_metadata / social | >=2 of card/title/description/image non-None pass 2/2; else warning 1/2. | Present count; add social-preview fields, not ranking guarantee. |
| html_lang / HTML | Nonempty html lang pass 2/2; absent warning 1/2. | Declared value; declare primary language when known. |
| viewport / HTML | Nonempty viewport meta pass 2/2; absent warning 1/2. | Value/missing; add valid responsive viewport. |
| charset / HTML | Nonempty charset pass 1/1; absent warning 0/1. | Charset/missing; declare encoding. |

Weights: technical/indexability 30, metadata 20, headings/content 15, links 10, images 10, structured data 5, social metadata 5, HTML signals 5.

Confirmed behavior and methodological limits:

- Title/description thresholds are fixed character counts, not display-width or page-context estimates. Word limits (100/300) are fixed heuristics, not quality/ranking tests. Domain validation of these thresholds was not performed.
- Heading extraction supports H1–H3 only. Hierarchy walks all H1s, then H2s, then H3s rather than DOM order, so unusual source order can be misreported. H1 check fails for any empty H1–H3, not just primary heading.
- A relative canonical is resolved but labelled relative and warned; any different hostname is warned even if cross-host canonicalization is intentional. Duplicate canonicals and indexing outcomes are not checked. Best-practice implications need independent domain review.
- Robots/googlebot/googlebot-news meta and X-Robots-Tag are flattened without crawler scope. Any noindex fails; nofollow/noarchive warn. none, robots.txt access, actual Googlebot responses and index status are not interpreted. Correct agent-specific behavior needs domain review.
- Link counts compare exact final hostname; subdomains count as external. Link targets are not fetched, broken links/backlinks are not measured, and external/relationship counts do not score.
- Alt coverage counts alt="" as present, but any empty alt still forces a warning, conflicting with advice to use empty alt for decorative images. Image purpose/usefulness is not inspected.
- JSON-LD is parsed and @type recursively collected; Schema.org validity/rich-result eligibility are not checked. Any malformed block fails the check even if another is valid.
- Social checks count non-None content; empty content can count as present. Social fields can reduce score despite low weight and explicit non-ranking wording.
- If a category has raw_max == 0, the code gives it full weight. A no-image page gets all 10 image points. link_relationships is 0/0 and excluded. N/A policy can make scores non-comparable across pages with different available evidence.
- Fetch duration/status/HTTPS measure transport or response signals, not indexing, Core Web Vitals, browser rendering or rankings. Dashboard/docs disclose limits; extension popup does not repeat “not a Google ranking prediction”. No check measures content quality, search intent or topic coverage.

tests/test_seo_engine.py covers repeatability, missing/short/long metadata, heading/image/link/social parsing, robots/X-Robots, valid/malformed JSON-LD, mixed-content count, canonical variants and score bounds. It does not cover exact threshold boundaries, arbitrary heading DOM order, duplicate canonicals/titles, empty social values, empty-decorative-only images, absent-image normalization, robots none/agent scope, or broad expected-weight fixtures. No live-site scoring comparison was done.

## 5. Automated execution matrix

Python checks used the temporary Python 3.11.7 environment and dummy settings; caches/coverage were outside the worktree. PASS means executed and returned zero.

| Command | Result / exit | Evidence |
|---|---|---|
| python -m pytest --cov --cov-report=term-missing | PASS / 0 | 136 passed in 15.47 s; 88% total coverage of backend/app; no live provider/crawl calls. |
| python -m compileall -q backend tests tools | PASS / 0 | Quiet success; pycache redirected to temp. |
| python -m ruff check backend tests tools | PASS / 0 | All checks passed. |
| python -m ruff format --check backend/app tests tools | PASS / 0 | 41 files already formatted. |
| python -m mypy backend/app | PASS / 0 | No issues in 27 source files. |
| python tools/security_checks.py | PASS / 0 | Repository security checks passed; pattern-based guard only. |
| node --check frontend/popup.js; node --check frontend/api-client.js; node --check frontend/options.js | PASS / 0 each | All parsed successfully. |
| python -c "import json; json.load(open('frontend/manifest.json', encoding='utf-8'))" | PASS / 0 | Manifest parsed. |
| bash -n scripts/deploy.sh | PASS / 0 | Git Bash used. WSL bash shim first failed because no WSL distribution was available. |
| docker compose --env-file temp-copy-of-.env.example -f compose.yaml -f compose.dev.yaml config --quiet | PASS / 0 | Validated with non-secret example settings; daemon not required. |
| docker info | PASS / 0 | Docker Desktop Linux engine responded; Server Version 29.7.2, 12 CPUs, 7.581 GiB memory. |
| docker run --rm -e APP_DOMAIN=app.example.com -e API_DOMAIN=api.example.com -e ACME_EMAIL=ops@example.com -v "$((Get-Location).Path)/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile | PASS / 0 | Pulled caddy:2.10.2-alpine (digest sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d); output: Valid configuration. Caddy warned the existing Caddyfile is not formatted; no tracked file was changed. |
| docker build --file Dockerfile.api --tag seo-sensei-api:ci . | PASS / 0 | Built image seo-sensei-api:ci. Non-fatal useradd warning: UID 10001 is greater than SYS_UID_MAX 999. |
| docker build --file Dockerfile.dashboard --tag seo-sensei-dashboard:ci . | PASS / 0 | Built image seo-sensei-dashboard:ci. Non-fatal useradd warning: UID 10001 is greater than SYS_UID_MAX 999. |

## 6. Safe functional verification

- Started Uvicorn on 127.0.0.1:18800 with dummy auth and no Gemini key. FastAPI TestClient startup/lifespan returned /health and /ready 200/ok. On the live server DashboardAPIClient.health() returned ok; invalid dummy token got 401, while the configured dummy token reached safe-fetch policy.
- With SafeFetcher active, http://127.0.0.1:8000/ was blocked before connecting; API returned 502/resource_unavailable. ftp://example.test/ returned 422. No third-party URL was fetched. DNS/redirect behavior is exercised with mocked resolver/transports in test_safe_fetcher.py.
- A temporary external probe replaced only app-scoped SafeFetcher with a deterministic fixture for https://example.test/. No URL resolution/network connection was made. Two authenticated analyses returned 200 and identical scores. AI disabled returned null recommendations; AI requested with no key returned configuration_error while retaining deterministic output. Article and boost returned 503. Response models validated.
- Started Streamlit on 127.0.0.1:18501, opened it in the available in-app browser and clicked Check API health. The rendered page showed “API online · test”, proving the UI action reached the live local API. Analysis/article/boost forms were visible; controlled analysis was verified through the fixture-backed API rather than a browser form submission.
- Extension source, manifest, syntax and contract tests passed. Chrome install/permissions/popup/real extension-origin CORS remain unverified. No Gemini service or external crawler target was invoked.

## 7. Security and deployment review

Source-verified controls: HTTP(S)-only URL policy; credential rejection; non-global IP/DNS answer rejection; pinned TCP destination; bounded same-host manual redirects; disabled environment proxies; cleared cookies; supported HTML types; response-size and timeout limits. Work routes require bearer auth and rate limits. CORS uses configured origins, rejects wildcard, permits GET/POST and declared headers, and defaults credentials false. Forwarded identity is trusted only through configured proxy network. Application logs omit request bodies, full URLs, prompts, HTML and credentials; Caddy filters authorization/cookie headers and query token. Extension pages disallow inline scripts; extension/dashboard display API values as text/data components.

Exercised controls: existing tests mock DNS, redirects, body caps, timeouts, CORS, rate limits, auth, log redaction, Gemini errors and extension invariants. This audit exercised valid/invalid auth, loopback blocking, health/readiness, deterministic fixture output and no-key failures. Real DNS rebinding, remote redirects, browser-extension CORS, provider success and concurrency were not exercised.

Public-dashboard risk: production Caddy routes the app host to Streamlit, but dashboard has no login. Its server token is not exposed to the browser, yet any visitor can invoke its authenticated analysis/article/boost calls. Visitors share the token and peer-IP rate-limit identity; this can consume crawler capacity and, when Gemini is configured, provider quota. Treat the dashboard as public service exposure until access is restricted.

RequestContextMiddleware checks only declared Content-Length and does not count streamed body events when absent. Production Caddy separately caps API bodies at 1 MB, but direct API deployments/bypass paths need app-level enforcement. Chunked-body behavior was not reproduced. MAX_TOPIC_LENGTH/keyword settings do not affect hard-coded schemas. Fetcher-wide lock serializes crawls. There is no dependency scanner/lockfile. Token rotation is operator-managed; extension local storage is not multi-user credential storage. API uses bearer headers rather than cookie auth today; a future cookie-session BFF needs CSRF and per-user authorization/quotas. No public deployment was accessed.

## 8. Ranked defect and risk register

| ID | Category / severity / confidence | Evidence, impact and reproduction | Next action; dependencies/regression risks |
|---|---|---|---|
| SEC-01 | Security / High / Verified (public deployment impact) | Caddyfile:5-7, compose.yaml:3-13,61-73, dashboard.py:24-28,159-179,202-240: public app host reverse-proxies unauthenticated Streamlit; server token enables protected work calls. All visitors share token/IP rate identity (rate_limit.py:50-57,84-90). Risks crawler/resource/AI quota abuse. No live deployment contacted. | Gate public access; define user/session auth and per-user budgets before public use. Requires approved audience, identity, cookie/CSRF plan and quotas; preserve private extension bearer flow. |
| SEO-01 | Product quality / Medium / Verified | seo/engine.py:294-316,696-729: no-image category receives full 10 points (zero denominator → ratio 1); empty alt both counts toward coverage and forces warning despite decorative-alt guidance. Scores can mislead comparisons. | Domain-review scoring, define N/A denominator and informative/decorative semantics, add boundary fixtures and version change. Risk: score/API consumer changes; preserve v1 or increment version. |
| SEC-02 | Security/availability / Medium / Strongly Suspected | app/main.py:86-122 only checks Content-Length. No-length/chunked bodies are not counted there. Caddy caps documented ingress (Caddyfile:26-31), mitigating standard route. Not reproduced. | Enforce streaming ASGI budget and test missing/false length; retain Caddy cap. Regression risk: request streaming, 413 envelope, middleware order. |
| OPS-01 | Configuration / Medium / Verified | config.py:48-50,130-132 loads topic/keyword limits; schemas/requests.py:24-27 fixes 500/20/80. Env overrides therefore do not control validation. | Make settings authoritative or remove misleading knobs; test lower/higher overrides. Risk: existing client contract limits change. |
| PERF-01 | Architecture/performance / Medium / Verified | security/fetcher.py:148,189-194 locks DNS through body read, so one process crawls one URL at a time despite pool default 10. | Measure expected throughput and redesign pinned transport for safe concurrency before scaling. Preserve DNS pin/race guarantees; add concurrency/redirect tests. |
| API-01 | API semantics / Low / Verified, reproduced | main.py:231-237 maps some fetch failures specially but blocked_destination falls through to 502 resource_unavailable. Controlled loopback probe blocked before connect and returned 502; user sees upstream-unavailable wording for a policy rejection. | Return stable 4xx policy code; add contract tests and align client messages. Preserve sanitized details. |
| TEST-01 | Testing / Medium / Verified | Extension tests inspect static source/manifest; no Chrome runtime end-to-end. Caddy validation and both image builds now pass locally; no full Compose service startup was performed. | Add controlled extension/API test or Chrome smoke procedure; retain container job in CI for environment parity. Risks: permission/CORS/browser variation and slower CI. |

## 9. Architecture and product decision support

### Frontend choice

| Option | Fit/security | Cost/complexity and recommendation |
|---|---|---|
| Retain Streamlit temporarily | Already uses typed FastAPI contracts; lowest migration risk. Public route currently lacks user auth. | Lowest change. Recommended for private or access-gated use while auth and score decisions are made. |
| React + TypeScript + Vite | Compatible with API and extension. Browser bundle cannot hold API_ACCESS_TOKEN/DASHBOARD_API_ACCESS_TOKEN; Vite env is public. Direct calls require per-user auth and exact CORS. | Static UI is simple, but protected access needs separate BFF/gateway or redesigned user-token API. Viable if that server is funded/operated. |
| Next.js + TypeScript | Can provide same-origin server routes/BFF/session while preserving FastAPI. It does not provide identity/authorization by itself. | Adds Node runtime/deployment and session secret management. Best fit if public multi-user dashboard is approved and BFF is desired; settle auth/deployment first. |

A same-origin reverse proxy alone does not secure a static SPA forwarding one shared server token. A BFF must authenticate visitors, keep token server-side, authorize work and enforce per-user/global quotas. Cookie sessions need Secure/HttpOnly, intentional SameSite, CSRF protection and origin checks. CORS is not authentication. Keep the extension as separately configured bearer client with exact extension-origin CORS; never put server credential in its bundle.

Decisions needed before implementation: public vs private audience; identity provider/account/tenant model; session/BFF placement; per-user crawl/AI budgets; extension credential support; data retention/Gemini disclosure; accepted score semantics/versioning; deployment target and ongoing Node/BFF/provider costs.

### Product priorities

| Priority/proposal | Benefit and dependencies | Complexity, validation, cost/security |
|---|---|---|
| Essential: review/fix score v1 semantics | More comparable evidence; requires review of title/description heuristics, canonical/robots semantics, N/A and versioning. | Medium; table-driven boundary fixtures and reviewer-approved examples. No provider cost; preserve contract or version changes. |
| Essential: protect public dashboard | Prevent shared-token crawler/AI abuse; requires identity/session, authorization, per-user/global quotas. | Large; verify anonymous visitors cannot invoke work and quotas isolate users. Manage session secrets, CSRF and identity-provider costs. |
| Essential: make configured request budgets effective | Enforce body/topic/keyword limits consistently; requires settings-backed validation and ASGI streaming cap. | Small–medium; test overrides, missing-length/chunked requests and 413. Align with Caddy limit. |
| Secondary: article drafting | Useful generic writing tool, separate from page evidence; depends on Gemini, content evaluation and usage budget. | Medium; mock provider and human review; provider use may cost money. |
| Consolidate: SEO boost | Avoid repeat fetch for a description suggestion; decide whether it belongs in analysis report or separate tool. | Medium; compare fetch counts/correctness and preserve existing API until clients inventoried. |
| Optional: Search Console | Would add authorized property impressions/clicks/query data, unavailable today. Requires OAuth, ownership/scopes, secure token storage and per-user authorization. | Large; test property validation. Sensitive account access, quota and retention concerns. |
| Optional: PageSpeed Insights/Core Web Vitals | Could add measured performance data separate from fetch time. Requires provider API and provenance. | Medium; validate returned metrics/missing-data state. Key/quota, URL disclosure and provider limits. Not currently implemented. |
| Consolidate/remove candidates | Extension boost helper has no UI caller; compatibility aliases have no local callers but explicit compatibility promises. | Small after consumer inventory; wire reviewed UI or remove helper, retain wrappers until external usage is checked. |
| Unsupported by current data | Rankings, traffic, authority/backlinks, competitor metrics, actual indexing, search intent, keyword volume, rich eligibility and CWV cannot be derived from fetched HTML alone. | Do not present as measured without reliable authorized data source. |

## 10. Implementation dependencies and blockers

1. Decide audience, auth/session model and provider budget before exposing/migrating dashboard.
2. Agree on v1 score interpretation and versioned correction plan; specify robots, canonicals, empty alt, no-images, heading order and boundaries.
3. Make limits settings-backed and enforce streaming request bodies; add policy-blocked API error cases.
4. Decide article/boost scope and check external consumers before changing compatibility wrappers.
5. Caddy validation and both image builds pass on local Docker Desktop; retain the CI job for runner parity. Decide lock/scanner strategy.
6. If extension release is required, install in Chrome and verify permissions, extension-origin CORS, config, popup rendering and errors.

Unverified: full Compose service startup and live Caddy TLS/proxy flow; Chrome-installed extension; live public deployment/DNS/auth; live Gemini/model/quota (intentionally not called); remote fetching/DNS rebinding/concurrency under real network; JavaScript-rendered SEO; scoring validity against current search-engine guidance. No application implementation or test file was changed.

Audit classification: BASELINE_PARTIAL — repository identity, source baseline, automated Python/Node checks, controlled API behavior, local dashboard-to-API browser flow, Caddy configuration and both image builds were verified. The installed Chrome extension and live service/provider flows remain unverified.
