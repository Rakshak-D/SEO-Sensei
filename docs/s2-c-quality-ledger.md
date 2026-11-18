# S2-C1 quality and accessibility ledger

## Baseline and revisions

- Required `origin/main`: `f3a024b83653f738fd55124d3c012e94b1605b57`.
- Feature branch: `fix/s2-c1-quality-accessibility`, created from that exact main commit.
- Starting feature SHA for this final correction: `376c64155519ee6eed2a0a3f2588c713dce1aab5`.
- Initial implementation/evidence commit: `5e9f16a1d79b84c9592f050b213612f002085548`.
- The ledger and final corrections are committed separately. The delivery report and PR checks identify the final branch tip and exact-head CI result.
- PR #10 is read-only and remains a separate unmerged design reference at `51a8134ce6a162730bfc8c97bc6c1d76a81d376e`.

## Confirmed defects and corrections

### JSON-LD reason grammar

The old rendering joined `The fetched HTML contains` to a generated fragment such as `1 JSON-LD block could not be parsed`. The result was not a grammatical sentence. `findings.py` now produces a complete deterministic reason and `rules.py` renders it directly:

- One: “One JSON-LD block in the fetched HTML could not be parsed.”
- Two: “Two JSON-LD blocks in the fetched HTML could not be parsed.”
- Three or more: numeric count followed by the plural “blocks”.

The real deterministic analyzer/enrichment path is tested for zero malformed blocks, one, two, three, multiple valid blocks, mixed valid/malformed blocks, and absent optional JSON-LD. The fix changes reason text only. Score version 1.1, scores, check IDs, status, impact, effort, actionability, priority, and optional-note behavior are asserted unchanged.

### Stationary pointer on X-ray navigation

The X-ray no longer treats `mouseenter` caused by mounting a new screen under a stationary pointer as user intent. It tracks deliberate pointer movement in the X-ray surface and maps that movement to a pin or region. Keyboard focus takes precedence after pointer departure; route selection remains the fallback. A changed route check clears stale local pointer/focus state. The X-ray route focus/scroll is scheduled after history scroll restoration so Back/Forward can return focus to the routed pin.

The regression uses a real Playwright mouse: it hovers “Show on X-ray”, clicks without moving, and verifies the routed finding, pin, region and details; it then deliberately hovers another region and returns to routed/focused state. Coverage also includes same-region pins, keyboard focus, history, pin-to-exact-fix navigation, and unknown check IDs. The details panel is sticky on desktop while browsing long anatomy; it returns to normal flow on mobile so the focused finding remains visible without changing the first-view layout.

### Computed colour policy

The production Chromium test scans visible computed text, background, border, outline, SVG paint, text decoration, shadows, and rendered pseudo-elements. It uses a channel-based vermilion predicate and exact element/semantic exemptions for the wordmark, High/Blocking badges and their direct marks, X-ray pins/highlight, and the direct Summary-preview pin marker. It does not exempt arbitrary descendants of a parent container.

- Verdicts in normal, High, Blocking, and zero-fix reports are explicitly `rgb(20, 19, 15)` (`#14130F`): 17.78:1 against `#FAFAF7`.
- The prior `#E5481C` wordmark text measured 3.81:1 against `#FAFAF7`; the prior white pin numeral measured 3.98:1 against that red. Those text pairs did not meet 4.5:1.
- The wordmark and numbered inspection marks now use `#C53B1A`: 5.00:1 against `#FAFAF7` and 5.23:1 against white.
- The selected X-ray-region outline remains `#E5481C`, an approved inspection mark; it measures 3.81:1 against `#FAFAF7` and 3.98:1 against white, above the 3:1 focus/status threshold.
- Chromium found zero unauthorized vermilion uses in Home (including keyboard focus), normal/High/Blocking/zero-fix Summary, Fix list, X-ray, On-page, Previews, mobile More, Loading, and Error.

Production colour policy verified independently; S1-A proof checker still requires separate owning-branch resolution.

## Owner SHOULD items 7–13

| Item | Original intent and current evidence | Disposition, impact, test and action |
|---|---|---|
| 7. Mark done | No “Mark done” workflow exists in the current Fix list. | **Intentionally deferred.** A local-only completion feature is not needed to use this release and could be confused with a re-audit. No score, server finding, or persisted audit state is changed. No implementation change recommended for C1. |
| 8. Keyword disclosure | Home exposes “Add a target keyword” and says “This is not included in the current audit.” | **Satisfied.** Playwright opens the disclosure, enters a keyword, submits, and verifies the request body contains only `{ url }` with no Authorization header. Continue to omit the unsupported keyword from the guest API. |
| 9. Loading checkmarks | The API returns one completed response and does not stream analysis phases. | **Satisfied.** The waiting state is indeterminate; the E2E test verifies no named phase is falsely shown complete and no completed-step checkmark appears. Keep this behavior unless the API later supplies real progress events. |
| 10. Previews treatment | S2-B2 already renders four distinct metadata-driven search/social illustrations and discloses uncertainty. | **Satisfied; no redesign.** Existing rich and missing-metadata S2-B2 Chromium captures were inspected. Source labels identify HTML/Open Graph/X metadata, absent fields stay absent, and the page disclaims verified platform rendering. C1’s Axe and computed-colour runs cover Previews; no screenshot set was regenerated. |
| 11. Unused navigation | Planned but unavailable screens must not appear functional. | **Satisfied.** Current navigation renders unavailable destinations as disabled “Coming later” entries, not active routes. E2E covers implemented guest navigation and the mobile More sheet. Keep the current grouping; no reorganization is needed. |
| 12. Ellipsis | Important evidence must not be truncated invisibly. | **Corrected/satisfied.** The mobile Summary no longer line-clamps priority reasons; long text wraps. E2E verifies the full long reason remains present and its scroll dimensions do not hide text at 320px and 390px. X-ray values remain available as text. |
| 13. X-ray pins | Numbered inspection pins should open their exact canonical fixes. | **Satisfied.** The pointer/keyboard/history regression verifies unique pin IDs, same-region pins, and exact Fix rows after pin activation. Keep the existing interaction. |

## Responsive, focus, and accessibility measurements

The production Chromium suite covered Home, Summary, Fix list, Page X-ray, On-page, Previews, Loading/Error, mobile More, and a sample authenticated sign-in/local-report flow. Axe checks report no violations on Home, Summary, each implemented report page, More, and the sampled authenticated views. Keyboard checks exercise score disclosure, error descriptions, Escape, focus restoration, Shift+Tab containment, finding focus, and X-ray route/history focus. Reduced-motion CSS is asserted to remove animation durations.

- Widths 320, 390, 768, 1024 and 1440px: no horizontal overflow on measured implemented guest pages; minimum measured interactive target height is 44px.
- Landscape 844×390: no horizontal overflow; minimum target remains 44px; the last report control clears the fixed navigation.
- At 390×844 Summary using the longer six-finding warning report: priority 1 is x=16, y=389.17, 358×181.83px; priority 2 is x=16, y=579, 358×181.69px; fixed navigation begins y=776px. The second card has 15.31px clearance; its full reason and action remain visible at 16px body text.
- At 320×844 Summary on the two-finding responsive report: the first two cards end at y=487.78px and y=654.84px; navigation begins y=776px.
- A 1.5× computed-text-size stress at 390px reports no horizontal overflow or right-edge clipping across Summary, Fix list, X-ray, On-page, and Previews. This is not browser zoom evidence.
- Actual browser 200% zoom and manual screen-reader testing were not performed and remain **UNVERIFIED**. Automated Axe results do not substitute for those checks.
- The X-ray is the visually longest report screen on mobile. Its mapped evidence and selected details remain available; no blocking overlap was observed. Desktop detail panel remains visible while a selected region is scrolled into view.

Capture metadata and exact rectangles are in [`web/review/s2-c1/README.md`](../web/review/s2-c1/README.md). Four captures were reviewed individually at native resolution; no visual defect was observed.

## Acceptance gates

| Gate | Result | Test/evidence | Measured result and limitation |
|---|---|---|---|
| S2C1-1 JSON-LD grammar | PASS | `test_json_ld_finding_grammar_preserves_v11_analysis` in `tests/test_seo_scoring_v11.py` | Seven engine/enrichment cases; complete singular/plural sentences. |
| S2C1-2 scoring/priority/count invariants | PASS | Same test plus full backend suite | Score v1.1, score values, check IDs/status/impact/effort/actionability, priority and counts remain asserted. |
| S2C1-3 stationary pointer | PASS | `stationary pointer does not override the routed X-ray finding on navigation` | Real pointer is not moved after click/navigation; URL, focus, selected region and details match the routed ID. |
| S2C1-4 hover/focus/history | PASS | `keeps routed, keyboard, pointer, and shared-region finding selection coherent` and stationary-pointer test | Deliberate hover, keyboard focus, pointer leave, Back/Forward, shared-region pins and unknown ID checked. |
| S2C1-5 verdict colour | PASS | `checks strict computed colours across guest pages and severity states` | Normal, High, Blocking, zero-fix verdicts explicitly equal `rgb(20, 19, 15)`; contrast 17.78:1 on page background. |
| S2C1-6 vermilion restriction | PASS | Same computed-style Chromium scan | Zero unauthorized occurrences in all 12 tested guest states; exact selector exemptions only. |
| S2C1-7 SHOULD audit | PASS | This ledger; keyword/loading/long-copy and X-ray Playwright tests | Items 7–13 each have evidence, disposition, impact, and follow-up action. Mark-done is intentionally deferred. |
| S2C1-8 keyboard/focus/dialog/form/announcement | PASS | `checks keyboard access, announcements, touch targets, and responsive reflow`; Axe and navigation E2E | Home/report screens and More checked; automated Axe only. Manual screen-reader use remains unverified. |
| S2C1-9 responsive, text enlargement, reflow | PASS | Same responsive test | 320/390/768/1024/1440 and landscape 844×390; 1.5× text stress; no overflow/clipping. Real 200% browser zoom remains unverified. |
| S2C1-10 mobile Summary cards | PASS | `keeps two complete priority cards above mobile navigation with the controlled warnings report`; `web/review/s2-c1/summary-mobile-priority-clearance-390x844.png` | Six-finding warning report at 390×844: second card bottom 760.69px; nav top 776px; 15.31px clearance. Full reasons and actions fit; reason text remains 16px. |
| S2C1-11 evidence/security invariants | PASS | JSON-LD tests, guest/security regression suite, E2E keyword and external-request checks, static scope review | No scoring/auth/security contract change, keyword not sent, no new outbound request or fabricated content. Live provider and deployment behavior are not claimed. |
| S2C1-12 guest/auth/scoring/extension regression | PASS | `.\tests\integration\run_phase2d_local.ps1`; full Pytest and web regression suites | Isolated HTTPS/Caddy integration passed 6/6, including authenticated analysis, API-domain isolation, guest journey, controlled analysis-to-X-ray, specialist pages, reload recovery and cancellation. No production config changed. |
| S2C1-13 final GitHub CI | UNVERIFIED pending final-head checks | PR check runs on final branch tip | Report exact run/head and all five job states in delivery; do not infer success from earlier CI. |
| S2C1-14 protected state and artifacts | UNVERIFIED pending delivery recheck | Git SHA/PR metadata, diff inventory, artifact SHA256 | Main, PR #10, environment, and named untracked files must be rechecked after push. |

## Local regression commands

Executed on the code/evidence commit; exit codes were 0 unless stated:

```text
.venv\Scripts\python.exe -B -m pytest -q                    444 passed, 1 skipped
.venv\Scripts\python.exe -m ruff check backend tests tools   passed
.venv\Scripts\python.exe -m ruff format --check backend/app tests tools   64 files formatted
.venv\Scripts\python.exe -m mypy backend/app                 38 source files, no issues
.venv\Scripts\python.exe -B tools/security_checks.py         passed
npm --prefix web run typecheck                                passed
npm --prefix web run lint                                     passed
npm --prefix web test                                         8 files, 90 tests passed
npm --prefix web run build                                    passed; Vite transformed 141 modules
npm --prefix web run test:e2e -- --workers=1 --grep-invert "captures demo and authentication browser review screenshots|renders v1.1 verdicts, shared counts, priority order, and severity colors in production reports|opens the fictional Northstar report X-ray and preserves its provenance|local example opens reload-safe On-page and Previews with usable mobile navigation"
                                                               19 passed
.\tests\integration\run_phase2d_local.ps1                   passed; isolated HTTPS integration 6/6
git diff --check                                             passed
```

Pytest skip: `tests/test_browser_auth.py:552`, POSIX account-file mode check not applicable on Windows. The final local Playwright invocation excluded four existing screenshot-capture tests to avoid overwriting approved milestone captures; all other 19 browser tests passed. The HTTPS harness passed all six integration tests, including the formerly failing two-card mobile Summary assertion. Its run refreshed screenshots in prior milestone folders; those tracked files were clean before the run and were restored to their pre-run revisions. The harness removed its own PID-scoped temporary directory. The three previously identified untracked artifacts remain untouched. Exact-head GitHub CI remains the final remote check.

Fixture verification retained the existing SHA256 values:

- `web/public/fixtures/audit.json`: `b2b8e40650729d39aefa436ca3e861cdd776cfcacbfc67f36af60a070305095b`
- `web/public/fixtures/northstar-solar.html`: `6b68d41c5b9ac1de0f529d5441add8dadd838ab1572543622da4143adc79faae`

## Changed files

The implementation/evidence commit changes these 16 files; this ledger adds the 17th:

```text
backend/app/seo/findings.py
backend/app/seo/rules.py
tests/test_seo_scoring_v11.py
web/e2e/guest.spec.ts
web/e2e/phase-s2b1-xray.spec.ts
web/e2e/phase-s2c1-quality.spec.ts
web/review/s2-c1/README.md
web/review/s2-c1/summary-mobile-priority-clearance-390x844.png
web/review/s2-c1/xray-deliberate-hover-1440x900.png
web/review/s2-c1/xray-keyboard-focus-1440x900.png
web/review/s2-c1/xray-stationary-routed-1440x900.png
web/src/app/App.tsx
web/src/features/guest/GuestNavigation.tsx
web/src/features/guest/GuestPageXray.tsx
web/src/features/guest/GuestSummary.tsx
web/src/styles/s2-a.css
docs/s2-c-quality-ledger.md
```

No backend engine/schema, auth/security, API, fetcher, environment, deployment, Caddy, CI, package/dependency, or S1-A proof files changed. No test or production file was deleted.

## Release dependencies and preserved workspace artifacts

- Public guest audits remain disabled by default; no production configuration or deployment was changed.
- Before release: live Turnstile end-to-end validation; verified single-worker/single-replica topology or reviewed shared limiter; production HTTPS/Caddy routing validation; and operational abuse/resource-limit review.
- Actual browser zoom and manual assistive-technology testing remain open.
- The S1-A proof checker remains on its unmerged owning branch; its blocking-verdict colour exception needs separate resolution.
- No S2-C2 work was started.
- Preserved untracked artifacts (not staged): `tests/integration/.seo-sensei-phase2d-37292/caddy-root.cer`, `tests/integration/.seo-sensei-phase2d-37292/caddy-root.pem`, and `web/review/s2-b2.zip`. They were not deleted, renamed, moved, or modified.
