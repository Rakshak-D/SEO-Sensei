import { useState, type FormEvent } from "react";

type Props = {
  available: boolean;
  message: string;
  onSignIn: (username: string, password: string) => Promise<void>;
  onRetry: () => void;
  onOpenDemo: () => void;
};

export function SignIn({ available, message, onSignIn, onRetry, onOpenDemo }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || pending) return;
    setPending(true);
    setFeedback("");
    try {
      await onSignIn(username, password);
      setPassword("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setPending(false);
      setPassword("");
    }
  }

  return (
    <section className="entry-shell login-shell" aria-labelledby="login-title">
      <p className="eyebrow">Restricted access</p>
      <h1 id="login-title" tabIndex={-1}>Sign in to analyze a page.</h1>
      {available ? (
        <>
          <p className="entry-intro">Use an individually provisioned account. SEO Sensei does not offer public registration or password recovery.</p>
          <form className="login-form" onSubmit={(event) => void submit(event)}>
            <div className="field-wrap">
              <label htmlFor="login-username">Username</label>
              <input className="text-input" id="login-username" name="username" autoComplete="username"
                value={username} onChange={(event) => setUsername(event.currentTarget.value)} required maxLength={64} />
            </div>
            <div className="field-wrap">
              <label htmlFor="login-password">Password</label>
              <input className="text-input password-input" id="login-password" name="password" type="password"
                autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required maxLength={1024} />
            </div>
            <button className="button-primary" type="submit" disabled={pending || !username || !password}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
            <p className={feedback ? "form-message error-message" : "form-message"} id="login-feedback"
              role={feedback ? "alert" : "status"} aria-live={feedback ? "assertive" : "polite"}>
              {feedback || message || "Your browser session is checked securely by the server."}
            </p>
          </form>
          <div className="entry-actions login-demo-actions">
            <button className="button-secondary" type="button" onClick={onOpenDemo}>Open local example</button>
            <span className="entry-disclosure">Fictional fixture · separate from live analysis</span>
          </div>
        </>
      ) : (
        <>
          <p className="entry-intro">Live analysis is unavailable because browser authentication could not be reached or is not enabled on this server.</p>
          {message && <p className="form-message error-message" role="status" aria-live="polite">{message}</p>}
          <div className="entry-actions">
            <button className="button-secondary" type="button" onClick={onRetry}>Check sign-in service again</button>
            <button className="button-primary" type="button" onClick={onOpenDemo}>Open local example</button>
          </div>
        </>
      )}
      <p className="entry-scope login-scope">
        <span className="source-marker">Local example available</span>
        <span>Northstar Solar is a fictional fixture. It never represents a live response and does not contact a website or AI provider.</span>
      </p>
    </section>
  );
}
