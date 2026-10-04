import { expect, type Locator, type Page } from "@playwright/test";

export type ThemeName = "dark" | "light";

/** The seeded admin; scripts/e2e-ui.sh generates the password for each run. */
export const ADMIN = { login: "admin@localhost", password: process.env.E2E_ADMIN_PASSWORD ?? "" };

/** Fixed wall clock so timestamps rendered by the app are identical on every run. */
export const FIXED_TIME = new Date("2026-10-01T10:00:00.000Z");

/** Prepare a page: fixed clock, theme preference, reduced motion. */
export async function preparePage(page: Page, theme: ThemeName): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((t: string) => {
    try {
      window.localStorage.setItem("vite-ui-theme", t);
    } catch {
      // storage can be unavailable in some contexts; the theme provider falls back
    }
  }, theme);
  // Toasts ("Connected to …") appear on their own timer; they are not page content.
  await page.addInitScript(() => {
    const hide = (): void => {
      const style = document.createElement("style");
      style.textContent = "[data-sonner-toaster]{display:none !important}";
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide, { once: true });
  });
}

export async function login(page: Page, credentials = ADMIN): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("admin@localhost").fill(credentials.login);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await dismissOverlays(page);
}

/** Close the first-install Getting Started hub and any coachmark if they opened. */
export async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const dialog = page.getByRole("dialog");
    if (!(await dialog.first().isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

/** Wait until the page stops fetching, tolerating pages that poll. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await settle(page);
  await dismissOverlays(page);
  await settle(page);
}


/** Regions ADR 0016 changes intentionally (navigation only); masked in parity screenshots. */
export function navigationMasks(page: Page): Locator[] {
  return [
    page.locator('[data-onboarding-id="app-navigation"]'),
    page.locator('nav[aria-label="Monitoring sections"]'),
  ];
}
