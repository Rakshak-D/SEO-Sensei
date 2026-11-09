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

## React frontend and local demonstration

The Evidence Ledger application under `web/` uses Node.js 24.x, npm, React,
TypeScript, and Vite. `frontend/` remains the separate Manifest V3 Chrome
extension. Install and run the fixture-backed local UI with:

```bash
cd web
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npx playwright install chromium  # one-time browser download
npm run test:e2e
npm run build
```

The Vite server does not proxy to FastAPI. Without the protected Caddy
integration, the UI reports live authentication unavailable and offers the
explicit Northstar Solar fictional example. A failed live API call never falls
back to that fixture. The fixture equality check compares `web/public/fixtures/`
with `design/seo-sensei/fixtures/`.

## Authenticated HTTPS integration test

The local integration stack uses the built React assets, Caddy, and the real
FastAPI application. A test-only transport returns controlled HTML directly to
the existing analyzer; it performs no DNS lookup, website request, or Gemini
call, and does not relax production URL policy. A disposable Argon2id account
is generated in the API container's temporary filesystem from a random test
password. The test API runs as the image's non-root service user. No account
file or credential is written into the repository or image.

On Windows, install the web dependencies once, then run this task-owned harness:

```powershell
cd web
npm ci
npx playwright install chromium
cd ..
pwsh -File tests/integration/run_phase2d_local.ps1
```

The script checks that loopback port `8443` is free, starts a uniquely named
Compose project bound only to `127.0.0.1`, obtains Caddy's temporary local CA,
adds that certificate to the current user's Windows trust store for the test,
and removes that exact certificate and project after the run. Playwright uses
its own Chromium context; an existing browser profile is never opened. TLS
verification remains enabled.

On Linux, the equivalent commands are:

```bash
export PHASE2D_TEST_PASSWORD="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose --project-name seo-sensei-phase2d -f compose.integration.yaml config --quiet
docker compose --project-name seo-sensei-phase2d -f compose.integration.yaml up --build -d
docker compose --project-name seo-sensei-phase2d -f compose.integration.yaml exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt > /tmp/seo-sensei-phase2d-root.crt
sudo install -m 0644 /tmp/seo-sensei-phase2d-root.crt /usr/local/share/ca-certificates/seo-sensei-phase2d.crt
sudo update-ca-certificates
cd web
npm ci
npx playwright install --with-deps chromium
export NODE_EXTRA_CA_CERTS=/tmp/seo-sensei-phase2d-root.crt
npm run test:e2e:integration
cd ..
docker compose --project-name seo-sensei-phase2d -f compose.integration.yaml down --volumes --remove-orphans
sudo rm /usr/local/share/ca-certificates/seo-sensei-phase2d.crt
sudo update-ca-certificates
rm /tmp/seo-sensei-phase2d-root.crt
```

The system and Node trust configuration is needed so the browser and test
request client validate Caddy's local CA normally. Do not use
`ignoreHTTPSErrors`, `--ignore-certificate-errors`, an insecure session cookie,
or an HTTP origin as substitutes. The test Compose file publishes only the
loopback HTTPS port and does not publish the API or dashboard ports.

The base Compose configuration keeps `BROWSER_AUTH_ENABLED=false` and does not
mount account data. For an explicitly managed restricted deployment, prepare an
account file outside the repository that is readable by the API's UID `10001`
and has only owner read permissions (`0400`) or owner read/write (`0600`). On a
Linux host the parent directory should be private and the file owned by UID
`10001`. Then opt in using the separate overlay:

```bash
export BROWSER_AUTH_HOST_FILE=/etc/seo-sensei/browser-users.json
docker compose -f compose.yaml -f compose.browser-auth.yaml up -d --build
```

The overlay mounts the account file read-only and is the only Compose path that
enables browser authentication. Windows Docker Desktop bind mounts may not
preserve Unix owner/mode checks; do not relax the validator. Use a private
Linux/WSL file with suitable UID/mode or run the isolated integration harness.
The browser session, analysis budgets, and active-work limits remain
process-local and support one API process only. Public multi-user deployment is
not approved.

## CI expectations

GitHub Actions runs Python 3.11 and 3.12 quality checks, extension validation,
security checks, Caddy/Compose configuration, container builds, frontend tests,
and a separate browser-to-Caddy-to-FastAPI HTTPS test with controlled HTML.
Those tests do not crawl public websites or call Gemini. The integration job
temporarily trusts its generated Caddy CA and removes its containers and CA
afterward.

The frontend development dependency tree has a previously reported moderate
npm advisory; it remains a separately reviewed dependency-maintenance item.

## Installed extension runtime check

The authenticated integration job also loads the actual unpacked `frontend/`
extension into a fresh, headed Playwright Chromium profile. It makes a temporary
copy with a generated public manifest key only to give that run a known
extension ID; the private key is never written, and the production manifest is
untouched. A Compose override allowlists that single generated extension origin
alongside the existing integration-test origin and supplies a random, masked
API bearer value. The installed extension's options page and toolbar action
then exercise the existing FastAPI routes over the loopback HTTPS Caddy stack.

The test uses Chromium's actual toolbar action, `activeTab`, Chrome storage and
optional-origin permission prompt. The CI runner installs Caddy's generated
root only into its disposable trust stores; TLS validation remains enabled.
The API container has no published port, its fetcher is replaced only by the
existing controlled fixture transport, and Gemini credentials are absent. The
job uses Xvfb and `xdotool` for the isolated toolbar and permission-prompt
inputs, then uploads sanitized screenshots without traces or credentials.
Each test closes and removes only the uniquely created browser profile. CI's
temporary extension copy is discarded with its runner; the local PowerShell
command leaves its generated extension copy under `$runtimeRoot` for inspection.

On Windows, the offline extension-options portion can be run in a separate
Playwright profile without starting the HTTPS stack:

```powershell
cd web
$runtimeRoot = Join-Path $env:TEMP ('seo-sensei-extension-check-' + [guid]::NewGuid().ToString('N'))
$runtime = node ..\tests\integration\prepare_extension_runtime.mjs ..\frontend $runtimeRoot | ConvertFrom-Json
$env:PHASE2E_EXTENSION_ID = $runtime.extensionId
$env:PHASE2E_EXTENSION_DIR = $runtime.extensionDirectory
$env:PHASE2E_EVIDENCE_DIR = 'review/evidence/phase-2e-c'
npx playwright test --config playwright.extension-runtime.config.ts --grep 'loads the unpacked extension'
```

This local check verifies installation and options-page storage only. It does
not verify the toolbar's `activeTab` grant, optional host-permission prompt, or
HTTPS API integration. Do not trust Caddy's local test CA in a user-owned
Windows or browser certificate store to claim those checks; use the disposable
CI runner or a separately isolated Linux test environment.
