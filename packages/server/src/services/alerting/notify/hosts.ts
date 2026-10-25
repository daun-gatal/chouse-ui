/**
 * Platform hosts (ADR 0026 §2). Bot requests only ever go to these fixed
 * origins: no channel setting can point them elsewhere. The e2e suite points
 * them at a local fake with an operator environment variable that is honoured
 * only alongside CHOUSE_ALLOW_TEST_OVERRIDES=1; it is not a UI setting.
 */

import { logger } from "../../../utils/logger";

export type PlatformHost = "slack" | "googleOauth" | "googleChat" | "googleCerts" | "telegram";

const DEFAULT_HOSTS: Record<PlatformHost, string> = {
  slack: "https://slack.com",
  googleOauth: "https://oauth2.googleapis.com",
  googleChat: "https://chat.googleapis.com",
  googleCerts: "https://www.googleapis.com",
  telegram: "https://api.telegram.org",
};

let overrides: Partial<Record<PlatformHost, string>> | null = null;

function loadOverrides(): Partial<Record<PlatformHost, string>> {
  if (overrides) return overrides;
  overrides = {};
  const raw = process.env.CHOUSE_INTEGRATIONS_TEST_HOSTS;
  if (!raw || process.env.CHOUSE_ALLOW_TEST_OVERRIDES !== "1") return overrides;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (key in DEFAULT_HOSTS && typeof value === "string" && /^https?:\/\//.test(value)) {
          overrides[key as PlatformHost] = value.replace(/\/+$/, "");
        }
      }
    }
    logger.warn({ module: "Notify", hosts: Object.keys(overrides) }, "Platform hosts overridden for testing");
  } catch {
    logger.error({ module: "Notify" }, "CHOUSE_INTEGRATIONS_TEST_HOSTS is not valid JSON; using the real hosts");
  }
  return overrides;
}

export function platformHost(name: PlatformHost): string {
  return loadOverrides()[name] ?? DEFAULT_HOSTS[name];
}

/** For tests that change the environment between cases. */
export function resetPlatformHosts(): void {
  overrides = null;
}
