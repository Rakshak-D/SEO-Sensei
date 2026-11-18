# S2-B2 browser evidence

Captured from the production React application in Chromium 158.0.8127.18. The two specialist integration scenarios ran through the controlled HTTPS harness: `/pages/warnings` and `/pages/all-pass` were fetched by the existing SafeFetcher and analyzed by the deterministic v1.1 engine (23 checks). The Northstar state is the existing fictional local sample and makes no page request.

All seven PNGs below were inspected at their native dimensions. They are unmodified Chromium captures. Social image addresses are shown as text; the browser made no requests outside the app origin.

| Capture | Route and source | Viewport | Measured elements and visual review |
| --- | --- | --- | --- |
| [on-page-demo-desktop-1440x900.png](on-page-demo-desktop-1440x900.png) | `?view=on-page&source=demo&access=guest`; fictional local Northstar sample | 1440×900 | On-page heading: x=464, y=167.48, 760×35.83. Page-title section heading: x=464, y=321, 86.67×32.55. No overflow or clipping. |
| [on-page-demo-mobile-390x844.png](on-page-demo-mobile-390x844.png) | `?view=on-page&source=demo&access=guest`; fictional local Northstar sample | 390×844 | On-page heading: x=16, y=151.48, 358×31.36. Page-title section heading: x=16, y=312.53, 78.42×29.44. Fixed navigation: y=776, h=68. No horizontal overflow; title and description are readable before the nav. |
| [on-page-selected-fix-390x844.png](on-page-selected-fix-390x844.png) | `?view=findings&source=guest&mode=review&check=title`; controlled `/pages/warnings` analysis reached from On-page | 390×844 | Exact expanded Fix row: x=16, y=243, 358×358.52, bottom=601.52. Fixed navigation top=776; clearance=174.48px. The selected title finding, evidence, next step and X-ray action are visible above the nav. |
| [previews-rich-desktop-1440x900.png](previews-rich-desktop-1440x900.png) | `?view=previews&source=guest`; controlled `/pages/all-pass` analysis | 1440×900 | Heading: x=464, y=134.69, 760×35.83. Search and Open Graph cards: x=367.19/854, y=254.52, each 466.81×495.84, bottom=750.36. X and LinkedIn cards continue below the first viewport and remain available by scrolling. No remote image rendered. |
| [previews-rich-mobile-390x844.png](previews-rich-mobile-390x844.png) | `?view=previews&source=guest`; controlled `/pages/all-pass` analysis | 390×844 | Heading: x=16, y=120.69, 358×31.36. Search illustration: x=16, y=252.05, 358×366.88, bottom=618.92. Fixed navigation top=776; clearance=157.08px. Single-column layout, no horizontal overflow. |
| [previews-missing-metadata-1440x900.png](previews-missing-metadata-1440x900.png) | `?view=previews&source=guest`; controlled `/pages/warnings` analysis, with no returned social metadata | 1440×900 | Heading: x=464, y=140.69, 760×35.83. Search and Open Graph cards: x=367.19/854, y=260.52, each 466.81×475.55, bottom=736.06. Absent social fields are explicitly reported; no fallback copy or image is fabricated. |
| [previews-related-fix-390x844.png](previews-related-fix-390x844.png) | `?view=findings&source=guest&mode=review&check=title`; controlled `/pages/warnings` analysis reached from Previews | 390×844 | Exact expanded Fix row: x=16, y=119, 358×358.52, bottom=477.52. Fixed navigation top=776; clearance=298.48px. The selected finding remains expanded and in view. |

## Requested missing-H1 capture

`on-page-missing-h1-1440x900.png` was not generated. The approved Northstar sample and the existing controlled HTTPS inputs used for this milestone all return at least one H1. Creating that capture would require inventing a report or changing the controlled backend input, which is outside this milestone's file scope. The actual React component's assessed-empty and unassessed heading states are covered by `GuestExperience.test.tsx`; `onPageModel.test.ts` covers their data distinction.

## Integration route evidence

The controlled browser test verified the complete path for two materially different documents: controlled HTML → SafeFetcher → deterministic v1.1 report → validated React specialist view → exact canonical Fix-list row. It also observed zero external-origin requests. This is controlled integration evidence, not a live public-site audit or live social-platform rendering.

Responsive Playwright checks at 320, 390, 768, 1024, and 1440px measured document widths equal to their viewport widths and a minimum visible target height of 44px. At mobile/tablet widths, the fixed navigation began at y=776. At 320/390/768px, the last On-page related action ended at y=652.59/670.47/665, while the last Previews related action ended at y=671/690.06/688.83. Both pages therefore scroll to their final action above navigation at those widths.
