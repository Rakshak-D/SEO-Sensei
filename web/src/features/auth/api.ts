import { z } from "zod";
import { liveSeoAnalysisSchema, type LiveSeoAnalysis } from "../analysis/schema";

const API_ROOT = "/api/browser/v1";

const sessionSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({ username: z.string().min(1).max(64) }),
  csrf_token: z.string().min(32).max(128),
});

export type BrowserSession = z.infer<typeof sessionSchema>;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
    request_id: z.string().min(1).max(64),
  }),
});

const safeMessages: Record<string, string> = {
  auth_required: "Your sign-in has expired. Sign in again to continue.",
  auth_invalid: "The username or password is incorrect.",
  origin_rejected: "The secure app origin was not accepted. Check the HTTPS and app-origin configuration.",
  csrf_rejected: "This request could not be verified. Refresh the session and try again.",
  invalid_url: "Enter a valid page address and try again.",
  unsupported_url: "Only supported HTTP or HTTPS page addresses can be analyzed.",
  destination_blocked: "The requested destination is not permitted by the server’s network policy.",
  resource_unavailable: "The page could not be fetched. Check the address and try again later.",
  rate_limited: "The analysis service is at its current request limit.",
  request_too_large: "The analysis request exceeded the allowed size.",
  unsupported_media_type: "The analysis request format was not accepted.",
  internal_server_error: "The analysis service could not complete this request.",
};

export class BrowserApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(options: {
    code: string;
    status: number;
    message: string;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(options.message);
    this.name = "BrowserApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("Retry-After")?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : null;
}

async function responseError(response: Response, operation: "login" | "analysis" | "session"): Promise<BrowserApiError> {
  let envelope: z.infer<typeof errorEnvelopeSchema> | null = null;
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) envelope = parsed.data;
  } catch {
    // Framework, proxy, and offline responses may not use the API envelope.
  }

  const code = envelope?.error.code ?? (response.status === 404 ? "auth_unavailable" : "service_unavailable");
  const message = code === "rate_limited" && operation === "login"
    ? "Sign-in attempts are temporarily rate-limited."
    : safeMessages[code]
    ?? (code === "auth_unavailable"
      ? "Live analysis is not configured on this server. You can still open the local demonstration."
      : code === "service_unavailable"
        ? "The analysis service is unavailable. Check that the local API and HTTPS gateway are running."
        : "The request could not be completed. Try again or contact the operator.");
  return new BrowserApiError({
    code,
    status: response.status,
    message,
    requestId: envelope?.error.request_id,
    retryAfterSeconds: response.status === 429 ? retryAfter(response) : null,
  });
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_ROOT}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    throw new BrowserApiError({
      code: timeout ? "request_timeout" : "network_unavailable",
      status: 0,
      message: timeout
        ? "The browser stopped waiting for the analysis response. The server may still be processing it."
        : "The secure analysis service could not be reached. Check the connection and try again.",
    });
  }
}

async function expectSuccess(response: Response, operation: "login" | "analysis" | "session"): Promise<Response> {
  if (!response.ok) throw await responseError(response, operation);
  return response;
}

export async function getBrowserSession(): Promise<BrowserSession> {
  const response = await expectSuccess(await apiFetch("/session", { method: "GET" }), "session");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The session response was incomplete. Refresh and try again." });
  }
  const parsed = sessionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The session response was incompatible with this application." });
  }
  return parsed.data;
}

export async function login(username: string, password: string): Promise<void> {
  const response = await expectSuccess(await apiFetch("/session/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }), "login");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The sign-in response was incomplete." });
  }
  if (!z.object({ authenticated: z.literal(true), user: z.object({ username: z.string().min(1).max(64) }) }).safeParse(payload).success) {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The sign-in response was incompatible with this application." });
  }
}

export async function logout(csrfToken: string): Promise<void> {
  const response = await expectSuccess(await apiFetch("/session/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  }), "session");
  try {
    if (!z.object({ authenticated: z.literal(false) }).safeParse(await response.json()).success) throw new Error();
  } catch {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The sign-out response was incomplete." });
  }
}

export async function analyzeUrl(url: string, csrfToken: string): Promise<LiveSeoAnalysis> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await expectSuccess(await apiFetch("/analyse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    }), "analysis");
  } finally {
    window.clearTimeout(timeout);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserApiError({ code: "contract_error", status: 502, message: "The analysis response was not valid JSON." });
  }
  const parsed = liveSeoAnalysisSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BrowserApiError({
      code: "contract_error",
      status: 502,
      message: "The server returned an analysis result this application cannot safely display.",
    });
  }
  return parsed.data;
}

export function messageForApiError(error: unknown): string {
  if (!(error instanceof BrowserApiError)) return "The request could not be completed. Try again.";
  if (error.code === "rate_limited" && error.retryAfterSeconds !== null) {
    return `${error.message} Wait approximately ${formatDuration(error.retryAfterSeconds)} before trying again.`;
  }
  return error.requestId ? `${error.message} Reference: ${error.requestId}.` : error.message;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hours ${remaining} minutes` : `${hours} hours`;
}

\n