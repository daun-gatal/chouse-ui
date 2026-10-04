/**
 * MCP settings, managed in the UI (Agents › MCP) instead of `MCP_*` env.
 *
 * Stored as one JSON document in `obs_settings`, so every replica reads the
 * same state and a change applies without a restart. Reads are cached for a
 * few seconds per pod; the pod that saves a change sees it immediately and
 * the others within the cache window.
 */

import { z } from "zod";

import { one, run, sql, str } from "../services/observe/db";
import { logger } from "../utils/logger";
import type { ChouseToolRegistration } from "./tools/helpers";

const MCP_SETTINGS_KEY = "mcp_settings";
const MCP_DEFAULT_TIMEOUT_SECONDS = 60;
const MCP_TIMEOUT_MIN_SECONDS = 1;
const MCP_TIMEOUT_MAX_SECONDS = 600;
const CACHE_TTL_MS = 5_000;

const mcpSettingsSchema = z.object({
  /** Off by default: the endpoint answers 404 until an administrator turns it on. */
  enabled: z.boolean(),
  /**
   * Origins allowed to call the endpoint. Requests without an Origin header
   * (CLI agents, curl, desktop clients) always pass; an empty list rejects
   * every request that carries one (DNS-rebinding protection).
   */
  allowedOrigins: z.array(z.string().trim().url().max(500)).max(50),
  /** Per-subrequest timeout for tool calls. */
  timeoutSeconds: z.number().int().min(MCP_TIMEOUT_MIN_SECONDS).max(MCP_TIMEOUT_MAX_SECONDS),
  /**
   * Explicit per-tool choices; a tool without an entry uses its default
   * (reads on; writes, destructive and LLM-spending tools off), so tools
   * added in later releases arrive in their safe state.
   */
  toolOverrides: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/).max(64), z.boolean()),
  /**
   * The address agents reach CHouse UI on (e.g. https://chouse.corp), when it
   * differs from the one administrators open the UI with — a port-forward,
   * an internal IP, a second ingress host. The endpoint is this plus /mcp.
   */
  publicUrl: z.string().trim().max(500).transform((value) => value.replace(/\/+$/, "")).pipe(
    z.string().url().refine((value) => {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && !url.search && !url.hash;
    }, "Must be an http(s) address without a query or fragment"),
  ).nullable(),
});

export type McpSettings = z.infer<typeof mcpSettingsSchema>;

export const mcpSettingsUpdateSchema = mcpSettingsSchema.partial();
export type McpSettingsUpdate = z.infer<typeof mcpSettingsUpdateSchema>;

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  allowedOrigins: [],
  timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
  toolOverrides: {},
  publicUrl: null,
};

export interface StoredMcpSettings extends McpSettings {
  updatedBy: string | null;
  updatedAt: number | null;
}

let cache: { value: StoredMcpSettings; expiresAt: number } | null = null;

/** Drop the per-pod cache (tests, and after a local write). */
export function resetMcpSettingsCache(): void {
  cache = null;
}

function parseStored(raw: string): McpSettings {
  try {
    const parsed = mcpSettingsSchema.partial().safeParse(JSON.parse(raw));
    if (parsed.success) return { ...DEFAULT_MCP_SETTINGS, ...parsed.data };
  } catch {
    // Fall through: a corrupt document must not open the endpoint.
  }
  logger.warn({ module: "Mcp" }, "Stored MCP settings are invalid; using the defaults (endpoint off)");
  return DEFAULT_MCP_SETTINGS;
}

export async function getMcpSettings(nowMs = Date.now()): Promise<StoredMcpSettings> {
  if (cache && cache.expiresAt > nowMs) return cache.value;
  const row = await one(sql`SELECT value, updated_by, updated_at FROM obs_settings WHERE setting_key = ${MCP_SETTINGS_KEY}`);
  const value: StoredMcpSettings = row
    ? { ...parseStored(str(row.value)), updatedBy: row.updated_by == null ? null : str(row.updated_by), updatedAt: Number(row.updated_at) || null }
    : { ...DEFAULT_MCP_SETTINGS, updatedBy: null, updatedAt: null };
  cache = { value, expiresAt: nowMs + CACHE_TTL_MS };
  return value;
}

export async function saveMcpSettings(update: McpSettingsUpdate, actorId: string | null): Promise<StoredMcpSettings> {
  const current = await getMcpSettings(0);
  const next = mcpSettingsSchema.parse({
    enabled: update.enabled ?? current.enabled,
    allowedOrigins: update.allowedOrigins ?? current.allowedOrigins,
    timeoutSeconds: update.timeoutSeconds ?? current.timeoutSeconds,
    toolOverrides: update.toolOverrides ? { ...current.toolOverrides, ...update.toolOverrides } : current.toolOverrides,
    publicUrl: update.publicUrl === undefined ? current.publicUrl : update.publicUrl,
  });
  const now = Date.now();
  const value = JSON.stringify(next);
  await run(sql`
    INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES (${MCP_SETTINGS_KEY}, ${value}, ${actorId}, ${now})
    ON CONFLICT (setting_key) DO UPDATE SET value = ${value}, updated_by = ${actorId}, updated_at = ${now}
  `);
  resetMcpSettingsCache();
  return getMcpSettings();
}

/** A tool's state when nobody chose one: reads on, everything else off. */
export function toolEnabledByDefault(tool: Pick<ChouseToolRegistration, "access" | "spendsLlm">): boolean {
  return tool.access === "read" && !tool.spendsLlm;
}

export function isToolEnabled(settings: Pick<McpSettings, "toolOverrides">, tool: Pick<ChouseToolRegistration, "name" | "access" | "spendsLlm">): boolean {
  return settings.toolOverrides[tool.name] ?? toolEnabledByDefault(tool);
}

/** Env keys the dedicated MCP listener used to read (ignored since 3.14.0). */
const LEGACY_MCP_ENV_KEYS = [
  "MCP_ENABLED",
  "MCP_HOST",
  "MCP_PORT",
  "MCP_ALLOW_WRITES",
  "MCP_ALLOW_DESTRUCTIVE",
  "MCP_TOOLSETS",
  "MCP_ALLOWED_ORIGINS",
  "MCP_TIMEOUT_SECONDS",
] as const;

/** Legacy `MCP_*` keys present in `env`, so startup can say they are ignored. */
export function legacyMcpEnvKeys(env: Record<string, string | undefined> = process.env): string[] {
  return LEGACY_MCP_ENV_KEYS.filter((key) => env[key] !== undefined && env[key] !== "");
}
