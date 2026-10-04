# AI Integration Boundary

Gemini is an optional recommendation and content-generation layer. It does not fetch URLs, parse HTML, calculate the deterministic score, alter checks, or decide whether a page was retrieved successfully. The deterministic analyzer remains available when Gemini is not configured or fails.

## Supported operations

- Grounded SEO recommendations generated from compact deterministic findings.
- Plain-text article generation from a bounded topic, keyword list, and approved tone.
- A meta-description boost generated from a server-fetched, deterministic analysis.

All calls flow through `backend.app.ai.gemini.GeminiService`. No other module may call the Gemini SDK directly.

## Validation and limits

The service requests Gemini JSON mode (`response_mime_type=application/json`), parses only the complete response document, and validates it with strict Pydantic models. It rejects malformed JSON, extra or missing fields, invalid priorities, invalid types, and oversized provider output. Recommendation lists are capped by `MAX_AI_RECOMMENDATION_COUNT`; each recommendation explanation and action is capped by `MAX_AI_RECOMMENDATION_LENGTH`.

Prompts are limited by `MAX_AI_INPUT_SIZE`; provider output is limited by `MAX_AI_OUTPUT_SIZE`. Article responses are additionally capped at 50,000 characters by the public response contract. The service does not send raw HTML, cookies, authorization data, request headers, server configuration, stack traces, or full crawler results.

Recommendation prompts receive a compact JSON summary: deterministic score/category points, failed and warning checks, bounded evidence, metadata, structural counts, and lexical summaries. Page-derived values are explicitly labeled untrusted data. The system instruction says that embedded instructions cannot change behavior, schema, tool use, or security policy.

## Timeouts and failures

`AI_REQUEST_TIMEOUT_SECONDS` bounds each request. `AI_RETRY_COUNT` and `AI_RETRY_BACKOFF_SECONDS` control conservative retry of timeout/temporary-provider failures only. Authentication, configuration, malformed output, and invalid requests are not retried. `AI_MAX_CONCURRENCY` caps in-process concurrent Gemini calls.

URL analysis can request optional recommendations. A failure returns a typed state (`unavailable`, `timed_out`, `invalid_response`, or `configuration_error`) and retains the full deterministic result. Article and boost endpoints are AI-only operations, so they return the existing safe `upstream_ai_unavailable` error contract when Gemini cannot serve them. Raw provider error text, prompts, and secrets are never returned to clients.

## Configuration

`GEMINI_API_KEY` is optional for deterministic analysis. AI features additionally use `AI_REQUEST_TIMEOUT_SECONDS`, `AI_RETRY_COUNT`, `AI_RETRY_BACKOFF_SECONDS`, `AI_MAX_CONCURRENCY`, `MAX_AI_INPUT_SIZE`, `MAX_AI_OUTPUT_SIZE`, `MAX_AI_RECOMMENDATION_COUNT`, and `MAX_AI_RECOMMENDATION_LENGTH`. Values and placeholders are listed in `.env.example`; secrets are deployment-side only.
