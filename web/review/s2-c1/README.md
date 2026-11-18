# S2-C1 review evidence

The four files below are unmodified Chromium captures from the production React application. Chromium was `158.0.8127.18`. These captures document current interaction states; none represents a live fetch of the pictured URL. The X-ray is a simplified view of returned HTML evidence, not the target site's actual layout.

| File | Route and provenance | Viewport | Browser-measured state and native-size review |
|---|---|---:|---|
| `summary-mobile-priority-clearance-390x844.png` | `?view=overview&source=guest`; controlled browser API response with two actionable findings, not a live fetch | 390×844 | Priority 1 rectangle y=338.64–480.11px; Priority 2 y=488.11–608.47px; fixed navigation top y=776px. The second card clears navigation by 167.53px. Both complete cards are visible. |
| `xray-stationary-routed-1440x900.png` | `?view=xray&source=guest&check=robots_directives`; controlled browser API response, not a live fetch | 1440×900 | Captured after navigating with the pointer left over “Show on X-ray”; scrollY=644px. Focused pin x=395.19, y=752.47, 44×44px; selected region x=383.19, y=677.48, 559.58×133.98px; sticky detail panel x=982.77, y=24, 338.05×361.09px. Pin, highlighted region, route check and Priority 1 detail agree. |
| `xray-deliberate-hover-1440x900.png` | `?view=xray&source=guest&check=robots_directives`; controlled response, with deliberate pointer movement to the other mapped finding | 1440×900 | scrollY=0. Hovered pin x=392.19, y=600, 44×44px; selected region x=384.19, y=491.63, 557.58×169.38px; detail panel x=982.77, y=282.27, 338.05×336.09px. The detail panel and highlight show Priority 2 heading-order finding during intentional hover. |
| `xray-keyboard-focus-1440x900.png` | `?view=xray&source=demo&access=guest&check=robots_directives`; known fictional local Northstar example, with the Open Graph pin keyboard-focused | 1440×900 | scrollY=983px. Focused Priority 3 pin x=395.19, y=654.02, 44×44px; selected region x=383.19, y=555.84, 559.58×156.17px; sticky detail panel x=982.77, y=24, 338.05×407.47px. Visible focus ring, Priority 3 pin, region and Open Graph detail agree. |

Rectangles are CSS pixels measured from `getBoundingClientRect()` in the actual browser viewport after the relevant interaction. The two X-ray focus/navigation captures have the detail panel in view after the selected target is scrolled into view. All four files were inspected individually at native resolution; no visual defect was observed. No older review screenshot sets were regenerated.

## Additional measured regression results

- Summary at 390×844 keeps its first two priority cards fully above the fixed navigation: second card bottom y=608.47px, navigation top y=776px.
- Responsive tests measured no horizontal overflow and no interactive target below 44px at 320, 390, 768, 1024 and 1440px. Landscape 844×390 and a 1.5× text-size stress pass also had no horizontal overflow or right-edge text clipping. The latter is a text-size stress test, not browser zoom evidence.
- The computed-style audit found zero unauthorized vermilion uses in Home (including keyboard focus), normal/High/Blocking/zero-fix Summary, Fix list, X-ray, On-page, Previews, mobile More, Loading and Error states.
- The S1-A static proof checker is on its separate unmerged branch and was not changed.
