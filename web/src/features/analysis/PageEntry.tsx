import type { FormEvent } from "react";
import { sampleUrl } from "./schema";

type Props = {
  value: string;
  setValue: (value: string) => void;
  error: string;
  isAnalyzing: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenDemo: () => void;
};

export function PageEntry({ value, setValue, error, isAnalyzing, onSubmit, onOpenDemo }: Props) {
  return (
    <section className="entry-shell" aria-labelledby="entry-title">
      <p className="eyebrow">One page · deterministic analysis</p>
      <h1 id="entry-title" tabIndex={-1}>Inspect what a page returns.</h1>
      <p className="entry-intro">
        SEO Sensei fetches one page through its protected analysis service, then presents the returned observations and rule results. Reports are held in this browser session and are not saved.
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
            placeholder="https://site.example/page/"
            disabled={isAnalyzing}
          />
        </div>
        <button className="button-primary" type="submit" disabled={isAnalyzing || !value.trim()}>
          {isAnalyzing ? "Analyzing page…" : "Analyze page"}
        </button>
        <p className="entry-help" id="url-help">
          Only submit a page you are authorized to inspect. The server enforces URL, network, body-size, and request-budget policies.
        </p>
        <p className={error ? "form-message error-message" : "form-message"} id="url-feedback"
          role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
          {error || (isAnalyzing ? "Waiting for the protected analysis service. This may take a short time." : "No live report is open.")}
        </p>
      </form>

      <div className="entry-actions">
        <button className="button-secondary" type="button" onClick={onOpenDemo} disabled={isAnalyzing}>Open local example</button>
        <span className="entry-disclosure">Fictional fixture · separate from live analysis</span>
      </div>

      <div className="entry-scope">
        <span className="source-marker">How to read this review</span>
        <p>Observed evidence, deterministic rule results, editorial context, and possible actions are labelled separately. A heuristic score is not a Google ranking or index result.</p>
      </div>
      <p className="entry-example-address">Fictional sample address: <code>{sampleUrl}</code></p>
    </section>
  );
}
