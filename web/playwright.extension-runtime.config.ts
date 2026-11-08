import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "phase-2e-extension-runtime.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  reporter: process.env.CI ? "github" : "list",
  outputDir: process.env.PHASE2E_PLAYWRIGHT_OUTPUT ?? "test-results/phase-2e-extension",
  use: {
    headless: false,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
