import { expect, test, type Locator, type Page } from "@playwright/test";

import { replayApi } from "./apiFixtures";
import { navigationMasks, preparePage, visit, type ThemeName } from "./helpers";

/**
 * Visual parity for screens ADR 0016 §14 leaves unchanged. The baseline was
 * captured from `preview` before any 0016 code landed; navigation chrome that
 * the ADR changes on purpose (dock items, Monitoring section pills) is masked.
 */
interface ParityRoute {
  name: string;
  path: string;
  /** Per-install values (random ids) and content ADR 0016 extends on purpose. */
  masks?: (page: Page) => Locator[];
  /** Content that must be rendered before the screenshot (lazy trees, charts). */
  ready?: (page: Page) => Locator;
}

const UNCHANGED_ROUTES: ParityRoute[] = [
  { name: "home", path: "/overview" },
  { name: "explorer", path: "/explorer", ready: (page) => page.getByText("analytics", { exact: true }).first() },
  { name: "monitoring-live-queries", path: "/monitoring/live-queries" },
  { name: "monitoring-logs", path: "/monitoring/logs" },
  { name: "monitoring-metrics", path: "/monitoring/metrics" },
  { name: "monitoring-parts", path: "/monitoring/parts" },
  { name: "monitoring-schema", path: "/monitoring/schema" },
  { name: "monitoring-cluster", path: "/monitoring/cluster" },
  { name: "monitoring-errors", path: "/monitoring/errors" },
  { name: "fleet", path: "/fleet" },
  { name: "admin-users", path: "/admin/users" },
  { name: "admin-roles", path: "/admin/roles" },
  { name: "admin-data-access", path: "/admin/data-access" },
  { name: "admin-connections", path: "/admin/connections" },
  { name: "admin-ai-models", path: "/admin/ai-models" },
  { name: "admin-sso", path: "/admin/sso" },
  { name: "admin-alerting", path: "/admin/alerting" },
  {
    name: "preferences",
    path: "/preferences",
    masks: (page) => [
      // The RBAC id is random per install; the permission list grows with new permissions.
      page.locator('[data-onboarding-id="preferences-identity"] >> xpath=..').locator("span.font-mono"),
      page.locator('[data-onboarding-id="preferences-functional-access"] >> xpath=..'),
    ],
  },
];

const THEMES: ThemeName[] = ["dark", "light"];

for (const theme of THEMES) {
  test.describe(`parity · ${theme}`, () => {
    test(`login · ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await preparePage(page, theme);
      await visit(page, "/login");
      await expect(page).toHaveScreenshot(`login-${theme}.png`, { fullPage: true });
      await context.close();
    });

    for (const route of UNCHANGED_ROUTES) {
      test(`${route.name} · ${theme}`, async ({ page }) => {
        await preparePage(page, theme);
        await replayApi(page, `${route.name}-${theme}`);
        await visit(page, route.path);
        if (route.ready) await expect(route.ready(page)).toBeVisible({ timeout: 15_000 });
        await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
          fullPage: true,
          mask: [...navigationMasks(page), ...(route.masks?.(page) ?? [])],
        });
      });
    }
  });
}
