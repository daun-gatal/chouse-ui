/**
 * Config-generation watcher (ADR 0010).
 *
 * Every replica polls the shared generation counter. When another replica bumps
 * it — an SSO provider added, edited, deleted, or the auth posture changed — this
 * one rebuilds its in-process SSO config, which in turn re-resolves the
 * password-login state.
 *
 * Polling (rather than a message bus) is deliberate: the whole HA design runs on
 * "the existing database, no Redis" (ADR 0008), and the counter read is a single
 * indexed primary-key lookup on a one-row table.
 */
import { logger } from "../../utils/logger";
import { readConfigGeneration } from "../db/configGeneration";
import { getCachedConfigGeneration, refreshSsoConfig } from "./config";

const DEFAULT_INTERVAL_MS = 15_000;

function intervalMs(): number {
  const configured = Number(process.env.AUTH_CONFIG_WATCH_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 1000 ? configured : DEFAULT_INTERVAL_MS;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Run one comparison. Exported for tests; safe to call concurrently. */
export async function checkConfigGeneration(): Promise<boolean> {
  const current = await readConfigGeneration();
  if (current === getCachedConfigGeneration()) return false;
  logger.info(
    { module: "Auth", from: getCachedConfigGeneration(), to: current },
    "Auth config generation changed on another replica — rebuilding local cache"
  );
  await refreshSsoConfig();
  return true;
}

export function startConfigGenerationWatcher(): void {
  if (timer) return;
  timer = setInterval(() => {
    void checkConfigGeneration().catch((error) => {
      logger.warn(
        { module: "Auth", err: error instanceof Error ? error.message : String(error) },
        "Config generation check failed"
      );
    });
  }, intervalMs());
  // Do not hold the process open for a cache refresh.
  timer.unref?.();
  logger.info({ module: "Auth", intervalMs: intervalMs() }, "Auth config generation watcher started");
}

export function stopConfigGenerationWatcher(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
