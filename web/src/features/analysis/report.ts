import type { FixtureBundle } from "./loadFixture";
import type { LiveSeoAnalysis } from "./schema";

export type DemoReport = {
  source: "demo";
  analysis: FixtureBundle["fixture"]["analysis"];
  fixture: FixtureBundle["fixture"];
  html: string;
};

export type LiveReport = {
  source: "live";
  analysis: LiveSeoAnalysis;
};

export type AnalysisReport = DemoReport | LiveReport;

export function demoReport(bundle: FixtureBundle): DemoReport {
  return {
    source: "demo",
    analysis: bundle.fixture.analysis,
    fixture: bundle.fixture,
    html: bundle.html,
  };
}

\n