/**
 * Fleet routes — multi-connection monitoring endpoints.
 *
 * Each card on the /fleet page calls these against a specific connectionId.
 * The endpoint takes a fixed metric enum instead of raw SQL so the SQL surface
 * is server-controlled (no user-supplied SQL bypasses RBAC's row-level access
 * checks). Metric SQL lives in services/fleetMetrics.ts so the live route
 * here and the background snapshot poller can never drift apart.
 *
 * Auth: RBAC JWT + connections:view permission + access to the specific
 * connectionId (via getUserConnections / super_admin override).
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { sql } from "drizzle-orm";
import {
  rbacAuthMiddleware,
  requirePermission,
  requireAnyPermission,
  getRbacUser,
} from "../rbac/middleware/rbacAuth";
import { PERMISSIONS, AUDIT_ACTIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import {
  getUserConnections,
  listConnections,
} from "../rbac/services/connections";
import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import {
  runFleetMetric,
  FLEET_METRIC_KEYS,
  type FleetMetric,
} from "../services/fleetMetrics";
import { AppError } from "../types";
import { logger } from "../utils/logger";
import { readFileSync, writeFileSync } from "node:fs";
import { sendTestAlert } from "../services/fleetAlerter";
import { runStructuredCapability } from "../services/ai/engine";
import { fleetScanCapability } from "../services/ai/capabilities/fleetScan";
import { isAIEnabled } from "../services/aiConfig";
import { loadSchedule, saveSchedule, type DoctorSchedule } from "../services/doctorScheduler";
import {
  saveDoctorReport,
  listDoctorReports,
  getDoctorReport,
  deleteDoctorReports,
  deleteAllDoctorReports,
} from "../services/doctorReports";
import { listAiConfigs } from "../rbac/services/aiModels";

const fleet = new Hono();

const ALERT_CONFIG_PATH =
  process.env.ALERT_CONFIG_FILE || "/app/data/alert-config.json";

type RawAlertConfig = {
  enabled?: boolean;
  rules?: { memoryPercent?: number; queryMemoryGb?: number; longQueryMin?: number };
  slack?: { webhookUrl?: string; enabled?: boolean };
  googleChat?: { webhookUrl?: string; enabled?: boolean };
  email?: { user?: string; password?: string; to?: string; enabled?: boolean; host?: string; port?: number; secure?: boolean };
  /** When true, a new breach also fires a Chouse AI RCA to the channels. */
  aiRcaOnBreach?: boolean;
  /** AI config id for the auto-RCA scan (blank = default model). */
  aiRcaModelId?: string;
};

function loadRawAlertConfig(): RawAlertConfig {
  try {
    return JSON.parse(readFileSync(ALERT_CONFIG_PATH, "utf8")) as RawAlertConfig;
  } catch {
    return {};
  }
}

// Apply RBAC + per-surface permissions to every route in this module.
//   - Coarse gate: you need at least one fleet/doctor capability to touch the router.
//     (connections:view kept for backward-compat with pre-granular installs.)
//   - Fleet data routes are additionally protected per-connection by assertConnectionAccess.
//   - Doctor surface: reading needs doctor:view; *generating* a report (manual scan or
//     saving a schedule) needs the dedicated doctor:run.
fleet.use("*", rbacAuthMiddleware);
fleet.use(
  "*",
  requireAnyPermission([
    PERMISSIONS.CONNECTIONS_VIEW,
    PERMISSIONS.FLEET_VIEW,
    PERMISSIONS.DOCTOR_VIEW,
    PERMISSIONS.DOCTOR_RUN,
  ]),
);
// Every /doctor/* endpoint requires the Doctor view permission. The
// report-generating actions (scan, schedule PUT) additionally require doctor:run,
// enforced inline on those individual routes below.
fleet.use("/doctor/*", requirePermission(PERMISSIONS.DOCTOR_VIEW));

const fleetQuerySchema = z.object({
  connectionId: z.string().min(1, "connectionId is required"),
  metric: z.enum(FLEET_METRIC_KEYS as [string, ...string[]]),
});

/**
 * Verify the calling user actually has access to this specific connectionId.
 * Super admins skip the per-user mapping (they see every connection); regular
 * users must have the connection assigned to them via rbac_user_connections.
 */
async function assertConnectionAccess(
  userId: string,
  isSuperAdmin: boolean,
  connectionId: string,
): Promise<void> {
  if (isSuperAdmin) return;
  const userConns = await getUserConnections(userId);
  const hasAccess = userConns.some((c) => c.id === connectionId);
  if (!hasAccess) {
    throw AppError.forbidden("You do not have access to this connection");
  }
}

fleet.post("/query", zValidator("json", fleetQuerySchema), async (c) => {
  const { connectionId, metric } = c.req.valid("json");
  const user = getRbacUser(c);
  const isSuperAdmin = (user.roles ?? []).includes("super_admin");

  await assertConnectionAccess(user.sub, isSuperAdmin, connectionId);

  try {
    const result = await runFleetMetric(
      connectionId,
      metric as (typeof FLEET_METRIC_KEYS)[number],
    );
    return c.json({ success: true, data: result });
  } catch (err) {
    // Permission / not-found errors come through as AppError — let them
    // bubble so the middleware translates to the proper HTTP code.
    if (err instanceof AppError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { module: "FleetRoute", connectionId, metric, err: message },
      "Fleet metric query failed",
    );
    // Return 200 with an error payload so the React Query hook doesn't go red
    // for transient cluster issues — the card decides how to render the
    // "unreachable" state itself (3-strike rule lives in the frontend).
    return c.json({
      success: false,
      error: {
        code: "FLEET_QUERY_FAILED",
        message,
      },
    });
  }
});

// ============================================
// Snapshot endpoints (M2 — backed by fleet_snapshots table)
// ============================================

interface SnapshotRow {
  connection_id: string;
  captured_at: number;
  metric: string;
  payload: string;
  error: string | null;
}

/**
 * Adapter-agnostic SELECT helper. SQLite drizzle uses `.all(stmt)`, Postgres
 * drizzle uses `.execute(stmt)` and unwraps `.rows`. Centralise so the
 * snapshot endpoints stay readable.
 */
async function selectRaw<T = unknown>(stmt: ReturnType<typeof sql>): Promise<T[]> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((db as SqliteDb).all(stmt) as any) ?? [];
  }
  // postgres-js + drizzle returns an array-like RowList; some driver configs
  // wrap it as { rows }. Match the canonical Array.isArray-first check the
  // RBAC migrations use so this behaves identically on Postgres.
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return (Array.isArray(anyRes) ? anyRes : (anyRes.rows ?? [])) as T[];
}

/**
 * Resolve which connection ids the current user is allowed to see. Super
 * admins see every active connection; regular users see only the rows
 * mapped to them in rbac_user_connections.
 */
async function visibleConnectionIds(
  userSub: string,
  isSuperAdmin: boolean,
): Promise<string[]> {
  if (isSuperAdmin) {
    const { connections } = await listConnections({ activeOnly: true });
    return connections.map((c) => c.id);
  }
  const userConns = await getUserConnections(userSub);
  return userConns.map((c) => c.id);
}

/**
 * Fetch the latest snapshot row per (connection, metric) from the cache.
 * The id-MAX subquery wins one row per group on both SQLite and Postgres
 * without needing window functions.
 */
async function fetchLatestSnapshots(
  connectionIds: string[],
): Promise<SnapshotRow[]> {
  if (connectionIds.length === 0) return [];
  // Connection ids are UUIDs from RBAC tables (server-controlled), so
  // sql.raw on the IN-list is safe — these are not user input.
  const placeholders = connectionIds
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(",");
  const stmt = sql.raw(`
    SELECT s.connection_id, s.captured_at, s.metric, s.payload, s.error
    FROM fleet_snapshots s
    WHERE s.id IN (
      SELECT MAX(id) FROM fleet_snapshots
      WHERE connection_id IN (${placeholders})
      GROUP BY connection_id, metric
    )
  `);
  return selectRaw<SnapshotRow>(stmt);
}

/**
 * GET /api/fleet/snapshots — returns the latest snapshot of every metric
 * for every connection the caller is allowed to see, grouped by connection.
 *
 * Response shape:
 *   {
 *     connections: [
 *       {
 *         connectionId,
 *         capturedAt,                    // max captured_at across this connection's metrics
 *         metrics: {
 *           summary?:        { data: Row[], error: null | string },
 *           longest_query?:  { data: Row[], error: null | string },
 *           last_exception?: { data: Row[], error: null | string },
 *         },
 *       }
 *     ],
 *     workerEnabled: boolean,            // hint for the stale-banner logic
 *     pollIntervalSeconds: number,
 *   }
 */
fleet.get("/snapshots", async (c) => {
  const user = getRbacUser(c);
  const isSuperAdmin = (user.roles ?? []).includes("super_admin");
  const ids = await visibleConnectionIds(user.sub, isSuperAdmin);
  const rows = await fetchLatestSnapshots(ids);

  // Group by connectionId.
  const byConnection = new Map<
    string,
    {
      connectionId: string;
      capturedAt: number;
      metrics: Record<
        string,
        { data: Record<string, unknown>[]; error: string | null }
      >;
    }
  >();

  for (const r of rows) {
    let entry = byConnection.get(r.connection_id);
    if (!entry) {
      entry = {
        connectionId: r.connection_id,
        capturedAt: r.captured_at,
        metrics: {},
      };
      byConnection.set(r.connection_id, entry);
    }
    entry.capturedAt = Math.max(entry.capturedAt, r.captured_at);
    let parsed: Record<string, unknown>[] = [];
    if (r.payload) {
      try {
        parsed = JSON.parse(r.payload);
      } catch {
        // Malformed payload — surface as a parse error.
        entry.metrics[r.metric] = {
          data: [],
          error: "Snapshot payload is corrupt",
        };
        continue;
      }
    }
    entry.metrics[r.metric] = { data: parsed, error: r.error };
  }

  const pollIntervalSeconds = Number(
    process.env.FLEET_POLL_INTERVAL_SECONDS ?? 30,
  );

  return c.json({
    success: true,
    data: {
      connections: Array.from(byConnection.values()),
      workerEnabled: ["1", "true", "yes", "on"].includes(
        (process.env.FLEET_POLLER_ENABLED ?? "").toLowerCase(),
      ),
      pollIntervalSeconds: Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0
        ? pollIntervalSeconds
        : 30,
    },
  });
});

const historyQuerySchema = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  metric: z.enum(FLEET_METRIC_KEYS as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(1000),
});

const bulkHistoryQuerySchema = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  metric: z.enum(FLEET_METRIC_KEYS as [string, ...string[]]).optional().default("summary"),
  // Bulk = N nodes × points, so allow a higher ceiling than the per-node route.
  limit: z.coerce.number().int().min(1).max(50000).optional().default(20000),
});

/**
 * GET /api/fleet/history — time-series for EVERY node the caller can view,
 * one metric, grouped by connection. One request paints the shared trend
 * chart AND every per-card sparkline, instead of N per-node requests.
 *
 * Query params: from, to (unix seconds; default last 1h), metric (default
 * 'summary'), limit (default 20000 rows across all nodes).
 */
fleet.get("/history", zValidator("query", bulkHistoryQuerySchema), async (c) => {
  const user = getRbacUser(c);
  const isSuperAdmin = (user.roles ?? []).includes("super_admin");
  const ids = await visibleConnectionIds(user.sub, isSuperAdmin);
  const { from, to, metric, limit } = c.req.valid("query");
  const now = Math.floor(Date.now() / 1000);
  const fromTs = from ?? now - 3600;
  const toTs = to ?? now;

  if (ids.length === 0) {
    return c.json({ success: true, data: { from: fromTs, to: toTs, metric, nodes: [] } });
  }

  // ids are server-controlled UUIDs → safe to inline. metric is enum-validated.
  const inList = sql.raw(ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(","));
  const stmt = sql`
    SELECT connection_id, captured_at, payload, error
    FROM fleet_snapshots
    WHERE connection_id IN (${inList})
      AND metric = ${metric}
      AND captured_at >= ${fromTs}
      AND captured_at <= ${toTs}
    ORDER BY captured_at ASC
    LIMIT ${limit}
  `;
  const rows = await selectRaw<SnapshotRow>(stmt);

  // Group rows by connection.
  const byConn = new Map<string, { connectionId: string; rows: { capturedAt: number; data: unknown[]; error: string | null }[] }>();
  for (const id of ids) byConn.set(id, { connectionId: id, rows: [] });
  for (const r of rows) {
    const entry = byConn.get(r.connection_id);
    if (!entry) continue;
    let data: unknown[] = [];
    if (r.payload) {
      try { data = JSON.parse(r.payload); } catch { data = []; }
    }
    entry.rows.push({ capturedAt: r.captured_at, data, error: r.error });
  }

  return c.json({
    success: true,
    data: { from: fromTs, to: toTs, metric, nodes: Array.from(byConn.values()) },
  });
});

/**
 * GET /api/fleet/snapshots/:connectionId/history — time-series of snapshots
 * for one cluster. Used by M3's alert evaluator to look back over a window
 * (e.g. "memory > 80% for the last 5 minutes").
 *
 * Query params:
 *   from   unix seconds — defaults to now - 1 hour
 *   to     unix seconds — defaults to now
 *   metric optional filter, otherwise returns all metrics interleaved
 *   limit  max rows (default 1000, capped at 5000)
 */
fleet.get(
  "/snapshots/:connectionId/history",
  zValidator("query", historyQuerySchema),
  async (c) => {
    const user = getRbacUser(c);
    const isSuperAdmin = (user.roles ?? []).includes("super_admin");
    const connectionId = c.req.param("connectionId");

    await assertConnectionAccess(user.sub, isSuperAdmin, connectionId);

    const { from, to, metric, limit } = c.req.valid("query");
    const now = Math.floor(Date.now() / 1000);
    const fromTs = from ?? now - 3600;
    const toTs = to ?? now;

    // Build the query incrementally — the metric filter is optional.
    const metricFilter = metric ? sql`AND metric = ${metric}` : sql``;
    const stmt = sql`
      SELECT connection_id, captured_at, metric, payload, error
      FROM fleet_snapshots
      WHERE connection_id = ${connectionId}
        AND captured_at >= ${fromTs}
        AND captured_at <= ${toTs}
        ${metricFilter}
      ORDER BY captured_at ASC
      LIMIT ${limit}
    `;
    const rows = await selectRaw<SnapshotRow>(stmt);

    return c.json({
      success: true,
      data: {
        connectionId,
        from: fromTs,
        to: toTs,
        rows: rows.map((r) => ({
          capturedAt: r.captured_at,
          metric: r.metric as FleetMetric,
          data: r.payload ? (() => {
            try { return JSON.parse(r.payload); } catch { return []; }
          })() : [],
          error: r.error,
        })),
      },
    });
  },
);

// ============================================
// Alert delivery config (Slack / email) — super-admin only.
// Secrets are never returned; on save, a blank secret means "keep existing".
// ============================================

function requireSuperAdmin(c: Context): boolean {
  const user = getRbacUser(c);
  return (user.roles ?? []).includes("super_admin");
}

fleet.get("/alert-config", async (c) => {
  if (!requireSuperAdmin(c)) {
    return c.json({ success: false, error: "Super admin required" }, 403);
  }
  const cfg = loadRawAlertConfig();
  return c.json({
    success: true,
    data: {
      enabled: cfg.enabled !== false,
      aiRcaOnBreach: cfg.aiRcaOnBreach === true,
      aiRcaModelId: cfg.aiRcaModelId ?? null,
      rules: {
        memoryPercent: Number(cfg.rules?.memoryPercent ?? 85),
        queryMemoryGb: Number(cfg.rules?.queryMemoryGb ?? 0),
        longQueryMin: Number(cfg.rules?.longQueryMin ?? 0),
      },
      slack: {
        configured: Boolean(cfg.slack?.webhookUrl),
        enabled: cfg.slack?.enabled !== false,
      },
      googleChat: {
        configured: Boolean(cfg.googleChat?.webhookUrl),
        enabled: cfg.googleChat?.enabled !== false,
      },
      email: {
        configured: Boolean(cfg.email?.user && cfg.email?.password),
        enabled: cfg.email?.enabled !== false,
        user: cfg.email?.user ?? "",
        to: cfg.email?.to ?? "",
      },
    },
  });
});

const alertConfigSchema = z.object({
  enabled: z.boolean(),
  aiRcaOnBreach: z.boolean().optional(),
  aiRcaModelId: z.string().optional(),
  rules: z.object({
    memoryPercent: z.number().min(0).max(100),
    queryMemoryGb: z.number().min(0),
    longQueryMin: z.number().min(0),
  }),
  // Blank/omitted secret = keep existing; `remove*` clears the channel.
  slackWebhookUrl: z.string().optional(),
  slackEnabled: z.boolean().optional(),
  removeSlack: z.boolean().optional(),
  googleChatWebhookUrl: z.string().optional(),
  googleChatEnabled: z.boolean().optional(),
  removeGoogleChat: z.boolean().optional(),
  email: z
    .object({ user: z.string(), to: z.string(), password: z.string().optional() })
    .optional(),
  emailEnabled: z.boolean().optional(),
  removeEmail: z.boolean().optional(),
});

fleet.put("/alert-config", zValidator("json", alertConfigSchema), async (c) => {
  if (!requireSuperAdmin(c)) {
    return c.json({ success: false, error: "Super admin required" }, 403);
  }
  const body = c.req.valid("json");
  const existing = loadRawAlertConfig();

  const next: RawAlertConfig = {
    enabled: body.enabled,
    aiRcaOnBreach: body.aiRcaOnBreach ?? existing.aiRcaOnBreach ?? false,
    aiRcaModelId: body.aiRcaModelId ?? existing.aiRcaModelId,
    rules: {
      memoryPercent: body.rules.memoryPercent,
      queryMemoryGb: body.rules.queryMemoryGb,
      longQueryMin: body.rules.longQueryMin,
    },
  };

  // Slack: explicit remove > (new URL | existing URL) carrying the enable flag.
  if (!body.removeSlack) {
    const webhookUrl =
      (body.slackWebhookUrl && body.slackWebhookUrl.trim()) || existing.slack?.webhookUrl;
    if (webhookUrl) {
      next.slack = {
        webhookUrl,
        enabled: body.slackEnabled ?? existing.slack?.enabled ?? true,
      };
    }
  }

  // Google Chat: same precedence as Slack — explicit remove > new URL > existing.
  if (!body.removeGoogleChat) {
    const webhookUrl =
      (body.googleChatWebhookUrl && body.googleChatWebhookUrl.trim()) || existing.googleChat?.webhookUrl;
    if (webhookUrl) {
      next.googleChat = {
        webhookUrl,
        enabled: body.googleChatEnabled ?? existing.googleChat?.enabled ?? true,
      };
    }
  }

  // Email: explicit remove > creds (blank password/fields keep existing) + enable.
  if (!body.removeEmail) {
    const user = body.email?.user?.trim() || existing.email?.user;
    const to = body.email?.to?.trim() || existing.email?.to;
    const password =
      body.email?.password && body.email.password.length
        ? body.email.password
        : existing.email?.password;
    if (user && to) {
      next.email = {
        user,
        to,
        password: password ?? "",
        enabled: body.emailEnabled ?? existing.email?.enabled ?? true,
        ...(existing.email?.host ? { host: existing.email.host } : {}),
        ...(existing.email?.port ? { port: existing.email.port } : {}),
        ...(existing.email?.secure !== undefined ? { secure: existing.email.secure } : {}),
      };
    }
  }

  try {
    writeFileSync(ALERT_CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch (e) {
    logger.error(
      { module: "FleetAlerter", err: e instanceof Error ? e.message : String(e) },
      "Failed to write alert config",
    );
    return c.json({ success: false, error: "Failed to save config" }, 500);
  }
  logger.info({ module: "FleetAlerter", by: getRbacUser(c).sub }, "Alert delivery config updated");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.FLEET_ALERT_CONFIG_UPDATE, getRbacUser(c).sub, {
    resourceType: "fleet_alert_config",
    details: {
      enabled: next.enabled,
      aiRcaOnBreach: next.aiRcaOnBreach,
      rules: next.rules,
      channels: {
        slack: next.slack?.enabled ?? false,
        googleChat: next.googleChat?.enabled ?? false,
        email: next.email?.enabled ?? false,
      },
    },
    status: "success",
  });
  return c.json({ success: true, data: { ok: true } });
});

fleet.post("/alert-config/test", async (c) => {
  if (!requireSuperAdmin(c)) {
    return c.json({ success: false, error: "Super admin required" }, 403);
  }
  try {
    const result = await sendTestAlert();
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json(
      { success: false, error: e instanceof Error ? e.message : "Test failed" },
      400,
    );
  }
});

// ============================================
// ChouseD — AI fleet doctor (agentic health scan). Reading is gated by doctor:view;
// generating a report (scan / schedule) by doctor:run. Uses the configured AI
// provider + read-only system.* tools.
// ============================================

fleet.get("/doctor/enabled", async (c) => {
  return c.json({ success: true, data: { enabled: await isAIEnabled() } });
});

// Available AI models for the Doctor picker (no secrets).
fleet.get("/doctor/models", async (c) => {
  try {
    const { configs } = await listAiConfigs({ activeOnly: true });
    return c.json({
      success: true,
      data: configs.map((cfg) => ({
        id: cfg.id,
        label: cfg.name,
        model: cfg.model?.modelId ?? cfg.model?.name ?? "",
        provider: cfg.provider?.name ?? cfg.provider?.providerType ?? "",
        isDefault: Boolean(cfg.isDefault),
      })),
    });
  } catch {
    return c.json({ success: true, data: [] });
  }
});

const doctorScanSchema = z.object({
  modelId: z.string().optional(),
  connectionIds: z.array(z.string()).optional(),
  hours: z.number().int().min(1).max(72).optional(),
});

fleet.post("/doctor/scan", requirePermission(PERMISSIONS.DOCTOR_RUN), zValidator("json", doctorScanSchema), async (c) => {
  const { modelId, connectionIds, hours } = c.req.valid("json");
  const createdBy = getRbacUser(c).sub;
  try {
    const report = await runStructuredCapability(
      fleetScanCapability,
      { connectionIds, hours },
      { userId: createdBy, modelId },
    );
    // Persist (+ prune to retention) so the report gets its own page and lands
    // in the history rail. Best-effort — never fails the scan response.
    await saveDoctorReport(report, createdBy, "manual");
    await createAuditLogWithContext(c, AUDIT_ACTIONS.DOCTOR_SCAN_RUN, createdBy, {
      resourceType: "doctor_report",
      resourceId: report.id,
      details: { hours, modelId, connectionIds: connectionIds ?? null, trigger: "manual" },
      status: "success",
    });
    return c.json({ success: true, data: { ...report, createdBy, trigger: "manual" } });
  } catch (e) {
    if (e instanceof AppError) throw e;
    logger.error(
      { module: "ChouseDoctor", err: e instanceof Error ? e.message : String(e) },
      "Doctor scan failed",
    );
    return c.json({ success: false, error: e instanceof Error ? e.message : "Scan failed" }, 500);
  }
});

// History of past scans — compact list (no JSON blobs) for the Doctor page rail.
fleet.get("/doctor/reports", async (c) => {
  const reports = await listDoctorReports();
  return c.json({ success: true, data: reports });
});

// One stored report by id — backs its own page at /doctor/:id.
fleet.get("/doctor/reports/:id", async (c) => {
  const r = await getDoctorReport(c.req.param("id"));
  if (!r) {
    return c.json({ success: false, error: "Report not found" }, 404);
  }
  return c.json({
    success: true,
    data: {
      id: r.id,
      analysis: r.analysis,
      raw: r.raw,
      steps: r.steps,
      vitals: r.vitals,
      model: r.model ?? "",
      scannedAt: r.createdAt,
      durationMs: r.durationMs,
      nodes: r.nodeCount,
      createdBy: r.createdBy,
      trigger: r.trigger,
    },
  });
});

// Delete reports — specific ids, or all. (Super-admin not required: any fleet
// viewer manages their own history view; reports carry no secrets.)
const doctorDeleteSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

fleet.post("/doctor/reports/delete", zValidator("json", doctorDeleteSchema), async (c) => {
  const { ids, all } = c.req.valid("json");
  if (all) {
    await deleteAllDoctorReports();
  } else if (ids && ids.length > 0) {
    await deleteDoctorReports(ids);
  }
  if (all || (ids && ids.length > 0)) {
    await createAuditLogWithContext(c, AUDIT_ACTIONS.DOCTOR_REPORT_DELETE, getRbacUser(c).sub, {
      resourceType: "doctor_report",
      details: all ? { all: true } : { ids },
      status: "success",
    });
  }
  return c.json({ success: true, data: { ok: true } });
});

// Scheduled scans (daily / weekly / monthly).
fleet.get("/doctor/schedule", async (c) => {
  return c.json({ success: true, data: loadSchedule() });
});

const doctorScheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  modelId: z.string().optional(),
  hours: z.number().int().min(1).max(744),
  connectionIds: z.array(z.string()).optional(),
  deliver: z.boolean(),
});

fleet.put("/doctor/schedule", requirePermission(PERMISSIONS.DOCTOR_RUN), zValidator("json", doctorScheduleSchema), async (c) => {
  const body = c.req.valid("json");
  // Stamp lastRunAt = now so enabling/editing fires at the NEXT occurrence,
  // not a backfill of a slot that already passed today.
  saveSchedule({ ...body, lastRunAt: Date.now() } as DoctorSchedule);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DOCTOR_SCHEDULE_UPDATE, getRbacUser(c).sub, {
    resourceType: "doctor_schedule",
    details: {
      enabled: body.enabled,
      frequency: body.frequency,
      hour: body.hour,
      deliver: body.deliver,
      hours: body.hours,
      modelId: body.modelId ?? null,
    },
    status: "success",
  });
  return c.json({ success: true, data: { ok: true } });
});

export default fleet;
