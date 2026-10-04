# Deterministic SEO Scoring

SEO-Sensei uses scoring model version `1.0`. The score is an engineering heuristic for explaining observable HTML and fetch signals; it is not a Google ranking score and does not predict search position.

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

Each check has a bounded point value. Category points are normalized to the category weight, then summed and rounded to an integer from 0 to 100. A category with no applicable checks is treated as not applicable and receives its full weight rather than penalizing a page for not containing optional content such as images or JSON-LD.

## Checks and thresholds

- Technical/indexability: successful bounded HTML retrieval, HTTP status, HTTPS, supported HTML content type, redirect count, observed initial response time, and robots/X-Robots directives.
- Metadata: title presence and length, meta description presence and length, and canonical URL structure. Title guidance is warning-oriented below 30 or above 60 characters; description guidance is warning-oriented below 50 or above 160 characters. These are heuristics, not search-result guarantees.
- Headings/content: H1 structure, obvious heading-level jumps, and approximate visible word count. Under 100 words is a stronger warning; under 300 words remains a cautionary signal, not a content-quality verdict.
- Links: internal-link presence and empty/placeholder anchor detection. `nofollow`, `sponsored`, and `ugc` are reported as metadata and are not independently penalized.
- Images: non-empty alt coverage, only when images exist.
- Structured data: JSON-LD presence and parseability. This does not validate Google rich-result eligibility.
- Social metadata: Open Graph and Twitter metadata presence. These signals describe sharing previews and are intentionally low-weight rather than core ranking factors.
- HTML signals: `lang`, viewport, and charset declarations.

Checks use `pass`, `warning`, `fail`, or `not_applicable`. Warnings represent an observed opportunity and are not catastrophic failures. Related signals are grouped to avoid repeatedly charging for the same missing field; for example, title absence is scored in metadata rather than repeated in every category.

The analyzer receives bounded HTML and fetch metadata from the safe fetcher. It performs no network calls, uses no current time or randomness, and never asks Gemini to calculate a score. Identical inputs therefore produce identical scores.

The score does not measure Core Web Vitals, Lighthouse performance, mobile usability, backlinks, authority, rankings, traffic, search intent, topic coverage, or rich-result eligibility.
