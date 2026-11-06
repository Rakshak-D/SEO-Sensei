# Development workflow

SEO-Sensei supports Python 3.11 and 3.12 (`>=3.11,<3.13`). The project keeps
runtime and development tooling dependencies separate so a fresh environment can
run the same checks as CI.

## Setup

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
copy .env.example .env  # PowerShell; use cp on Linux/macOS
```

Use safe test values for local work. A Gemini key is not required for the test
suite. Production mode requires `API_ACCESS_TOKEN`; never commit `.env`.

## Checks

```bash
python -m pytest --cov --cov-report=term-missing
python -m compileall -q backend tests tools
python -m ruff check backend tests tools
python -m ruff format --check backend/app tests tools
python -m mypy backend/app
python tools/security_checks.py
```

Validate the extension without a browser:

```bash
node --check frontend/popup.js
node --check frontend/api-client.js
node --check frontend/options.js
python -c "import json; json.load(open('frontend/manifest.json', encoding='utf-8'))"
```

## Running locally

With the backend environment configured:

```bash
python -m uvicorn backend.app.main:app --reload --port 8000
streamlit run backend/dashboard.py
```

The dashboard uses `API_BASE_URL` and `DASHBOARD_API_ACCESS_TOKEN` for
server-to-server API calls. Load `frontend/` as an unpacked Manifest V3
extension, then configure its API origin and token through the options page.

## Isolated browser-auth testing

Browser authentication is disabled by default and should remain disabled in
shared or deployed environments until its later integration review. This
milestone provides login, session bootstrap, and logout only; it does not make
URL analysis or any other bearer route available to browser sessions. Keep
`API_ACCESS_TOKEN` server-side and do not place it in a browser bundle.

For an isolated test, create a protected account directory outside the
repository, provision an individual account, and run the API with an HTTPS
origin matching the browser's `Origin` header:

```bash
install -d -m 700 /etc/seo-sensei
python tools/provision_browser_user.py site-editor \
  --accounts-file /etc/seo-sensei/browser-users.json
export BROWSER_AUTH_ENABLED=true
export BROWSER_AUTH_ACCOUNTS_FILE=/etc/seo-sensei/browser-users.json
export BROWSER_APP_ORIGIN=https://localhost:5173
python -m uvicorn backend.app.main:app --port 8000
```

Use a locally trusted HTTPS certificate for the browser application origin.
The session cookie always has the `Secure` attribute; HTTP is not permitted as
a development fallback. In Windows, configure the account directory/file ACL
so only the operator can write it and the API service identity can read it.
The provisioning utility sets POSIX file mode `0600`, but Windows operators
must configure NTFS ACLs themselves. The API requires an absolute account-file
path outside the repository and validates the file at startup.

The Uvicorn command above is an internal HTTP backend example, not a complete
HTTPS browser setup. A local TLS-terminating proxy must overwrite
`X-Forwarded-Proto` and be named by its exact address in
`TRUSTED_PROXY_NETWORKS`; alternatively, serve the API itself over HTTPS and
use that same origin for the browser app. Do not trust broad networks or
forwarded headers from direct clients.

The current Caddy/Compose configuration does not route or enable this browser
authentication flow. Do not infer a working browser-to-API deployment from a
successful local API startup; same-origin routing, protected browser work
endpoints, and end-to-end access control belong to later reviewed stages.

## CI expectations

GitHub Actions runs the test suite, coverage collection, compile check, Ruff,
Mypy, extension syntax/manifest validation, and repository security checks on
pushes to `main` and pull requests targeting `main`. CI uses fake credentials,
does not call Gemini, and does not access live websites.

Dependency vulnerability scanning is intentionally not a blocking local check;
the project should add a pinned scanner or platform Dependabot policy when the
deployment workflow is introduced.

## React frontend demonstration

The Evidence Ledger frontend in web/ uses Node.js 24.x and npm. The existing
Chrome extension remains independent in frontend/.

~~~bash
cd web
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npx playwright install chromium  # one-time browser download
npm run test:e2e
npm run build
~~~

This application uses the fictional Northstar Solar fixture bundled under
web/public/fixtures/. It has no FastAPI connection and no browser authentication
integration. The static build is a local demonstration and is not authorized
for public deployment. The fixture equality check fails if the copied files
drift from design/seo-sensei/fixtures/.
