import { useEffect, useRef } from "react";

type TurnstileWidgetOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  theme: "light";
  size: "flexible";
};

type TurnstileApi = {
  ready: (callback: () => void) => void;
  render: (container: HTMLElement, options: TurnstileWidgetOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
let pendingScript: HTMLScriptElement | null = null;
let pendingTimeout: number | null = null;
let rejectPendingLoad: ((reason?: unknown) => void) | null = null;

function cancelPendingTurnstileLoad() {
  if (window.turnstile || !pendingScript) return;
  const script = pendingScript;
  const reject = rejectPendingLoad;
  pendingScript = null;
  rejectPendingLoad = null;
  if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
  pendingTimeout = null;
  script.onload = null;
  script.onerror = null;
  script.remove();
  scriptPromise = null;
  reject?.(new Error("Security check script loading was cancelled."));
}

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.location.protocol !== "https:") {
      scriptPromise = null;
      reject(new Error("The security check requires a secure connection."));
      return;
    }
    const script = document.createElement("script");
    pendingScript = script;
    rejectPendingLoad = reject;
    pendingTimeout = window.setTimeout(() => {
      script.remove();
      pendingScript = null;
      pendingTimeout = null;
      rejectPendingLoad = null;
      scriptPromise = null;
      reject(new Error("Security check script timed out."));
    }, 12_000);
    script.src = new URL("//challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", window.location.origin).toString();
    script.async = true;
    script.defer = true;
    script.dataset.guestTurnstile = "true";
    script.onload = () => {
      if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
      pendingTimeout = null;
      pendingScript = null;
      rejectPendingLoad = null;
      if (window.turnstile) resolve(window.turnstile);
      else {
        scriptPromise = null;
        reject(new Error("Security check script did not initialize."));
      }
    };
    script.onerror = () => {
      if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
      script.remove();
      pendingTimeout = null;
      pendingScript = null;
      rejectPendingLoad = null;
      scriptPromise = null;
      reject(new Error("Security check script could not load."));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

type Props = {
  sitekey: string;
  action: string;
  epoch: number;
  onReady: () => void;
  onSuccess: (token: string) => void;
  onExpired: () => void;
  onFailure: () => void;
};

export function TurnstileWidget({ sitekey, action, epoch, onReady, onSuccess, onExpired, onFailure }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<{ api: TurnstileApi; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadTurnstile().then((api) => {
      if (!active || !containerRef.current) return;
      api.ready(() => {
        if (!active || !containerRef.current) return;
        try {
          const id = api.render(containerRef.current, {
            sitekey,
            action,
            theme: "light",
            size: "flexible",
            callback: (token) => { if (active && token) onSuccess(token); },
            "error-callback": () => { if (active) onFailure(); },
            "expired-callback": () => { if (active) onExpired(); },
            "timeout-callback": () => { if (active) onExpired(); },
          });
          widgetRef.current = { api, id };
          onReady();
        } catch {
          onFailure();
        }
      });
    }).catch(() => {
      if (active) onFailure();
    });

    return () => {
      active = false;
      const widget = widgetRef.current;
      if (widget) {
        try { widget.api.remove(widget.id); } catch { /* cleanup must not block unmount */ }
        widgetRef.current = null;
      }
      cancelPendingTurnstileLoad();
    };
  }, [sitekey, action, onReady, onSuccess, onExpired, onFailure]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || epoch === 0) return;
    try { widget.api.reset(widget.id); } catch { onFailure(); }
  }, [epoch, onFailure]);

  return <div className="turnstile-wrap" aria-label="Security check">
    <p className="turnstile-label">Complete the security check to continue.</p>
    <div className="turnstile-container" ref={containerRef} />
  </div>;
}
