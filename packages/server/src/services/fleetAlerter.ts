/**
 * Fleet alerter — backend alert evaluation + delivery (M4, always-on).
 *
 * The fleet poller calls processTick() after each snapshot tick. We evaluate
 * the same rules the client bell uses against the fresh metrics and, on a NEW
 * breach (edge-triggered, mirroring the client's latch + hysteresis), deliver
 * to the rule's channels through the shared notify layer (ADR 0026), and when
 * the breach clears, edit the alert where the channel can. This runs
 * server-side so alerts fire even with no browser open.
 *
 * Config lives in the shared RBAC DB (single-row fleet_alert_config), loaded
 * via fleetAlertConfig. It's re-read every tick so it can be edited live, and
 * every replica sees the same settings. An empty config or `enabled: false`
 * simply turns delivery off.
 *
 * Example stored config (RawAlertConfig):
 * {
 *   "enabled": true,
 *   "rules": { "memoryPercent": 85, "queryMemoryGb": 10, "longQueryMin": 5 },
 *   "slack": { "webhookUrl": "https://hooks.slack.com/services/..." },
 *   "googleChat": { "webhookUrl": "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=...&token=..." },
 *   "email": { "user": "you@gmail.com", "password": "app-password", "to": "ops@team.com" }
 * }
 */

import { logger } from "../utils/logger";
import {
  getLastAutoRcaAt,
  loadLatches,
  persistLatches,
  setLastAutoRcaAt,
} from "./fleetAlertLatchStore";
import { listRules, getRuleChannelIds, getChannel, recordEvent } from "./alerting/store";
import { ChannelType, AlertSourceType, AlertSeverity } from "./alerting/types";
import { editSubject, isDeliverable, notifyChannelIds, type NotifyMessage } from "./alerting/notify";
import { linkTo } from "./alerting/notify/links";
import type { DoctorReport } from "./ai/capabilities/fleetScan";
/** Node-memory re-arms only once it drops this far below threshold (anti-flap). */
const HYSTERESIS = 5;
/** Min gap between autonomous RCA scans, so a breach storm can't spawn a scan storm. */
const AUTO_RCA_COOLDOWN_MS =
  (Number(process.env.DOCTOR_AUTO_RCA_COOLDOWN_MINUTES) > 0
    ? Number(process.env.DOCTOR_AUTO_RCA_COOLDOWN_MINUTES)
    : 15) * 60 * 1000;

interface AlertRules {
  memoryPercent: number; // node memory %, 0 = off
  queryMemoryGb: number; // single query GB, 0 = off
  longQueryMin: number; // single query minutes, 0 = off
  partsEtaMin: number; // projected minutes until a table hits parts_to_throw_insert, 0 = off
}
/** A diverging table re-arms only once its projected ETA climbs this far past the limit (anti-flap). */
const PARTS_ETA_CLEAR_RATIO = 1.25;
/** A resolved delivery destination — one of a rule's linked, enabled channels. */
interface DeliveryTarget {
  id: string;
  type: ChannelType;
  name: string;
}
/** One enabled fleet-threshold rule with its thresholds + delivery channels. */
interface RuleConfig {
  ruleId: string;
  name: string;
  severity: AlertSeverity;
  rules: AlertRules;
  /** All enabled channels linked to this rule (any type). */
  channels: DeliveryTarget[];
  /** When true, a new breach also kicks off a Chouse AI RCA delivered to the channels. */
  aiRcaOnBreach: boolean;
  /** AI config id for the auto-RCA scan (undefined = use the default model). */
  aiRcaModelId?: string;
}

interface SnapshotInput {
  connectionId: string;
  metric: string;
  payload: string;
  error: string | null;
}

interface RuleEval {
  ruleKey: string;
  instanceId?: string; // query_id for per-query rules
  metric: string; // human label
  summary: string; // self-describing value
  user?: string;
  detail?: string; // clean SQL snippet
  breaching: boolean;
  clearing: boolean;
}

interface Breach {
  node: string;
  metric: string;
  summary: string;
  user?: string;
  detail?: string;
}

// Per-(node, rule[, query]) latch — fire only on the healthy → breach edge.
// Persisted in `fleet_alert_latches` (ADR 0010) and loaded per tick, so the
// edge survives the poller lease moving between replicas.

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resolve a rule's enabled, deliverable channels. */
async function resolveRuleChannels(ruleId: string): Promise<DeliveryTarget[]> {
  const channels: DeliveryTarget[] = [];
  for (const id of await getRuleChannelIds(ruleId)) {
    const row = await getChannel(id);
    if (row && row.enabled && isDeliverable(row)) channels.push({ id: row.id, type: row.type, name: row.name });
  }
  return channels;
}

/**
 * Load every enabled fleet-threshold rule with its thresholds + delivery
 * channels (any type). A rule with no deliverable channel is
 * dropped. Returns [] when nothing is configured/enabled — the "delivery off"
 * contract callers expect.
 */
async function loadRuleConfigs(): Promise<RuleConfig[]> {
  const rules = await listRules();
  const out: RuleConfig[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.sourceType !== AlertSourceType.FleetThreshold) continue;
    let rulesRaw: Record<string, unknown> = {};
    try {
      rulesRaw = JSON.parse(rule.config) as Record<string, unknown>;
    } catch {
      rulesRaw = {};
    }
    const channels = await resolveRuleChannels(rule.id);
    if (channels.length === 0) continue;
    out.push({
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      rules: {
        memoryPercent: num(rulesRaw.memoryPercent),
        queryMemoryGb: num(rulesRaw.queryMemoryGb),
        longQueryMin: num(rulesRaw.longQueryMin),
        partsEtaMin: num(rulesRaw.partsEtaMin),
      },
      channels,
      aiRcaOnBreach: rule.aiRcaEnabled,
      aiRcaModelId: rule.aiRcaModelId ?? undefined,
    });
  }
  return out;
}

/** Dedup union of all active rules' channels — used by test + scheduled-report delivery. */
function unionChannels(configs: RuleConfig[]): DeliveryTarget[] {
  const byId = new Map<string, DeliveryTarget>();
  for (const cfg of configs) for (const ch of cfg.channels) byId.set(ch.id, ch);
  return [...byId.values()];
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function querySnippet(q: Record<string, unknown>): string | undefined {
  const user = q.user ? String(q.user) : "";
  const sql = String(q.query_preview ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (user && sql) return `${user} · ${sql}`;
  return user || sql || undefined;
}

/** Pure rule evaluation for one node — mirrors the client's evaluateNode. Exported for tests. */
export function evaluateNode(metrics: Record<string, Record<string, unknown>[]>, rules: AlertRules): RuleEval[] {
  const out: RuleEval[] = [];

  if (rules.memoryPercent > 0) {
    const s = metrics.summary?.[0];
    if (s) {
      const total = num(s.server_memory_total_bytes);
      const used = num(s.server_memory_used_bytes);
      const mem = total > 0 ? (used / total) * 100 : 0;
      out.push({
        ruleKey: "memory",
        metric: "node memory",
        summary: `${mem.toFixed(0)}% memory`,
        breaching: mem > rules.memoryPercent,
        clearing: mem < rules.memoryPercent - HYSTERESIS,
      });
    }
  }

  if (rules.queryMemoryGb > 0) {
    for (const q of metrics.top_memory_query ?? []) {
      const gb = num(q.memory_usage) / 1e9;
      if (gb > rules.queryMemoryGb) {
        out.push({
          ruleKey: "querymem",
          instanceId: String(q.query_id ?? ""),
          metric: "query memory",
          summary: `${gb.toFixed(1)} GB query`,
          user: q.user ? String(q.user) : undefined,
          detail: querySnippet(q),
          breaching: true,
          clearing: false,
        });
      }
    }
  }

  if (rules.longQueryMin > 0) {
    const q = metrics.longest_query?.[0];
    if (q) {
      const over = num(q.elapsed_seconds) / 60 > rules.longQueryMin;
      out.push({
        ruleKey: "longquery",
        metric: "long query",
        summary: `query running ${fmtDuration(num(q.elapsed_seconds))}`,
        user: q.user ? String(q.user) : undefined,
        detail: querySnippet(q),
        breaching: over,
        clearing: !over,
      });
    }
  }

  if (rules.partsEtaMin > 0) {
    // Predictive "too many parts": each table in the parts_pressure snapshot
    // carries a projected eta_minutes until its worst partition crosses
    // parts_to_throw_insert (negative = converging / not at risk). Latch per
    // table so independent tables fire and clear on their own.
    for (const row of metrics.parts_pressure ?? []) {
      const eta = num(row.eta_minutes);
      const net = num(row.net_parts_per_min);
      const db = String(row.database ?? "");
      const table = String(row.table ?? "");
      const maxParts = Math.round(num(row.max_parts_in_partition));
      const threshold = Math.round(num(row.parts_threshold));
      const diverging = net > 0 && eta >= 0;
      out.push({
        ruleKey: "partspressure",
        instanceId: db && table ? `${db}.${table}` : table || db,
        metric: "parts pressure",
        summary: `~${fmtMinutes(eta)} to parts limit`,
        detail: `${db}.${table} (${maxParts}/${threshold} parts, +${net.toFixed(1)}/min)`,
        breaching: diverging && eta < rules.partsEtaMin,
        clearing: !diverging || eta > rules.partsEtaMin * PARTS_ETA_CLEAR_RATIO,
      });
    }
  }

  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The alert for one breach, on every platform; the webhook body is the `fleet_alert` contract. */
export function breachMessage(b: Breach, firedAt: Date = new Date()): NotifyMessage {
  const facts = [
    { label: "Node", value: b.node },
    { label: "Issue", value: capitalize(b.metric) },
    { label: "Detail", value: b.summary },
    ...(b.user ? [{ label: "User", value: b.user }] : []),
  ];
  return {
    title: "🔴 ClickHouse fleet alert",
    severity: "critical",
    facts,
    detail: b.detail,
    links: linkTo("Open fleet", "/fleet"),
    footer: `chouse-fleet · ${firedAt.toUTCString()}`,
    fallback: `🔴 ${b.node} — ${b.metric}: ${b.summary}`,
    emailSubject: `🔴 ${b.node} — ${capitalize(b.metric)} alert`,
    webhook: {
      kind: "fleet_alert",
      node: b.node,
      metric: b.metric,
      summary: b.summary,
      user: b.user,
      detail: b.detail,
      firedAt: firedAt.toISOString(),
    },
  };
}

/** The alert as posted, once its breach cleared (only edits it where the channel can). */
export function resolvedBreachMessage(posted: NotifyMessage, firedAt: number, resolvedAt: Date): NotifyMessage {
  const minutes = Math.max(0, Math.round((resolvedAt.getTime() - firedAt) / 60_000));
  return {
    ...posted,
    title: "✅ ClickHouse fleet alert resolved",
    severity: "success",
    text: `Resolved at ${resolvedAt.toUTCString()} · lasted ${minutes} min`,
  };
}

interface Fired {
  breach: Breach;
  latchKey: string;
  firedAt: Date;
}

async function deliver(fired: Fired, config: RuleConfig): Promise<void> {
  const b = fired.breach;
  const result = await notifyChannelIds(config.channels.map((ch) => ch.id), breachMessage(b, fired.firedAt), {
    feature: "fleet_alert",
    subjectId: fired.latchKey,
    kind: `fire:${fired.firedAt.getTime()}`,
  });
  await recordEvent({
    ruleId: config.ruleId,
    severity: config.severity,
    payload: `${b.node} — ${b.metric}: ${b.summary}${b.user ? ` (${b.user})` : ""}`,
    deliveredTo: result.deliveredTo,
    source: "fleet_alert",
    channelIds: result.channelIds,
    deliveryFailed: result.failed.length > 0,
  }).catch((err) => logger.error({ module: "FleetAlerter", err: String(err) }, "Failed to record alert event"));
  logger.info({ module: "FleetAlerter", node: b.node, metric: b.metric, summary: b.summary }, "Alert fired");
}

/**
 * A breach cleared: mark its alert resolved wherever the channel can edit it.
 * Read from the message log, so it works whichever replica holds the poller.
 */
async function resolve(latchKey: string, now: Date): Promise<void> {
  await editSubject("fleet_alert", latchKey, (posted, postedAt) => resolvedBreachMessage(posted, postedAt, now), { close: true });
}

// ============================================
// Autonomous RCA (ChouseD) — fired on a NEW breach
// ============================================

const STATUS_EMOJI: Record<string, string> = { healthy: "🟢", warning: "🟠", critical: "🔴" };
const STATUS_RANK: Record<string, number> = { critical: 0, warning: 1, healthy: 2 };

function rcaStatus(report: DoctorReport): string {
  if (report.analysis?.verdict.status) return report.analysis.verdict.status;
  // Structured parse failed — recover the status from the raw JSON if present.
  const m = (report.raw || "").match(/"status"\s*:\s*"(healthy|warning|critical)"/i);
  return m?.[1]?.toLowerCase() ?? "warning";
}

/**
 * Best-effort human verdict line. When the structured analysis is null (the
 * model didn't return parseable JSON, or the report got truncated), recover the
 * verdict summary from the raw text instead of dumping the raw fenced JSON blob
 * into the alert — which renders especially badly in Google Chat.
 */
function rcaSummary(report: DoctorReport): string {
  if (report.analysis?.verdict.summary) return report.analysis.verdict.summary;
  const raw = report.raw || "";
  const m = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m?.[1]) return m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim().slice(0, 300);
  return (
    raw.replace(/```(?:json)?/gi, "").replace(/\s+/g, " ").trim().slice(0, 300) ||
    "See the report in the platform."
  );
}

const RCA_SEVERITY: Record<string, NotifyMessage["severity"]> = { healthy: "success", warning: "warning", critical: "critical" };

/** The root-cause report on every platform; the webhook body is the `fleet_rca` contract. */
export function rcaMessage(report: DoctorReport, triggers: string[], at: Date = new Date()): NotifyMessage {
  const status = rcaStatus(report);
  const emoji = STATUS_EMOJI[status] ?? "🟠";
  const summary = rcaSummary(report);
  const recs = report.analysis?.recommendations?.slice(0, 3) ?? [];
  const nodes = [...(report.analysis?.nodes ?? [])]
    .filter((n) => n.status !== "healthy")
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
    .slice(0, 3);
  const sections = nodes.map((n) => ({
    title: `${STATUS_EMOJI[n.status] ?? "🟠"} ${n.name}`,
    text: n.details.slice(0, 2).map((d) => `• ${d}`).join("\n").slice(0, 600),
  }));
  if (recs.length) sections.push({ title: "Recommendations", text: recs.map((r) => `• ${r}`).join("\n").slice(0, 1000) });
  const links = linkTo("Open the report", `/doctor/${encodeURIComponent(report.id)}`);
  if (links.length === 0) sections.push({ title: "", text: "🔎 Please log in to the platform to check the details." });
  return {
    title: `${emoji} Chouse AI — root-cause analysis`,
    severity: RCA_SEVERITY[status] ?? "warning",
    facts: [{ label: "Triggered by", value: triggers.join(" · ").slice(0, 280) }],
    text: `Verdict: ${summary}`,
    sections: sections.map((section) => (section.title ? section : { text: section.text })),
    links,
    footer: `chouse-fleet · Chouse AI · ${report.model} · ${at.toUTCString()}`,
    fallback: `${emoji} Chouse AI RCA — ${summary}`.slice(0, 200),
    emailSubject: `🩺 Chouse AI RCA — ${status.toUpperCase()}`,
    webhook: {
      kind: "fleet_rca",
      status,
      summary,
      triggers,
      model: report.model,
      reportId: report.id,
      firedAt: at.toISOString(),
    },
  };
}

async function deliverRca(report: DoctorReport, triggers: string[], channels: DeliveryTarget[]): Promise<void> {
  const result = await notifyChannelIds(channels.map((ch) => ch.id), rcaMessage(report, triggers), { feature: "fleet_rca", subjectId: report.id });
  await recordEvent({
    ruleId: null,
    severity: RCA_SEVERITY[rcaStatus(report)] === "critical" ? AlertSeverity.Critical : AlertSeverity.Warning,
    payload: JSON.stringify({ source: "fleet_rca", title: `Chouse AI RCA — ${rcaStatus(report)}`, text: rcaSummary(report), reportId: report.id, failed: result.failed }),
    deliveredTo: result.deliveredTo,
    source: "fleet_rca",
    channelIds: result.channelIds,
    deliveryFailed: result.failed.length > 0,
  }).catch((err) => logger.error({ module: "FleetAlerter", err: String(err) }, "Failed to record RCA event"));
}

/**
 * Deliver a finished Chouse AI report to the configured channels (Slack/email).
 * Used by the scheduler for scheduled scans. No-op if no channel is configured.
 */
export async function deliverDoctorReport(report: DoctorReport, context: string): Promise<void> {
  const channels = unionChannels(await loadRuleConfigs());
  if (channels.length === 0) return;
  await deliverRca(report, [context], channels);
}

/**
 * Have ChouseD investigate the fleet and deliver a root-cause analysis. Lazy-
 * imports the doctor service so the alerter never hard-depends on the AI
 * runtime at load. Best-effort: a failure is logged, never propagated to the
 * poll loop.
 */
async function runAutoRca(
  channels: DeliveryTarget[],
  aiRcaModelId: string | undefined,
  triggers: string[],
): Promise<void> {
  try {
    const { runStructuredCapability } = await import("./ai/engine");
    const { fleetScanCapability } = await import("./ai/capabilities/fleetScan");
    const { saveDoctorReport } = await import("./doctorReports");
    logger.info(
      { module: "FleetAlerter", triggers: triggers.length, model: aiRcaModelId ?? "default" },
      "Auto-RCA: Chouse AI scanning fleet",
    );
    const report = await runStructuredCapability(
      fleetScanCapability,
      {},
      { modelId: aiRcaModelId },
    );
    await saveDoctorReport(report, null, "auto");
    await deliverRca(report, triggers, channels);
    logger.info(
      { module: "FleetAlerter", reportId: report.id, status: rcaStatus(report) },
      "Auto-RCA delivered",
    );
  } catch (err) {
    logger.error(
      { module: "FleetAlerter", err: err instanceof Error ? err.message : String(err) },
      "Auto-RCA failed",
    );
  }
}

/**
 * Send a sample alert through the configured channels — for verifying setup
 * (a "send test alert" action / one-off check). Throws if no config is loaded.
 */
export async function sendTestAlert(): Promise<{
  slack: boolean;
  googleChat: boolean;
  email: boolean;
  webhook: boolean;
}> {
  const channels = unionChannels(await loadRuleConfigs());
  if (channels.length === 0) {
    throw new Error("No alert config (missing, disabled, or no channel set)");
  }
  const sample: Breach = {
    node: "clickhouse-bi.paysera.net",
    metric: "query memory",
    summary: "57.4 GB query",
    user: "r_redash",
    detail: "r_redash · SELECT toInt32OrNull(customer_id) AS UserId, count() AS c FROM events …",
  };
  await notifyChannelIds(channels.map((ch) => ch.id), breachMessage(sample), { feature: "test" });
  const has = (t: ChannelType): boolean => channels.some((ch) => ch.type === t);
  return {
    slack: has(ChannelType.Slack),
    googleChat: has(ChannelType.GoogleChat),
    email: has(ChannelType.Email),
    webhook: has(ChannelType.Webhook),
  };
}

/**
 * Evaluate the just-polled snapshots and deliver any NEW breaches. Called by
 * the fleet poller after it writes a tick. Never throws — delivery problems are
 * logged, not propagated, so they can't break the poll loop.
 */
export async function processTick(
  connections: { id: string; name: string }[],
  rows: SnapshotInput[],
): Promise<void> {
  try {
    const configs = await loadRuleConfigs();
    if (configs.length === 0) return;

    const nameById = new Map(connections.map((c) => [c.id, c.name]));

    // Group parsed metric payloads by connection.
    const byConn = new Map<string, Record<string, Record<string, unknown>[]>>();
    for (const r of rows) {
      if (r.error || !r.payload) continue;
      let parsed: Record<string, unknown>[];
      try {
        parsed = JSON.parse(r.payload);
      } catch {
        continue;
      }
      if (!byConn.has(r.connectionId)) byConn.set(r.connectionId, {});
      byConn.get(r.connectionId)![r.metric] = parsed;
    }

    // Latch keys are namespaced by ruleId so independent rules don't share state.
    const seenQueryKeys = new Set<string>();

    // ADR 0010: latches live in the database so lease failover resumes them
    // instead of re-arming from empty and re-firing every standing breach.
    // Loaded per tick, written back at the end as a delta.
    const armed = await loadLatches();
    const latchChanges = new Map<string, boolean>();
    const latchRemovals = new Set<string>();

    // Evaluate every enabled rule against the snapshots; deliver each rule's
    // breaches to that rule's own channels, and fire per-rule auto-RCA.
    const now = new Date();
    for (const config of configs) {
      const fires: Fired[] = [];
      for (const [connId, metrics] of byConn) {
        const node = nameById.get(connId) ?? connId;
        for (const r of evaluateNode(metrics, config.rules)) {
          const key = r.instanceId
            ? `${config.ruleId}:${connId}:${r.ruleKey}:${r.instanceId}`
            : `${config.ruleId}:${connId}:${r.ruleKey}`;
          if (r.instanceId) seenQueryKeys.add(key);
          const wasArmed = armed.get(key) ?? false;
          if (r.breaching && !wasArmed) {
            armed.set(key, true);
            latchChanges.set(key, true);
            fires.push({ breach: { node, metric: r.metric, summary: r.summary, user: r.user, detail: r.detail }, latchKey: key, firedAt: now });
          } else if (r.clearing && wasArmed) {
            armed.set(key, false);
            latchChanges.set(key, false);
            void resolve(key, now);
          }
        }
      }

      // Deliver after the latch is settled (so a delivery failure can't double-fire),
      // and record each fire so the "recent alerts" feed reflects what happened.
      for (const fired of fires) {
        void deliver(fired, config).catch((err) =>
          logger.error({ module: "FleetAlerter", err: String(err) }, "Alert delivery failed"),
        );
      }

      // Autonomous RCA: a NEW breach also kicks off a ChouseD investigation whose
      // root-cause analysis is delivered to this rule's channels. Cooldown is
      // global (shared lastAutoRcaAt) so a breach storm across rules can't spawn a
      // scan storm; the timestamp is set BEFORE the (slow) scan to prevent re-entry.
      const lastAutoRcaAt = await getLastAutoRcaAt();
      if (config.aiRcaOnBreach && fires.length > 0 && Date.now() - lastAutoRcaAt >= AUTO_RCA_COOLDOWN_MS) {
        await setLastAutoRcaAt(Date.now());
        const triggers = fires.map(({ breach: b }) => `${b.node} — ${b.metric}: ${b.summary}`);
        void runAutoRca(config.channels, config.aiRcaModelId, triggers);
      }
    }

    // Re-arm latches for query rules whose query is gone (finished / dropped).
    // Key shape for query rules is rule:conn:ruleKey:instance → 4 segments.
    for (const k of [...armed.keys()]) {
      if (k.split(":").length === 4 && armed.get(k) && !seenQueryKeys.has(k)) {
        armed.delete(k);
        latchChanges.delete(k);
        latchRemovals.add(k);
        void resolve(k, now);
      }
    }

    await persistLatches(latchChanges, latchRemovals);
  } catch (err) {
    logger.error({ module: "FleetAlerter", err: err instanceof Error ? err.message : String(err) }, "processTick failed");
  }
}
