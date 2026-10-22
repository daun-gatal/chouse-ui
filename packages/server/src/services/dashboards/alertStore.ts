/**
 * Panel threshold alerts (ADR 0021 §7): stored next to the dashboards they
 * watch, delivered through the shared notification channels, recorded in the
 * shared `alert_events` history.
 *
 * They live in their own tables rather than as a new `alert_rules` source
 * type: every server reads `alert_rules` through the fleet alerter, and a
 * server from before this table existed would evaluate an unknown source type
 * as a fleet rule during a rolling upgrade.
 */

import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { all, num, one, run, runBatch, str, strOrNull, type Row } from "../observe/db";
import { RELATIVE_RANGES, REDUCERS, variableValuesSchema, type RelativeRange } from "./spec";

export const ALERT_OPS = [">", ">=", "<", "<="] as const;
export type AlertOp = (typeof ALERT_OPS)[number];
export const ALERT_SEVERITIES = ["warning", "critical"] as const;
export const ALERT_STATES = ["ok", "pending", "firing", "no_data", "error"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

const RANGE_KEYS = Object.keys(RELATIVE_RANGES) as [RelativeRange, ...RelativeRange[]];

export const alertConfigSchema = z.object({
  kind: z.literal("threshold"),
  /** The result column the threshold applies to. */
  column: z.string().min(1).max(200),
  /** How the column's values over the evaluated window become one number. */
  reduce: z.enum(REDUCERS),
  op: z.enum(ALERT_OPS),
  value: z.number().finite(),
  /** Consecutive breaching evaluations before it fires. */
  forEvaluations: z.number().int().min(1).max(60),
  everyMinutes: z.number().int().min(1).max(1_440),
  /** The window each evaluation runs the panel over. */
  range: z.enum(RANGE_KEYS),
  /** Variable values the panel runs with. */
  values: variableValuesSchema,
}).strict();
export type AlertConfig = z.infer<typeof alertConfigSchema>;

export const alertInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  severity: z.enum(ALERT_SEVERITIES),
  connectionId: z.string().min(1),
  channelIds: z.array(z.string().min(1)).min(1).max(10),
  enabled: z.boolean(),
  config: alertConfigSchema,
}).strict();
export type AlertInput = z.infer<typeof alertInputSchema>;

export interface PanelAlert {
  id: string;
  dashboardId: string;
  panelId: string;
  name: string;
  ownerId: string;
  connectionId: string;
  severity: (typeof ALERT_SEVERITIES)[number];
  config: AlertConfig;
  enabled: boolean;
  channelIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AlertStatus {
  state: AlertState;
  breaches: number;
  since: number;
  lastEvalAt: number | null;
  lastValue: number | null;
  lastError: string | null;
}

export class CorruptAlertError extends Error {}

function alertRow(r: Row, channelIds: string[]): PanelAlert {
  const id = str(r.id);
  let raw: unknown;
  try {
    raw = JSON.parse(str(r.config));
  } catch {
    throw new CorruptAlertError(`Stored config of panel alert ${id} is not valid JSON`);
  }
  const config = alertConfigSchema.safeParse(raw);
  if (!config.success) throw new CorruptAlertError(`Stored config of panel alert ${id} does not match its schema`);
  const severity = z.enum(ALERT_SEVERITIES).safeParse(str(r.severity));
  if (!severity.success) throw new CorruptAlertError(`Stored severity of panel alert ${id} is unknown`);
  return {
    id,
    dashboardId: str(r.dashboard_id),
    panelId: str(r.panel_id),
    name: str(r.name),
    ownerId: str(r.owner_id),
    connectionId: str(r.connection_id),
    severity: severity.data,
    config: config.data,
    enabled: num(r.enabled) === 1 || r.enabled === true,
    channelIds,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function statusRow(r: Row): AlertStatus {
  const state = z.enum(ALERT_STATES).safeParse(str(r.state));
  if (!state.success) throw new CorruptAlertError(`Stored state of panel alert ${str(r.alert_id)} is unknown`);
  const lastValue = r.last_value === null || r.last_value === undefined ? null : Number(r.last_value);
  return {
    state: state.data,
    breaches: num(r.breaches),
    since: num(r.since),
    lastEvalAt: r.last_eval_at === null || r.last_eval_at === undefined ? null : num(r.last_eval_at),
    lastValue,
    lastError: strOrNull(r.last_error),
  };
}

async function channelsByAlert(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const r of await all(sql`SELECT alert_id, channel_id FROM dashboard_alert_channels ORDER BY channel_id`)) {
    const list = map.get(str(r.alert_id)) ?? [];
    list.push(str(r.channel_id));
    map.set(str(r.alert_id), list);
  }
  return map;
}

export async function listAlerts(filter: { dashboardId?: string; enabledOnly?: boolean } = {}): Promise<PanelAlert[]> {
  const rows = filter.dashboardId
    ? await all(sql`SELECT * FROM dashboard_alerts WHERE dashboard_id = ${filter.dashboardId} ORDER BY name`)
    : await all(sql`SELECT * FROM dashboard_alerts ORDER BY name`);
  const channels = await channelsByAlert();
  return rows
    .map((r) => alertRow(r, channels.get(str(r.id)) ?? []))
    .filter((a) => !filter.enabledOnly || a.enabled);
}

export async function getAlert(id: string): Promise<PanelAlert | null> {
  const row = await one(sql`SELECT * FROM dashboard_alerts WHERE id = ${id}`);
  if (!row) return null;
  const channels = (await all(sql`SELECT channel_id FROM dashboard_alert_channels WHERE alert_id = ${id} ORDER BY channel_id`)).map((r) => str(r.channel_id));
  return alertRow(row, channels);
}

export async function getStatuses(ids: string[]): Promise<Map<string, AlertStatus>> {
  const map = new Map<string, AlertStatus>();
  if (ids.length === 0) return map;
  const rows = await all(sql`SELECT * FROM dashboard_alert_state WHERE alert_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  for (const r of rows) map.set(str(r.alert_id), statusRow(r));
  return map;
}

export async function createAlert(dashboardId: string, panelId: string, ownerId: string, input: AlertInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await runBatch([
    sql`INSERT INTO dashboard_alerts (id, dashboard_id, panel_id, name, owner_id, connection_id, severity, config, enabled, created_at, updated_at)
      VALUES (${id}, ${dashboardId}, ${panelId}, ${input.name}, ${ownerId}, ${input.connectionId}, ${input.severity}, ${JSON.stringify(input.config)}, ${input.enabled ? 1 : 0}, ${now}, ${now})`,
    ...input.channelIds.map((channelId) => sql`INSERT INTO dashboard_alert_channels (alert_id, channel_id) VALUES (${id}, ${channelId})`),
    sql`INSERT INTO dashboard_alert_state (alert_id, state, breaches, since) VALUES (${id}, 'ok', 0, ${now})`,
  ]);
  return id;
}

/**
 * Replace an alert's settings. Whoever saves it becomes its owner — it runs
 * with their access from now on — and its state starts over, since the
 * threshold may have changed.
 */
export async function updateAlert(id: string, ownerId: string, input: AlertInput): Promise<void> {
  const now = Date.now();
  await runBatch([
    sql`UPDATE dashboard_alerts SET name = ${input.name}, owner_id = ${ownerId}, connection_id = ${input.connectionId}, severity = ${input.severity},
      config = ${JSON.stringify(input.config)}, enabled = ${input.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`,
    sql`DELETE FROM dashboard_alert_channels WHERE alert_id = ${id}`,
    ...input.channelIds.map((channelId) => sql`INSERT INTO dashboard_alert_channels (alert_id, channel_id) VALUES (${id}, ${channelId})`),
    sql`UPDATE dashboard_alert_state SET state = 'ok', breaches = 0, since = ${now}, last_error = NULL WHERE alert_id = ${id}`,
  ]);
}

export async function deleteAlert(id: string): Promise<void> {
  await runBatch(deleteAlertStatements([id]));
}

/** Statements removing these alerts with their channel links and state (for use inside a dashboard save or delete). */
export function deleteAlertStatements(ids: string[]): ReturnType<typeof sql>[] {
  return ids.flatMap((id) => [
    sql`DELETE FROM dashboard_alert_channels WHERE alert_id = ${id}`,
    sql`DELETE FROM dashboard_alert_state WHERE alert_id = ${id}`,
    sql`DELETE FROM dashboard_alerts WHERE id = ${id}`,
  ]);
}

/** Alert ids watching any of these panels. */
export async function alertIdsForPanels(panelIds: string[]): Promise<string[]> {
  if (panelIds.length === 0) return [];
  const rows = await all(sql`SELECT id FROM dashboard_alerts WHERE panel_id IN (${sql.join(panelIds.map((id) => sql`${id}`), sql`, `)})`);
  return rows.map((r) => str(r.id));
}

export async function saveStatus(id: string, status: AlertStatus): Promise<void> {
  await run(sql`UPDATE dashboard_alert_state SET state = ${status.state}, breaches = ${status.breaches}, since = ${status.since},
    last_eval_at = ${status.lastEvalAt}, last_value = ${status.lastValue}, last_error = ${status.lastError} WHERE alert_id = ${id}`);
}

/** How many panel alerts deliver to this channel (a channel in use cannot be deleted). */
export async function countAlertsUsingChannel(channelId: string): Promise<number> {
  const row = await one(sql`SELECT COUNT(*) AS c FROM dashboard_alert_channels WHERE channel_id = ${channelId}`);
  return row ? num(row.c) : 0;
}
