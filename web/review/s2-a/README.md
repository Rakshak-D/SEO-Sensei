# S2-A browser evidence

These are full-resolution Chromium captures from the production React app served through the local HTTPS Caddy/FastAPI integration harness. The API used the existing guest v1.1 contract and controlled test-only SafeFetcher responses for `phase2d.test`; no public website was fetched. Browser version reported by Playwright: Chromium `158.0.8127.18` (not branded Google Chrome).

The guest feature flag and Turnstile verifier were enabled only by `tests/integration/guest-test.compose.yaml`. The test verifier is not part of the browser bundle. The test session did not require a challenge, and the browser made zero external-origin requests and zero Turnstile requests. The test explicitly confirmed the guest cookie is HttpOnly, Secure, SameSite=Lax, host-only and unavailable to `document.cookie`; CSRF stayed in memory and no authorization header was sent. A separate deliberate request verified that the protected browser analysis endpoint still returns 401 to an unauthenticated guest.

## Captures

| File | Route/state and source | Viewport | What it records |
|---|---|---:|---|
| [home-desktop-1440x900.png](home-desktop-1440x900.png) | `/`, guest bootstrap from HTTPS test app | 1440×900 | URL entry; the heading wraps to two lines; local example is explicitly identified as fictional. |
| [home-mobile-390x844.png](home-mobile-390x844.png) | `/`, same guest session | 390×844 | Mobile URL entry and compact header. |
| [summary-normal-desktop-1440x900.png](summary-normal-desktop-1440x900.png) | `?view=overview&source=guest`, controlled warning response from SafeFetcher fixture | 1440×900 | Actual backend v1.1 verdict, score, counts and three priorities. |
| [summary-normal-mobile-390x844.png](summary-normal-mobile-390x844.png) | Same report held in browser memory | 390×844 | Verdict, first priorities and fixed bottom navigation. |
| [summary-blocking-desktop-1440x900.png](summary-blocking-desktop-1440x900.png) | `?view=overview&source=guest`, controlled noindex response | 1440×900 | Backend blocking verdict and finding data. |
| [summary-blocking-mobile-390x844.png](summary-blocking-mobile-390x844.png) | Same blocking report held in browser memory | 390×844 | Blocking summary above mobile navigation. |
| [fix-list-desktop-1440x900.png](fix-list-desktop-1440x900.png) | `?view=findings&source=guest&mode=review`, same blocking report | 1440×900 | One expanded finding and other collapsed findings. |
| [fix-list-mobile-390x844.png](fix-list-mobile-390x844.png) | Same report | 390×844 | Mobile evidence and fix instructions. |
| [guest-loading-1440x900.png](guest-loading-1440x900.png) | `/`, controlled delayed response before the HTTPS request continues | 1440×900 | Honest indeterminate wait state and Cancel action; no simulated progress telemetry. |
| [guest-error-390x844.png](guest-error-390x844.png) | `/`, Playwright-controlled 429 with `Retry-After: 45` | 390×844 | Friendly rate-limit message and retry guidance. |
| [mobile-more-390x844.png](mobile-more-390x844.png) | `?view=findings&source=guest&mode=review`, More sheet opened | 390×844 | Available navigation and disabled planned pages; X-ray has no count badge. The sheet scrolls for lower entries. |
| [focus-keyboard-390x844.png](focus-keyboard-390x844.png) | `/`, keyboard focus on URL field | 390×844 | Visible 3px keyboard focus ring. |

The captures are unmodified Playwright screenshots. Summary reports and fixes come from the actual guest response; the 429 and loading delay are controlled UI scenarios. The report is held in browser memory only and is not restored after reload. The reload screen asks the visitor to run a new audit.

## Measured layout

At 1440×900, the verdict rectangle is `(x=367.19, y=197.30, w=533.11, h=73.44)` and the score rectangle is `(x=1177.72, y=193.30, w=143.09, h=50.00)`. The three priority cards occupy y ranges `394.67–504.67`, `514.67–624.67`, and `634.67–744.67`.

At 390×844, the fixed navigation starts at y=776 and is 68px tall. Priority card 1 occupies `429.88–592.59`; card 2 occupies `600.59–742.06`. Both are fully above the navigation with 33.94px remaining after card 2. Document scroll width is 390px. The third card remains reachable by scrolling.

## Review limits

- This evidence uses local HTTPS, controlled fetch fixtures, and a test-only Turnstile verifier. Live Cloudflare Siteverify and a real challenge were not exercised.
- The real extension/Google Chrome branding, public production guest mode, and multi-replica limiting are outside this milestone.
- S2-A does not implement the interactive Page X-ray, specialist pages, shared limiter, or deployment. These remain S2-B/S2-C or operational gates.
- Chromium testing is not a complete manual screen-reader or accessibility review.
