# S2-B1 Page X-ray evidence

All captures are unmodified Chromium screenshots from the production React app. Chromium reported version `158.0.8127.18`. The local fictional example is not a live fetch. The two `phase2d.test` reports came through the controlled HTTPS integration harness: test HTML -> injected SafeFetcher transport -> deterministic v1.1 API response -> validated React report. The noindex response is a controlled test scenario, not a claim about a public website.

| Screenshot | Route and source | Viewport | Review notes |
| --- | --- | ---: | --- |
| [xray-northstar-desktop-1440x900.png](xray-northstar-desktop-1440x900.png) | `?view=xray&source=demo&access=guest`, local fictional Northstar example | 1440x900 | Shows the page silhouette, actual H1/H2 text, observed word and image counts, and unassessed header. Lower regions continue below the viewport. |
| [xray-northstar-mobile-390x844.png](xray-northstar-mobile-390x844.png) | `?view=xray&source=demo&access=guest`, local fictional Northstar example | 390x844 | Same report data in a single column. Fixed bottom tabs remain visible; the longer diagram scrolls vertically. |
| [xray-noindex-desktop-1440x900.png](xray-noindex-desktop-1440x900.png) | `?view=xray&source=guest`, controlled HTTPS noindex analysis | 1440x900 | Scrolled to expanded head metadata. The observed `noindex, follow` directive is marked Blocking and has priority pin 1. |
| [xray-noindex-mobile-390x844.png](xray-noindex-mobile-390x844.png) | `?view=xray&source=guest`, controlled HTTPS noindex analysis | 390x844 | Scrolled to metadata so the directive and pin are visible above fixed navigation; full report remains vertically scrollable. |
| [xray-weak-desktop-1440x900.png](xray-weak-desktop-1440x900.png) | `?view=xray&source=guest`, controlled HTTPS warning analysis | 1440x900 | Materially different structure: one H1, no H2/H3, no image elements, no link elements, and 16 observed words. |
| [summary-with-preview-1440x900.png](summary-with-preview-1440x900.png) | `?view=overview&source=guest`, controlled HTTPS warning analysis | 1440x900 | Three priority cards precede the compact data-shaped preview. The preview begins near the viewport bottom. |
| [summary-with-preview-390x844.png](summary-with-preview-390x844.png) | `?view=overview&source=guest`, controlled HTTPS warning analysis | 390x844 | First two priority cards are complete above fixed navigation. The third card continues below it; the preview follows all priority cards. |
| [xray-selected-pin-1440x900.png](xray-selected-pin-1440x900.png) | `?view=xray&source=guest&check=robots_directives`, controlled HTTPS noindex analysis | 1440x900 | Selected robots region is outlined and its exact finding appears in the detail panel. Pin is 44x44px. |
| [xray-keyboard-focus-390x844.png](xray-keyboard-focus-390x844.png) | `?view=xray&source=guest&check=robots_directives`, controlled HTTPS noindex analysis | 390x844 | The selected pin has a visible 3px keyboard focus ring and remains above the fixed tabs. |

## Measured rectangles

The integration test logs viewport-relative `x`, `y`, `width`, `height`, `right`, and `bottom` for the Summary verdict, score, all priority cards, X-ray title/document/regions, selected pin, and fixed navigation. Relevant results:

- Desktop Summary at 1440x900: verdict bottom `270.73`, score bottom `243.30`, and priority-card bottoms `504.67`, `624.67`, `744.67`.
- Mobile Summary at 390x844: priority-card bottoms `592.59`, `742.06`; fixed navigation top `776`, giving the second card `33.94px` clearance. The third card is below the fold.
- Desktop noindex X-ray: robots region `(383.19, 445.28, 559.58, 133.98)`; selected pin `(395.19, 520.27, 44, 44)`.
- Mobile noindex X-ray: robots region `(28, 280.95, 334, 133.98)`; navigation top `776`.
- Mobile focused pin: `(40, 185.94, 44, 44)`; navigation top `776`.
- Responsive browser checks at widths `320`, `390`, `768`, `1024`, and `1440` measured document scroll width equal to viewport width and minimum interactive target `44px`.

## Visual inspection

All nine files were opened and inspected at native resolution. The observed strings and the schematic order remain readable, and absent regions are explicitly reported. The X-ray is intentionally taller than one viewport; mobile users must scroll for lower regions. The noindex captures are intentionally scrolled to the relevant head metadata rather than showing the page top. The Summary mobile capture exposes only the first two complete priority cards above navigation, as required by the inherited S2-A layout; the remaining priority and X-ray preview remain reachable by scrolling.

The diagram describes observed HTML structure and assessment state. It does not claim exact DOM coordinates, original page layout, per-image data, navigation text, or footer content.
