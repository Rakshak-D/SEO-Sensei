import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSeoAnalysis } from "../analysis/schema";
import { analyzeGuestUrl, getGuestSession, GuestApiError, isSupportedPageUrl, type GuestSession } from "./api";

export type GuestPhase = "idle" | "bootstrapping" | "ready" | "verifying" | "submitting" | "success" | "error";

export type GuestFlowState = {
  phase: GuestPhase;
  session: GuestSession | null;
  report: LiveSeoAnalysis | null;
  errorCode: string | null;
  message: string;
  widgetEpoch: number;
};

const initialState: GuestFlowState = {
  phase: "idle",
  session: null,
  report: null,
  errorCode: null,
  message: "",
  widgetEpoch: 0,
};

function safeErrorMessage(error: unknown): { code: string; message: string } {
  if (error instanceof GuestApiError) return { code: error.code, message: error.message };
  return { code: "service_unavailable", message: "The guest audit service is unavailable. Try again later." };
}

export function useGuestFlow(enabled: boolean) {
  const [state, setState] = useState<GuestFlowState>(initialState);
  const sessionRef = useRef<GuestSession | null>(null);
  const challengeTokenRef = useRef<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const bootstrap = useCallback(async () => {
    const requestId = ++generation.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    sessionRef.current = null;
    challengeTokenRef.current = null;
    setState((previous) => ({ ...initialState, phase: "bootstrapping", widgetEpoch: previous.widgetEpoch + 1 }));
    try {
      const session = await getGuestSession(controller.signal);
      if (!mounted.current || requestId !== generation.current) return null;
      sessionRef.current = session;
      setState((previous) => ({
        ...previous,
        phase: session.bot_check_required ? "verifying" : "ready",
        session,
        report: null,
        errorCode: null,
        message: "",
      }));
    } catch (error) {
      if (!mounted.current || requestId !== generation.current) return null;
      const safe = safeErrorMessage(error);
      setState((previous) => ({
        ...initialState,
        phase: "error",
        errorCode: safe.code,
        message: safe.message,
        widgetEpoch: previous.widgetEpoch + 1,
      }));
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      mounted.current = false;
      generation.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      return;
    }
    mounted.current = true;
    const timer = globalThis.setTimeout(() => { void bootstrap(); }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      mounted.current = false;
      generation.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [bootstrap, enabled]);

  const acceptChallenge = useCallback((token: string) => {
    if (!token || token.length > 2_048 || !sessionRef.current?.bot_check_required) return;
    challengeTokenRef.current = token;
    setState((previous) => ({ ...previous, phase: "ready", errorCode: null, message: "" }));
  }, []);

  const challengeStarted = useCallback(() => {
    setState((previous) => previous.session?.bot_check_required && previous.phase !== "submitting" && previous.phase !== "error"
      ? { ...previous, phase: "verifying" }
      : previous);
  }, []);

  const challengeFailed = useCallback((message = "The security check could not load. Check your connection and try again.") => {
    challengeTokenRef.current = null;
    setState((previous) => ({ ...previous, phase: "error", errorCode: "bot_verification_unavailable", message }));
  }, []);

  const challengeExpired = useCallback(() => {
    challengeTokenRef.current = null;
    setState((previous) => previous.session?.bot_check_required
      ? { ...previous, phase: "verifying", errorCode: null, message: "The security check expired. Complete it again before auditing." }
      : previous);
  }, []);

  const retryChallenge = useCallback(() => {
    challengeTokenRef.current = null;
    setState((previous) => ({
      ...previous,
      phase: previous.session?.bot_check_required ? "verifying" : previous.session ? "ready" : "error",
      errorCode: null,
      message: "",
      widgetEpoch: previous.widgetEpoch + 1,
    }));
  }, []);

  const analyze = useCallback(async (rawUrl: string): Promise<LiveSeoAnalysis | null> => {
    const session = sessionRef.current;
    if (!session) {
      setState((previous) => ({ ...previous, phase: "error", errorCode: "guest_session_required", message: "Refresh the guest security session before starting an audit." }));
      return null;
    }
    const url = rawUrl.trim();
    if (!isSupportedPageUrl(url)) {
      setState((previous) => ({ ...previous, phase: "error", errorCode: "invalid_url", message: "Enter a complete HTTP or HTTPS page address without a username or password." }));
      return null;
    }
    const challengeToken = challengeTokenRef.current;
    if (session.bot_check_required && !challengeToken) {
      setState((previous) => ({ ...previous, phase: "verifying", errorCode: null, message: "Complete the security check before starting the audit." }));
      return null;
    }

    const requestId = ++generation.current;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setState((previous) => ({ ...previous, phase: "submitting", errorCode: null, message: "" }));
    try {
      const report = await analyzeGuestUrl(url, session.csrf_token, challengeToken ?? undefined, controller.signal);
      if (!mounted.current || requestId !== generation.current) return null;
      challengeTokenRef.current = null;
      setState((previous) => ({ ...previous, phase: "success", report, errorCode: null, message: "", widgetEpoch: previous.widgetEpoch + 1 }));
      return report;
    } catch (error) {
      if (!mounted.current || requestId !== generation.current) return null;
      challengeTokenRef.current = null;
      const safe = safeErrorMessage(error);
      const sessionInvalid = safe.code === "guest_session_required" || safe.code === "csrf_rejected";
      if (sessionInvalid) sessionRef.current = null;
      setState((previous) => ({
        ...previous,
        phase: "error",
        session: sessionInvalid ? null : previous.session,
        errorCode: safe.code,
        message: safe.message,
        widgetEpoch: previous.widgetEpoch + 1,
      }));
      return null;
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (state.phase !== "submitting") return;
    generation.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    challengeTokenRef.current = null;
    setState((previous) => ({
      ...previous,
      phase: previous.session?.bot_check_required ? "verifying" : "ready",
      errorCode: "request_cancelled",
      message: "Stopped waiting in this browser. The server may still be processing the request.",
      widgetEpoch: previous.widgetEpoch + 1,
    }));
  }, [state.phase]);

  const startNewAudit = useCallback(() => {
    challengeTokenRef.current = null;
    setState((previous) => ({
      ...previous,
      phase: previous.session?.bot_check_required ? "verifying" : previous.session ? "ready" : "error",
      report: null,
      errorCode: null,
      message: "",
      widgetEpoch: previous.widgetEpoch + 1,
    }));
  }, []);

  const retry = useCallback(() => {
    if (!sessionRef.current) {
      void bootstrap();
      return;
    }
    retryChallenge();
  }, [bootstrap, retryChallenge]);

  return {
    state,
    bootstrap,
    analyze,
    acceptChallenge,
    challengeStarted,
    challengeFailed,
    challengeExpired,
    retry,
    cancel,
    startNewAudit,
  };
}
