/**
 * Fleet alerter — backend alert evaluation + delivery (M4, always-on).
 *
 * The fleet poller calls processTick() after each snapshot tick. We evaluate
 * the same rules the client bell uses against the fresh metrics and, on a NEW
 * breach (edge-triggered, mirroring the client's latch + hysteresis), deliver
 * to the configured channels — Slack (incoming webhook) and/or email (SMTP,
 * e.g. Gmail). This runs server-side so alerts fire even with no browser open.
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
import { loadRawAlertConfig } from "./fleetAlertConfig";
import type { DoctorReport } from "./ai/capabilities/fleetScan";
/** Node-memory re-arms only once it drops this far below threshold (anti-flap). */
const HYSTERESIS = 5;
/** Min gap between autonomous RCA scans, so a breach storm can't spawn a scan storm. */
const AUTO_RCA_COOLDOWN_MS =
  (Number(process.env.DOCTOR_AUTO_RCA_COOLDOWN_MINUTES) > 0
    ? Number(process.env.DOCTOR_AUTO_RCA_COOLDOWN_MINUTES)
    : 15) * 60 * 1000;
let lastAutoRcaAt = 0;

interface AlertRules {
  memoryPercent: number; // node memory %, 0 = off
  queryMemoryGb: number; // single query GB, 0 = off
  longQueryMin: number; // single query minutes, 0 = off
  partsEtaMin: number; // projected minutes until a table hits parts_to_throw_insert, 0 = off
}
/** A diverging table re-arms only once its projected ETA climbs this far past the limit (anti-flap). */
const PARTS_ETA_CLEAR_RATIO = 1.25;
interface SlackConfig {
  webhookUrl: string;
}
interface GoogleChatConfig {
  webhookUrl: string;
}
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  to: string;
  from: string;
}
interface AlertConfig {
  rules: AlertRules;
  slack?: SlackConfig;
  googleChat?: GoogleChatConfig;
  email?: EmailConfig;
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
const armed = new Map<string, boolean>();

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadConfig(): Promise<AlertConfig | null> {
  const parsed = (await loadRawAlertConfig()) as Record<string, unknown>;
  if (!parsed || Object.keys(parsed).length === 0 || parsed.enabled === false) {
    return null; // no config / disabled → delivery off
  }

  const rulesRaw = (parsed.rules ?? {}) as Record<string, unknown>;
  const rules: AlertRules = {
    memoryPercent: num(rulesRaw.memoryPercent),
    queryMemoryGb: num(rulesRaw.queryMemoryGb),
    longQueryMin: num(rulesRaw.longQueryMin),
    partsEtaMin: num(rulesRaw.partsEtaMin),
  };

  const slackRaw = parsed.slack as { webhookUrl?: unknown; enabled?: unknown } | undefined;
  // A channel delivers only if configured AND not explicitly disabled
  // (enabled defaults to true when the flag is absent, for older configs).
  const slack =
    slackRaw?.webhookUrl && slackRaw.enabled !== false
      ? { webhookUrl: String(slackRaw.webhookUrl) }
      : undefined;

  const gchatRaw = parsed.googleChat as { webhookUrl?: unknown; enabled?: unknown } | undefined;
  const googleChat =
    gchatRaw?.webhookUrl && gchatRaw.enabled !== false
      ? { webhookUrl: String(gchatRaw.webhookUrl) }
      : undefined;

  const e = parsed.email as Record<string, unknown> | undefined;
  const email =
    e?.user && e?.password && e?.to && e.enabled !== false
      ? {
          host: String(e.host ?? "smtp.gmail.com"),
          port: num(e.port) || 465,
          secure: e.secure !== undefined ? Boolean(e.secure) : true,
          user: String(e.user),
          password: String(e.password),
          to: String(e.to),
          from: String(e.from ?? e.user),
        }
      : undefined;

  if (!slack && !googleChat && !email) return null; // nothing to deliver to
  return {
    rules,
    slack,
    googleChat,
    email,
    aiRcaOnBreach: parsed.aiRcaOnBreach === true,
    aiRcaModelId: typeof parsed.aiRcaModelId === "string" && parsed.aiRcaModelId ? parsed.aiRcaModelId : undefined,
  };
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function deliverSlack(b: Breach, slack: SlackConfig): Promise<void> {
  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Node*\n${b.node}` },
    { type: "mrkdwn", text: `*Issue*\n${capitalize(b.metric)}` },
    { type: "mrkdwn", text: `*Detail*\n${b.summary}` },
  ];
  if (b.user) fields.push({ type: "mrkdwn", text: `*User*\n${b.user}` });

  const payload = {
    text: `🔴 ${b.node} — ${b.metric}: ${b.summary}`, // notification fallback
    attachments: [
      {
        color: "#dc2626",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🔴 ClickHouse fleet alert", emoji: true },
          },
          { type: "section", fields },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `chouse-fleet · ${new Date().toUTCString()}` },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function deliverGoogleChat(b: Breach, gchat: GoogleChatConfig): Promise<void> {
  const widgets: unknown[] = [
    { decoratedText: { topLabel: "Node", text: b.node } },
    { decoratedText: { topLabel: "Issue", text: capitalize(b.metric) } },
    { decoratedText: { topLabel: "Detail", text: b.summary } },
  ];
  if (b.user) widgets.push({ decoratedText: { topLabel: "User", text: b.user } });
  widgets.push({
    textParagraph: { text: `<font color="#9ca3af">chouse-fleet · ${new Date().toUTCString()}</font>` },
  });

  const payload = {
    // Plain text drives the notification preview; the card carries the detail.
    text: `🔴 ${b.node} — ${b.metric}: ${b.summary}`,
    cardsV2: [
      {
        cardId: "fleet-alert",
        card: {
          header: { title: "🔴 ClickHouse fleet alert", subtitle: `${b.node} · ${capitalize(b.metric)}` },
          sections: [{ widgets }],
        },
      },
    ],
  };

  const res = await fetch(gchat.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Google Chat webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function deliverEmail(b: Breach, email: EmailConfig): Promise<void> {
  // Lazy import — the server shouldn't hard-depend on nodemailer at startup
  // (email is optional; the package may not be installed yet).
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    auth: { user: email.user, pass: email.password },
  });

  const detail = b.detail
    ? `<div style="margin-top:12px;padding:10px 12px;background:#f9fafb;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#374151;word-break:break-all">${escapeHtml(b.detail)}</div>`
    : "";
  const user = b.user
    ? `<div style="margin-top:4px;color:#6b7280;font-size:13px">by ${escapeHtml(b.user)}</div>`
    : "";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:460px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff">
    <div style="background:#dc2626;color:#fff;padding:14px 18px;font-weight:600;font-size:15px">🔴 ClickHouse fleet alert</div>
    <div style="padding:18px">
      <div style="font-size:16px;font-weight:600;color:#111827">${escapeHtml(b.node)}</div>
      <div style="margin-top:6px;color:#374151;font-size:14px">${capitalize(b.metric)} · <strong>${escapeHtml(b.summary)}</strong></div>
      ${user}
      ${detail}
      <div style="margin-top:16px;color:#9ca3af;font-size:11px">chouse-fleet · ${new Date().toUTCString()}</div>
    </div>
  </div>`;

  await transport.sendMail({
    from: email.from,
    to: email.to,
    subject: `🔴 ${b.node} — ${capitalize(b.metric)} alert`,
    text: `${b.node} — ${b.metric}: ${b.summary}${b.user ? ` (${b.user})` : ""}`,
    html,
  });
}

async function deliver(b: Breach, config: AlertConfig): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (config.slack) {
    tasks.push(
      deliverSlack(b, config.slack).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "slack", err: String(err) }, "Slack delivery failed"),
      ),
    );
  }
  if (config.googleChat) {
    tasks.push(
      deliverGoogleChat(b, config.googleChat).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "google_chat", err: String(err) }, "Google Chat delivery failed"),
      ),
    );
  }
  if (config.email) {
    tasks.push(
      deliverEmail(b, config.email).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "email", err: String(err) }, "Email delivery failed"),
      ),
    );
  }
  await Promise.allSettled(tasks);
  logger.info({ module: "FleetAlerter", node: b.node, metric: b.metric, summary: b.summary }, "Alert fired");
}

// ============================================
// Autonomous RCA (ChouseD) — fired on a NEW breach
// ============================================

const STATUS_EMOJI: Record<string, string> = { healthy: "🟢", warning: "🟠", critical: "🔴" };
const STATUS_COLOR: Record<string, string> = { healthy: "#16a34a", warning: "#d97706", critical: "#dc2626" };
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

async function deliverRcaSlack(report: DoctorReport, triggers: string[], slack: SlackConfig): Promise<void> {
  const status = rcaStatus(report);
  const emoji = STATUS_EMOJI[status] ?? "🟠";
  const summary = rcaSummary(report);
  const recs = report.analysis?.recommendations?.slice(0, 3) ?? [];
  const nodes = [...(report.analysis?.nodes ?? [])]
    .filter((n) => n.status !== "healthy")
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
    .slice(0, 3);

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${emoji} Chouse AI — root-cause analysis`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `*Triggered by:* ${triggers.join(" · ").slice(0, 280)}` }] },
    { type: "section", text: { type: "mrkdwn", text: `*Verdict:* ${summary}` } },
  ];
  for (const n of nodes) {
    const ne = STATUS_EMOJI[n.status] ?? "🟠";
    const detail = n.details.slice(0, 2).map((d) => `• ${d}`).join("\n").slice(0, 600);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `${ne} *${n.name}*\n${detail}` } });
  }
  if (recs.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Recommendations*\n${recs.map((r) => `• ${r}`).join("\n")}`.slice(0, 1000) },
    });
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "🔎 *Please log in to the platform to check the details.*" },
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `chouse-fleet · Chouse AI · ${report.model} · ${new Date().toUTCString()}` }],
  });

  const payload = {
    text: `${emoji} Chouse AI RCA — ${summary}`.slice(0, 200),
    attachments: [{ color: STATUS_COLOR[status] ?? "#d97706", blocks }],
  };
  const res = await fetch(slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function deliverRcaGoogleChat(report: DoctorReport, triggers: string[], gchat: GoogleChatConfig): Promise<void> {
  const status = rcaStatus(report);
  const emoji = STATUS_EMOJI[status] ?? "🟠";
  const summary = rcaSummary(report);
  const recs = report.analysis?.recommendations?.slice(0, 3) ?? [];
  const nodes = [...(report.analysis?.nodes ?? [])]
    .filter((n) => n.status !== "healthy")
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
    .slice(0, 3);

  const widgets: unknown[] = [
    { decoratedText: { topLabel: "Triggered by", text: triggers.join(" · ").slice(0, 280) } },
    { textParagraph: { text: `<b>Verdict:</b> ${summary}` } },
  ];
  for (const n of nodes) {
    const ne = STATUS_EMOJI[n.status] ?? "🟠";
    const detail = n.details.slice(0, 2).map((d) => `• ${d}`).join("<br>").slice(0, 600);
    widgets.push({ textParagraph: { text: `${ne} <b>${n.name}</b><br>${detail}` } });
  }
  if (recs.length) {
    widgets.push({
      textParagraph: { text: `<b>Recommendations</b><br>${recs.map((r) => `• ${r}`).join("<br>")}`.slice(0, 1000) },
    });
  }
  widgets.push({ textParagraph: { text: "🔎 <b>Please log in to the platform to check the details.</b>" } });
  widgets.push({
    textParagraph: {
      text: `<font color="#9ca3af">chouse-fleet · Chouse AI · ${report.model} · ${new Date().toUTCString()}</font>`,
    },
  });

  const payload = {
    text: `${emoji} Chouse AI RCA — ${summary}`.slice(0, 200),
    cardsV2: [
      {
        cardId: "fleet-rca",
        card: {
          header: { title: `${emoji} Chouse AI — root-cause analysis`, subtitle: status.toUpperCase() },
          sections: [{ widgets }],
        },
      },
    ],
  };
  const res = await fetch(gchat.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Google Chat webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function deliverRcaEmail(report: DoctorReport, triggers: string[], email: EmailConfig): Promise<void> {
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    auth: { user: email.user, pass: email.password },
  });
  const status = rcaStatus(report);
  const color = STATUS_COLOR[status] ?? "#d97706";
  const summary = rcaSummary(report);
  const recs = report.analysis?.recommendations?.slice(0, 4) ?? [];
  const nodes = [...(report.analysis?.nodes ?? [])].filter((n) => n.status !== "healthy").slice(0, 4);

  const nodeHtml = nodes
    .map(
      (n) => `
      <div style="margin-top:10px"><strong style="color:#111827">${escapeHtml(n.name)}</strong> <span style="color:#6b7280">(${escapeHtml(n.status)})</span>
        <ul style="margin:4px 0 0;padding-left:18px;color:#374151;font-size:13px">${n.details
          .slice(0, 3)
          .map((d) => `<li>${escapeHtml(d)}</li>`)
          .join("")}</ul>
      </div>`,
    )
    .join("");
  const recHtml = recs.length
    ? `<div style="margin-top:14px"><div style="font-weight:600;color:#111827">Recommendations</div><ul style="margin:4px 0 0;padding-left:18px;color:#374151;font-size:13px">${recs
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul></div>`
    : "";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff">
    <div style="background:${color};color:#fff;padding:14px 18px;font-weight:600;font-size:15px">🩺 Chouse AI — root-cause analysis</div>
    <div style="padding:18px">
      <div style="color:#6b7280;font-size:12px">Triggered by: ${escapeHtml(triggers.join(" · ").slice(0, 300))}</div>
      <div style="margin-top:8px;font-size:15px;color:#111827"><strong>Verdict:</strong> ${escapeHtml(summary)}</div>
      ${nodeHtml}
      ${recHtml}
      <div style="margin-top:16px;padding:10px 12px;background:#f9fafb;border-radius:6px;color:#374151;font-size:13px">🔎 <strong>Please log in to the platform to check the details.</strong></div>
      <div style="margin-top:12px;color:#9ca3af;font-size:11px">chouse-fleet · Chouse AI · ${escapeHtml(report.model)} · ${new Date().toUTCString()}</div>
    </div>
  </div>`;
  await transport.sendMail({
    from: email.from,
    to: email.to,
    subject: `🩺 Chouse AI RCA — ${status.toUpperCase()}`,
    text: `Chouse AI RCA: ${summary}`,
    html,
  });
}

async function deliverRca(report: DoctorReport, triggers: string[], config: AlertConfig): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (config.slack)
    tasks.push(
      deliverRcaSlack(report, triggers, config.slack).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "slack", err: String(err) }, "RCA Slack delivery failed"),
      ),
    );
  if (config.googleChat)
    tasks.push(
      deliverRcaGoogleChat(report, triggers, config.googleChat).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "google_chat", err: String(err) }, "RCA Google Chat delivery failed"),
      ),
    );
  if (config.email)
    tasks.push(
      deliverRcaEmail(report, triggers, config.email).catch((err) =>
        logger.error({ module: "FleetAlerter", channel: "email", err: String(err) }, "RCA email delivery failed"),
      ),
    );
  await Promise.allSettled(tasks);
}

/**
 * Deliver a finished Chouse AI report to the configured channels (Slack/email).
 * Used by the scheduler for scheduled scans. No-op if no channel is configured.
 */
export async function deliverDoctorReport(report: DoctorReport, context: string): Promise<void> {
  const config = await loadConfig();
  if (!config) return;
  await deliverRca(report, [context], config);
}

/**
 * Have ChouseD investigate the fleet and deliver a root-cause analysis. Lazy-
 * imports the doctor service so the alerter never hard-depends on the AI SDK at
 * load. Best-effort: a failure is logged, never propagated to the poll loop.
 */
async function runAutoRca(config: AlertConfig, triggers: string[]): Promise<void> {
  try {
    const { runStructuredCapability } = await import("./ai/engine");
    const { fleetScanCapability } = await import("./ai/capabilities/fleetScan");
    const { saveDoctorReport } = await import("./doctorReports");
    logger.info(
      { module: "FleetAlerter", triggers: triggers.length, model: config.aiRcaModelId ?? "default" },
      "Auto-RCA: Chouse AI scanning fleet",
    );
    const report = await runStructuredCapability(
      fleetScanCapability,
      {},
      { modelId: config.aiRcaModelId },
    );
    await saveDoctorReport(report, null, "auto");
    await deliverRca(report, triggers, config);
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
export async function sendTestAlert(): Promise<{ slack: boolean; googleChat: boolean; email: boolean }> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No alert config (missing, disabled, or no channel set)");
  }
  await deliver(
    {
      node: "clickhouse-bi.paysera.net",
      metric: "query memory",
      summary: "57.4 GB query",
      user: "r_redash",
      detail: "r_redash · SELECT toInt32OrNull(customer_id) AS UserId, count() AS c FROM events …",
    },
    config,
  );
  return { slack: !!config.slack, googleChat: !!config.googleChat, email: !!config.email };
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
    const config = await loadConfig();
    if (!config) return;

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

    const seenQueryKeys = new Set<string>();
    const fires: Breach[] = [];

    for (const [connId, metrics] of byConn) {
      const node = nameById.get(connId) ?? connId;
      for (const r of evaluateNode(metrics, config.rules)) {
        const key = r.instanceId
          ? `${connId}:${r.ruleKey}:${r.instanceId}`
          : `${connId}:${r.ruleKey}`;
        if (r.instanceId) seenQueryKeys.add(key);
        const wasArmed = armed.get(key) ?? false;
        if (r.breaching && !wasArmed) {
          armed.set(key, true);
          fires.push({ node, metric: r.metric, summary: r.summary, user: r.user, detail: r.detail });
        } else if (r.clearing && wasArmed) {
          armed.set(key, false);
        }
      }
    }

    // Re-arm latches for query rules whose query is gone (finished / dropped).
    for (const k of [...armed.keys()]) {
      if (k.split(":").length === 3 && armed.get(k) && !seenQueryKeys.has(k)) {
        armed.delete(k);
      }
    }

    // Deliver after the latch is settled (so a delivery failure can't double-fire).
    for (const b of fires) {
      void deliver(b, config);
    }

    // Autonomous RCA: a NEW breach also kicks off a ChouseD investigation whose
    // root-cause analysis is delivered to the same channels — turning a raw
    // "memory 92%" alert into "here's why + what to do". Cooldown-throttled so a
    // breach storm can't spawn a scan storm; the timestamp is set BEFORE the
    // (slow, ~10–30s) scan so the next ticks can't re-enter while it runs.
    if (config.aiRcaOnBreach && fires.length > 0 && Date.now() - lastAutoRcaAt >= AUTO_RCA_COOLDOWN_MS) {
      lastAutoRcaAt = Date.now();
      const triggers = fires.map((b) => `${b.node} — ${b.metric}: ${b.summary}`);
      void runAutoRca(config, triggers);
    }
  } catch (err) {
    logger.error({ module: "FleetAlerter", err: err instanceof Error ? err.message : String(err) }, "processTick failed");
  }
}
