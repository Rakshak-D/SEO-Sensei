import { useState, type FormEvent } from "react";
import type { GuestFlowState } from "./useGuestFlow";
import { TurnstileWidget } from "./TurnstileWidget";

type Props = {
  flow: GuestFlowState;
  onAnalyze: (url: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onChallengeReady: () => void;
  onChallenge: (token: string) => void;
  onChallengeExpired: () => void;
  onChallengeFailed: () => void;
  onOpenExample: () => void;
};

export function GuestHome({
  flow,
  onAnalyze,
  onCancel,
  onRetry,
  onChallengeReady,
  onChallenge,
  onChallengeExpired,
  onChallengeFailed,
  onOpenExample,
}: Props) {
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [keywordOpen, setKeywordOpen] = useState(false);
  const [urlError, setUrlError] = useState("");
  const sessionReady = flow.session !== null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUrlError("");
    const value = url.trim();
    try {
      const parsed = new URL(value);
      if (!(parsed.protocol === "https:" || parsed.protocol === "http:") || !parsed.hostname || parsed.username || parsed.password) {
        setUrlError("Enter an HTTP or HTTPS address without a username or password.");
        return;
      }
    } catch {
      setUrlError("Enter a complete web address, such as https://site.example/page/.");
      return;
    }
    if (keyword.trim()) {
      // The keyword control is collected locally but is not part of the v1.1 guest API.
    }
    onAnalyze(value);
  };

  const challengeVisible = Boolean(flow.session?.bot_check_required && flow.session.turnstile_sitekey);

  return (
    <section className="guest-home" aria-labelledby="guest-home-title">
      <h1 id="guest-home-title" tabIndex={-1}>Check a web page for SEO problems.</h1>
      <p className="guest-home-support">Paste a page address. You get a list of fixes, most important first.</p>

      <form className="guest-entry-form" onSubmit={submit} noValidate>
        <label htmlFor="guest-page-url">Page address</label>
        <input
          className="guest-url-input"
          id="guest-page-url"
          name="url"
          data-role="code"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://site.example/page/"
          value={url}
          onChange={(event) => { setUrl(event.currentTarget.value); setUrlError(""); }}
          aria-invalid={Boolean(urlError)}
          aria-describedby="guest-url-help guest-url-error"
          disabled={flow.phase === "submitting"}
        />
        <button className="guest-primary-button" type="submit" disabled={!sessionReady || flow.phase === "bootstrapping" || flow.phase === "submitting"}>
          {flow.phase === "submitting" ? "Checking page…" : "Check page"}
        </button>
        <p className="guest-field-help" id="guest-url-help">Use an HTTP or HTTPS page address. The server checks whether the destination can be reached safely.</p>
        <p className={urlError ? "guest-message guest-error" : "guest-message"} id="guest-url-error" role={urlError ? "alert" : "status"} aria-live={urlError ? "assertive" : "polite"}>
          {urlError || (flow.phase === "bootstrapping" ? "Preparing a secure guest session…" : "")}
        </p>

        {keywordOpen ? (
          <div className="guest-keyword-field">
            <label htmlFor="guest-target-keyword">Target keyword <span>Optional</span></label>
            <input id="guest-target-keyword" type="text" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} />
            <p>This is not included in the current audit.</p>
          </div>
        ) : (
          <button className="guest-text-button guest-keyword-toggle" type="button" onClick={() => setKeywordOpen(true)}>Add a target keyword</button>
        )}

        {challengeVisible && flow.session && (flow.phase === "verifying" || flow.phase === "ready" || flow.phase === "error" || flow.phase === "submitting") && (
          <TurnstileWidget
            key={flow.widgetEpoch}
            sitekey={flow.session.turnstile_sitekey!}
            epoch={flow.widgetEpoch}
            onReady={onChallengeReady}
            onSuccess={onChallenge}
            onExpired={onChallengeExpired}
            onFailure={onChallengeFailed}
          />
        )}
      </form>

      {flow.message && flow.phase !== "bootstrapping" && (
        <p className={flow.phase === "error" ? "guest-service-message guest-error" : "guest-service-message"} role={flow.phase === "error" ? "alert" : "status"} aria-live={flow.phase === "error" ? "assertive" : "polite"}>
          {flow.message}
        </p>
      )}

      {flow.phase === "submitting" ? (
        <div className="guest-request-actions"><p role="status" aria-live="polite">Waiting for the audit service to return a report.</p><button type="button" className="guest-text-button" onClick={onCancel}>Cancel</button></div>
      ) : flow.phase === "error" ? (
        <div className="guest-request-actions">
          {!flow.session || flow.errorCode === "guest_session_required" || flow.errorCode === "csrf_rejected"
            ? <button className="guest-secondary-button" type="button" onClick={onRetry}>Refresh guest session</button>
            : <button className="guest-secondary-button" type="button" onClick={onRetry}>{flow.errorCode?.startsWith("bot_") ? "Retry security check" : "Try again"}</button>}
        </div>
      ) : null}

      <div className="guest-examples" aria-label="Local examples">
        <p>Explore a local example</p>
        <button className="guest-example-chip" type="button" onClick={onOpenExample}>Example: Northstar Solar</button>
        <span>This fictional sample is bundled with the app; it is not a new website audit.</span>
      </div>
      <p className="guest-trust-line">No sign-up. Reports stay in this browser session.</p>
    </section>
  );
}
