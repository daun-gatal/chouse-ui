/**
 * Organization settings for Chobi (ADR 0025 §6), managed in AI Governance ›
 * Assistant. One JSON document in `obs_settings`, like the MCP settings, so
 * every replica reads the same value; reads are cached for a few seconds.
 */

import { z } from "zod";

import { one, run, sql, str } from "../observe/db";
import { logger } from "../../utils/logger";

const CHOBI_SETTINGS_KEY = "chobi_settings";
const CACHE_TTL_MS = 5_000;

/** Need You alerts (ADR 0026 §6): requests waiting on a person, sent to team channels. */
export const chobiAlertsSchema = z.object({
  enabled: z.boolean(),
  events: z.object({
    /** T3 changes waiting for a second person. */
    secondApprover: z.boolean(),
    /** Proposals from runs with no person in the loop (auto-triage). */
    background: z.boolean(),
    /** MCP and CLI calls held for their own user's confirmation. */
    heldMcp: z.boolean(),
  }).strict(),
  /** Only alert once a request has waited this long (0 = at once). */
  delayMinutes: z.number().int().min(0).max(1440),
  channels: z.array(z.object({
    channelId: z.string().min(1),
    /** Put Approve and Decline on the message, where the channel can carry buttons. */
    approveFromChat: z.boolean(),
  }).strict()).max(10),
}).strict();
export type ChobiAlerts = z.infer<typeof chobiAlertsSchema>;

export const DEFAULT_CHOBI_ALERTS: ChobiAlerts = {
  enabled: false,
  events: { secondApprover: true, background: true, heldMcp: false },
  delayMinutes: 5,
  channels: [],
};

const chobiSettingsSchema = z.object({
  /** Show the CHouse logo instead of the character, for organizations that want a plainer UI. */
  plainMode: z.boolean(),
  /** Let Chobi point out new incidents, approvals and failures on its own (each user can still mute it). */
  nudges: z.boolean(),
  alerts: chobiAlertsSchema,
});

export type ChobiSettings = z.infer<typeof chobiSettingsSchema>;
export const chobiSettingsUpdateSchema = chobiSettingsSchema.partial().strict();
export type ChobiSettingsUpdate = z.infer<typeof chobiSettingsUpdateSchema>;

export const DEFAULT_CHOBI_SETTINGS: ChobiSettings = { plainMode: false, nudges: true, alerts: DEFAULT_CHOBI_ALERTS };

export interface StoredChobiSettings extends ChobiSettings {
  updatedBy: string | null;
  updatedAt: number | null;
}

let cache: { value: StoredChobiSettings; expiresAt: number } | null = null;

export function resetChobiSettingsCache(): void {
  cache = null;
}

function parseStored(raw: string): ChobiSettings {
  try {
    const parsed = chobiSettingsSchema.partial().safeParse(JSON.parse(raw));
    // Settings saved before Need You alerts have no `alerts`: they stay off.
    if (parsed.success) return { ...DEFAULT_CHOBI_SETTINGS, ...parsed.data };
  } catch {
    // Fall through to the defaults.
  }
  logger.warn({ module: "Chobi" }, "Stored Chobi settings are invalid; using the defaults");
  return DEFAULT_CHOBI_SETTINGS;
}

export async function getChobiSettings(nowMs = Date.now()): Promise<StoredChobiSettings> {
  if (cache && cache.expiresAt > nowMs) return cache.value;
  const row = await one(sql`SELECT value, updated_by, updated_at FROM obs_settings WHERE setting_key = ${CHOBI_SETTINGS_KEY}`);
  const value: StoredChobiSettings = row
    ? { ...parseStored(str(row.value)), updatedBy: row.updated_by == null ? null : str(row.updated_by), updatedAt: Number(row.updated_at) || null }
    : { ...DEFAULT_CHOBI_SETTINGS, updatedBy: null, updatedAt: null };
  cache = { value, expiresAt: nowMs + CACHE_TTL_MS };
  return value;
}

export async function saveChobiSettings(update: ChobiSettingsUpdate, actorId: string | null): Promise<StoredChobiSettings> {
  const current = await getChobiSettings(0);
  const next = chobiSettingsSchema.parse({
    plainMode: update.plainMode ?? current.plainMode,
    nudges: update.nudges ?? current.nudges,
    alerts: update.alerts ?? current.alerts,
  });
  const now = Date.now();
  const value = JSON.stringify(next);
  await run(sql`
    INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES (${CHOBI_SETTINGS_KEY}, ${value}, ${actorId}, ${now})
    ON CONFLICT (setting_key) DO UPDATE SET value = ${value}, updated_by = ${actorId}, updated_at = ${now}
  `);
  resetChobiSettingsCache();
  return getChobiSettings();
}
