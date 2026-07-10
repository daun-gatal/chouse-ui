/**
 * DoctorScheduler — runs a Chouse AI fleet scan on a recurring cadence
 * (daily / weekly / monthly) and saves the report (trigger="scheduled"),
 * optionally delivering it to the configured Slack/email channels.
 *
 * Config + run-state live in the shared RBAC DB (single-row doctor_schedule,
 * id=1), re-read every tick so it's live-editable. `last_run_at` is written
 * back after each run so a missed/late tick still fires once.
 *
 * Multi-instance: safe. The per-slot claim (claimSlot) is one atomic
 * conditional UPDATE on last_run_at — the row itself is the lease, mirroring
 * the fleet-poller pattern. With N replicas only the one whose UPDATE flips the
 * row for a given slot runs the scan; the rest see the slot already taken.
 *
 * Backward compat: migration 1.37.0 imports an existing doctor-schedule.json
 * (including its lastRunAt) into the seed row on first run.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import { logger } from "../utils/logger";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export interface DoctorSchedule {
  enabled: boolean;
  frequency: ScheduleFrequency;
  hour: number; // 0-23, UTC
  dayOfWeek: number; // 0 (Sun) - 6 (Sat), for weekly
  dayOfMonth: number; // 1-28, for monthly
  modelId?: string; // AI config id (undefined = default)
  hours: number; // scan window (lookback), 1-72
  connectionIds?: string[]; // node subset (empty/undefined = all)
  deliver: boolean; // also send the report to Slack/email
  lastRunAt: number; // unix ms
}

const DEFAULTS: DoctorSchedule = {
  enabled: false,
  frequency: "daily",
  hour: 8,
  dayOfWeek: 1,
  dayOfMonth: 1,
  hours: 6,
  deliver: true,
  lastRunAt: 0,
};

function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Read the single config row (id=1) — config blob + last_run_at column. */
async function selectScheduleRow(): Promise<Record<string, unknown> | undefined> {
  const db = getDatabase();
  const stmt = sql`SELECT config, last_run_at FROM doctor_schedule WHERE id = 1 LIMIT 1`;
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt)[0] as Record<string, unknown> | undefined;
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  const rows = (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Record<string, unknown>[];
  return rows[0];
}

/**
 * Load the schedule from the DB. The schedule fields live in the `config` JSON
 * blob; `lastRunAt` is the dedicated last_run_at column (it's the atomic claim
 * guard). Falls back to DEFAULTS when no row exists or the blob is unparseable.
 */
export async function loadSchedule(): Promise<DoctorSchedule> {
  let raw: Partial<DoctorSchedule> = {};
  let lastRunAt = 0;
  try {
    const row = await selectScheduleRow();
    lastRunAt = num(row?.last_run_at);
    const cfg = row?.config;
    if (typeof cfg === "string" && cfg.length > 0) {
      raw = JSON.parse(cfg) as Partial<DoctorSchedule>;
    }
  } catch (err) {
    logger.error(
      { module: "DoctorScheduler", err: err instanceof Error ? err.message : String(err) },
      "Failed to load schedule",
    );
    return { ...DEFAULTS };
  }
  const frequency: ScheduleFrequency =
    raw.frequency === "weekly" || raw.frequency === "monthly" ? raw.frequency : "daily";
  return {
    enabled: raw.enabled === true,
    frequency,
    hour: clampInt(raw.hour, 0, 23, DEFAULTS.hour),
    dayOfWeek: clampInt(raw.dayOfWeek, 0, 6, DEFAULTS.dayOfWeek),
    dayOfMonth: clampInt(raw.dayOfMonth, 1, 28, DEFAULTS.dayOfMonth),
    modelId: typeof raw.modelId === "string" && raw.modelId ? raw.modelId : undefined,
    hours: clampInt(raw.hours, 1, 72, DEFAULTS.hours),
    connectionIds: Array.isArray(raw.connectionIds) ? raw.connectionIds.map(String) : undefined,
    deliver: raw.deliver !== false,
    lastRunAt: clampInt(lastRunAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/**
 * Persist the schedule. The schedule fields go into the `config` blob and
 * `lastRunAt` into its own column. The row (id=1) is seeded by migration
 * 1.37.0; the INSERT fallback covers a missing row so a save never no-ops.
 */
export async function saveSchedule(next: DoctorSchedule): Promise<void> {
  const db = getDatabase();
  const dbType = getDatabaseType();
  const { lastRunAt, ...config } = next;
  const json = JSON.stringify(config);
  if (dbType === "sqlite") {
    (db as SqliteDb).run(sql`
      INSERT INTO doctor_schedule (id, config, last_run_at)
      VALUES (1, ${json}, ${lastRunAt})
      ON CONFLICT (id) DO UPDATE SET config = excluded.config, last_run_at = excluded.last_run_at
    `);
  } else {
    await (db as PostgresDb).execute(sql`
      INSERT INTO doctor_schedule (id, config, last_run_at)
      VALUES (1, ${json}, ${lastRunAt})
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, last_run_at = EXCLUDED.last_run_at
    `);
  }
}

/**
 * Atomically claim the scheduled slot for `fireAt`. Returns true if THIS call
 * performed the claim (and the caller should run the scan), false if the slot
 * was already taken. One conditional UPDATE flips last_run_at→now and stamps
 * last_run_by; the WHERE (last_run_at < fireAt) means only the first writer
 * across all replicas matches a row. We key off the affected-row count (1 = we
 * won, 0 = someone else already had it) rather than reading the holder back, so
 * the result is correct even when the same holder retries. Race-safe like the
 * fleet-poller lease: SQLite serializes writes; Postgres row-locks and
 * re-evaluates the WHERE under READ COMMITTED.
 */
export async function claimScheduledSlot(holderId: string, fireAt: number, now: number): Promise<boolean> {
  const db = getDatabase();
  const dbType = getDatabaseType();
  const claim = sql`
    UPDATE doctor_schedule
    SET last_run_at = ${now}, last_run_by = ${holderId}
    WHERE id = 1 AND last_run_at < ${fireAt}
  `;
  if (dbType === "sqlite") {
    const res = (db as SqliteDb).run(claim) as unknown as { changes?: number };
    return (res?.changes ?? 0) > 0;
  }
  // postgres-js exposes affected rows as `.count` on the result.
  const res = (await (db as PostgresDb).execute(claim)) as unknown as { count?: number };
  return (res?.count ?? 0) > 0;
}

/** Unix ms of the most recent moment the schedule should have fired, <= now. */
function lastScheduledFireMs(cfg: DoctorSchedule, now: Date): number {
  const d = new Date(now);
  d.setUTCHours(cfg.hour, 0, 0, 0);

  if (cfg.frequency === "daily") {
    if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 1);
    return d.getTime();
  }
  if (cfg.frequency === "weekly") {
    const diff = (d.getUTCDay() - cfg.dayOfWeek + 7) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 7);
    return d.getTime();
  }
  // monthly
  d.setUTCDate(cfg.dayOfMonth);
  if (d.getTime() > now.getTime()) d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime();
}

const CHECK_INTERVAL_MS = 60_000;

class DoctorScheduler {
  private static instance: DoctorScheduler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly runId = randomUUID();

  static getInstance(): DoctorScheduler {
    if (!DoctorScheduler.instance) DoctorScheduler.instance = new DoctorScheduler();
    return DoctorScheduler.instance;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
    logger.info({ module: "DoctorScheduler" }, "Doctor scheduler started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cfg = await loadSchedule();
      if (!cfg.enabled) return;

      const now = Date.now();
      const fireAt = lastScheduledFireMs(cfg, new Date(now));
      if (cfg.lastRunAt >= fireAt) return; // already ran for this slot (fast path)

      // Atomically claim the slot BEFORE the (slow) scan: this both prevents a
      // re-entry / next tick from double-firing AND ensures only one replica
      // fires when several share the DB. Lost the race → another pod has it.
      if (!(await claimScheduledSlot(this.runId, fireAt, now))) {
        logger.debug(
          { module: "DoctorScheduler", runId: this.runId },
          "Scheduled slot already claimed by another instance; standing by",
        );
        return;
      }
      logger.info(
        { module: "DoctorScheduler", frequency: cfg.frequency, hours: cfg.hours, model: cfg.modelId ?? "default" },
        "Scheduled scan starting",
      );

      const { runStructuredCapability } = await import("./ai/engine");
      const { fleetScanCapability } = await import("./ai/capabilities/fleetScan");
      const { saveDoctorReport } = await import("./doctorReports");
      const report = await runStructuredCapability(
        fleetScanCapability,
        { connectionIds: cfg.connectionIds, hours: cfg.hours },
        { modelId: cfg.modelId },
      );
      await saveDoctorReport(report, null, "scheduled");

      if (cfg.deliver) {
        const { deliverDoctorReport } = await import("./fleetAlerter");
        await deliverDoctorReport(report, `Scheduled ${cfg.frequency} scan`);
      }
      logger.info(
        { module: "DoctorScheduler", reportId: report.id, status: report.analysis?.verdict.status },
        "Scheduled scan complete",
      );
    } catch (err) {
      logger.error(
        { module: "DoctorScheduler", err: err instanceof Error ? err.message : String(err) },
        "Scheduled scan failed",
      );
    } finally {
      this.running = false;
    }
  }
}

export { DoctorScheduler };
