/**
 * Seed Scheduled Queries with rich, end-to-end demo data.
 *
 * Generates a broad matrix of jobs — from the most basic `SELECT 1` to complex
 * windowed CTE rollups that materialize back into ClickHouse — plus realistic run
 * history (success / error / running, scheduled + manual, across ~14 days) and a
 * pending failure-alert outbox row, so every Overview KPI, breakdown, top-failing
 * streak, Jobs filter, and Runs drill-down has something to show.
 *
 * Usage:  bun run packages/server/scripts/seed-scheduled-queries.ts
 *
 * NOTE: this is a DEV seed — it WIPES the existing scheduled_query* tables and
 * the demo notification channels (names prefixed "Demo ") before re-seeding, so
 * it is safely re-runnable. It never touches your real connections or users.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { initializeRbac } from "../src/rbac";
import { getDatabase, getDatabaseType, type SqliteDb, type PostgresDb } from "../src/rbac/db";
import { createConnection, listConnections } from "../src/rbac/services/connections";
import { createChannel } from "../src/services/alerting/store";
import { ChannelType } from "../src/services/alerting/types";
import * as store from "../src/services/scheduledQueries/store";
import type { JobInput } from "../src/services/scheduledQueries/store";
import type { SqStatus, SqTrigger } from "../src/services/scheduledQueries/types";
import { logger } from "../src/utils/logger";

// --- low-level dialect-aware helpers ----------------------------------------

async function run(stmt: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(stmt);
    return;
  }
  await (db as PostgresDb).execute(stmt);
}

async function all(stmt: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt) as Array<Record<string, unknown>>;
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Array<Record<string, unknown>>;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// --- job + run spec types ---------------------------------------------------

type RunProfile = "all_success" | "recent_fail" | "recent_error" | "flapping" | "running_now" | "degraded" | "none";

interface JobSpec extends Omit<JobInput, "connectionId"> {
  /** Which seeded connection to bind to ("primary" | "secondary"). */
  conn: "primary" | "secondary";
  /** Demo channel keys to link. */
  channels: string[];
  /** Run-history shape. */
  profile: RunProfile;
  /** Approximate run interval for synthetic history (ms). */
  intervalMs: number;
  /** How many historical runs to generate. */
  runs: number;
}

function base(partial: Partial<JobInput>): JobInput {
  return {
    name: "",
    description: null,
    connectionId: "",
    query: "SELECT 1",
    enabled: true,
    frequency: "daily",
    hour: 8,
    dayOfWeek: 1,
    dayOfMonth: 1,
    cronExpr: null,
    outputMode: "none",
    destDatabase: null,
    destTable: null,
    outputConfig: null,
    maxRows: 100,
    timeoutSecs: 60,
    useFinal: false,
    seqConsistency: false,
    maxAttempts: 2,
    retentionDays: 90,
    ...partial,
  };
}

function spec(conn: "primary" | "secondary", channels: string[], profile: RunProfile, intervalMs: number, runs: number, partial: Partial<JobInput>): JobSpec {
  return { ...base(partial), conn, channels, profile, intervalMs, runs };
}

// --- the scenario matrix ----------------------------------------------------

const JOBS: JobSpec[] = [
  // ─── Very basic ───────────────────────────────────────────────────────────
  spec("primary", [], "all_success", DAY, 10, {
    name: "hello_world",
    description: "The simplest possible scheduled query — a smoke test.",
    query: "SELECT 1",
    frequency: "daily",
    hour: 6,
  }),
  spec("primary", [], "all_success", DAY, 12, {
    name: "table_count",
    description: "Count of tables in the cluster — a trivial health ping.",
    query: "SELECT count() AS tables FROM system.tables",
    frequency: "daily",
    hour: 7,
  }),
  spec("primary", [], "none", DAY, 0, {
    name: "never_run_yet",
    description: "A freshly created job with no run history yet.",
    query: "SELECT now() AS ts",
    frequency: "daily",
    enabled: true,
  }),

  // ─── Cadences ─────────────────────────────────────────────────────────────
  spec("primary", [], "all_success", 7 * DAY, 6, {
    name: "weekly_active_parts",
    description: "Weekly snapshot of active parts.",
    query: "SELECT count() AS parts FROM system.parts WHERE active",
    frequency: "weekly",
    dayOfWeek: 1,
    hour: 9,
  }),
  spec("primary", [], "all_success", 30 * DAY, 3, {
    name: "monthly_disk_usage",
    description: "Monthly total disk usage across tables.",
    query: "SELECT formatReadableSize(sum(bytes_on_disk)) AS used FROM system.parts WHERE active",
    frequency: "monthly",
    dayOfMonth: 1,
    hour: 0,
  }),
  spec("primary", [], "all_success", 15 * 60 * 1000, 20, {
    name: "cron_every_15min_inserts",
    description: "Custom cron — every 15 minutes, counts recent inserts.",
    query: "SELECT count() AS recent FROM system.query_log WHERE type = 'QueryFinish' AND query_kind = 'Insert' AND event_time >= {{slot_start}} AND event_time < {{slot_end}}",
    frequency: "cron",
    cronExpr: "*/15 * * * *",
  }),
  spec("primary", [], "all_success", HOUR, 18, {
    name: "cron_hourly_errors",
    description: "Custom cron — hourly error count over the last hour window.",
    query: "SELECT count() AS errors FROM system.query_log WHERE type = 'ExceptionWhileProcessing' AND event_time >= {{slot_start}} AND event_time < {{slot_end}}",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("primary", [], "all_success", DAY, 8, {
    name: "cron_weekdays_0630",
    description: "Custom cron — weekdays at 06:30 UTC.",
    query: "SELECT count() AS sessions FROM system.query_log WHERE event_date = today() - 1",
    frequency: "cron",
    cronExpr: "30 6 * * 1-5",
  }),
  spec("primary", [], "none", DAY, 0, {
    name: "manual_adhoc_audit",
    description: "Manual-only job — run on demand, never auto-fires.",
    query: "SELECT user, count() AS queries FROM system.query_log WHERE event_date = today() GROUP BY user ORDER BY queries DESC LIMIT 20",
    frequency: "manual",
  }),

  // ─── Failure alerting (channels) ──────────────────────────────────────────
  spec("primary", ["slack"], "degraded", HOUR, 16, {
    name: "errors_last_hour",
    description: "Classic alert — any error rows in the last hour is a problem.",
    query: "SELECT event_time, query_id, exception FROM system.query_log WHERE type = 'ExceptionWhileProcessing' AND event_time >= {{slot_start}} AND event_time < {{slot_end}} ORDER BY event_time DESC",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("primary", ["slack", "email"], "recent_fail", DAY, 14, {
    name: "no_data_loaded_today",
    description: "Freshness alert — fail if the ingest table got NO rows today.",
    query: "SELECT count() AS rows_today FROM system.query_log WHERE event_date = today()",
    frequency: "daily",
    hour: 5,
  }),
  spec("primary", ["slack"], "flapping", HOUR, 18, {
    name: "long_running_queries",
    description: "Alert when more than 5 queries run longer than 30s.",
    query: "SELECT count() AS slow FROM system.processes WHERE elapsed > 30",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("secondary", ["webhook"], "degraded", HOUR, 16, {
    name: "error_ratio_too_high",
    description: "Scalar probe — alert if error ratio crosses 1%.",
    query: "SELECT countIf(type = 'ExceptionWhileProcessing') / greatest(count(), 1) AS ratio FROM system.query_log WHERE event_time >= {{slot_start}} AND event_time < {{slot_end}}",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("primary", ["email"], "all_success", DAY, 12, {
    name: "daily_row_count_guard",
    description: "Guardrail — fail if fewer than 1000 rows landed yesterday.",
    query: "SELECT count() AS c FROM system.query_log WHERE event_date = today() - 1",
    frequency: "daily",
    hour: 4,
  }),

  // ─── Exports / digests ────────────────────────────────────────────────────
  spec("primary", ["slack", "email"], "all_success", DAY, 12, {
    name: "daily_top_queries_digest",
    description: "Export digest — top queries by memory, mailed every morning.",
    query: "SELECT normalized_query_hash, count() AS runs, formatReadableSize(max(memory_usage)) AS peak_mem FROM system.query_log WHERE event_date = today() - 1 AND type = 'QueryFinish' GROUP BY normalized_query_hash ORDER BY runs DESC LIMIT 25",
    frequency: "daily",
    hour: 8,
  }),
  spec("primary", ["webhook"], "all_success", 7 * DAY, 6, {
    name: "weekly_storage_report",
    description: "Weekly storage growth digest pushed to a webhook.",
    query: "SELECT database, formatReadableSize(sum(bytes_on_disk)) AS size FROM system.parts WHERE active GROUP BY database ORDER BY sum(bytes_on_disk) DESC",
    frequency: "weekly",
    dayOfWeek: 1,
    hour: 7,
  }),

  // ─── ClickHouse-semantics toggles ─────────────────────────────────────────
  spec("primary", [], "all_success", DAY, 10, {
    name: "dedup_aware_count_final",
    description: "Uses FINAL so ReplacingMergeTree duplicates aren't double-counted.",
    query: "SELECT count() AS deduped FROM system.tables",
    frequency: "daily",
    hour: 3,
    useFinal: true,
  }),
  spec("primary", [], "all_success", DAY, 10, {
    name: "replica_consistent_read",
    description: "Sequential consistency — read-your-writes on Replicated tables.",
    query: "SELECT count() AS parts FROM system.parts WHERE active",
    frequency: "daily",
    hour: 3,
    seqConsistency: true,
  }),

  // ─── Complex queries ──────────────────────────────────────────────────────
  spec("primary", ["slack"], "degraded", HOUR, 14, {
    name: "p95_latency_by_query_kind",
    description: "Complex aggregate — p95 latency per query kind over the window.",
    query:
      "SELECT query_kind, count() AS n, round(quantile(0.95)(query_duration_ms)) AS p95_ms, round(avg(query_duration_ms)) AS avg_ms FROM system.query_log WHERE type = 'QueryFinish' AND event_time >= {{slot_start}} AND event_time < {{slot_end}} GROUP BY query_kind ORDER BY p95_ms DESC",
    frequency: "cron",
    cronExpr: "0 * * * *",
    maxRows: 200,
  }),
  spec("secondary", [], "all_success", DAY, 11, {
    name: "cte_user_activity_cohorts",
    description: "Complex CTE — daily active users bucketed by query volume.",
    query:
      "WITH per_user AS (SELECT user, count() AS q FROM system.query_log WHERE event_date = today() - 1 GROUP BY user) SELECT multiIf(q >= 1000, 'heavy', q >= 100, 'medium', 'light') AS cohort, count() AS users, sum(q) AS total_queries FROM per_user GROUP BY cohort ORDER BY total_queries DESC",
    frequency: "daily",
    hour: 2,
    maxRows: 500,
  }),

  // ─── Materialize: append / replace / upsert (write-back) ──────────────────
  spec("primary", ["slack"], "all_success", DAY, 12, {
    name: "rollup_daily_query_stats_append",
    description: "Materialize APPEND — incremental daily rollup into analytics.daily_query_stats.",
    query:
      "SELECT toDate({{slot_start}}) AS day, query_kind, count() AS queries, round(avg(query_duration_ms)) AS avg_ms FROM system.query_log WHERE type = 'QueryFinish' AND event_time >= {{slot_start}} AND event_time < {{slot_end}} GROUP BY day, query_kind",
    frequency: "daily",
    hour: 1,
    outputMode: "append",
    destDatabase: "analytics",
    destTable: "daily_query_stats",
    outputConfig: { createIfMissing: true, engine: "MergeTree", orderBy: "(day, query_kind)", partitionBy: "toYYYYMM(day)" },
  }),
  spec("primary", ["email"], "all_success", DAY, 12, {
    name: "rollup_daily_errors_replace",
    description: "Materialize REPLACE PARTITION — atomically overwrite the day's partition.",
    query:
      "SELECT toDate({{slot_start}}) AS day, exception_code, count() AS errors FROM system.query_log WHERE type = 'ExceptionWhileProcessing' AND event_time >= {{slot_start}} AND event_time < {{slot_end}} GROUP BY day, exception_code",
    frequency: "daily",
    hour: 1,
    outputMode: "replace",
    destDatabase: "analytics",
    destTable: "daily_errors",
    outputConfig: { partitionExpr: "toYYYYMMDD({{slot_end}})", createIfMissing: true, engine: "MergeTree", orderBy: "(day, exception_code)", partitionBy: "toYYYYMMDD(day)" },
  }),
  spec("primary", [], "recent_error", DAY, 10, {
    name: "upsert_latest_user_state",
    description: "Materialize UPSERT — latest-per-user state into a ReplacingMergeTree.",
    query:
      "SELECT user, max(event_time) AS last_seen, count() AS lifetime_queries FROM system.query_log WHERE event_time < {{slot_end}} GROUP BY user",
    frequency: "daily",
    hour: 1,
    outputMode: "upsert",
    destDatabase: "analytics",
    destTable: "user_state",
    outputConfig: { createIfMissing: true, engine: "ReplacingMergeTree(last_seen)", orderBy: "user" },
  }),

  // ─── Failure / edge states for the dashboards ─────────────────────────────
  spec("secondary", ["slack", "email"], "recent_error", HOUR, 14, {
    name: "schema_drift_demo",
    description: "Errors out repeatedly — exercises the error KPI and reaper messages.",
    query: "SELECT col_that_was_dropped, count() FROM system.query_log GROUP BY col_that_was_dropped",
    frequency: "cron",
    cronExpr: "0 * * * *",
    timeoutSecs: 30,
  }),
  spec("secondary", ["slack"], "running_now", HOUR, 9, {
    name: "currently_running_demo",
    description: "Has an in-flight run right now — exercises the 'running' state.",
    query: "SELECT count() AS n FROM system.numbers LIMIT 1",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("primary", ["slack"], "flapping", HOUR, 20, {
    name: "flapping_capacity_check",
    description: "Alternates pass/fail — exercises transition-based alerting + recovery.",
    query: "SELECT value AS conns FROM system.metrics WHERE metric = 'TCPConnection'",
    frequency: "cron",
    cronExpr: "0 * * * *",
  }),
  spec("primary", [], "all_success", DAY, 10, {
    name: "disabled_legacy_job",
    description: "A disabled job — should never auto-fire, shown greyed out.",
    query: "SELECT count() FROM system.tables",
    frequency: "daily",
    hour: 12,
    enabled: false,
  }),
  spec("primary", [], "all_success", DAY, 8, {
    name: "wide_result_truncated_demo",
    description: "Returns more rows than max_rows — exercises the truncation flag.",
    query: "SELECT number FROM system.numbers LIMIT 5000",
    frequency: "daily",
    hour: 11,
    maxRows: 50,
  }),
];

// --- run-history synthesis --------------------------------------------------

const DEMO_CHANNEL_PREFIX = "Demo ";

/**
 * Failure-based run status: a run is `success` or `error` (execution failure);
 * `running` marks an in-flight run. No condition-based `failed`.
 */
function statusForIndex(profile: RunProfile, i: number, _total: number): SqStatus {
  switch (profile) {
    case "all_success":
      return "success";
    case "recent_fail":
      return i < 3 ? "error" : "success";
    case "recent_error":
      return i < 2 ? "error" : "success";
    case "flapping":
      return i % 2 === 0 ? "error" : "success";
    case "running_now":
      return i === 0 ? "running" : "success";
    case "degraded":
      return i < 6 && i % 2 === 0 ? "error" : "success";
    default:
      return "success";
  }
}

function snapshotFor(job: JobSpec, status: SqStatus, slotAt: number): { resultJson: string; rowCount: number; writtenRows: number | null; truncated: boolean } {
  const win = {
    slot_start: new Date(slotAt - job.intervalMs).toISOString().replace("T", " ").replace("Z", ""),
    slot_end: new Date(slotAt).toISOString().replace("T", " ").replace("Z", ""),
  };

  // Materialize jobs record a write summary instead of a row snapshot.
  if (job.outputMode !== "none") {
    const written = status === "success" ? 50 + Math.floor(Math.random() * 5000) : 0;
    const resultJson = JSON.stringify({ mode: job.outputMode, dest: `${job.destDatabase}.${job.destTable}`, writtenRows: written, window: win });
    return { resultJson, rowCount: written, writtenRows: written, truncated: false };
  }

  // Read-only jobs: synth a small, plausible row snapshot.
  const rowCount = Math.floor(Math.random() * 200);
  const cap = job.maxRows;
  const truncated = job.name.includes("truncated") && rowCount > cap;
  const snapRows = Array.from({ length: Math.min(rowCount, Math.min(cap, 5)) }, (_, k) => ({ value: rowCount + k }));
  const resultJson = JSON.stringify({
    columns: [{ name: "value", type: "UInt64" }],
    rows: snapRows,
    window: { ...win, prev_run_at: win.slot_start },
  });
  return { resultJson, rowCount, writtenRows: null, truncated };
}

const ERROR_MESSAGES = [
  "Code: 47. DB::Exception: Missing columns: 'col_that_was_dropped'",
  "reaped: runner lost (deadline exceeded)",
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 30.1 seconds",
  "Code: 210. DB::NetException: Connection refused",
];

async function seedRuns(jobId: string, job: JobSpec): Promise<number | null> {
  if (job.profile === "none" || job.runs === 0) return null;
  const now = Date.now();
  // Anchor most recent slot a little in the past so it doesn't look "due".
  let latestSlot: number | null = null;

  for (let i = 0; i < job.runs; i++) {
    const slotAt = now - i * job.intervalMs - 5 * 60 * 1000;
    if (i === 0) latestSlot = slotAt;
    const status = statusForIndex(job.profile, i, job.runs);
    const trigger: SqTrigger = i === 1 && job.frequency !== "manual" ? "scheduled" : "scheduled";
    const startedAt = slotAt + Math.floor(Math.random() * 2000);
    const durationMs = 200 + Math.floor(Math.random() * 8000);
    const runId = randomUUID();

    if (status === "running") {
      // In-flight: no finish, deadline in the future.
      await store.insertRun({
        id: runId,
        queryId: jobId,
        trigger,
        slotAt,
        attempt: 1,
        runnerId: "seed",
        deadline: now + 2 * job.timeoutSecs * 1000,
        startedAt: now - 30 * 1000,
      });
      continue;
    }

    const snap = status === "error" ? null : snapshotFor(job, status, slotAt);
    const message = status === "error" ? ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)] : null;
    const attempt = status === "error" ? 1 + Math.floor(Math.random() * 2) : 1;

    await run(sql`
      INSERT INTO scheduled_query_runs
        (id, query_id, trigger, status, slot_at, attempt, runner_id, deadline, row_count, truncated, written_rows, result_json, condition_value, condition_met, duration_ms, message, notified, started_at, finished_at)
      VALUES (
        ${runId}, ${jobId}, ${trigger}, ${status}, ${slotAt}, ${attempt}, 'seed', ${startedAt + durationMs * 2},
        ${snap?.rowCount ?? null}, ${snap?.truncated ? 1 : 0}, ${snap?.writtenRows ?? null}, ${snap?.resultJson ?? null},
        NULL, NULL,
        ${durationMs}, ${message}, ${i === 0 && status === "error" ? 1 : 0},
        ${startedAt}, ${startedAt + durationMs}
      )
    `);
  }

  // A couple of jobs also get a manual run in their history.
  if (job.profile !== "none" && (job.name === "manual_adhoc_audit" || job.name === "errors_last_hour")) {
    const slotAt = now - 90 * 60 * 1000;
    const snap = snapshotFor(job, "success", slotAt);
    await run(sql`
      INSERT INTO scheduled_query_runs
        (id, query_id, trigger, status, slot_at, attempt, runner_id, deadline, row_count, truncated, written_rows, result_json, condition_value, condition_met, duration_ms, message, notified, started_at, finished_at)
      VALUES (${randomUUID()}, ${jobId}, 'manual', 'success', ${slotAt}, 1, 'seed', ${slotAt + 60000}, ${snap.rowCount}, 0, NULL, ${snap.resultJson}, NULL, NULL, 1234, NULL, 0, ${slotAt}, ${slotAt + 1234})
    `);
  }

  return latestSlot;
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info({ module: "seed" }, "Initializing RBAC + DB…");
  await initializeRbac();

  // 1. Admin user (for created_by audit).
  const adminEmail = process.env.RBAC_ADMIN_EMAIL || "admin@localhost";
  const adminRows = await all(sql`SELECT id FROM rbac_users WHERE email = ${adminEmail} LIMIT 1`);
  const adminId = adminRows[0] ? String(adminRows[0].id) : null;

  // 2. Connections — reuse the first existing one as "primary"; create demo ones if needed.
  const { connections: existing } = await listConnections();
  let primaryId: string;
  if (existing.length > 0) {
    primaryId = existing[0].id;
    logger.info({ module: "seed", connection: existing[0].name }, "Reusing existing connection as primary");
  } else {
    const created = await createConnection(
      { name: "Demo ClickHouse", host: "localhost", port: 8123, username: "default", password: "", database: "default" },
      adminId ?? undefined,
    );
    primaryId = created.id;
    logger.info({ module: "seed" }, "Created demo primary connection");
  }
  // Secondary — always a demo connection so multi-connection scenarios show.
  const demoSecondary = existing.find((c) => c.name === "Demo Secondary CH");
  const secondaryId = demoSecondary
    ? demoSecondary.id
    : (await createConnection({ name: "Demo Secondary CH", host: "ch-replica", port: 8123, username: "readonly", password: "", database: "default" }, adminId ?? undefined)).id;

  // 3. Wipe previous demo data (re-runnable).
  logger.info({ module: "seed" }, "Wiping existing scheduled_query* data + demo channels…");
  await run(sql`DELETE FROM scheduled_query_outbox`);
  await run(sql`DELETE FROM scheduled_query_runs`);
  await run(sql`DELETE FROM scheduled_query_channels`);
  await run(sql`DELETE FROM scheduled_queries`);
  const demoChannels = await all(sql`SELECT id FROM notification_channels WHERE name LIKE ${`${DEMO_CHANNEL_PREFIX}%`}`);
  for (const ch of demoChannels) {
    await run(sql`DELETE FROM scheduled_query_channels WHERE channel_id = ${String(ch.id)}`);
    await run(sql`DELETE FROM notification_channels WHERE id = ${String(ch.id)}`);
  }

  // 4. Demo notification channels.
  const channelIds: Record<string, string> = {};
  channelIds.slack = await createChannel({ name: "Demo Slack #alerts", type: ChannelType.Slack, config: { webhookUrl: "https://hooks.slack.com/services/DEMO/DEMO/DEMO" }, enabled: true }, adminId ?? undefined);
  channelIds.email = await createChannel({ name: "Demo Email oncall", type: ChannelType.Email, config: { host: "smtp.example.com", port: 587, secure: false, user: "oncall@example.com", password: "demo", from: "chouse@example.com", to: "oncall@example.com" }, enabled: true }, adminId ?? undefined);
  channelIds.webhook = await createChannel({ name: "Demo Webhook PagerDuty", type: ChannelType.Webhook, config: { url: "https://events.pagerduty.com/demo", secret: "demo-secret" }, enabled: true }, adminId ?? undefined);

  // 5. Seed jobs + run history.
  let jobCount = 0;
  let runCount = 0;
  for (const job of JOBS) {
    const { conn, channels, profile, intervalMs, runs, ...jobInput } = job;
    void profile; void intervalMs; void runs; void channels;
    const input: JobInput = { ...jobInput, connectionId: conn === "primary" ? primaryId : secondaryId };
    const id = await store.createJob(input, adminId);
    const links = job.channels.map((k) => channelIds[k]).filter(Boolean);
    if (links.length > 0) await store.setJobChannels(id, links);

    const latestSlot = await seedRuns(id, job);
    runCount += job.runs;
    // Set the lease so an enabled scheduled job doesn't look immediately "due".
    if (latestSlot && job.enabled && job.frequency !== "manual") {
      await run(sql`UPDATE scheduled_queries SET last_run_at = ${latestSlot} WHERE id = ${id}`);
    }
    jobCount++;

    // 6. Seed a couple of PENDING outbox rows for one alerting job so the
    //    delivery pass + Runs show something to send.
    if (job.name === "errors_last_hour" && links.length > 0) {
      const recentRun = await all(sql`SELECT id FROM scheduled_query_runs WHERE query_id = ${id} AND status IN ('failed','error') ORDER BY started_at DESC LIMIT 1`);
      if (recentRun[0]) {
        const runId = String(recentRun[0].id);
        await run(sql`
          INSERT INTO scheduled_query_outbox (id, run_id, query_id, kind, dedup_key, payload, status, attempts, created_at)
          VALUES (${randomUUID()}, ${runId}, ${id}, 'alert', ${`${runId}:alert`},
            ${JSON.stringify({ title: `🔴 Scheduled Query alert — ${job.name}`, text: "Condition rows_returned matched (42 rows). Window 09:00..10:00 UTC.", channelIds: links })},
            'pending', 0, ${Date.now()})
        `);
      }
    }
  }

  logger.info({ module: "seed", jobs: jobCount, runs: runCount, channels: Object.keys(channelIds).length }, "✅ Seed complete");
  // eslint-disable-next-line no-console
  console.log(`\n✅ Seeded ${jobCount} scheduled queries (~${runCount} runs) across ${Object.keys(channelIds).length} demo channels and 2 connections.\n`);
  process.exit(0);
}

main().catch((err) => {
  logger.error({ module: "seed", err: err instanceof Error ? err.message : String(err) }, "Seed failed");
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
