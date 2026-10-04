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

## CI expectations

GitHub Actions runs the test suite, coverage collection, compile check, Ruff,
Mypy, extension syntax/manifest validation, and repository security checks on
pushes to `main` and pull requests targeting `main`. CI uses fake credentials,
does not call Gemini, and does not access live websites.

Dependency vulnerability scanning is intentionally not a blocking local check;
the project should add a pinned scanner or platform Dependabot policy when the
deployment workflow is introduced.
