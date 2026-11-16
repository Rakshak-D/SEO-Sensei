# S1-A R1 taste review

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
