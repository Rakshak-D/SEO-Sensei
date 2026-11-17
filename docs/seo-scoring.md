# Deterministic SEO scoring

SEO Sensei uses deterministic scoring model version `1.1`. The score is a bounded engineering heuristic for the checks and fetch signals listed below. It is not a search-ranking prediction and does not establish current index status, traffic, user experience, or rich-result eligibility.

## Categories and weights

| Category | Weight |
| --- | ---: |
| Technical / indexability | 30 |
| Metadata | 20 |
| Headings / content structure | 15 |
| Links | 10 |
| Images | 10 |
| Structured data | 5 |
| Social metadata | 5 |
| HTML signals | 5 |

The eight weights still sum to 100. The score calculation is unchanged from version `1.0`:

1. For each category, sum the applicable check points and maximum points.
2. Divide category points by category maximum. If the category has no applicable checks, use a ratio of `1` so optional page features do not reduce the score.
3. Multiply the ratio by the category weight and round that category contribution to two decimal places.
4. Sum the rounded category contributions, round to the nearest integer, and clamp the result to `0..100`.

Formally, for category `c`, `category_c = round2(weight_c * (sum(points_c) / sum(max_points_c)))`; an empty denominator uses ratio `1`. `overall = clamp(round(sum(category_c)), 0, 100)`, using Python's built-in `round` behavior (ties to even). Checks, weights, and thresholds are deterministic and use no current time, randomness, Gemini output, or network access in the scoring calculation.

## Version 1.1 changes

- Category weights, existing title/description/visible-text thresholds, and all 23 stable check IDs remain unchanged.
- Finding impact, effort, action-first title, reason, safe snippet, review requirement, actionability, anatomy mapping, exclusions, and priority order are resolved by the single inspectable ruleset in `backend/app/seo/rules.py`. These presentation fields do not change check points or the score.
- The response now includes a resolved `findings_summary` with raw status totals, actionable count, optional-note count, impact and effort totals, priority IDs, and one plain-language verdict. Existing response fields and status values remain present.
- An image with an empty `alt` attribute is not treated as missing: HTML alone cannot establish whether an empty value is appropriate for that image. Version 1.1 separately reports images with a present non-empty value, a present empty value, and no `alt` attribute. The old `with_alt` and `alt_coverage_percent` fields retain their compatible meaning: an `alt` attribute is present, whether empty or not. When every image has an `alt` attribute but one or more values are empty, `image_alt` changes from the version 1.0 warning and 7/10 points to a version 1.1 pass and 10/10 points. This can raise the overall score by up to three points; it does not claim that the analyzer knows whether any alt text is useful. An optional note explains the uncertainty.
- A missing optional JSON-LD block remains a non-actionable note, not a definite defect. Malformed JSON-LD is still actionable when the existing analyzer reports that condition.

## Checks and thresholds

- Technical/indexability: bounded HTML retrieval, HTTP status, HTTPS, supported HTML content type, redirect count, observed fetch duration, and robots/X-Robots directives.
- Metadata: title presence and length, description presence and length, and canonical URL structure. Existing warning thresholds remain below 30 or above 60 title characters and below 50 or above 160 description characters. These are analyzer heuristics, not search-result display guarantees.
- Headings/content: H1 structure, heading-level jumps, and approximate visible-word count. Under 100 words is a stronger warning; under 300 remains a caution, not a content-quality verdict.
- Links: internal-link presence, empty/placeholder anchor text, and link relationship attributes. `nofollow`, `sponsored`, or `ugc` alone are not treated as an actionable problem.
- Images: image count, legacy attribute-presence coverage, empty-attribute count, and missing-attribute count. Only missing `alt` attributes can create an image action. A human must determine whether an image conveys information; no decorative intent is inferred.
- Structured data: JSON-LD presence and parseability. This analyzer does not determine rich-result eligibility.
- Social metadata: Open Graph and X card metadata. These fields describe sharing previews and remain low-weight checks.
- HTML signals: language, viewport, and character-encoding declarations.

## Findings and verdicts

The same deterministic resolver derives raw passes, warnings, failures, and not-applicable checks; actionable findings; optional notes and explicit exclusions; impact/effort totals; the prioritized check IDs; and the verdict. Actionable findings are ordered by impact (`blocking`, `high`, `medium`, `low`), then effort (`quick`, `moderate`, `larger_job`), then original analyzer order. A warning or failure that is not actionable has an explicit exclusion reason.

The headline uses these rules: a blocking condition names the observed condition; otherwise any high-impact finding leads with the total actionable count and top high-priority issue; medium/low-only results say how many small fixes remain; zero actionable findings use `Nothing to fix in these checks.` This verdict does not claim Google has indexed, excluded, ranked, or processed a page.

The analyzer consumes bounded HTML and fetch metadata provided by the existing SafeFetcher. It performs no additional network or AI calls. Identical HTML, final URL, and fetch metadata produce identical scores and findings.

## Score comparison against version 1.0

Baseline values were recomputed in-process from the exact `origin/main` version 1.0 engine and models, then compared with version 1.1 using the same HTML bytes, URL, and controlled fetch metadata (`200`, `text/html`, exact byte length, zero redirects, and `0.25` seconds). Input SHA-256 values identify the exact files. The three files under `tests/fixtures/` are every checked-in HTML engine test fixture; the Northstar row is the existing UI sample used for compatibility verification.

| Input | SHA-256 | Score 1.0 | Score 1.1 | Difference | Reason |
| --- | --- | ---: | ---: | ---: | --- |
| `tests/fixtures/basic.html` | `919dc92cf04f343480cd4450cc3172cff2546299db3659714950fc5645977c48` | 84 | 84 | 0 | Existing applicable check points and weights are unchanged. |
| `tests/fixtures/hostile.html` | `e1b31c59cbee32677e0ad709454fce54673cea8f4e6b1c7ac4ec61bd1b1b6055` | 67 | 67 | 0 | Existing applicable check points and weights are unchanged. |
| `tests/fixtures/weak.html` | `9ad98243a038102990292ea96b8b71bf326be53c97a060c3f6ab15dcb27dc27d` | 55 | 55 | 0 | Existing applicable check points and weights are unchanged; its image has a missing attribute, not an empty one. |
| `web/public/fixtures/northstar-solar.html` (existing UI sample) | `6b68d41c5b9ac1de0f529d5441add8dadd838ab1572543622da4143adc79faae` | 90 | 90 | 0 | Existing applicable check points and weights are unchanged. |

For each row, all eight per-category contributions are identical between versions: basic `30, 16, 13, 5, 10, 3, 2, 5`; hostile `30, 8, 7, 5, 10, 3, 2, 2`; weak `30, 7, 7, 3.75, 0, 3, 2, 2`; Northstar `25, 18, 14, 10, 10, 5, 2.5, 5` (in the category order shown above). Each analysis retains the same 23 check IDs and statuses for these inputs. The version label and additive findings fields change; the numeric outputs above do not.

The status comparison was made against every stable check ID. `pass` means the ID is not in that input's warning, failure, or not-applicable set.

| Input | Warnings | Failures | Not applicable |
| --- | --- | --- | --- |
| Basic | `title`, `meta_description`, `visible_text`, `internal_links`, `json_ld`, `open_graph`, `twitter_metadata` | None | `link_relationships`, `image_alt` |
| Hostile | `title`, `canonical`, `visible_text`, `internal_links`, `json_ld`, `open_graph`, `twitter_metadata`, `html_lang`, `viewport`, `charset` | `meta_description`, `h1_structure` | `link_relationships`, `image_alt` |
| Weak | `title`, `canonical`, `visible_text`, `internal_links`, `anchor_text`, `json_ld`, `open_graph`, `twitter_metadata`, `html_lang`, `viewport`, `charset` | `meta_description`, `h1_structure`, `image_alt` | `link_relationships` |
| Northstar UI sample | `canonical`, `visible_text`, `open_graph`, `twitter_metadata` | `robots_directives` | `link_relationships` |

Version 1.1 behavior for an empty `alt` value is covered separately by deterministic engine tests because none of the checked-in input files has an empty-only image case. In that case, `image_alt` is `pass` and earns 10/10 points, while the optional note preserves the distinction between an observed empty attribute and the unknown intent behind it. The test also verifies that the score and finding summary are identical for repeated identical input.

## Limitations

The score does not measure Core Web Vitals, Lighthouse performance, mobile usability, backlinks, authority, rankings, traffic, search intent, topic coverage, rendered client-side content, or rich-result eligibility. HTTP fetch duration is one observed request and does not establish ongoing performance or its cause. Recommendations are bounded observations; snippet templates that depend on page intent are explicitly marked for human review.
