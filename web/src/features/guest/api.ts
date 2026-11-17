import { z } from "zod";
import { liveSeoAnalysisSchema, type LiveSeoAnalysis } from "../analysis/schema";

const API_ROOT = "/api/guest/v1";
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
    request_id: z.string().min(1).max(64),
  }),
});

const guestSessionSchema = z.object({
  csrf_token: z.string().min(32).max(128),
  expires_in: z.number().int().min(1).max(86_400),
  bot_check_required: z.boolean(),
  turnstile_sitekey: z.string().min(1).max(255).nullable(),
  turnstile_action: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(),
}).refine((session) => session.bot_check_required
  ? Boolean(session.turnstile_sitekey && session.turnstile_action)
  : session.turnstile_action === null, {
  message: "The guest security challenge configuration is incomplete.",
});

export type GuestSession = z.infer<typeof guestSessionSchema>;

export class GuestApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(options: { code: string; status: number; message: string; requestId?: string | null; retryAfterSeconds?: number | null }) {
    super(options.message);
    this.name = "GuestApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

const publicMessages: Record<string, string> = {
  invalid_url: "That address is not valid. Enter a complete web address and try again.",
  unsupported_url: "Use a web address beginning with HTTP or HTTPS.",
  destination_blocked: "The server cannot inspect that destination because it is not publicly reachable.",
  resource_unavailable: "The site could not be reached. Check the address and try again later.",
  request_timeout: "The site took too long to respond. Try again later.",
  request_too_large: "This request was larger than the service allows. Try a shorter address.",
  rate_limited: "The guest audit limit has been reached for now.",
  guest_session_required: "Your guest session expired. Refresh the security session, then start the audit again.",
  csrf_rejected: "The security session changed. Refresh it before starting a new audit.",
  bot_verification_failed: "The security check did not complete. Complete a fresh check and try again.",
  bot_verification_unavailable: "The security check is temporarily unavailable. Try again later.",
  origin_rejected: "The secure app connection could not be verified. Reload the page and try again.",
  guest_capacity_unavailable: "Guest audits are temporarily unavailable. Try again later.",
  internal_server_error: "The audit service could not complete this request.",
};

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get("Retry-After")?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : null;
}

async function errorForResponse(response: Response): Promise<GuestApiError> {
  let envelope: z.infer<typeof errorEnvelopeSchema> | null = null;
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) envelope = parsed.data;
  } catch {
    // Proxy and offline responses may not use the API error envelope.
  }
  const code = envelope?.error.code ?? (response.status === 404 ? "guest_unavailable" : "service_unavailable");
  const retryAfterSeconds = response.status === 429 ? readRetryAfter(response) : null;
  let message = publicMessages[code]
    ?? (code === "guest_unavailable"
      ? "Guest audits are not available on this service yet. You can still open the local example."
      : "The guest audit service is unavailable. Try again later.");
  if (retryAfterSeconds !== null) message += ` Try again in ${retryAfterSeconds} seconds.`;
  return new GuestApiError({
    code,
    status: response.status,
    message,
    requestId: envelope?.error.request_id,
    retryAfterSeconds,
  });
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw await errorForResponse(response);
    return response;
  } catch (error) {
    if (error instanceof GuestApiError) throw error;
    if (controller.signal.aborted) {
      throw new GuestApiError({
        code: timedOut ? "request_timeout" : "request_cancelled",
        status: 0,
        message: timedOut
          ? "The browser stopped waiting for the audit response. The server may still be processing it."
          : "Stopped waiting in this browser. The server may still be processing the request.",
      });
    }
    throw new GuestApiError({
      code: "network_unavailable",
      status: 0,
      message: "The secure guest audit service could not be reached. Check the connection and try again.",
    });
  } finally {
    globalThis.clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getGuestSession(signal?: AbortSignal): Promise<GuestSession> {
  const response = await request("/session", { method: "GET", headers: { Accept: "application/json" }, signal }, 10_000);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GuestApiError({ code: "contract_error", status: 502, message: "The guest session response was incomplete." });
  }
  const parsed = guestSessionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GuestApiError({ code: "contract_error", status: 502, message: "The guest session response was incompatible with this application." });
  }
  return parsed.data;
}

export function isSupportedPageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export async function analyzeGuestUrl(
  url: string,
  csrfToken: string,
  challengeToken?: string,
  signal?: AbortSignal,
): Promise<LiveSeoAnalysis> {
  const body: { url: string; challenge_token?: string } = { url };
  if (challengeToken) body.challenge_token = challengeToken;
  const response = await request("/analyse-url", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
    signal,
  }, 25_000);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GuestApiError({ code: "contract_error", status: 502, message: "The audit response was not valid JSON." });
  }
  const parsed = liveSeoAnalysisSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GuestApiError({
      code: "contract_error",
      status: 502,
      message: "The server returned a report this application cannot safely display.",
    });
  }
  return parsed.data;
}
