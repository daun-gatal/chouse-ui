/**
 * Panel alert evaluator (ADR 0021 §7). A 60 s tick runs every enabled alert
 * that is due, on exactly one pod: each alert is claimed with a row lease
 * (`obs_leases`) and its due time re-read after the claim, so a pod that loses
 * the race skips it.
 *
 * Each evaluation re-checks the alert's owner — still active, still allowed to
 * view the dashboard — and runs the panel through the same pipeline as a
 * viewer (runner.ts) with the owner's access. A failed check or query puts the
 * alert in state `error` with the reason and notifies once; it never passes
 * silently. Notifications go out when an alert starts firing, resolves, starts
 * failing and recovers.
 */

import { randomUUID } from "crypto";
import { hostname } from "os";

import { decryptChannelConfig, getChannel, recordEvent } from "../alerting/store";
import { sendChannelMessage } from "../alerting/deliver";
import { AlertSeverity } from "../alerting/types";
import { PERMISSIONS } from "../../rbac/schema/base";
import { getUserById } from "../../rbac/services/rbac";
import { AppError } from "../../types";
import { logger } from "../../utils/logger";
import { acquireLease } from "../observe/lease";
import { dashboardAccess, has, type Viewer } from "./access";
import * as alertStore from "./alertStore";
import type { AlertConfig, AlertState, AlertStatus, PanelAlert, ThresholdConfig } from "./alertStore";
import { runBaseline } from "./baseline";
import { runPanel } from "./runner";
import type { Baseline, TimeSeries } from "./baseline";
import { inScope, type REDUCERS } from "./spec";
import * as store from "./store";

const TICK_MS = 60_000;
/** Long enough to cover one evaluation; a pod that dies mid-run frees it after this. */
const LEASE_SECONDS = 120;
const HOLDER = `dashboards-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

// ============================================
// Pure evaluation logic
// ============================================

export type Outcome =
  | { kind: "value"; value: number; breached: boolean; band?: { lo: number; hi: number } }
  | { kind: "no_data"; reason: string }
  | { kind: "error"; reason: string };

export type Notice = "firing" | "resolved" | "error" | "recovered";

export function reduceValues(values: number[], reduce: (typeof REDUCERS)[number]): number {
  switch (reduce) {
    case "last": return values[values.length - 1];
    case "max": return Math.max(...values);
    case "min": return Math.min(...values);
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

export function breaches(value: number, config: Pick<ThresholdConfig, "op" | "value">): boolean {
  switch (config.op) {
    case ">": return value > config.value;
    case ">=": return value >= config.value;
    case "<": return value < config.value;
    case "<=": return value <= config.value;
  }
}

/** The next status after `outcome`, and the notice it calls for (null when none). */
export function nextStatus(prev: AlertStatus, outcome: Outcome, config: Pick<AlertConfig, "forEvaluations">, now: number): { status: AlertStatus; notice: Notice | null } {
  const since = (state: AlertState): number => (prev.state === state ? prev.since : now);
  if (outcome.kind === "error") {
    return {
      status: { state: "error", breaches: 0, since: since("error"), lastEvalAt: now, lastValue: null, lastError: outcome.reason },
      notice: prev.state === "error" ? null : "error",
    };
  }
  if (outcome.kind === "no_data") {
    return {
      status: { state: "no_data", breaches: 0, since: since("no_data"), lastEvalAt: now, lastValue: null, lastError: outcome.reason },
      notice: prev.state === "firing" ? "resolved" : prev.state === "error" ? "recovered" : null,
    };
  }
  if (outcome.breached) {
    const count = prev.state === "pending" || prev.state === "firing" ? prev.breaches + 1 : 1;
    const state: AlertState = count >= config.forEvaluations ? "firing" : "pending";
    const notice: Notice | null = state === "firing" && prev.state !== "firing" ? "firing" : prev.state === "error" ? "recovered" : null;
    return { status: { state, breaches: count, since: since(state), lastEvalAt: now, lastValue: outcome.value, lastError: null }, notice };
  }
  return {
    status: { state: "ok", breaches: 0, since: since("ok"), lastEvalAt: now, lastValue: outcome.value, lastError: null },
    notice: prev.state === "firing" ? "resolved" : prev.state === "error" ? "recovered" : null,
  };
}

export function isDue(alert: Pick<PanelAlert, "enabled" | "config">, status: AlertStatus, now: number): boolean {
  if (!alert.enabled) return false;
  return status.lastEvalAt === null || now - status.lastEvalAt >= alert.config.everyMinutes * 60_000;
}

// ============================================
// Evaluation
// ============================================

export interface Evaluated {
  outcome: Outcome;
  dashboardTitle: string;
  panelTitle: string;
}

/** The alert owner as a viewer, or the reason the alert cannot run as them. */
async function ownerViewer(ownerId: string): Promise<Viewer | string> {
  const user = await getUserById(ownerId);
  if (!user) return "The alert's owner no longer exists";
  if (!user.isActive) return `The alert's owner ${user.username} is deactivated`;
  return { id: user.id, roles: user.roles, permissions: user.permissions };
}

export async function evaluate(alert: PanelAlert, now: number): Promise<Evaluated> {
  const detail = await store.getDashboard(alert.dashboardId);
  if (!detail) return { outcome: { kind: "error", reason: "The dashboard no longer exists" }, dashboardTitle: "", panelTitle: "" };
  const panel = detail.panels.find((p) => p.id === alert.panelId);
  const dashboardTitle = detail.dashboard.title;
  if (!panel) return { outcome: { kind: "error", reason: "The panel no longer exists" }, dashboardTitle, panelTitle: "" };
  const result = (outcome: Outcome): Evaluated => ({ outcome, dashboardTitle, panelTitle: panel.title });
  if (panel.kind !== "chart") return result({ kind: "error", reason: "The panel is no longer a chart" });
  if (panel.fleet) return result({ kind: "error", reason: "The panel now runs across the fleet; alerts need a panel for one connection" });
  if (!inScope(detail.dashboard.connectionScope, alert.connectionId)) return result({ kind: "error", reason: "The dashboard is no longer assigned to the connection this alert watches" });
  const owner = await ownerViewer(alert.ownerId);
  if (typeof owner === "string") return result({ kind: "error", reason: owner });
  if (!dashboardAccess(owner, detail.dashboard, detail.shares).view) return result({ kind: "error", reason: "The alert's owner can no longer view this dashboard" });
  if (!has(owner, PERMISSIONS.QUERY_EXECUTE)) return result({ kind: "error", reason: "The alert's owner can no longer run queries (query:execute)" });
  const query = {
    sql: panel.sql,
    variables: detail.dashboard.variables,
    values: alert.config.values,
    range: { kind: "relative" as const, value: alert.config.range },
    dashboardId: detail.dashboard.id,
    panelId: panel.id,
  };
  const config = alert.config;
  if (config.kind === "outside_band") {
    if (panel.viz.baseline === null || panel.viz.x === null) return result({ kind: "error", reason: "The panel no longer draws an expected range" });
    if (panel.viz.y[0] !== config.column) return result({ kind: "error", reason: `The panel's band is for ${panel.viz.y[0] ?? "no column"}, not ${config.column}` });
    try {
      const { current, baseline } = await runBaseline({ viewer: owner, connectionId: alert.connectionId, query, xColumn: panel.viz.x, yColumn: config.column, weeks: panel.viz.baseline.weeks, agentFor: () => null, nowMs: now });
      return result(bandOutcome(current, baseline));
    } catch (error) {
      return result({ kind: "error", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    const run = await runPanel(owner, alert.connectionId, query, () => null, now);
    const column = config.column;
    if (!run.data.columns.some((c) => c.name === column)) return result({ kind: "error", reason: `The panel's result has no column ${column}` });
    if (run.data.rows.length === 0) return result({ kind: "no_data", reason: "The panel returned no rows" });
    const values = run.data.rows.map((row) => row[column]);
    const numbers = values.map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN));
    if (numbers.some((n) => !Number.isFinite(n))) return result({ kind: "error", reason: `Column ${column} has values that are not numbers (NULL or text)` });
    const value = reduceValues(numbers, config.reduce);
    return result({ kind: "value", value, breached: breaches(value, config) });
  } catch (error) {
    const reason = error instanceof AppError || error instanceof Error ? error.message : String(error);
    return result({ kind: "error", reason });
  }
}

// ============================================
// Notifications
// ============================================

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/**
 * A band alert's outcome: the latest complete bucket (the second-newest by
 * time; the newest is still filling) against its expected range.
 */
export function bandOutcome(current: TimeSeries, baseline: Baseline): Outcome {
  if (baseline.state === "learning") return { kind: "no_data", reason: `The expected range is still learning: ${baseline.reason}` };
  const order = current.xsMs
    .map((ms, i) => ({ ms, i }))
    .filter((e): e is { ms: number; i: number } => e.ms !== null && current.values[e.i] !== null)
    .sort((a, b) => a.ms - b.ms);
  if (order.length < 2) return { kind: "no_data", reason: "The panel has no complete bucket yet" };
  const { i } = order[order.length - 2];
  const point = baseline.points.find((p) => p.x === current.xs[i]);
  if (!point) return { kind: "no_data", reason: `No expected range for ${current.xs[i]}: fewer than 2 earlier weeks have that bucket` };
  const value = current.values[i] as number;
  return { kind: "value", value, breached: value < point.lo || value > point.hi, band: { lo: point.lo, hi: point.hi } };
}

export function noticeMessage(alert: PanelAlert, notice: Notice, evaluated: Evaluated, status: AlertStatus): { title: string; text: string } {
  const where = `${evaluated.panelTitle || "(panel)"} on dashboard ${evaluated.dashboardTitle || "(deleted)"}`;
  const config = alert.config;
  const measure = config.kind === "threshold" ? `${config.reduce} of ${config.column}` : `${config.column} in the latest complete bucket`;
  const band = evaluated.outcome.kind === "value" ? evaluated.outcome.band : undefined;
  const rule = config.kind === "threshold"
    ? `alert when ${config.op} ${formatValue(config.value)}`
    : band ? `expected ${formatValue(band.lo)} to ${formatValue(band.hi)}` : "outside the expected range";
  const icon = alert.severity === "critical" ? "🔴" : "🟠";
  switch (notice) {
    case "firing":
      return {
        title: `${icon} ${alert.name}`,
        text: `${where}: ${measure} is ${formatValue(status.lastValue ?? Number.NaN)} (${rule}, ${config.forEvaluations} evaluation${config.forEvaluations === 1 ? "" : "s"} in a row).`,
      };
    case "resolved":
      return {
        title: `✅ ${alert.name} resolved`,
        text: status.lastValue === null ? `${where}: ${status.lastError ?? "no rows"}.` : `${where}: ${measure} is ${formatValue(status.lastValue)}.`,
      };
    case "error":
      return { title: `⚠️ ${alert.name} cannot be evaluated`, text: `${where}: ${status.lastError ?? "unknown error"}.` };
    case "recovered":
      return { title: `✅ ${alert.name} is evaluating again`, text: `${where}: the alert runs normally again.` };
  }
}

async function deliver(alert: PanelAlert, notice: Notice, evaluated: Evaluated, status: AlertStatus): Promise<void> {
  const message = noticeMessage(alert, notice, evaluated, status);
  const delivered: string[] = [];
  const failed: Array<{ channelId: string; error: string }> = [];
  for (const channelId of alert.channelIds) {
    const row = await getChannel(channelId);
    if (!row) { failed.push({ channelId, error: "channel no longer exists" }); continue; }
    if (!row.enabled) { failed.push({ channelId, error: "channel is disabled" }); continue; }
    try {
      await sendChannelMessage(row.type, decryptChannelConfig(row.type, JSON.parse(row.config) as Record<string, unknown>), message);
      delivered.push(row.name);
    } catch (error) {
      failed.push({ channelId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed.length > 0) logger.warn({ module: "DashboardAlerts", alertId: alert.id, failed }, "Panel alert delivery failed on some channels");
  const severity = notice === "firing" ? (alert.severity === "critical" ? AlertSeverity.Critical : AlertSeverity.Warning) : notice === "error" ? AlertSeverity.Warning : AlertSeverity.Info;
  await recordEvent({
    ruleId: alert.id,
    severity,
    payload: JSON.stringify({
      source: "dashboard_panel_alert",
      notice,
      alertName: alert.name,
      dashboardId: alert.dashboardId,
      panelId: alert.panelId,
      title: message.title,
      text: message.text,
      value: status.lastValue,
      error: status.lastError,
      failed,
    }),
    deliveredTo: delivered,
  });
}

/** Evaluate one alert now and apply the transition. Returns the new status. */
export async function evaluateAndApply(alert: PanelAlert, prev: AlertStatus, now: number): Promise<AlertStatus> {
  const evaluated = await evaluate(alert, now);
  const { status, notice } = nextStatus(prev, evaluated.outcome, alert.config, now);
  await alertStore.saveStatus(alert.id, status);
  if (notice) await deliver(alert, notice, evaluated, status);
  return status;
}

// ============================================
// Scheduler
// ============================================

export class DashboardAlertEvaluator {
  private static instance: DashboardAlertEvaluator | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  static getInstance(): DashboardAlertEvaluator {
    if (!DashboardAlertEvaluator.instance) DashboardAlertEvaluator.instance = new DashboardAlertEvaluator();
    return DashboardAlertEvaluator.instance;
  }

  start(): void {
    if (this.timer) return;
    logger.info({ module: "DashboardAlerts", holder: HOLDER }, "Panel alert evaluator started (tick=60s)");
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
      const alerts = await alertStore.listAlerts({ enabledOnly: true });
      const statuses = await alertStore.getStatuses(alerts.map((a) => a.id));
      for (const alert of alerts) {
        const status = statuses.get(alert.id);
        if (!status || !isDue(alert, status, now)) continue;
        if (!(await acquireLease(`dashboard-alert:${alert.id}`, HOLDER, LEASE_SECONDS))) continue;
        // Another pod may have evaluated it between our read and our claim.
        const fresh = (await alertStore.getStatuses([alert.id])).get(alert.id);
        if (!fresh || !isDue(alert, fresh, now)) continue;
        try {
          await evaluateAndApply(alert, fresh, now);
        } catch (error) {
          logger.error({ module: "DashboardAlerts", alertId: alert.id, err: error instanceof Error ? error.message : String(error) }, "Panel alert evaluation failed");
        }
      }
    } catch (error) {
      logger.error({ module: "DashboardAlerts", err: error instanceof Error ? error.message : String(error) }, "Panel alert tick failed");
    } finally {
      this.running = false;
    }
  }
}
