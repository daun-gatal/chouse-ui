/**
 * Scheduled reports (ADR 0023 §13): a text digest of a dashboard, sent to
 * notification channels on a daily or weekly schedule, with a link back to the
 * dashboard at the reported range.
 *
 * A report runs as its owner (whoever last saved it), re-checked on every run
 * the way panel alerts are: still active, still allowed to view the dashboard
 * and run queries, on a connection the dashboard is assigned to. Reports need
 * PUBLIC_BASE_URL; a run that cannot build its link fails rather than send
 * without one. A run that fails sends nothing. Every run writes an
 * `alert_events` row (source `dashboard_report`).
 *
 * A 60 s scheduler claims each due report with a row lease, so one pod sends
 * it. Its tick also deletes expired snapshots.
 */

import { randomUUID } from "crypto";
import { hostname } from "os";

import { sql } from "drizzle-orm";

import { recordEvent } from "../alerting/store";
import { AlertSeverity } from "../alerting/types";
import { notifyChannelIds } from "../alerting/notify";
import { publicBaseUrl } from "../alerting/notify/links";
import { PERMISSIONS } from "../../rbac/schema/base";
import { getUserById } from "../../rbac/services/rbac";
import { logger } from "../../utils/logger";
import { acquireLease } from "../observe/lease";
import { all, num, one, run, runBatch, str, strOrNull } from "../observe/db";
import { dashboardAccess, has, type Viewer } from "./access";
import { resolveWindow } from "./macros";
import { buildDigest, nextRunAt, reportRangeSchema, reportScheduleSchema, type DigestPanel, type ReportSchedule } from "./reportDigest";
import { runFleet, runPanel, type PanelQuery } from "./runner";
import { deleteExpiredSnapshots } from "./snapshots";
import { inScope, type RelativeRange } from "./spec";
import * as store from "./store";

const TICK_MS = 60_000;
/** Long enough for one report's panels; a pod that dies mid-run frees it after this. */
const LEASE_SECONDS = 300;
const HOLDER = `dashboard-reports-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

export type ReportStatus = "sent" | "skipped" | "failed";

export interface ReportInput {
  name: string;
  connectionId: string;
  schedule: ReportSchedule;
  range: RelativeRange;
  onlyIfAlert: boolean;
  enabled: boolean;
  channelIds: string[];
}

export interface Report extends ReportInput {
  id: string;
  dashboardId: string;
  ownerId: string;
  ownerName: string | null;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: ReportStatus | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export { publicBaseUrl };

function statusOf(value: unknown): ReportStatus | null {
  return value === "sent" || value === "skipped" || value === "failed" ? value : null;
}

function rangeOf(value: unknown, id: string): RelativeRange {
  const parsed = reportRangeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Stored range of report ${id} is not a known range`);
  return parsed.data;
}

function reportRow(r: Record<string, unknown>, channels: string[]): Report {
  const id = str(r.id);
  return {
    id,
    dashboardId: str(r.dashboard_id),
    ownerId: str(r.owner_id),
    ownerName: strOrNull(r.owner_name),
    name: str(r.name),
    connectionId: str(r.connection_id),
    schedule: store.parseStored(reportScheduleSchema, r.schedule, `schedule of report ${id}`),
    range: rangeOf(r.time_range, id),
    onlyIfAlert: num(r.only_if_alert) === 1,
    enabled: num(r.enabled) === 1,
    channelIds: channels,
    nextRunAt: num(r.next_run_at),
    lastRunAt: r.last_run_at === null || r.last_run_at === undefined ? null : num(r.last_run_at),
    lastStatus: statusOf(r.last_status),
    lastError: strOrNull(r.last_error),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

const SELECT = sql`SELECT r.*, u.username AS owner_name FROM dashboard_reports r LEFT JOIN rbac_users u ON u.id = r.owner_id`;

/** Each report's channels, in one query. */
async function channelsOf(reportIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(reportIds.map((id) => [id, []]));
  if (reportIds.length === 0) return out;
  const rows = await all(sql`SELECT report_id, channel_id FROM dashboard_report_channels
    WHERE report_id IN (${sql.join(reportIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY channel_id`);
  for (const row of rows) out.get(str(row.report_id))?.push(str(row.channel_id));
  return out;
}

export async function listReports(dashboardId: string): Promise<Report[]> {
  const rows = await all(sql`${SELECT} WHERE r.dashboard_id = ${dashboardId} ORDER BY r.name, r.id`);
  const channels = await channelsOf(rows.map((r) => str(r.id)));
  return rows.map((r) => reportRow(r, channels.get(str(r.id)) ?? []));
}

export async function getReport(dashboardId: string, id: string): Promise<Report | null> {
  const row = await one(sql`${SELECT} WHERE r.id = ${id} AND r.dashboard_id = ${dashboardId}`);
  if (!row) return null;
  return reportRow(row, (await channelsOf([id])).get(id) ?? []);
}

export async function createReport(dashboardId: string, ownerId: string, input: ReportInput, nowMs: number = Date.now()): Promise<Report> {
  const id = randomUUID();
  await runBatch([
    sql`INSERT INTO dashboard_reports (id, dashboard_id, owner_id, name, connection_id, schedule, time_range, only_if_alert, enabled, next_run_at, last_run_at, last_status, last_error, created_at, updated_at)
      VALUES (${id}, ${dashboardId}, ${ownerId}, ${input.name}, ${input.connectionId}, ${JSON.stringify(input.schedule)}, ${input.range}, ${input.onlyIfAlert ? 1 : 0}, ${input.enabled ? 1 : 0},
        ${nextRunAt(input.schedule, nowMs)}, NULL, NULL, NULL, ${nowMs}, ${nowMs})`,
    ...input.channelIds.map((channelId) => sql`INSERT INTO dashboard_report_channels (report_id, channel_id) VALUES (${id}, ${channelId})`),
  ]);
  const created = await getReport(dashboardId, id);
  if (!created) throw new Error("The report was not saved");
  return created;
}

/** Replace a report's settings. Whoever saves it becomes its owner and it runs with their access from now on. */
export async function updateReport(dashboardId: string, id: string, ownerId: string, input: ReportInput, nowMs: number = Date.now()): Promise<Report> {
  await runBatch([
    sql`UPDATE dashboard_reports SET owner_id = ${ownerId}, name = ${input.name}, connection_id = ${input.connectionId}, schedule = ${JSON.stringify(input.schedule)},
      time_range = ${input.range}, only_if_alert = ${input.onlyIfAlert ? 1 : 0}, enabled = ${input.enabled ? 1 : 0}, next_run_at = ${nextRunAt(input.schedule, nowMs)},
      updated_at = ${nowMs} WHERE id = ${id} AND dashboard_id = ${dashboardId}`,
    sql`DELETE FROM dashboard_report_channels WHERE report_id = ${id}`,
    ...input.channelIds.map((channelId) => sql`INSERT INTO dashboard_report_channels (report_id, channel_id) VALUES (${id}, ${channelId})`),
  ]);
  const updated = await getReport(dashboardId, id);
  if (!updated) throw new Error("The report was not saved");
  return updated;
}

export async function deleteReport(id: string): Promise<void> {
  await runBatch([
    sql`DELETE FROM dashboard_report_channels WHERE report_id = ${id}`,
    sql`DELETE FROM dashboard_reports WHERE id = ${id}`,
  ]);
}

/** How many reports deliver to this channel (a channel in use cannot be deleted). */
export async function countReportsUsingChannel(channelId: string): Promise<number> {
  const row = await one(sql`SELECT COUNT(*) AS c FROM dashboard_report_channels WHERE channel_id = ${channelId}`);
  return row ? num(row.c) : 0;
}

// ============================================
// Running a report
// ============================================

export interface RunOutcome {
  status: ReportStatus;
  error: string | null;
  title: string | null;
  text: string | null;
  deliveredTo: string[];
  failed: Array<{ channelId: string; error: string }>;
}

async function ownerViewer(ownerId: string): Promise<Viewer | string> {
  const user = await getUserById(ownerId);
  if (!user) return "The report's owner no longer exists";
  if (!user.isActive) return `The report's owner ${user.username} is deactivated`;
  return { id: user.id, roles: user.roles, permissions: user.permissions };
}

/** Names of the dashboard's panel alerts that started firing on the report's connection in [fromMs, toMs). */
async function firedAlerts(dashboardId: string, connectionId: string, fromMs: number, toMs: number): Promise<string[]> {
  const alerts = await all(sql`SELECT id, name FROM dashboard_alerts WHERE dashboard_id = ${dashboardId} AND connection_id = ${connectionId}`);
  if (alerts.length === 0) return [];
  const names = new Map(alerts.map((a) => [str(a.id), str(a.name)]));
  const rows = await all(sql`SELECT rule_id, payload FROM alert_events
    WHERE rule_id IN (${sql.join([...names.keys()].map((id) => sql`${id}`), sql`, `)}) AND fired_at >= ${fromMs} AND fired_at < ${toMs}`);
  const fired = new Set<string>();
  for (const row of rows) {
    try {
      const payload: unknown = JSON.parse(str(row.payload));
      if (payload && typeof payload === "object" && "notice" in payload && payload.notice === "firing") fired.add(names.get(str(row.rule_id)) ?? "");
    } catch {
      // A payload that is not JSON is not a panel alert notice.
    }
  }
  return [...fired].filter((n) => n !== "").sort();
}

/** Gather and build the message, as the owner. Throws with the reason when the run cannot happen. */
async function compose(report: Report, nowMs: number): Promise<{ title: string; text: string } | { skipped: string }> {
  const base = publicBaseUrl();
  if (!base) throw new Error("PUBLIC_BASE_URL is not set, so the report's link cannot be built");
  const detail = await store.getDashboard(report.dashboardId);
  if (!detail) throw new Error("The dashboard no longer exists");
  const owner = await ownerViewer(report.ownerId);
  if (typeof owner === "string") throw new Error(owner);
  if (!dashboardAccess(owner, detail.dashboard, detail.shares).view) throw new Error("The report's owner can no longer view this dashboard");
  if (!has(owner, PERMISSIONS.QUERY_EXECUTE)) throw new Error("The report's owner can no longer run queries (query:execute)");
  if (!inScope(detail.dashboard.connectionScope, report.connectionId)) throw new Error("The dashboard is no longer assigned to the report's connection");

  const window = resolveWindow({ kind: "relative", value: report.range }, nowMs);
  const fired = await firedAlerts(detail.dashboard.id, report.connectionId, window.from * 1000, window.to * 1000);
  if (report.onlyIfAlert && fired.length === 0) return { skipped: "No panel alert fired in the range" };

  const panels: DigestPanel[] = [];
  for (const panel of detail.panels) {
    if (panel.kind !== "chart") continue;
    const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values: {}, range: { kind: "absolute", from: window.from, to: window.to }, dashboardId: detail.dashboard.id, panelId: panel.id };
    const shape = { title: panel.title, type: panel.viz.type, unit: panel.viz.unit, x: panel.viz.x, y: panel.viz.y, series: panel.viz.series, reduce: panel.viz.reduce };
    try {
      if (panel.fleet) {
        const fleet = await runFleet(owner, query, () => null, detail.dashboard.connectionScope, nowMs);
        panels.push({
          ...shape,
          ok: true,
          connections: fleet.connections.flatMap((e) => (e.ok ? [{ name: e.connectionName, data: e.data }] : [])),
          failed: fleet.connections.flatMap((e) => (e.ok ? [] : [{ name: e.connectionName, error: e.error }])),
        });
      } else {
        const result = await runPanel(owner, report.connectionId, query, () => null, nowMs);
        panels.push({ ...shape, ok: true, connections: [{ name: null, data: result.data }], failed: [] });
      }
    } catch (error) {
      panels.push({ title: panel.title, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const link = `${base}/dashboards/${encodeURIComponent(detail.dashboard.id)}?from=${window.from}&to=${window.to}`;
  return buildDigest({ reportName: report.name, dashboardTitle: detail.dashboard.title, from: window.from, to: window.to, timezone: report.schedule.timezone, panels, firedAlerts: fired, link });
}

async function send(report: Report, nowMs: number, message: { title: string; text: string }): Promise<{ deliveredTo: string[]; channelIds: string[]; failed: RunOutcome["failed"] }> {
  const result = await notifyChannelIds(report.channelIds, message, { feature: "dashboard_report", subjectId: report.id, kind: `run:${nowMs}` });
  return {
    deliveredTo: result.deliveredTo,
    channelIds: result.channelIds,
    failed: result.failed.map((f) => ({ channelId: f.channelId, error: f.name ? `${f.name}: ${f.error}` : `${f.channelId}: ${f.error}` })),
  };
}

/**
 * Run a report now: compose, send, record the event and the outcome. With
 * `advance`, the next run moves on (the scheduler); a manual send leaves the
 * schedule alone.
 */
export async function runReport(report: Report, nowMs: number = Date.now(), advance = true): Promise<RunOutcome> {
  let outcome: RunOutcome;
  let sentTo: string[] = [];
  try {
    const composed = await compose(report, nowMs);
    if ("skipped" in composed) {
      outcome = { status: "skipped", error: composed.skipped, title: null, text: null, deliveredTo: [], failed: [] };
    } else {
      const { deliveredTo, channelIds, failed } = await send(report, nowMs, composed);
      const status: ReportStatus = deliveredTo.length > 0 ? "sent" : "failed";
      const error = failed.length > 0 ? failed.map((f) => f.error).join("; ") : null;
      outcome = { status, error, title: composed.title, text: composed.text, deliveredTo, failed };
      sentTo = channelIds;
    }
  } catch (error) {
    outcome = { status: "failed", error: error instanceof Error ? error.message : String(error), title: null, text: null, deliveredTo: [], failed: [] };
  }
  await recordEvent({
    ruleId: report.id,
    severity: outcome.status === "failed" ? AlertSeverity.Warning : AlertSeverity.Info,
    payload: JSON.stringify({
      source: "dashboard_report",
      status: outcome.status,
      reportName: report.name,
      dashboardId: report.dashboardId,
      title: outcome.title ?? `📊 ${report.name} ${outcome.status === "skipped" ? "skipped" : "failed"}`,
      text: outcome.text ?? outcome.error ?? "",
      error: outcome.error,
      failed: outcome.failed,
    }),
    deliveredTo: outcome.deliveredTo,
    source: "dashboard_report",
    channelIds: sentTo,
    deliveryFailed: outcome.failed.length > 0,
  });
  const next = advance ? nextRunAt(report.schedule, nowMs) : report.nextRunAt;
  await run(sql`UPDATE dashboard_reports SET last_run_at = ${nowMs}, last_status = ${outcome.status}, last_error = ${outcome.error}, next_run_at = ${next} WHERE id = ${report.id}`);
  if (outcome.status === "failed") logger.warn({ module: "DashboardReports", reportId: report.id, error: outcome.error }, "Dashboard report failed");
  return outcome;
}

// ============================================
// Scheduler
// ============================================

export class DashboardReportScheduler {
  private static instance: DashboardReportScheduler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  static getInstance(): DashboardReportScheduler {
    if (!DashboardReportScheduler.instance) DashboardReportScheduler.instance = new DashboardReportScheduler();
    return DashboardReportScheduler.instance;
  }

  start(): void {
    if (this.timer) return;
    logger.info({ module: "DashboardReports", holder: HOLDER }, "Dashboard report scheduler started (tick=60s)");
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const swept = await deleteExpiredSnapshots(now);
      if (swept > 0) logger.info({ module: "DashboardReports", swept }, "Deleted expired dashboard snapshots");
      const due = await all(sql`SELECT id, dashboard_id FROM dashboard_reports WHERE enabled = 1 AND next_run_at <= ${now} ORDER BY next_run_at`);
      for (const row of due) {
        const id = str(row.id);
        if (!(await acquireLease(`dashboard-report:${id}`, HOLDER, LEASE_SECONDS))) continue;
        // Another pod may have sent it between our read and our claim.
        const fresh = await getReport(str(row.dashboard_id), id);
        if (!fresh || !fresh.enabled || fresh.nextRunAt > now) continue;
        try {
          await runReport(fresh, now);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ module: "DashboardReports", reportId: id, err: message }, "Dashboard report run failed");
          // Move on to the next run regardless, so a failure after sending never repeats the send every lease.
          await run(sql`UPDATE dashboard_reports SET last_run_at = ${now}, last_status = 'failed', last_error = ${message.slice(0, 2000)}, next_run_at = ${nextRunAt(fresh.schedule, now)} WHERE id = ${id}`)
            .catch((e: unknown) => logger.error({ module: "DashboardReports", reportId: id, err: e instanceof Error ? e.message : String(e) }, "Could not record the failed report run"));
        }
      }
    } catch (error) {
      logger.error({ module: "DashboardReports", err: error instanceof Error ? error.message : String(error) }, "Dashboard report tick failed");
    } finally {
      this.running = false;
    }
  }
}
