import type { FormEvent } from "react";
import { sampleUrl } from "./schema";

type Props = {
  value: string;
  setValue: (value: string) => void;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenSample: () => void;
};

export function PageEntry({ value, setValue, error, onSubmit, onOpenSample }: Props) {
  return (
    <section className="entry-shell" aria-labelledby="entry-title">
      <p className="eyebrow">A local demonstration</p>
      <h1 id="entry-title" tabIndex={-1}>A clearer view of what a page returns.</h1>
      <p className="entry-intro">
        SEO Sensei organizes observable page signals into a reviewable list. This frontend currently contains one fictional example; it does not fetch websites.
      </p>

      <form className="entry-form" onSubmit={onSubmit} noValidate>
        <div className="field-wrap">
          <label htmlFor="page-url">Page address</label>
          <input
            className="text-input"
            id="page-url"
            name="page-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="url-help url-feedback"
            placeholder="https://example.com/page/"
          />
        </div>
        <button className="button-primary" type="submit">Open review</button>
        <p className="entry-help" id="url-help">
          Only the bundled Northstar Solar address opens a report. Other addresses are never sent anywhere.
        </p>
        <p className={error ? "form-message error-message" : "form-message"} id="url-feedback"
          role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
          {error || "No report is open. Choose the local example to continue."}
        </p>
      </form>

      <div className="entry-actions">
        <button className="button-secondary" type="button" onClick={onOpenSample}>Open local sample</button>
        <span className="entry-disclosure">Fictional fixture · no network analysis</span>
      </div>

      <div className="entry-scope">
        <span className="source-marker">How to read this review</span>
        <p>Observed evidence, deterministic rule results, editorial context, and possible actions are labelled separately. A heuristic score is not a Google ranking or index result.</p>
      </div>
      <p className="entry-example-address">Local example address: <code>{sampleUrl}</code></p>
    </section>
  );
}
