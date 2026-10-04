import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_UI_PORT ?? 5599);

/**
 * UI end-to-end suite (ADR 0016 §Delivery, gate 9).
 *
 * Runs against a production build served by the real server on a throwaway
 * SQLite RBAC database, so every run starts from the same seeded state.
 * Locally `PW_CHANNEL=chrome` reuses the system Chrome; CI installs Chromium.
 */
export default defineConfig({
  testDir: "./e2e/ui",
  outputDir: "./e2e/ui/.results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" },
  },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/ui/.report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    trace: "retain-on-failure",
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    // Log in once per run: the login endpoint is rate-limited (10 per 15 min per IP).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "e2e/ui/.auth/admin.json" },
    },
  ],
  webServer: {
    command: "bash scripts/e2e-ui-server.sh",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    // Always a fresh server: each start gets a new RBAC DB (login rate limits, seeded state).
    reuseExistingServer: false,
    env: { E2E_UI_PORT: String(PORT) },
  },
});
