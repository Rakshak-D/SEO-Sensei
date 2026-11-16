# S1-A R2 — Static SEO X-ray design proof

This is an offline design proof, not the production application. The page results are generated directly by the repository's deterministic SEO engine from local HTML with documented fetch metadata. It does not call an API, Gemini, or an external website and does not save report history or credentials.

## What the proof contains

- Home accepts an address, optional target keyword, or one of three supported local samples. Arbitrary addresses do not create invented results.
- Summary identifies the page, gives an action-first verdict, shows one score-information popover, three priority actions, reconciled counts, category pass totals, and a small page X-ray preview.
- Fix list groups actionable findings by priority. Each row expands to one reason, evidence, action, and a defensible snippet when one exists. “Done” is local to the open page session; it changes neither score nor engine status and does not claim a recheck.
- Page X-ray is a separate route. It draws only structures supported by analysis fields and leaves unassessed regions unmarked. It is a simplified drawing, not DOM coordinates.
- On-page and Previews lead with their own content. Loading and error routes show controlled interface states.
- At desktop widths the sidebar lists all ten planned pages. Five implemented pages navigate; five future pages are disabled. On mobile, the More sheet provides the same inventory.

## Offline inputs and engine output

The realistic default sample is the fictional local Northstar Solar page at northstar-solar-r2.html. It was derived from web/public/fixtures/northstar-solar.html without modifying the original. The R2 source removes the existing robots noindex meta directive, removes the meta description, removes the html lang attribute, removes alt text from one informative image, and adds one practical paragraph about household loads, roof conditions, equipment, warranties, and written estimates. Exact changes are recorded in offline-source-notes.json.

All four analyses are direct, deterministic engine outputs at score version 1.0. Presentation enrichment does not alter scores, check statuses, engine recommendations, or check order.

| Input | Score | Checks | Pass | Fail | Warning | Not applicable | Actionable |
|---|---:|---:|---:|---:|---:|---:|---:|
| Northstar Solar R2 page | 78 | 23 | 17 | 2 | 3 | 1 | 5 |
| weak.html | 55 | 23 | 8 | 3 | 11 | 1 | 13 |
| basic.html | 84 | 23 | 14 | 0 | 7 | 2 | 6 |
| weak.html with synthetic noindex response metadata | 50 | 23 | 7 | 4 | 11 | 1 | 14 |

The noindex input is an explicit simulated response-header condition supplied to the engine. It was not fetched from a website. The synthetic condition is kept separate from the original weak-page output.

The earlier mismatch between “3 failed + 11 warnings” and “13 open findings” was not a lost finding: the raw total is 14. The optional empty JSON-LD warning is excluded from suggested actions because absence alone is not a defect. One link-relationship check is not applicable. The shared view model reports raw attention, actionable suggestions, exclusions, not-applicable checks, passed checks, and locally marked items separately.

## Finding and X-ray rules

enrichment.json is the one design-only presentation ruleset for titles, reasons, evidence mapping, impact conditions, effort, actions, and snippets. A generic interpreter in proof.js applies it. A missing optional structured-data block does not become a defect. Noindex is described as an observed instruction and asks the visitor to confirm intent before changing it. Missing evidence is not replaced with invented copy. Editable templates are labelled as templates.

The X-ray maps returned title and description, heading text, approximate visible word count, aggregate image count, and link counts to page regions. The analyzer does not provide exact DOM coordinates, footer landmarks, or per-image attributes; these are not claimed. Supplementary offline HTML inspection is identified separately in offline-source-notes.json.

## Local fonts

Two locally bundled font pairs were compared against the same Summary data at 1440×900 and 390×844:

| Pair | UI | Monospace | Loaded | Measured title/body/mono sizes |
|---|---|---|---|---|
| A | Hanken Grotesk | JetBrains Mono | Yes | 28px / 16px / 13px desktop; 26px / 16px / 12px mobile |
| B | Schibsted Grotesk | IBM Plex Mono | Yes | 28px / 16px / 13px desktop; 26px / 16px / 12px mobile |

Both pairs produced the same measured text bounds and priority-row heights. Pair A was selected after visual comparison because Hanken Grotesk felt more open and approachable at the same sizes; Pair B looked firmer and denser. Font files and their licence notices are bundled under fonts/. No Google Fonts or other runtime font request is made.

## Run locally

From the repository root, regenerate all offline engine outputs and source notes with the existing virtual environment:

    .venv\Scripts\python.exe -B docs/design/s1-a/generate_data.py

For repeated-output verification, hash the four audit JSON files and offline-source-notes.json before and after a second identical run. The original weak, basic, and synthetic noindex JSON must remain byte-identical.

Run the Playwright-bundled Chromium checks and capture the exact 14 screenshots:

    node docs/design/s1-a/check.mjs

After opening and inspecting all captures at native size, record the visual review:

    node docs/design/s1-a/check.mjs --visual-reviewed

The runner starts a short-lived static server bound to 127.0.0.1, uses an in-memory browser context, blocks non-local requests, and closes the server and browser. It uses CSS viewport sizes, not actual browser zoom.

For manual local viewing, run a server from the repository root in a separate terminal, bound only to loopback:

    py -3.11 -m http.server 4173 --bind 127.0.0.1

Open http://127.0.0.1:4173/docs/design/s1-a/proof-static-not-the-product.html?state=summary&sample=northstar. Stop the server with Ctrl+C.

## Reload-safe routes and sample names

The supported states are home, summary, fix-list, xray, on-page, previews, loading, and error. Samples are northstar, weak, and noindex. Missing or unknown analysis data produces an explicit recovery state and never falls back to another sample. The Home form only opens a report for a supported local example; entering any other URL does not claim it was analyzed.

Examples:

- ?state=home
- ?state=summary&sample=northstar
- ?state=fix-list&sample=weak
- ?state=xray&sample=noindex
- ?state=on-page&sample=northstar
- ?state=previews&sample=northstar
- ?state=loading
- ?state=error

## R2 screenshot index

Each path below is a direct, unretouched Playwright Chromium capture. Query values are relative to proof-static-not-the-product.html.

| Screenshot | Viewport | Query |
|---|---:|---|
| [r2-home-1440x900.png](screenshots/r2-home-1440x900.png) | 1440×900 | ?state=home |
| [r2-home-390x844.png](screenshots/r2-home-390x844.png) | 390×844 | ?state=home |
| [r2-summary-northstar-1440x900.png](screenshots/r2-summary-northstar-1440x900.png) | 1440×900 | ?state=summary&sample=northstar |
| [r2-summary-northstar-390x844.png](screenshots/r2-summary-northstar-390x844.png) | 390×844 | ?state=summary&sample=northstar |
| [r2-summary-weak-1440x900.png](screenshots/r2-summary-weak-1440x900.png) | 1440×900 | ?state=summary&sample=weak |
| [r2-summary-noindex-1440x900.png](screenshots/r2-summary-noindex-1440x900.png) | 1440×900 | ?state=summary&sample=noindex |
| [r2-fix-list-expanded-1440x900.png](screenshots/r2-fix-list-expanded-1440x900.png) | 1440×900 | ?state=fix-list&sample=northstar; first finding expanded |
| [r2-fix-list-390x844.png](screenshots/r2-fix-list-390x844.png) | 390×844 | ?state=fix-list&sample=northstar |
| [r2-on-page-1440x900.png](screenshots/r2-on-page-1440x900.png) | 1440×900 | ?state=on-page&sample=northstar |
| [r2-previews-1440x900.png](screenshots/r2-previews-1440x900.png) | 1440×900 | ?state=previews&sample=northstar |
| [r2-xray-hover-1440x900.png](screenshots/r2-xray-hover-1440x900.png) | 1440×900 | ?state=xray&sample=northstar; description region hovered |
| [r2-loading-1440x900.png](screenshots/r2-loading-1440x900.png) | 1440×900 | ?state=loading |
| [r2-errors-four-causes-1440x900.png](screenshots/r2-errors-four-causes-1440x900.png) | 1440×900 | ?state=error |
| [r2-focus-ring-390x844.png](screenshots/r2-focus-ring-390x844.png) | 390×844 | ?state=home; keyboard focus on wordmark control |

The machine-readable query and interaction index is evidence/screenshot-index.json. Superseded R1 captures are linked at their historical commit in evidence/R1-BEFORE-AFTER.md.

## Verification

The R2 browser suite records 33 checks, 40 responsive layout cases, 14 captures, 904 local requests, zero outside-origin requests, zero browser console/page errors, zero measured CLS, zero text overlaps, and zero horizontal overflow in measured layouts. Latest recorded measurement has 12px minimum rendered text, 16px body text, minimum audited ordinary-text contrast 6.6588:1, minimum severity contrast 6.4060:1, and a minimum measured visible word gap of 0.2441em (4.2344px). Desktop Summary at 1440×900 has a 248px sidebar, verdict at x=340/y=201.9, score at x=1164/y=169, and all three priority rows ending by y=762.7. The exact results are in evidence/verification.json and ACCEPTANCE.md.

The source also retains controls and interaction checks for filters, keyboard navigation, X-ray/finding selection, Copy, History navigation, the More sheet focus trap, reduced motion, the score popover, and local Done state. These are checks of this static proof only.

The verification run on the current R2 working tree passed 33/33 browser checks with 0 unverified checks; all 14 captures were inspected at native size, then the review-flag run reproduced identical screenshot hashes. The offline SEO engine tests passed 5/5. The complete backend suite passed 332 tests with one platform-specific POSIX account-file permission test skipped on Windows. Frontend typecheck and lint passed; Vitest passed 30 tests in 2 files and its fixture verifier completed; the production Vite build passed. Ruff lint, Ruff format check, mypy (32 source files), and repository security checks passed. Exact commands and the latest GitHub CI result are recorded in the R2 completion report.

## Limitations and workspace note

This does not validate production analysis, a public guest endpoint, authentication, rate limits, deployment, the future Technical/Links and images/Structured data/Speed/History pages, real Google rendering, or screen-reader behavior. The proof does not claim a live fetch time or ranking/indexing outcome. Actual 200% browser zoom and manual screen-reader review remain unverified.

Workspace inventory and preservation decisions are documented in evidence/WORKSPACE-HYGIENE.md. The previously blocked root archive and two identified bytecode files remain untouched; no alternate cleanup method was used.
