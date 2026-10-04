import { expect, test as setup } from "@playwright/test";

import { dismissOverlays, login, preparePage } from "./helpers";

/**
 * Sign in once, register the throwaway e2e ClickHouse as a connection, and
 * persist the session (tokens and the active connection live in localStorage).
 */
setup("authenticate as admin with a ClickHouse connection", async ({ page }) => {
  await preparePage(page, "dark");
  await login(page);

  const host = process.env.E2E_CH_HOST ?? "localhost";
  const port = Number(process.env.E2E_CH_PORT ?? 18123);
  const password = process.env.E2E_CH_PASSWORD ?? "";

  const created = await page.evaluate(
    async ({ host, port, password }) => {
      const token = window.localStorage.getItem("rbac_access_token");
      const response = await fetch("/api/rbac/connections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: "e2e-clickhouse", host, port, username: "default", password, sslEnabled: false }),
      });
      return { status: response.status, body: await response.text() };
    },
    { host, port, password },
  );
  expect(created.status, created.body).toBeLessThan(300);

  // The connection selector auto-activates the only connection on load.
  await page.goto("/overview");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ch_connection_id")), { timeout: 20_000 }).not.toBeNull();
  await dismissOverlays(page);
  await page.context().storageState({ path: "e2e/ui/.auth/admin.json" });
});
