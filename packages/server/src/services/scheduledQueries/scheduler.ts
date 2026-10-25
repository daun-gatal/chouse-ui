/**
 * Scheduled Queries scheduler — in-process singleton tick (every 60s) that runs
 * the reaper, the outbox delivery pass, then claims due slots per-job with an
 * atomic lease and runs them under bounded concurrency, then prunes old runs.
 * Correct under N replicas with no leader election (the job row is the lease).
 * Crash-only: recovery never depends on graceful shutdown. See ADR 0002 (D5–D7,
 * D11).
 */

import { recordEvent } from "../alerting/store";
import { AlertSeverity } from "../alerting/types";
import { notifyChannelIds, type NotifyFeature, type NotifyMessage } from "../alerting/notify";
import type { NotifyButton, NotifyLink, NotifySeverity } from "../alerting/notify/types";
import type { ScheduledQueryOutboxRow } from "./types";
import { logger } from "../../utils/logger";
import { clientForConnection } from "./chClient";
import * as store from "./store";
import { listExpiredWatches } from "../dataHealth/store";
import { lastScheduledFireMs } from "./cadence";
import * as runner from "./runner";

const TICK_INTERVAL_MS = 60_000;
const MAX_CONCURRENCY = 4;
const OUTBOX_BATCH = 20;
const OUTBOX_LEASE_TTL_MS = 5 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 5;

/** Optional extras an outbox row carries for the notify layer (Data Health alerts). */
interface OutboxNotify {
  subjectId?: string;
  severity?: NotifySeverity;
  buttons?: NotifyButton[];
  links?: NotifyLink[];
}

export class ScheduledQueryScheduler {
  private static instance: ScheduledQueryScheduler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private runningSince = 0;
  private stopped = false;

  static getInstance(): ScheduledQueryScheduler {
    if (!ScheduledQueryScheduler.instance) {
      ScheduledQueryScheduler.instance = new ScheduledQueryScheduler();
    }
    return ScheduledQueryScheduler.instance;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    logger.info({ module: "ScheduledQueries", runnerId: runner.RUNNER_ID }, "Scheduler started (tick=60s)");
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
    // Kick an immediate tick so a restart recovers orphaned runs promptly.
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info({ module: "ScheduledQueries" }, "Scheduler stopped");
  }

  /** One scheduler pass. Guarded by the `running` flag (skip if already running). */
  async tick(): Promise<void> {
    if (this.running) {
      // Watchdog: if a tick has been wedged longer than any plausible run, reset.
      if (this.runningSince > 0 && Date.now() - this.runningSince > 30 * 60 * 1000) {
        logger.error({ module: "ScheduledQueries" }, "Tick wedged >30m — resetting running flag");
        this.running = false;
      } else {
        return;
      }
    }
    if (this.stopped) return;
    this.running = true;
    this.runningSince = Date.now();
    try {
      await this.reaperPass();
      await this.outboxDeliverPass();
      await this.expireWatchesPass();
      await this.claimAndRunPass();
      await store.pruneOldRuns();
    } catch (err) {
      logger.error({ module: "ScheduledQueries", err: err instanceof Error ? err.message : String(err) }, "Scheduler tick failed");
    } finally {
      this.running = false;
      this.runningSince = 0;
    }
  }

  // --- reaper (D6) ----------------------------------------------------------

  private async reaperPass(): Promise<void> {
    const now = Date.now();
    const reaped = await store.reapOrphanedRuns(now);
    for (const r of reaped) {
      await this.killQuery(r.queryId, r.id);
      // Manual runs are never auto-retried (their slot_at is unique).
      if (r.trigger !== "scheduled") continue;
      const job = await store.getJob(r.queryId);
      if (!job) continue;
      const attempts = await store.countRunsForSlot(r.queryId, r.slotAt);
      if (attempts < job.maxAttempts) {
        await store.reopenSlot(r.queryId, r.slotAt);
      }
    }
    if (reaped.length > 0) {
      logger.warn({ module: "ScheduledQueries", count: reaped.length }, "Reaped orphaned runs");
    }
  }

  private async killQuery(jobId: string, runId: string): Promise<void> {
    try {
      const job = await store.getJob(jobId);
      if (!job) return;
      // Attribute the reaper's KILL to the job OWNER in query_log (not the bare
      // ClickHouse user). A distinct `source` keeps the KILL's own query_id from
      // being counted as a run by the lineage observation query.
      const logComment = JSON.stringify({ rbac_user_id: job.createdBy ?? null, source: "scheduled_query_kill", job_id: job.id });
      const client = await clientForConnection(job.connectionId, logComment);
      await client.command({ query: `KILL QUERY WHERE query_id = {qid:String}`, query_params: { qid: runId } });
    } catch {
      /* best-effort */
    }
  }

  // --- watches (ADR 0025) ----------------------------------------------------

  /**
   * Remove watches whose time is up, before they could run again. Deleting the
   * execution job cascades to the promise, its checks and incidents; another
   * replica deleting the same watch first makes this a no-op.
   */
  async expireWatchesPass(now: number = Date.now()): Promise<number> {
    const expired = await listExpiredWatches(now);
    for (const watch of expired) await store.deleteJob(watch.scheduledQueryId);
    if (expired.length > 0) {
      logger.info({ module: "ScheduledQueries", count: expired.length, ids: expired.map((w) => w.id) }, "Removed expired watches");
    }
    return expired.length;
  }

  // --- claim + run (D5) -----------------------------------------------------

  private async claimAndRunPass(): Promise<void> {
    const now = Date.now();
    const jobs = await store.listEnabledJobs();
    const due: Array<{ job: typeof jobs[number]; fireAt: number }> = [];
    for (const job of jobs) {
      if (job.frequency === "manual" || job.frequency === "event") continue;
      const fireAt = lastScheduledFireMs(job, now);
      if (fireAt == null) continue;
      if (job.lastRunAt >= fireAt) continue; // slot already ran
      due.push({ job, fireAt });
    }

    // Bounded concurrency across the due set.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, due.length) }, async () => {
      while (cursor < due.length && !this.stopped) {
        const item = due[cursor++];
        try {
          const won = await store.claimSlot(item.job.id, item.fireAt, now, runner.RUNNER_ID);
          if (!won) continue; // another pod/tick took it
          const attempt = (await store.countRunsForSlot(item.job.id, item.fireAt)) + 1;
          await runner.execute(item.job, { trigger: "scheduled", slotAt: item.fireAt, attempt });
        } catch (err) {
          logger.error(
            { module: "ScheduledQueries", jobId: item.job.id, err: err instanceof Error ? err.message : String(err) },
            "Scheduled job execution failed",
          );
        }
      }
    });
    await Promise.all(workers);
  }

  // --- outbox delivery (D7) -------------------------------------------------

  private async outboxDeliverPass(): Promise<void> {
    await store.reapStuckSending(Date.now() - OUTBOX_LEASE_TTL_MS);
    const pending = await store.listClaimableOutbox(OUTBOX_BATCH);
    for (const row of pending) {
      if (this.stopped) break;
      if (row.attempts >= OUTBOX_MAX_ATTEMPTS) continue; // leave for inspection
      const claimed = await store.claimOutboxRow(row.id, runner.RUNNER_ID, Date.now());
      if (!claimed) continue;
      try {
        await this.deliverOutboxRow(row);
        await store.markOutboxSent(row.id, Date.now());
      } catch (err) {
        logger.warn(
          { module: "ScheduledQueries", outboxId: row.id, err: err instanceof Error ? err.message : String(err) },
          "Outbox delivery failed (will retry)",
        );
        await store.markOutboxFailed(row.id);
      }
    }
  }

  /**
   * Send one outbox row through the notify layer. The row id is the message's
   * subject, so a retry only reaches the channels that did not get it yet.
   * Throws when a channel failed to deliver (the row is retried); a missing or
   * disabled channel is skipped.
   */
  private async deliverOutboxRow(row: ScheduledQueryOutboxRow): Promise<void> {
    const payload = JSON.parse(row.payload) as { title: string; text: string; channelIds: string[]; notify?: OutboxNotify };
    const source: NotifyFeature = row.dedupKey.startsWith("data-health:") ? "data_health" : "scheduled_query";
    const extra = payload.notify ?? {};
    const message: NotifyMessage = { title: payload.title, text: payload.text, severity: extra.severity, buttons: extra.buttons, links: extra.links };
    // A message about a subject (a Data Health incident) is keyed by it, so it can be updated when the incident changes.
    const key = extra.subjectId ? { feature: source, subjectId: extra.subjectId, kind: row.id } : { feature: source, subjectId: row.id };
    const result = await notifyChannelIds(payload.channelIds ?? [], message, key);
    const errors = result.failed.filter((f) => f.reason === "error");
    const lastAttempt = row.attempts + 1 >= OUTBOX_MAX_ATTEMPTS;
    if (errors.length === 0 || lastAttempt) {
      await recordEvent({
        ruleId: row.queryId,
        severity: row.kind === "recovery" ? AlertSeverity.Info : AlertSeverity.Warning,
        payload: JSON.stringify({ source, title: payload.title, text: payload.text, failed: result.failed.map((f) => ({ channelId: f.channelId, error: f.error })) }),
        deliveredTo: result.deliveredTo,
        source,
        channelIds: result.channelIds,
        deliveryFailed: result.failed.length > 0,
      }).catch((err) => logger.error({ module: "ScheduledQueries", err: String(err) }, "Failed to record alert event"));
    }
    if (errors.length > 0) throw new Error(errors.map((f) => `${f.name ?? f.channelId}: ${f.error}`).join("; "));
  }
}
