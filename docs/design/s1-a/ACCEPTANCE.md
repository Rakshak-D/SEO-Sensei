# S1-A acceptance matrix

All results below describe the static design proof. Production behavior is unverified unless a row explicitly says otherwise.

| Criterion | Status | Measured value | Evidence | Production applicability |
|---|---|---|---|---|
| 1. Summary shows no more than five fixes; explanatory copy stays under 120 words. | **PASS** | 5 fixes; 36 words | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static UI only; production API content unverified. |
| 2. Page anatomy changes with the analysis data. | **PASS** | 8 regions differ; all 23 check IDs mapped | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static test inputs; live API variation unverified. |
| 3. Finding and anatomy selection work with mouse and keyboard. | **PASS** | 3 keyboard actions; bidirectional mapping and focus checked | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static browser interactions only. |
| 4. No credential fields or browser bearer code. | **PASS** | 0 credential inputs; 0 bearer-code matches | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof scope only. |
| 5. One score caveat per report; no banned authored UI labels. | **PASS** | 1 caveat panel per report view; 0 app-authored banned labels; 3 observed page-data occurrences | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof UI; excludes observed source text from label scan. |
| 6. Only opacity/transform animate; reduced motion removes motion. | **PASS** | Animated properties: opacity, transform; reduced duration 1e-05s | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof CSS; production styles unverified. |
| 7. No overflow or overlap at required widths; layout shift measured. | **PASS** | 0/37 overflow/overlap cases; minimum text 16px, evidence 13px; 768px URL field 377px and subpage anatomy 707px; hostname lines at 390/320px 1/1; CLS initial 0, loading→result 0; 320px no overflow; sources none | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof only; production runtime unverified. |
| 8. Text contrast ≥4.5:1; status/focus ≥3:1. | **PASS** | 6.10:1 text; 3.81:1 status; 3.81:1 focus | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Measured rendered static proof colors. |
| 9. No browser request leaves the app origin. | **PASS** | 897 requests; hosts 127.0.0.1:58574; 0 unexpected | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Local test server only; future service calls unverified. |
| 10. Seven state URLs survive reload; unavailable report data has recovery. | **PASS** | 7/7 routes; missing-data recovery shown | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static routes; persistence of future live reports unverified. |
| 11. Banned visual patterns are absent in inspected screenshots. | **PASS** | 27/27 screenshots manually opened; see TASTE.md | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Human review of static screenshots only. |
| 12. Two concrete audit-specific visual choices are documented for every state. | **PASS** | 7/7 named state sections cite visible differentiators | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Written design review; supervisor approval remains open. |

## Layout measurements

| View | Sample | Viewport | Document width | Overflow | Overlap pairs | Body / evidence text px |
|---|---|---:|---:|---:|---:|---:|
| home | — | 1440x900 | 1440px | no | 0 | 16 / 16 |
| home | — | 1024x768 | 1024px | no | 0 | 16 / 16 |
| home | — | 768x1024 | 768px | no | 0 | 16 / 16 |
| home | — | 390x844 | 390px | no | 0 | 16 / 16 |
| summary | weak | 1440x900 | 1440px | no | 0 | 16 / 13 |
| summary | weak | 1024x768 | 1024px | no | 0 | 16 / 13 |
| summary | weak | 768x1024 | 768px | no | 0 | 16 / 13 |
| summary | weak | 390x844 | 390px | no | 0 | 16 / 13 |
| on-page | weak | 1440x900 | 1440px | no | 0 | 16 / 17 |
| on-page | weak | 1024x768 | 1024px | no | 0 | 16 / 17 |
| on-page | weak | 768x1024 | 768px | no | 0 | 16 / 17 |
| on-page | weak | 390x844 | 390px | no | 0 | 16 / 17 |
| previews | weak | 1440x900 | 1440px | no | 0 | 16 / 16 |
| previews | weak | 1024x768 | 1024px | no | 0 | 16 / 16 |
| previews | weak | 768x1024 | 768px | no | 0 | 16 / 16 |
| previews | weak | 390x844 | 390px | no | 0 | 16 / 16 |
| fix-list | weak | 1440x900 | 1440px | no | 0 | 16 / 14 |
| fix-list | weak | 1024x768 | 1024px | no | 0 | 16 / 14 |
| fix-list | weak | 768x1024 | 768px | no | 0 | 16 / 14 |
| fix-list | weak | 390x844 | 390px | no | 0 | 16 / 14 |
| loading | weak | 1440x900 | 1440px | no | 0 | 16 / 16 |
| loading | weak | 1024x768 | 1024px | no | 0 | 16 / 16 |
| loading | weak | 768x1024 | 768px | no | 0 | 16 / 16 |
| loading | weak | 390x844 | 390px | no | 0 | 16 / 16 |
| error | — | 1440x900 | 1440px | no | 0 | 16 / 16 |
| error | — | 1024x768 | 1024px | no | 0 | 16 / 16 |
| error | — | 768x1024 | 768px | no | 0 | 16 / 16 |
| error | — | 390x844 | 390px | no | 0 | 16 / 16 |
| summary | basic | 1440x900 | 1440px | no | 0 | 16 / 13 |
| summary | basic | 1024x768 | 1024px | no | 0 | 16 / 13 |
| summary | basic | 768x1024 | 768px | no | 0 | 16 / 13 |
| summary | basic | 390x844 | 390px | no | 0 | 16 / 13 |
| summary | noindex | 1440x900 | 1440px | no | 0 | 16 / 13 |
| summary | noindex | 1024x768 | 1024px | no | 0 | 16 / 13 |
| summary | noindex | 768x1024 | 768px | no | 0 | 16 / 13 |
| summary | noindex | 390x844 | 390px | no | 0 | 16 / 13 |

CLS measured with Chromium 158.0.8127.18: initial report load **0**, controlled loading-to-result transition **0**. Initial shift sources: none; transition shift sources: none.

Contrast sample (weak Summary): minimum text **6.10:1**; status **3.81:1**; focus **3.81:1**.

Network sample: 897 requests across 1 distinct host(s): 127.0.0.1:58574. Unexpected external requests: 0.

Visual review: 27 screenshots opened and inspected at native dimensions; see TASTE.md for state-specific notes.
