# Phase 1C — Evidence Ledger design handoff

**Decision status:** refined design candidate for independent review. This is not production approval.

## Baseline and changes

- Repository: `Rakshak-D/SEO-Sensei`.
- Base branch: `design/phase-1b-focused-exploration`.
- Exact base commit: `f15a3ccafd879a46f5597be19ac54b91ca3f0c03`.
- Working branch: `design/phase-1c-evidence-ledger-final`.
- Prototype: [Phase 1C Evidence Ledger](../design/seo-sensei/phase-1c/index.html).

Phase 1C keeps Evidence Ledger's warm editorial foundation, serif/sans contrast, thin rules, text-first evidence, and secondary heuristic score. It adds a distinctive typographic wordmark and repeatable source markers; makes the failed `robots_directives` rule the first Needs review item; makes All checks retain all 23 results; and replaces the repeated URL form with a compact page context and Change page action. The broad heading word-wrap rule was removed after the real Edge 200% zoom review exposed broken word wrapping. The findings heading now stacks below 820px.

## Concept and identity

Evidence Ledger is a professional page-inspection instrument for site owners, editors, and small content teams. The visual system uses measured alignment, a warm paper-like canvas, dark evergreen ink, one restrained action color, and status colors only where they describe analyzer outcomes. Its identity comes from a repeatable wordmark, source notation, and outcome treatment; it uses no decorative charts, gauges, shadows, emoji, external fonts, or edition labels.

### Color tokens

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#f5f2ea` | Main page surface |
| `--surface` | `#fffefa` | Inputs and quoted fixture source |
| `--surface-muted` | `#eeece4` | Hover and quiet control fill |
| `--ink` | `#24302b` | Primary text and titles |
| `--ink-soft` | `#405048` | Explanatory body copy |
| `--muted` | `#526159` | Secondary labels and provenance |
| `--rule` / `--rule-light` | `#c9cec4` / `#dedfd7` | Structural and quiet dividers |
| `--field-border` / `--placeholder-ink` | `#9da99f` / `#606c64` | Form boundaries and placeholder copy |
| `--context-rule` | `#737d75` | Context separator |
| `--accent` / `--accent-hover` | `#315c50` / `#23473e` | Links, selected navigation, primary action |
| `--fail` / `--fail-wash` | `#8e3f31` / `#f4e8e2` | Fail label and restrained observation tint |
| `--lead-wash` / `--lead-divider` | `#f7eee8` / `#d8b9ad` | Consequential observation blend and its structural divider |
| `--warning` / `--warning-wash` | `#79540f` / `#f5efd9` | Warning label and wash |
| `--pass` / `--pass-wash` | `#315d43` / `#e9efe8` | Pass label and wash |
| `--na` / `--na-wash` | `#4e5d62` / `#edf0ee` | Not-applicable label and wash |
| `--evidence-ink` | `#344b44` | Fictional source excerpt text |
| `--focus` | `#145d76` | 3px keyboard focus outline |

The lead observation's pale blend supports the fail rule without acting as a second status badge. Status remains text-labelled and outlined; color is supplementary.

Calculated foreground/background contrast ratios are: primary ink on canvas 12.25:1; muted text on canvas 5.84:1; accent on canvas 6.76:1; white on the primary accent 7.49:1; fail, warning, pass, and N/A text on their washes 6.02:1, 5.90:1, 6.47:1, and 5.97:1; focus blue on canvas 6.57:1. These checks cover selected color pairs, not every component/state combination or WCAG conformance.

### Typography and layout tokens

- **Display serif:** `Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif`.
- **Interface sans:** `"Segoe UI", Arial, sans-serif`.
- **Evidence mono:** `Consolas, "SFMono-Regular", "Liberation Mono", monospace`.
- These are system stacks with no downloaded assets or font licensing dependency.
- Body is 16px/1.55. Main text stays 14–16px; secondary labels are 12–13px. Entry title is 32–46px/1.1, report titles 30–40px/1.12, detail title 28–38px, and findings title 31px on compact screens. Weights are 400–750, with heavier use limited to controls, markers, and status labels.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40px. Small optical offsets and input padding are component-specific. Minimum control height is 44px; text fields are 46px.
- Main content maximum is 1184px. Side gutters are 28px on wide screens, 20px through 820px, 16px on compact screens, and 12px at 360px and below.
- Breakpoints: 820px (narrow desktop/tablet composition), 600px (single-column mobile), and 360px (320–360px gutter and context tightening). No fixed or sticky navigation is used.
- Overview: the lead finding uses 152px / flexible / 168px columns, becoming 125px / flexible at 820px; its action moves below the observation on compact screens. Categories use two columns on wide screens and one on mobile.
- Findings rows use a flexible title/status column and evidence column on wider screens, then one readable row flow on mobile. Evidence wraps long values. Details use a 1.5fr main column and 270px action column, narrowing at 820px and stacking below 600px.
- Corners: 3px on controls, 2px on status tags, square structural panels elsewhere. Borders are 1px, with 2px active navigation rules. No elevation or box shadow is used.

### Component and state rules

- **Wordmark:** tracked `SEO` sans word plus `Sensei` serif word; the adjacent Page review label has a useful product role.
- **Report context:** Northstar Solar and the path identify the current page; a visible Change page action returns to URL entry. The long path ellipsizes without making the action inaccessible.
- **Report navigation:** Overview and Findings tabs use an underline and `aria-current`; the count is the total check count, not a score.
- **Observation panel:** a status rail, `Observed in static HTML` marker, plain-language finding, concise qualification, and Inspect evidence link. The 92/100 value is smaller than the noindex observation and explicitly named a weighted heuristic, not a Google ranking or index score.
- **Finding row:** title, text status, category, observed summary, and source label form a single keyboard-operable button. No severity or commercial priority is implied.
- **Source annotation:** short horizontal marker for the static HTML observation; the detail view separately names `Static HTML · fictional fixture`, file and line. Other checks say `Analyzer evidence text` and disclose that no source-node location is returned.
- **Detail:** four purposeful steps—Observation returned, Interpretation, Possible next step, Verify after a change. The action is always marked Suggested · not applied, and the page states that SEO Sensei changed nothing.
- **Controls:** links underline; buttons use a 3px focus-visible outline with offset; hover receives a quiet surface fill. Disabled controls stay text-labelled and reduce opacity. No icon is required to understand an action.
- **States:** initial fixture loading is labelled; empty search reports zero and offers clear-search/status recovery; unsupported/blocked sample addresses explain that no website request was made; fixture-load failure offers a local retry; simulated recheck changes its label and disabled/busy state, then explicitly says no recheck occurred. AI is described as unavailable with no provider contacted. There is no completed crawl success state: the visible report is explicitly a local fixture; Pass labels apply only to individual analyzer checks.
- **Motion:** only color feedback transitions (120ms, `cubic-bezier(.2,.7,.25,1)`) and the desktop page's smooth scrolling. `prefers-reduced-motion: reduce` switches scrolling to auto and caps transitions/animations at `.01ms`.

## Navigation and findings semantics

Entry is a distinct state with the URL form and clear sample controls. Once a report is shown, Overview, Findings, and Detail use the compact page context; no repeated large form displaces report content. `?view=`, `mode`, `q`, `status`, and `check` represent the sample's route state. Search and status updates replace the current history entry; changing list scope retains both. Opening a detail stores its parent list URL; return/back restores filters and moves focus to the matching row. Browser Back and Forward restore the represented view.

Needs review is a deliberately labelled reading order: all `fail` rules, then all `warning` rules, stable within each status according to the analyzer response. It contains four rules in this fixture. All checks preserves the analyzer response order and exposes all 23: 1 fail, 3 warnings, 18 pass, 1 not applicable. The status selector intersects with the chosen scope; counts state the actual filtered and available result counts. These are deterministic analyzer outcomes, not severity, urgency, or business value. No new priority field was invented.

## Evidence, API boundary, and source accuracy

The fictional fixture is [Northstar's audit response](../design/seo-sensei/fixtures/audit.json) plus [its local static HTML](../design/seo-sensei/fixtures/northstar-solar.html). It supplies the 23 statuses, 92/100 weighted score, and mocked HTTP/fetch metadata. The failed observation is a `noindex, follow` directive. The source excerpt is explicitly labelled as a line from the fictional HTML file. The observation/explanation/action distinction also notes that Google needs to fetch a page to read its robots directive and that this one sample does not prove Google's current index state ([Google Search Central](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)).

The existing `SEOCheck` contract has `id`, `category`, `title`, `status`, `points`, `max_points`, `evidence.observed`, `evidence.value`, and `recommendation`; it does not return severity/business priority or arbitrary DOM excerpts/locations ([SEO result models](../backend/app/seo/models.py)). TypeScript types in a future application must mirror those fields. Do not render the fixture-only file/line as if a production response supplied it. Do not imply ranking, indexing, traffic, backlinks, keyword position, content quality, Core Web Vitals, or rich-result eligibility. A real recheck and AI response remain unavailable here.

## Browser and accessibility evidence

All screenshots were captured from the local prototype in Microsoft Edge Chromium at device scale factor 1. Primary responsive screenshots use CSS viewports 1440×900 and 390×844; a 320×844 findings capture checks narrow-screen reflow. The design renders only local HTML, CSS, JS, and fixture JSON; the isolated browser recorded no nonlocal HTTP requests and no console errors after adding a data-URL favicon. `documentElement.scrollWidth` equalled 390 and 320 at both mobile widths; desktop page width was 1425 inside a 1440 viewport due to the browser scrollbar.

The real Edge browser's Zoom control was set to 200%. That review exposed a findings-heading wrap defect. The final CSS correction and final 320px capture are verified, but a post-correction capture at the visible browser's 200% zoom could not be completed because the Edge window signalled user input and was left untouched. A 200% post-fix visual check remains required. Device-scale-factor changes were not used as a substitute for browser zoom.

Tab traversal in the isolated Edge page reached the submit and sample controls with visible focus; route transitions focus the new heading and returning from detail focuses the selected result. Automated interaction assertions passed for entry/invalid URL, sample overview, AI-unavailable and recheck simulation states, Needs review ordering/counts, no-match search, filter/scope preservation, all 23 checks and N/A, detail/next/return, filtered-state restoration, and Back/Forward. The browser's reduced-motion media rule was enabled and verified. A native keyboard Enter activation could not be verified through the isolated CDP event simulation; it is not claimed as a pass. No screen-reader session or automated WCAG audit was run. These checks are not a WCAG conformance claim. The 320px and text-resize targets follow the intent of [WCAG Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow) and [Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), but conformance needs dedicated validation.

### Screenshot index

| View | Evidence |
|---|---|
| Desktop overview, 1440×900 | [desktop-overview.png](../design/seo-sensei/phase-1c/screenshots/desktop-overview.png) |
| Mobile overview, 390×844 | [mobile-overview.png](../design/seo-sensei/phase-1c/screenshots/mobile-overview.png) |
| Desktop Needs review, 1440×900 | [desktop-needs-review.png](../design/seo-sensei/phase-1c/screenshots/desktop-needs-review.png) |
| Desktop All checks, 1440×900 | [desktop-all-checks.png](../design/seo-sensei/phase-1c/screenshots/desktop-all-checks.png) |
| Mobile Needs review, 390×844 | [mobile-needs-review.png](../design/seo-sensei/phase-1c/screenshots/mobile-needs-review.png) |
| Desktop detail, 1440×900 | [desktop-evidence.png](../design/seo-sensei/phase-1c/screenshots/desktop-evidence.png) |
| Mobile detail, 390×844 | [mobile-evidence.png](../design/seo-sensei/phase-1c/screenshots/mobile-evidence.png) |
| Unsupported address, 390×844 | [mobile-error.png](../design/seo-sensei/phase-1c/screenshots/mobile-error.png) |
| Narrow findings, 320×844 | [narrow-320-findings.png](../design/seo-sensei/phase-1c/screenshots/narrow-320-findings.png) |
| Narrow All checks, 320×844 | [narrow-320-all-checks.png](../design/seo-sensei/phase-1c/screenshots/narrow-320-all-checks.png) |

The 320px views keep page identity, Change page, section navigation, finding title, and text status within the viewport. The 23-row All checks layout showed no title/evidence clipping or horizontal overflow, including the fixture's longest title and observed text. The main content scrolls vertically; no fixed bar consumes zoomed viewport space.

## React + TypeScript + Vite implementation mapping

This handoff specifies presentation and interaction behavior, not component internals. A future implementation can map it to typed `AppShell`, `PageEntry`, `ReportContext`, `ReportNavigation`, `AnalysisOverview`, `FindingFilters`, `FindingList`, `FindingRow`, `FindingDetail`, `SourceAnnotation`, and state-message components. Move the CSS variables and scales into a token layer; preserve the current API response types. Keep search, scope, and status in navigable URL state and use route transitions to move focus intentionally. Use React text nodes for all fetched evidence. The static fixture excerpt must not become a general source viewer without a deliberate API change.

The prototype makes no authentication or frontend/API architecture decision. Existing server credentials must never be exposed in browser code. Before production work, approve identity/session handling, an access-controlled demo or same-origin server-side mediation, CSRF/CORS boundaries, rate limits and AI budgets. Keep the existing API and extension contracts compatible. A browser-shared bearer token for anonymous visitors is not acceptable.

## Remaining decisions and approval gate

1. Independently review the pushed screenshots and decide whether Evidence Ledger's typography, status treatment, and density are accepted for production.
2. Complete and record post-fix Edge 200% zoom and keyboard Enter verification; run screen-reader and automated accessibility checks before implementation sign-off.
3. Approve the production authentication/session and same-origin API access model, plus public-versus-private deployment scope and AI cost controls.
4. Decide whether product/API work is warranted for source-node locations, report persistence/export, and any explicit priority model. The prototype supplies none of those fields or behaviors.

**Approval gate:** Phase 1C is a design-system candidate only. No candidate is approved for production until independent supervisor review and explicit user approval. No React migration, backend, authentication, deployment, scoring, or Streamlit work is authorized by this handoff.
