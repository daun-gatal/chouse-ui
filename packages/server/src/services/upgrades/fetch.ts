/**
 * Outbound requests for the upgrade check (ADR 0029 §6). Requests only ever go
 * to two fixed origins with paths built here from validated parts: no setting
 * or user input can point them elsewhere. HTTPS only, redirects refused, a
 * timeout, a size cap, and response bodies never reach the user.
 *
 * The e2e suite points the origins at a local fake with
 * CHOUSE_UPGRADE_TEST_HOSTS, honoured only alongside CHOUSE_ALLOW_TEST_OVERRIDES=1,
 * the same switch the chat integrations use.
 */

import { logger } from "../../utils/logger";

export type UpgradeSource = "github" | "dockerHub";

const DEFAULT_HOSTS: Record<UpgradeSource, string> = {
  github: "https://raw.githubusercontent.com",
  dockerHub: "https://hub.docker.com",
};

const TIMEOUT_MS = 10_000;

/** A source could not be read. The message is ours, never the response body. */
export class UpgradeSourceError extends Error {
  constructor(readonly source: UpgradeSource, message: string) {
    super(message);
    this.name = "UpgradeSourceError";
  }
}

export function upgradeCheckEnabled(): boolean {
  const raw = (process.env.UPGRADE_CHECK_ENABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

let overrides: Partial<Record<UpgradeSource, string>> | null = null;

function loadOverrides(): Partial<Record<UpgradeSource, string>> {
  if (overrides) return overrides;
  overrides = {};
  const raw = process.env.CHOUSE_UPGRADE_TEST_HOSTS;
  if (!raw || process.env.CHOUSE_ALLOW_TEST_OVERRIDES !== "1") return overrides;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (key in DEFAULT_HOSTS && typeof value === "string" && /^https?:\/\/[^/]+$/.test(value.replace(/\/+$/, ""))) {
          overrides[key as UpgradeSource] = value.replace(/\/+$/, "");
        }
      }
    }
    logger.warn({ module: "Upgrades", hosts: Object.keys(overrides) }, "Upgrade check hosts overridden for testing");
  } catch {
    logger.error({ module: "Upgrades" }, "CHOUSE_UPGRADE_TEST_HOSTS is not valid JSON; using the real hosts");
  }
  return overrides;
}

/** For tests that change the environment between cases. */
export function resetUpgradeHosts(): void {
  overrides = null;
}

export function sourceOrigin(source: UpgradeSource): string {
  return loadOverrides()[source] ?? DEFAULT_HOSTS[source];
}

/** Path segments we build URLs from: release lines, years and file names, never free text. */
const SAFE_PATH = /^\/[A-Za-z0-9._\-/?=&]+$/;

/**
 * GET `path` on a fixed origin and return the body as text, at most `maxBytes`.
 * Throws UpgradeSourceError with a short reason on any failure.
 */
export async function fetchSource(source: UpgradeSource, path: string, maxBytes: number, timeoutMs = TIMEOUT_MS): Promise<string> {
  if (!SAFE_PATH.test(path) || path.includes("..") || path.includes("//")) throw new UpgradeSourceError(source, "Invalid source path");
  const url = sourceOrigin(source) + path;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "chouse-ui-upgrade-check", Accept: source === "dockerHub" ? "application/json" : "text/plain" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UpgradeSourceError(source, timedOut ? "Timed out" : "Could not connect");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpgradeSourceError(source, `HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpgradeSourceError(source, "Response too large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new UpgradeSourceError(source, "Response too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof UpgradeSourceError) throw error;
    throw new UpgradeSourceError(source, "Read failed");
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(body);
}
