# S1-A acceptance matrix

All results below describe the static design proof. Production behavior is unverified unless a row explicitly says otherwise.

| Criterion | Status | Measured value | Evidence | Production applicability |
|---|---|---|---|---|
| 1. Summary shows no more than five fixes; explanatory copy stays under 120 words. | **PASS** | 5 fixes; 97 words | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static UI only; production API content unverified. |
| 2. Page anatomy changes with the analysis data. | **PASS** | 8 regions differ; all 23 check IDs mapped | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static test inputs; live API variation unverified. |
| 3. Finding and anatomy selection work with mouse and keyboard. | **PASS** | 3 keyboard actions plus mouse selection; bidirectional mapping and focus checked | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static browser interactions only. |
| 4. No credential fields or browser bearer code. | **PASS** | 0 credential inputs; 0 bearer-code matches | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof scope only. |
| 5. One score caveat per report; no banned authored UI labels. | **PASS** | 1 caveat panel per report view; 0 app-authored banned labels; 3 observed page-data occurrences | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof UI; excludes observed source text from label scan. |
| 6. Only opacity/transform animate; reduced motion removes motion. | **PASS** | Animated properties: opacity, transform; reduced duration 1e-05s | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof CSS; production styles unverified. |
| 7. No overflow or overlap at required widths; mobile evidence and secondary labels remain readable, with layout shift measured. | **PASS** | 0/37 overflow/overlap cases; minimum text 16px, evidence 11px; 390/320px technical evidence minimum 13px with 0 clipped elements; secondary-label minimum 12px with 0 labels below 12px; 768px URL field 377px and subpage anatomy 707px; hostname lines at 390/320px 1/1; CLS initial 0, loading→result 0; 320px no overflow; sources none | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static proof only; production runtime unverified. |
| 8. Text contrast ≥4.5:1; status/focus ≥3:1. | **PASS** | 6.07:1 text; 3.81:1 status; 3.81:1 focus | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Measured rendered static proof colors. |
| 9. No browser request leaves the app origin. | **PASS** | 1068 requests; hosts 127.0.0.1:58683; 0 unexpected | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Local test server only; future service calls unverified. |
| 10. Seven state URLs survive reload; unavailable report data has recovery. | **PASS** | 7/7 routes; missing-data recovery shown | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Static routes; persistence of future live reports unverified. |
| 11. Banned visual patterns are absent in inspected screenshots. | **PASS** | 27/27 screenshots manually opened; see TASTE.md | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Human review of static screenshots only. |
| 12. Two concrete audit-specific visual choices are documented for every state. | **PASS** | 7/7 named state sections cite visible differentiators | `node docs/design/s1-a/check.mjs` · `verification.json` · TASTE.md | Written design review; supervisor approval remains open. |

## S1-A R1 gates

| Gate | Status | Measured value | Method / evidence | Scope |
|---|---|---|---|---|
| R1-1. Desktop Summary shows verdict, specimen and first three actions. | **PASS** | 1440×900: verdict {"top":268,"bottom":306,"width":1325,"height":38,"visible":true}; X-ray {"top":420,"bottom":1099,"width":476,"height":679,"visible":true}; action bounds [{"top":354,"bottom":515,"width":564,"height":161,"visible":true},{"top":515,"bottom":676,"width":564,"height":161,"visible":true},{"top":676,"bottom":837,"width":564,"height":161,"visible":true}] | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Measured Chromium rectangles at document scroll origin. |
| R1-2. Mobile Summary shows verdict, two actions and X-ray entry. | **PASS** | 390×844: verdict {"top":254,"bottom":279,"width":352,"height":26,"visible":true}; first two actions [{"top":397,"bottom":550,"width":352,"height":153,"visible":true},{"top":550,"bottom":685,"width":352,"height":135,"visible":true}]; entry {"top":312,"bottom":377,"width":352,"height":65,"visible":true} | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Measured Chromium rectangles at document scroll origin. |
| R1-3. On-page foregrounds observed title and description. | **PASS** | 390×844 content bounds {"heading":"On-page","top":187,"bottom":409,"visible":true,"structureLabel":"Inspect page structure","structureOpen":false,"directAction":false,"expectedHeading":"On-page"}; heading and first values visible | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Mobile viewport browser check. |
| R1-4. Previews foregrounds the metadata-based search preview. | **PASS** | 390×844 content bounds {"heading":"Previews","top":187,"bottom":340,"visible":true,"structureLabel":"Inspect page structure","structureOpen":false,"directAction":false,"expectedHeading":"Previews"}; search preview visible | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Mobile viewport browser check. |
| R1-5. Fix list foregrounds an actionable finding and action. | **PASS** | 390×844 content bounds {"heading":"Fix list","top":227,"bottom":549,"visible":true,"structureLabel":"Inspect page structure","structureOpen":false,"directAction":true,"expectedHeading":"Fix list"}; direct action true | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Mobile viewport browser check. |
| R1-6. Summary actions copy directly or offer an honest review action. | **PASS** | 5 visible direct buttons: Copy editable template, Copy editable template, Copy editable template, Copy editable template, Copy editable template | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Rendered control visibility; clipboard success separately tested. |
| R1-7. Weak and Basic analyses produce different page shapes. | **PASS** | Weak {"h1":"No H1 returned","imageSlots":1,"linksPresent":true,"footerUnassessed":true,"schemaOutsideBody":true}; Basic {"h1":"Basic fixture","imageSlots":0,"linksPresent":false,"footerUnassessed":true,"schemaOutsideBody":true} | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Rendered fields, aggregate image counts, returned link counts; no DOM coordinates claimed. |
| R1-8. Exactly one score help trigger and caveat panel appears per report. | **PASS** | {"summary":{"triggers":1,"panels":1},"on-page":{"triggers":1,"panels":1},"previews":{"triggers":1,"panels":1},"fix-list":{"triggers":1,"panels":1}} | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Counts on Summary, On-page, Previews and Fix list. |
| R1-9. Impact and effort policies live in enrichment with generic evaluation. | **PASS** | Rule-source generic: true; cases [{"case":"short title remains medium","expected":"medium","actual":"medium"},{"case":"missing title is high","expected":"high","actual":"high"},{"case":"missing description is high","expected":"high","actual":"high"},{"case":"nofollow alone is not blocking","expected":"low","actual":"low"},{"case":"malformed JSON-LD is medium","expected":"medium","actual":"medium"},{"case":"noindex is blocking","expected":"blocking","actual":"blocking"}] | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Condition variations rendered in browser from temporary test-only data; raw files unchanged. |
| R1-10. Engine scores, statuses, checks and raw outputs remain unchanged. | **PASS** | Scores/check counts {"audit-weak.json":{"score":55,"checks":23,"statuses":{"pass":8,"warning":11,"fail":3,"not_applicable":1},"enrichment":23},"audit-basic.json":{"score":84,"checks":23,"statuses":{"pass":14,"warning":7,"not_applicable":2},"enrichment":23},"audit-noindex-test.json":{"score":50,"checks":23,"statuses":{"pass":7,"fail":4,"warning":11,"not_applicable":1},"enrichment":23}}; SHA-256 {"audit-weak.json":"6b5ab639b111c52f581fa15c7a778a62fd08043b70812630a5b5bf9eb676acea","audit-basic.json":"374f9a081d34770534de68051402d6b4c6b871a60b2c0acc6e7d018ee9504a2d","audit-noindex-test.json":"018e54337646fc047177c1ab64c9198e19f7f3710d07f1a6cb79d63c48dff89c"} | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Raw analyzer JSON SHA-256 compared with baseline hashes; version 1.0. |
| R1-11. Anatomy selection and keyboard operation survive redesign. | **PASS** | 3 keyboard checks; mouse finding-to-region and region-to-evidence check PASS; focus is moved for anatomy-opened evidence | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Playwright mouse, Tab, Enter and Space interactions. |
| R1-12. No banned visual style or fabricated page content appears. | **PASS** | 27/27 captures manually inspected; 0 authored banned UI labels; 3 occurrences are observed source text; see TASTE.md | `node docs/design/s1-a/check.mjs` · `verification.json` · screenshots | Visual review is limited to this local static proof. |

## Layout measurements

| View | Sample | Viewport | Document width | Overflow | Overlap pairs | Body / evidence text px |
|---|---|---:|---:|---:|---:|---:|
| home | — | 1440x900 | 1440px | no | 0 | 16 / 16; technical —px; clipped 0 |
| home | — | 1024x768 | 1024px | no | 0 | 16 / 16; technical —px; clipped 0 |
| home | — | 768x1024 | 768px | no | 0 | 16 / 16; technical —px; clipped 0 |
| home | — | 390x844 | 390px | no | 0 | 16 / 16; technical —px; clipped 0 |
| summary | weak | 1440x900 | 1440px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | weak | 1024x768 | 1024px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | weak | 768x1024 | 768px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | weak | 390x844 | 390px | no | 0 | 16 / 13; technical 13px; clipped 0 |
| on-page | weak | 1440x900 | 1440px | no | 0 | 16 / 14; technical 11px; clipped 0 |
| on-page | weak | 1024x768 | 1024px | no | 0 | 16 / 14; technical 11px; clipped 0 |
| on-page | weak | 768x1024 | 768px | no | 0 | 16 / 14; technical 11px; clipped 0 |
| on-page | weak | 390x844 | 390px | no | 0 | 16 / 13; technical 13px; clipped 0 |
| previews | weak | 1440x900 | 1440px | no | 0 | 16 / 16; technical 11px; clipped 0 |
| previews | weak | 1024x768 | 1024px | no | 0 | 16 / 16; technical 11px; clipped 0 |
| previews | weak | 768x1024 | 768px | no | 0 | 16 / 16; technical 11px; clipped 0 |
| previews | weak | 390x844 | 390px | no | 0 | 16 / 16; technical 13px; clipped 0 |
| fix-list | weak | 1440x900 | 1440px | no | 0 | 16 / 13; technical 11px; clipped 0 |
| fix-list | weak | 1024x768 | 1024px | no | 0 | 16 / 13; technical 11px; clipped 0 |
| fix-list | weak | 768x1024 | 768px | no | 0 | 16 / 13; technical 11px; clipped 0 |
| fix-list | weak | 390x844 | 390px | no | 0 | 16 / 13; technical 13px; clipped 0 |
| loading | weak | 1440x900 | 1440px | no | 0 | 16 / 16; technical —px; clipped 0 |
| loading | weak | 1024x768 | 1024px | no | 0 | 16 / 16; technical —px; clipped 0 |
| loading | weak | 768x1024 | 768px | no | 0 | 16 / 16; technical —px; clipped 0 |
| loading | weak | 390x844 | 390px | no | 0 | 16 / 16; technical —px; clipped 0 |
| error | — | 1440x900 | 1440px | no | 0 | 16 / 16; technical —px; clipped 0 |
| error | — | 1024x768 | 1024px | no | 0 | 16 / 16; technical —px; clipped 0 |
| error | — | 768x1024 | 768px | no | 0 | 16 / 16; technical —px; clipped 0 |
| error | — | 390x844 | 390px | no | 0 | 16 / 16; technical —px; clipped 0 |
| summary | basic | 1440x900 | 1440px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | basic | 1024x768 | 1024px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | basic | 768x1024 | 768px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | basic | 390x844 | 390px | no | 0 | 16 / 13; technical 13px; clipped 0 |
| summary | noindex | 1440x900 | 1440px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | noindex | 1024x768 | 1024px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | noindex | 768x1024 | 768px | no | 0 | 16 / 11; technical 11px; clipped 0 |
| summary | noindex | 390x844 | 390px | no | 0 | 16 / 13; technical 13px; clipped 0 |

CLS measured with Chromium 158.0.8127.18: initial report load **0**, controlled loading-to-result transition **0**. Initial shift sources: none; transition shift sources: none.

Contrast sample (weak Summary): minimum text **6.07:1**; status **3.81:1**; focus **3.81:1**.

Network sample: 1068 requests across 1 distinct host(s): 127.0.0.1:58683. Unexpected external requests: 0.

Visual review: 27 screenshots opened and inspected at native dimensions; see TASTE.md for state-specific notes.
