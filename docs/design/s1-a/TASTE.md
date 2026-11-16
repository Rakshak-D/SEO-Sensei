# S1-A R2 final design taste review

## R2 screen-by-screen review

### Home

- **SEO Sensei identity:** The page-address field is the main visual action, followed by named local page examples rather than generic feature tiles.
- The compact page wordmark and direct “Check page” control lead into a report-oriented layout.
- **Calmer than R1:** The single-column form and brief support sentence remove the extra explanatory density.
- At 390px the 36px headline wraps to two lines; the 56px input and 44px actions remain comfortable.
- **Removed generic patterns:** There is no three-card marketing grid, score gauge, or decorative AI artwork.
- The optional keyword control is present but makes no claim of keyword analysis.

### Summary

- **SEO Sensei identity:** A real-data page-shaped preview shows the returned title, missing description, H1, text, image, and link structure.
- Three action-first fixes sit beside the preview on desktop; the page identity and verdict explain what is being inspected.
- **Calmer than R1:** The header is shorter and removes the previous extra word spacing; the page reads in ordinary sentence case.
- Priority cards use 16px explanation copy and restrained severity marks rather than many compact labels.
- **Removed generic patterns:** The full X-ray is no longer repeated in a rail; the Summary has only a small preview and one opening action.
- The Summary is still the screen closest to a generic report dashboard: white priority sheets and a conventional score block are familiar patterns. The data-derived X-ray preview is its strongest distinct mark.

### Fix list

- **SEO Sensei identity:** Findings connect to inspectable page parts through “Show on page” and to concrete source evidence.
- Group headings, one open row, and one collapsed row make the work list identifiable without a table of every check.
- **Calmer than R1:** The mobile page starts with its own task heading and a short explanation, not a repeated report header or anatomy.
- Count reconciliation appears once; severity and effort are short text badges with icons.
- **Removed generic patterns:** There are no repeated full evidence blocks and no Copy button on every collapsed item.
- The mobile count line remains the densest text component and wraps to three lines at 390px; it is useful reconciliation, but should be scanned as a summary rather than prose.

### Page X-ray

- **SEO Sensei identity:** Title and description occupy the top of a document-shaped specimen; H1, subheadings, body text, image, and links sit in distinct page regions.
- The caption says this is a simplified drawing, and unassessed header/footer spaces remain dashed instead of being marked pass or fail.
- **Calmer than R1:** Larger page regions replace the earlier sequence of diagnostic rows.
- Metadata such as JSON-LD is kept outside the page silhouette, so the body drawing does not imply it is visible page content.
- **Removed generic patterns:** The X-ray is a dedicated page, not a decorative diagram repeated beside every finding.
- The layout is still schematic because the engine returns aggregate information, not DOM positions; the drawing must not be read as exact geometry.

### On-page

- **SEO Sensei identity:** The returned page title and description are the first evidence, followed by actual H1/H2 text and a word count.
- A relevant description finding links directly back to its fix.
- **Calmer than R1:** The page has a distinct “On-page content” heading and fewer shared report controls.
- Four white sections separate title, description, headings, and content without enclosing each sentence in a border.
- **Removed generic patterns:** The full X-ray and broad Summary priority list are not repeated here.
- The four soft-shadow surfaces are still somewhat repetitive, though their content is distinct and in a useful reading order.

### Previews

- **SEO Sensei identity:** The search, Facebook, X, and LinkedIn treatments are built from returned metadata and show absent descriptions/images as absent.
- An estimate note qualifies their appearance rather than promising the exact result on a third-party service.
- **Calmer than R1:** Preview details are grouped by destination and use a compact shared page identity.
- The first search treatment leads; the social treatments follow in a two-column desktop layout.
- **Removed generic patterns:** No invented thumbnail art, gradient panels, or generic KPI cards appear.
- Four platform surfaces remain the busiest page, and at 768px they need layout measurement even though no overflow or overlap was detected.

### Loading

- **SEO Sensei identity:** The four stages name page retrieval, HTML reading, deterministic checks, and report building.
- The stage list reserves the report space rather than using a spinner or abstract progress gauge.
- **Calmer than R1:** One stage is visibly active and the Cancel action is easy to locate.
- Motion is limited to opacity/transform and is removed under reduced-motion preference.
- **Removed generic patterns:** There is no circular progress meter, robot/AI illustration, or fake numerical percentage.
- This is a controlled offline state, not evidence that a request or crawl ran.

### Error

- **SEO Sensei identity:** The four causes describe failures visitors can understand when a page cannot be checked.
- Each cause gives a short explanation, a next step, Try again, and Back controls.
- **Calmer than R1:** The state uses one heading, a short introduction, and a two-by-two layout instead of a large error hero.
- The retry returns to a supported local sample because arbitrary URLs are not fetched in this proof.
- **Removed generic patterns:** There are no fabricated URL-specific diagnostics or decorative warning illustrations.
- The four recovery choices are dense at 1440×900 but remain separated and legible; production errors will need real server classifications.

## Typography and spacing comparison

Both required local font pairs were loaded on the same Summary at 1440×900 and 390×844. Pair A (Hanken Grotesk + JetBrains Mono) and Pair B (Schibsted Grotesk + IBM Plex Mono) had identical measured text bounds: title 1008×32.47px desktop and 358×30.16px mobile; body 593.5×22.39px desktop and 302×44.78px mobile. The display text was 28px/26px, body 16px, and code 13px/12px. Pair A was selected after direct visual comparison: Hanken reads more open and friendly at those identical dimensions, while Schibsted feels firmer. All fonts and licence notices are bundled.

The CSS display tracking is no tighter than -0.02em. Browser Range measurements found a minimum visible adjacent-word gap of 0.2441em (4.2344px) across 75 tested pairs. Smallest rendered text is 12px. The browser suite found minimum ordinary text contrast 6.6588:1 and minimum severity-badge contrast 6.4060:1. No palette change was necessary.

## Critical limits

- **Weakest remaining screen:** Summary still uses conventional report cards and score placement; the small X-ray preview differentiates it, but the overall layout is not entirely unique.
- **Most crowded component:** The Fix list’s multi-part count line, especially on 390px where it wraps to three lines.
- **Smallest actual text:** 12px monospace evidence on mobile X-ray/URL elements; this meets the explicit minimum but is the least comfortable size.
- **Accessibility weaknesses:** Automated keyboard and focus checks pass. Actual 200% browser zoom/text enlargement and manual screen-reader review were not performed; desktop and mobile visual review cannot replace them.
- **Unavailable product work:** Live guest analysis, public abuse controls, Technical, Links and images, Structured data, Speed, History, persistent re-check history, and production error recovery are outside this proof.

The remainder of this file preserves the earlier R1 taste notes as historical context. Their 27-capture measurements describe R1 and are not R2 evidence.

## Historical R1 taste review

## Design decisions

This revision follows the page-X-ray brief and does not reuse the rejected cream-and-serif Evidence Ledger style. Archivo carries interface and heading text; IBM Plex Mono marks URLs, observations, tags and code. Both fonts are bundled with their licence notices. The page remains near-white (`#FAFAF7`) with white paper, warm rules, dark ink and the single red action signal (`#E5481C`). Existing palette tokens were not changed. Search-preview titles now use ink instead of green; medium-impact labels use neutral ink; review explanations use dark text with a small amber status dot. These usage corrections keep green and amber as status marks and retain readable contrast.

The summary report header is compressed to 17px top padding, a 12px identity divider, and a 12px gap before its work area. At mobile width, the report title uses `clamp(27px, 8.2vw, 35px)`, and the priority list follows the verdict and schematic entry. The page silhouette uses borders and nested regions rather than repeated diagnostic rows. Its labels explicitly say that the arrangement is schematic, not DOM geometry. Response metadata sits in a separate rail; JSON-LD and sharing fields are never drawn as body content.

## State-by-state taste check

### Home

With the wordmark covered, the screen still reads as an audit because its headline names the page itself and the URL field is the dominant action. Two visible local page addresses sit in plain ruled rows beside that field, so the visitor sees a concrete path from URL to inspection rather than generic feature cards. The optional keyword field is identified as unchecked. Weakness: the large home headline still takes substantial space on mobile, but the URL control remains in the first screen.

### Summary

The page-shaped specimen is the first unmistakable audit cue: title and description at its top, an H1 block, indented content bands, and image/link regions only when returned counts justify them. The first priorities sit beside it on desktop, and each has its own evidence, action and copy-or-review control. Mobile shows the verdict, the first two priorities and a miniature anatomy entry before scrolling. The desktop specimen continues below the 900px capture edge, and its full metadata rail is dense; this is the weakest remaining Summary tradeoff. The score is secondary to the verdict, and its one help disclosure is the only score caveat.

### On-page

The specialist heading is followed immediately by returned title and description values; heading text and approximate visible-word count come next. Monospace values distinguish observations from UI copy. On mobile the structure control is below the page-specific content and starts closed; opening it exposes the schematic without replacing the current selection. The first viewport now answers the page's job before offering extra anatomy.

### Previews

The search-result treatment is first and uses only returned title, URL and description. Social surfaces follow in a single mobile column; absent images remain explicitly empty, not decorated with invented artwork. The preview title uses the same dark ink as the rest of the report so green remains a small status color. The platform surfaces are still sketches; they do not claim exact rendering or guaranteed truncation behavior.

### Fix list

An actionable finding, its status, impact, evidence, plain action and copy-or-review control appear immediately after the distinct Fix list heading. Ruled rows keep the list readable without turning each entry into a boxed dashboard card. Editable templates are labelled as such and carry review notes; a missing defensible snippet gets a Review fix action instead. The list is long by design because it exposes every actionable non-passing check, so users must scroll for later findings.

### Loading

The staged bars echo the same specimen-and-findings composition used by the report. Their widths vary like content regions, and animation uses only opacity and transform. Copy states that no crawl or service request is running. The screenshot is a timed capture of the local motion study, not a live analysis state.

### Error

“No live scan here” identifies why an arbitrary URL cannot produce a result in this offline proof. The visible URL is inert history context, and the two recovery links return to URL entry or an available local analysis. This state looks like a failed audit only in the sense that no report is loaded; it does not invent a fetch failure or offer a fake retry.

## Before and after

The R1 comparison is linked in [`evidence/R1-BEFORE-AFTER.md`](evidence/R1-BEFORE-AFTER.md). The prior desktop Summary put a large header above a row-shaped diagnostic anatomy; the anatomy started late and the top findings had no direct copy control. The mobile Summary showed the verdict and first findings but no recognizable anatomy entry. On-page, Previews and Fix list started with the same large header and anatomy, burying their distinct work. R1 changes these to a page specimen, task-first subpages, and direct Summary actions.

The weak and basic results differ structurally, not just by labels: weak has a dashed missing-H1 region, one image slot and an observed link area; basic places its returned H1 in the heading block and draws no image or link area. A footer position remains explicitly unassessed. JSON-LD and sharing observations remain outside the page silhouette.

## Responsive decisions and measurements

At 1440×900, the verdict occupies y=268–306; the specimen begins at y=420; the first three priority rows end at y=515, 676 and 837. At 390×844 after the final readability pass, the verdict occupies y=254–279, the anatomy entry y=312–377, and the first two priority rows span y=397–550 and y=550–685. On-page primary values, the first preview and first fix item all fit within their 390×844 first viewport. The detailed anatomy is available in a labelled, keyboard-operable disclosure on tablet and mobile; the disclosure opens when a check is inspected.

Measurements run at 390, 768, 1024 and 1440 CSS pixels show no horizontal overflow or detected sibling overlap; the extra 320px Summary check also has no overflow. Visible primary technical evidence measures at least 13px at both 390px and 320px, with no clipped or line-clamped evidence. Measured secondary labels are at least 12px at those widths. Measured CLS is 0 on initial Summary load and on the controlled loading-to-result transition. Text contrast measured 6.07:1, status 3.81:1 and focus 3.81:1 in the reported sample. CSS viewport emulation is not browser zoom or text enlargement.

## Priority and snippet honesty

Impact conditions are stored in `enrichment.json`; `proof.js` has one generic condition evaluator and no per-check impact branches. Browser-rendered test variations confirm missing title/description as high, the observed one-character title as medium, `noindex` as blocking, `nofollow` alone as low, and malformed JSON-LD as medium. The noindex test uses controlled response-header metadata. It does not claim an actual indexing decision. Missing optional JSON-LD is not presented as a broken-feature action.

Snippets preserve provenance. An observed H1 can seed a clearly labelled editable title template when the title is missing. Description and H1 placeholders are editable templates, not invented page copy. A missing canonical draft uses the returned final URL and says to confirm the preferred URL. An image-alt suggestion uses the supplementary local source note and warns that decorative images can correctly have empty alt. The noindex pattern asks the owner to confirm intent; it does not recommend removal. No snippet promises rankings or indexation.

## Tradeoffs, weak spots, and unverified items

- The X-ray is intentionally a schematic grouping of API fields; the engine does not return DOM positions or header/footer landmarks. The footer is never marked as passed or failed.
- The desktop Summary specimen is still taller than the first viewport. Its top establishes the page shape, while all first three priority actions remain visible; the rest is available by scrolling.
- At 390px, longer evidence and actions now wrap at readable sizes rather than being clamped. This makes the first two Summary priorities taller, while the verdict, X-ray entry and both actions remain visible in the initial viewport. Later findings remain available by scrolling.
- The input pages are short, so some regions are sparse. The proof keeps those absences instead of adding invented content.
- All 27 final Chromium captures were opened and inspected at their native dimensions. The banned cream-and-serif, blue/gradient, three-card and emoji patterns are absent. The weakest visual spot remains the desktop Summary specimen extending below the capture; its first three actions are visible. Mobile Summary no longer shortens evidence or actions, and specialist-page mobile captures show each page's primary job before the anatomy disclosure.
- Social previews are sparse when metadata is absent. Empty imagery and missing values remain explicit.
- The score and check statuses are byte-for-byte unchanged engine outputs at version 1.0. Enrichment affects presentation priority only.
- Automated browser checks use Playwright-bundled Chromium and CSS viewport changes. No actual 200% browser zoom, text-enlargement/reflow or manual screen-reader review is claimed.
- This remains an offline static design proof. It does not validate production API behavior, anonymous quotas, account-free access, crawl safety, or deployment.

## Final readability correction

The last mobile typography pass changed only compact mobile sizes and wrapping; it did not change palette, fonts, hierarchy or page composition. Primary observed evidence, recommendations, URLs and code snippets are at least 13px at 390px and 320px. The measured secondary labels are at least 12px. Summary observations and actions wrap naturally with no line clamp; the measured browser check found zero clipped evidence elements, zero horizontal overflow and zero detected overlap. The regenerated 27 screenshots were re-opened at native dimensions. Desktop typography and the accepted desktop layout remain unchanged.
