# S1-A taste review

## Design decisions

This proof starts from the S1-A X-ray design bible, not the earlier warm serif Evidence Ledger system. It uses Archivo for interface and headings and IBM Plex Mono for URLs, tags, and code. Both are bundled locally with their OFL notices; there is no font CDN.

The seed colors are unchanged: page `#FAFAF7`, sheet `#FFFFFF`, ink `#14130F`, and action signal `#E5481C`. The structural and status tokens make the rules explicit: rule `#D8D6CE`, strong rule `#A9A69D`, muted ink `#625F57`, deep action `#A72D0F`, pass `#216B49`, warning `#805100`, fail `#A72D0F`, neutral `#59574F`, quiet surface `#F0EFE9`, and blocking tint `#FFF0E9`. The fail mark reuses the deep action token; green and amber are reserved for small check-status cues. No blue, purple, gradient, or serif styling is used.

No pre-existing spacing scale was supplied. The added rhythm uses 4/8px increments for controls and small gaps, 16/24/32px for section structure, and fluid page gutters (`clamp(20px, 4vw, 64px)`, reduced to 19px on mobile). A few 1px offsets and 13px evidence labels remain for alignment and density; larger evidence text is 14px.

## State-by-state taste check

### Home

If the wordmark were covered, the oversized “See what your page says” headline leads directly into a URL field, and the side list names two reserved page paths with observed audit differences. The title is not a generic SaaS greeting: it sets up page observation, and the URL field is the only primary action. The side list uses plain rows and actual source URLs instead of feature cards. The optional keyword field is visibly marked as not checked.

### Summary

If the wordmark were covered, the page is still identifiable as an audit because a page-shaped specimen shows actual title, description, H1, heading, text, link, image, structured-data, and sharing signals, while the neighboring top-five list names specific returned checks. Selecting “Image alternative text” lights the image region and exposes the aggregate check evidence plus a clearly separate offline source note. The noindex comparison shows a blocking observation before its smaller score. Page anatomy and evidence—not a chart or widget—own the main working area.

### On-page

If the wordmark were covered, the primary content is a sequence of actual title, description, heading values, visible-word count, and canonical observation. Each check row has a working “Inspect in anatomy” path that returns to the scan and focuses the related note. The right-side mini anatomy repeats the real page structure, which keeps inspection linked to the source rather than turning this into an editorial article.

### Previews

If the wordmark were covered, the four separate surfaces are labeled by the metadata source they use: page metadata, Open Graph, and X values with page-metadata fallback. Missing share images remain empty neutral regions instead of fake artwork. The page URL, title, and descriptions come from the analysis JSON; each surface says it is a sketch and may differ from platform rendering.

### Fix list

If the wordmark were covered, each open check has a status, design-only impact, effort, observed evidence, and a control to inspect its anatomy mapping. Rows are separated by rules rather than repeated boxed cards. The exact snippet is either derived from observed values or remains an editable template with an explicit review note; checks that cannot support a safe snippet explain why no code was drafted.

### Loading

If the wordmark were covered, the reserved two-column footprint already resembles the page scan beside an ordered inspection list. The stepping outline positions match the metadata and heading regions used in the result screen. The copy states this is a local motion study and provides a real link to the completed local result; it does not suggest a request has been sent.

### Error

If the wordmark were covered, “No live scan here” states why an arbitrary URL has no report, and the URL appears only as preserved in-memory navigation context. The recovery actions return to URL entry or open an available local analysis. The visible state avoids an invented crawl failure and has no retry that would imply a backend request.

## Responsive decisions

At 1024px and desktop widths the scan and ranked findings share the main work surface, with the scan receiving slightly more width. At 768px the report navigation wraps to its own row and the report still keeps the scan beside the prioritized findings. The subpage anatomy and URL-entry fields stack at tablet widths: the previous 171px URL field was too narrow for a useful pasted address, and the 199px side anatomy forced returned text into narrow columns. At mobile width the top-five list comes before the anatomy, so the first actions are visible sooner; the scan remains a sequence of full-width, keyboard-operable regions below it. Categories stack to two columns and then continue vertically. Subpage side context moves above the main content, previews become a single column, and there is no fixed navigation.

Browser measurement found a 13px side-rail overhang at 768px caused by the anatomy status words. The compact subpage rail now hides those redundant visible words at widths up to 900px; each anatomy control retains its full accessible name, including status. No palette, font, or spacing token changed.

The 390px and 320px captures showed `example.test` splitting with a single terminal character on its own line because the hostname shared a row with the score. The mobile heading now uses a smaller fluid size (`clamp(31px, 10vw, 46px)`) so this short hostname remains on one line at both widths. The typeface and desktop title sizes are unchanged.

The noindex comparison initially fell into the unavailable-data state because supplementary source notes exist for the original `weak` HTML only, while the loader required a separate `noindex` note record. It now reuses the weak-source note set for the noindex analysis because both engine outputs derive from the same unchanged HTML. The report itself still reads the separately generated noindex analyzer output and labels the response-header condition as simulated.

The first-load CLS probe identified the initial boot placeholder moving the document body and the navigation text changing width during local font swap. The root now reserves the viewport before the script runs, report routes use the already-designed loading skeleton while data files load, the footer is appended after the report content, and the bundled fonts are preloaded. These changes preserve the selected typefaces and layout tokens while addressing the measured shift sources.

## Tradeoffs, weak spots, and unverified items

- The original test pages are unusually short. Their observed copy makes some anatomy rows sparse; the proof preserves that instead of filling them with invented DOM content.
- The Basic summary at mobile width is the weakest view: its five ranked review rows push the page X-ray below the first viewport. Showing those first actions is the intentional reading order, but a future review may choose to surface a compact anatomy entry before the list.
- The analyzer returns image counts, not each image's source or line. Only the weak input has a supplementary source note generated from the original test HTML. That detail is explicitly described as unavailable in the current analysis contract.
- The analyzer does not expose page landmarks or a footer. The scan explicitly says those are not returned and does not draw a fabricated footer.
- The optional target-keyword field has no checking behavior. Its purpose and limitation are stated beside it; the field only carries local form input and sends nothing.
- Preview surfaces can feel sparse when social metadata is absent. The empty image treatment is intentional and evidence-led.
- Small mono labels and status tags are secondary. Body copy is 16px; code/evidence is 14px. At the narrowest inspected width, finding evidence wraps instead of scrolling sideways.
- The word “fixture” appears in the Basic page's actual title, description, and H1. Those text nodes are marked as observed source data, not authored interface labels. No interface label uses the prohibited terms.
- A small logo-covering identifier is not needed to distinguish the report: the page-structure X-ray and the adjacent ordered observations make the audit purpose visible. Subpages keep the compact score and page identity above the returned fields.
- The screenshots and browser checks use Playwright's bundled Chromium and CSS viewports. No genuine browser-zoom or text-enlargement test is claimed. A manual screen-reader review and production accessibility acceptance are still open.
- This is a static proof only. Production API behavior, account-free access, quotas, backend limits, page-fetch safety, and public deployment are not implemented or verified here.
