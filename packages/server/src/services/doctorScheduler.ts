/**
 * DoctorScheduler — runs a Chouse AI fleet scan on a recurring cadence
 * (daily / weekly / monthly) and saves the report (trigger="scheduled"),
 * optionally delivering it to the configured Slack/email channels.
 *
 * Config is a JSON file (default <data>/doctor-schedule.json, override with
 * DOCTOR_SCHEDULE_FILE), re-read every tick so it's live-editable. `lastRunAt`
 * is written back after each run so a missed/late tick still fires once.
 *
 * Multi-instance: best-effort (it stamps lastRunAt before running). If several
 * replicas share a DB they could double-fire a scheduled scan; single-container
 * is the happy path. Deferred, like the early fleet poller.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { logger } from "../utils/logger";

const SCHEDULE_PATH = process.env.DOCTOR_SCHEDULE_FILE || "/app/data/doctor-schedule.json";

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

export function loadSchedule(): DoctorSchedule {
  let raw: Partial<DoctorSchedule> = {};
  try {
    raw = JSON.parse(readFileSync(SCHEDULE_PATH, "utf8")) as Partial<DoctorSchedule>;
  } catch {
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
    lastRunAt: clampInt(raw.lastRunAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function saveSchedule(next: DoctorSchedule): void {
  writeFileSync(SCHEDULE_PATH, JSON.stringify(next, null, 2));
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
      const cfg = loadSchedule();
      if (!cfg.enabled) return;

      const now = Date.now();
      const fireAt = lastScheduledFireMs(cfg, new Date(now));
      if (cfg.lastRunAt >= fireAt) return; // already ran for this slot

      // Stamp BEFORE the (slow) scan so a re-entry / next tick can't double-fire.
      saveSchedule({ ...cfg, lastRunAt: now });
      logger.info(
        { module: "DoctorScheduler", frequency: cfg.frequency, hours: cfg.hours, model: cfg.modelId ?? "default" },
        "Scheduled scan starting",
      );

      const { runFleetScan } = await import("./chouseDoctor");
      const { saveDoctorReport } = await import("./doctorReports");
      const report = await runFleetScan({
        modelId: cfg.modelId,
        connectionIds: cfg.connectionIds,
        hours: cfg.hours,
      });
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
