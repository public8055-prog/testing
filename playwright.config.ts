import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "artifacts/e2e",
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }], ["json", { outputFile: "artifacts/e2e-results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    browserName: process.env.E2E_BROWSER === "webkit" ? "webkit" : "chromium",
    channel: process.env.E2E_BROWSER === "webkit" ? undefined : process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 90_000,
    navigationTimeout: 120_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
