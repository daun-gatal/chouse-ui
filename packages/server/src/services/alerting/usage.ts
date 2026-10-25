/**
 * What uses each notification channel, across every feature (ADR 0026 §7):
 * Admin › Alerting shows it per channel, warns before a delete, and flags
 * channels nothing sends to. Counts only — no names of things the viewer may
 * not be allowed to see.
 */

import { all, json, num, one, sql, str } from "../observe/db";
import { getChobiSettings } from "../chobi/settings";
import { getRemediationNotify } from "../remediation/notify";

export const USAGE_SOURCES = ["fleetRules", "dashboardAlerts", "dashboardReports", "scheduledQueries", "dataHealth", "triage", "chobi", "remediation"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];
export type ChannelUsage = Record<UsageSource, number>;

export function emptyUsage(): ChannelUsage {
  return { fleetRules: 0, dashboardAlerts: 0, dashboardReports: 0, scheduledQueries: 0, dataHealth: 0, triage: 0, chobi: 0, remediation: 0 };
}

function add(map: Map<string, ChannelUsage>, channelId: string, source: UsageSource, count = 1): void {
  const usage = map.get(channelId) ?? emptyUsage();
  usage[source] += count;
  map.set(channelId, usage);
}

async function countBy(map: Map<string, ChannelUsage>, source: UsageSource, statement: ReturnType<typeof sql>): Promise<void> {
  for (const row of await all(statement)) add(map, str(row.channel_id), source, num(row.c));
}

/** Usage for every channel that has any. */
export async function channelUsage(): Promise<Map<string, ChannelUsage>> {
  const map = new Map<string, ChannelUsage>();
  await countBy(map, "fleetRules", sql`SELECT channel_id, COUNT(*) AS c FROM alert_rule_channels GROUP BY channel_id`);
  await countBy(map, "dashboardAlerts", sql`SELECT channel_id, COUNT(*) AS c FROM dashboard_alert_channels GROUP BY channel_id`);
  await countBy(map, "dashboardReports", sql`SELECT channel_id, COUNT(*) AS c FROM dashboard_report_channels GROUP BY channel_id`);
  // A Data Health promise runs as a scheduled query: its channels are that job's.
  await countBy(map, "scheduledQueries", sql`
    SELECT c.channel_id, COUNT(*) AS c FROM scheduled_query_channels c
    WHERE c.query_id NOT IN (SELECT scheduled_query_id FROM data_health_promises WHERE scheduled_query_id IS NOT NULL)
    GROUP BY c.channel_id`);
  await countBy(map, "dataHealth", sql`
    SELECT c.channel_id, COUNT(*) AS c FROM scheduled_query_channels c
    JOIN data_health_promises p ON p.scheduled_query_id = c.query_id
    GROUP BY c.channel_id`);
  for (const row of await all(sql`SELECT channel_ids FROM ai_triage_rules`)) {
    for (const id of json<unknown[]>(row.channel_ids, [])) if (typeof id === "string") add(map, id, "triage");
  }
  for (const target of (await getChobiSettings()).alerts.channels) add(map, target.channelId, "chobi");
  for (const id of (await getRemediationNotify()).channelIds) add(map, id, "remediation");
  return map;
}

export function totalUsage(usage: ChannelUsage): number {
  return USAGE_SOURCES.reduce((sum, source) => sum + usage[source], 0);
}

/** Requests waiting on a person, for the Overview. */
export async function waitingRequests(now: number = Date.now()): Promise<number> {
  const row = await one(sql`SELECT COUNT(*) AS c FROM ai_actions WHERE status = 'pending' AND source IN ('background', 'held') AND expires_at > ${now}`);
  return row ? num(row.c) : 0;
}

/** What is firing now: fleet breaches still latched, panel alerts firing, open Data Health incidents. */
export async function firingNow(): Promise<{ fleet: number; dashboards: number; dataHealth: number }> {
  // A latch stays armed after its rule is turned off; only enabled rules' breaches are firing.
  const fleet = await one(sql`
    SELECT COUNT(*) AS c FROM fleet_alert_latches l JOIN alert_rules r ON substr(l.latch_key, 1, length(r.id) + 1) = r.id || ':'
    WHERE l.armed = 1 AND r.enabled = 1`);
  const dashboards = await one(sql`SELECT COUNT(*) AS c FROM dashboard_alert_state WHERE state = 'firing'`);
  const dataHealth = await one(sql`SELECT COUNT(*) AS c FROM data_health_incidents WHERE status <> 'recovered'`);
  return { fleet: fleet ? num(fleet.c) : 0, dashboards: dashboards ? num(dashboards.c) : 0, dataHealth: dataHealth ? num(dataHealth.c) : 0 };
}
