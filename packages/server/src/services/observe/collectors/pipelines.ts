/**
 * `pipelines` collector (ADR 0016 §4): runs every source adapter, stores the
 * normalized samples, classifies each pipeline with the shared vocabulary and
 * opens / recovers pipeline incidents when a pipeline upstream of an important
 * table goes bad.
 */

import { sql, type SQL } from "drizzle-orm";

import { logger } from "../../../utils/logger";
import { nextFireTimes, type CadenceSpec } from "../../scheduledQueries/cadence";
import { isFrequency } from "../../scheduledQueries/types";
import { MIN_CADENCE_SAMPLES } from "../baselines";
import { selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, json, num, numOrNull, runBatch, str, strOrNull, type Row } from "../db";
import { classifyPipeline, STATUS_SEVERITY, type PipelineSample, type PipelineStatus } from "../pipelineStatus";
import { median } from "../stats";
import {
  asyncInserts,
  buffers,
  databaseReplication,
  dictionaries,
  distributed,
  externalTables,
  materializedViews,
  objectStorageQueues,
  queueEngines,
  refreshableViews,
  viewStats,
  writers,
  type AdapterContext,
  type AdapterResult,
  type CatalogTable,
  type PipelineDef,
} from "../adapters";
import { openOrUpdateIncident, recoverIncident, recoverIncidentsExcept, updateActiveIncident } from "../incidents";

const MAX_WINDOW_MS = 15 * 60 * 1000;
export const BAD_STATUSES: PipelineStatus[] = ["retrying", "stalled", "failing", "stopped"];
/** How long a pipeline must stay bad before it opens an incident (OBSERVE_INCIDENT_HOLD_SECONDS, default 5 min). */
export function incidentHoldMs(): number {
  const seconds = Number(process.env.OBSERVE_INCIDENT_HOLD_SECONDS ?? 300);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 300_000;
}

export type IncidentAction = "none" | "open" | "update" | "recover";

/**
 * What one collector run does to a pipeline's incident. A bad status opens
 * one only once it has held for incidentHoldMs(), so a one-minute blip never
 * pages; an open incident follows changes in the reason; leaving the bad
 * statuses recovers it.
 */
export function incidentAction(input: {
  status: PipelineStatus;
  since: number;
  nowMs: number;
  previous: { status: PipelineStatus; reason: string | null; updatedAt: number } | null;
  reason: string;
}): IncidentAction {
  const { status, since, nowMs, previous, reason } = input;
  const bad = BAD_STATUSES.includes(status);
  if (!bad) return previous && BAD_STATUSES.includes(previous.status) ? "recover" : "none";
  const hold = incidentHoldMs();
  const heldNow = nowMs - since >= hold;
  const heldBefore = previous !== null && previous.status === status && previous.updatedAt - since >= hold;
  if (heldNow && !heldBefore) return "open";
  if (previous && (previous.status !== status || previous.reason !== reason)) return "update";
  return "none";
}

async function loadCatalog(connectionId: string): Promise<CatalogTable[]> {
  const rows = await all(sql`SELECT database_name, table_name, engine, create_query, total_rows FROM obs_catalog_tables WHERE connection_id = ${connectionId}`);
  return rows.map((r) => ({ database: str(r.database_name), table: str(r.table_name), engine: str(r.engine), createQuery: str(r.create_query), totalRows: numOrNull(r.total_rows) }));
}

async function viewsBySource(connectionId: string): Promise<Map<string, string[]>> {
  const rows = await all(sql`SELECT source_id, target_id FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND kind = 'view_source'`);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const view = str(r.target_id).replace(/^table:/, "");
    map.set(str(r.source_id), [...(map.get(str(r.source_id)) ?? []), view]);
  }
  return map;
}

interface ExistingPipeline {
  id: string;
  kind: string;
  status: PipelineStatus;
  statusSince: number;
  attrs: Record<string, unknown>;
  targetNode: string | null;
  name: string;
  lastSampleAt: number | null;
  reason: string | null;
  updatedAt: number;
}

async function loadExisting(connectionId: string): Promise<Map<string, ExistingPipeline>> {
  const rows = await all(sql`SELECT * FROM obs_pipelines WHERE connection_id = ${connectionId}`);
  return new Map(rows.map((r: Row) => [str(r.pipeline_id), {
    id: str(r.pipeline_id),
    kind: str(r.kind),
    status: str(r.status) as PipelineStatus,
    statusSince: num(r.status_since),
    attrs: json<Record<string, unknown>>(r.attrs, {}),
    targetNode: strOrNull(r.target_node),
    name: str(r.name),
    lastSampleAt: numOrNull(r.last_sample_at),
    reason: strOrNull(r.status_reason),
    updatedAt: num(r.updated_at),
  }]));
}

function sampleRow(r: Row): PipelineSample {
  return {
    sampledAt: num(r.sampled_at),
    unitsIn: numOrNull(r.units_in),
    bytesIn: numOrNull(r.bytes_in),
    lastSuccessAt: numOrNull(r.last_success_at),
    lagSeconds: numOrNull(r.lag_seconds),
    backlog: numOrNull(r.backlog),
    backlogUnit: strOrNull(r.backlog_unit),
    errors: numOrNull(r.errors),
    errorSample: strOrNull(r.error_sample),
    errorClass: (strOrNull(r.error_class) as PipelineSample["errorClass"]) ?? null,
    progressing: r.progressing === null || r.progressing === undefined ? null : num(r.progressing) === 1,
  };
}

async function recentSamples(connectionId: string, limit: number): Promise<Map<string, PipelineSample[]>> {
  const rows = await all(sql`
    SELECT * FROM obs_pipeline_samples WHERE connection_id = ${connectionId} AND granularity = 'minute'
      AND sampled_at > ${Date.now() - 6 * 3600 * 1000}
    ORDER BY sampled_at DESC`);
  const map = new Map<string, PipelineSample[]>();
  for (const r of rows) {
    const id = str(r.pipeline_id);
    const list = map.get(id) ?? [];
    if (list.length < limit) list.push(sampleRow(r));
    map.set(id, list);
  }
  return map;
}

/** Typical gap between successes, from the distinct lastSuccessAt values seen. */
export function learnedCadenceSeconds(history: PipelineSample[], def: PipelineDef): number | null {
  if (typeof def.attrs.periodSeconds === "number") return def.attrs.periodSeconds;
  if (typeof def.attrs.lifetimeMax === "number" && def.attrs.lifetimeMax > 0) return def.attrs.lifetimeMax;
  const successes = [...new Set(history.map((s) => s.lastSuccessAt).filter((v): v is number => v !== null))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < successes.length; i++) gaps.push((successes[i] - successes[i - 1]) / 1000);
  // Enough gaps that a person running a few inserts by hand is not mistaken
  // for a regular writer (same bar as table cadences).
  return gaps.length >= MIN_CADENCE_SAMPLES ? median(gaps) : null;
}

/**
 * The longest gap between a schedule's next few fires, in seconds, or null when
 * the clock never fires it (manual and event-chained jobs). The longest gap
 * keeps an irregular cron (weekdays only, say) from looking late on Monday.
 */
export function schedulePeriodSeconds(spec: CadenceSpec, nowMs: number): number | null {
  const fires = nextFireTimes(spec, 8, nowMs);
  let gap = 0;
  for (let i = 1; i < fires.length; i++) gap = Math.max(gap, fires[i] - fires[i - 1]);
  return gap > 0 ? gap / 1000 : null;
}

function jobSpec(job: Row): CadenceSpec {
  const frequency = str(job.frequency);
  return {
    frequency: isFrequency(frequency) ? frequency : "daily",
    hour: num(job.hour),
    dayOfWeek: num(job.day_of_week),
    dayOfMonth: num(job.day_of_month),
    cronExpr: strOrNull(job.cron_expr),
    timezone: strOrNull(job.timezone) ?? "UTC",
  };
}

async function scheduledJobs(connectionId: string, ctx: AdapterContext): Promise<AdapterResult> {
  const out: AdapterResult = { defs: [], samples: new Map(), unsupported: new Map(), attrs: new Map() };
  const jobs = await all(sql`
    SELECT id, name, dest_database, dest_table, output_mode, enabled, frequency, hour, day_of_week, day_of_month, cron_expr, timezone
    FROM scheduled_queries WHERE connection_id = ${connectionId}`);
  for (const job of jobs) {
    const jobId = str(job.id);
    const id = `scheduled_job:${jobId}`;
    const target = job.dest_database && job.dest_table && str(job.output_mode) !== "none" ? `table:${str(job.dest_database)}.${str(job.dest_table)}` : null;
    const enabled = num(job.enabled) === 1;
    // A job's schedule is its cadence: learning one from run history mistakes a
    // burst of manual "Run now" clicks for an every-few-minutes job.
    const periodSeconds = enabled ? schedulePeriodSeconds(jobSpec(job), ctx.nowMs) : null;
    out.defs.push({
      id, kind: "scheduled_job", engine: "CHouse scheduler", name: str(job.name), sourceLabel: null, sourceNode: `job:${jobId}`, targetNode: target,
      attrs: { enabled, periodSeconds, expectsRecurring: periodSeconds !== null, paused: enabled ? null : "The job is disabled" },
    });
    const runs = await all(sql`SELECT status FROM scheduled_query_runs WHERE query_id = ${jobId} AND started_at > ${ctx.sinceMs}`);
    const last = await all(sql`SELECT finished_at FROM scheduled_query_runs WHERE query_id = ${jobId} AND status = 'success' ORDER BY finished_at DESC LIMIT 1`);
    // Judge the job by its latest finished run: a failure that a retry already
    // fixed is not an outage, and a failed daily run stays failing until the
    // next run succeeds instead of fading after a few minutes.
    const latest = await all(sql`
      SELECT status, message FROM scheduled_query_runs
      WHERE query_id = ${jobId} AND status <> 'running' ORDER BY started_at DESC LIMIT 1`);
    const latestFailed = latest[0] !== undefined && ["error", "failed"].includes(str(latest[0].status));
    const failure = latestFailed ? strOrNull(latest[0].message) ?? "the run reported an error" : null;
    const sample: PipelineSample = {
      sampledAt: ctx.nowMs,
      unitsIn: runs.length,
      bytesIn: null,
      lastSuccessAt: last[0] ? numOrNull(last[0].finished_at) : null,
      lagSeconds: null,
      backlog: null,
      backlogUnit: null,
      errors: latestFailed ? 1 : 0,
      errorSample: failure,
      errorClass: null,
      progressing: latestFailed ? null : runs.some((r) => str(r.status) === "success") ? true : null,
      lastRunFailure: failure,
    };
    out.samples.set(id, sample);
  }
  return out;
}

export const pipelinesCollector: ConnectionCollector = {
  name: "pipelines",
  scope: "connection",
  intervalMs: 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const watermark = await ctx.getWatermark();
    const sinceMs = Math.max(watermark, ctx.nowMs - MAX_WINDOW_MS);
    const [catalog, sources, existing] = await Promise.all([loadCatalog(connectionId), viewsBySource(connectionId), loadExisting(connectionId)]);
    const databases = await selectRows<{ name: string; engine: string }>(ctx.client, "SELECT name, engine FROM system.databases");
    const adapterCtx: AdapterContext = {
      client: ctx.client,
      capabilities: ctx.capabilities,
      nowMs: ctx.nowMs,
      sinceMs,
      previous: new Map([...existing.values()].map((p) => [p.id, p.attrs])),
      viewsBySource: sources,
    };

    const results: AdapterResult[] = [];
    const views = await viewStats(adapterCtx).catch(() => new Map());
    const runners: Array<[string, () => Promise<AdapterResult> | AdapterResult]> = [
      ["materialized_view", () => materializedViews(adapterCtx, catalog)],
      ["refreshable_view", () => refreshableViews(adapterCtx, catalog)],
      ["queue_engine", () => queueEngines(adapterCtx, catalog, views)],
      ["object_storage_queue", () => objectStorageQueues(adapterCtx, catalog)],
      ["database_replication", () => databaseReplication(adapterCtx, catalog, new Map(databases.map((d) => [d.name, d.engine])))],
      ["external_table", () => externalTables(adapterCtx, catalog)],
      ["distributed", () => distributed(adapterCtx, catalog)],
      ["dictionary", () => dictionaries(adapterCtx)],
      ["async_insert", () => asyncInserts(adapterCtx)],
      ["buffer", () => buffers(adapterCtx, catalog)],
      ["writer", () => writers(adapterCtx)],
      ["scheduled_job", () => scheduledJobs(connectionId, adapterCtx)],
    ];
    for (const [kind, runAdapter] of runners) {
      try {
        results.push(await runAdapter());
      } catch (error) {
        // One adapter failing (e.g. a privilege) never hides the others.
        logger.warn({ module: "Observe", collector: "pipelines", kind, connectionId, err: error instanceof Error ? error.message : String(error) }, "Pipeline adapter failed");
      }
    }

    const defs = new Map<string, PipelineDef>();
    const samples = new Map<string, PipelineSample>();
    const unsupported = new Map<string, string>();
    const attrs = new Map<string, Record<string, unknown>>();
    for (const r of results) {
      for (const d of r.defs) defs.set(d.id, d);
      for (const [k, v] of r.samples) samples.set(k, v);
      for (const [k, v] of r.unsupported) unsupported.set(k, v);
      for (const [k, v] of r.attrs) attrs.set(k, v);
    }
    // Writers that went quiet still need a sample so "stopped" can be detected,
    // unless their target table was dropped: then the writer is gone, not stopped.
    const liveTables = new Set(catalog.map((t) => `table:${t.database}.${t.table}`));
    for (const p of existing.values()) {
      if (p.kind !== "writer" || defs.has(p.id)) continue;
      if (catalog.length > 0 && p.targetNode?.startsWith("table:") && !liveTables.has(p.targetNode)) continue;
      if (p.lastSampleAt === null || ctx.nowMs - p.lastSampleAt > 24 * 3600 * 1000) continue;
      defs.set(p.id, { id: p.id, kind: "writer", engine: "", name: p.name, sourceLabel: null, sourceNode: null, targetNode: p.targetNode, attrs: p.attrs });
      samples.set(p.id, { sampledAt: ctx.nowMs, unitsIn: 0, bytesIn: null, lastSuccessAt: typeof p.attrs.lastSuccessAt === "number" ? p.attrs.lastSuccessAt : null, lagSeconds: null, backlog: null, backlogUnit: null, errors: 0, errorSample: null, errorClass: null, progressing: null });
    }

    const history = await recentSamples(connectionId, 120);
    const statements: SQL[] = [];
    const badNow: string[] = [];
    const transitions: Array<{ def: PipelineDef; action: IncidentAction; to: PipelineStatus; reason: string; since: number }> = [];
    for (const def of defs.values()) {
      const sample = samples.get(def.id);
      const past = history.get(def.id) ?? [];
      const window = sample ? [...past.slice(0, 5).reverse(), sample] : past.slice(0, 5).reverse();
      const mergedAttrs = { ...(existing.get(def.id)?.attrs ?? {}), ...def.attrs, ...(attrs.get(def.id) ?? {}), ...(sample?.lastSuccessAt ? { lastSuccessAt: sample.lastSuccessAt } : {}) };
      const cadence = learnedCadenceSeconds([...past, ...(sample ? [sample] : [])], { ...def, attrs: mergedAttrs });
      // Switches come from this run's evidence only, never from stored attrs.
      const fresh = { ...def.attrs, ...(attrs.get(def.id) ?? {}) };
      const verdict = classifyPipeline(window, {
        nowMs: ctx.nowMs,
        cadenceSeconds: cadence,
        unsupported: unsupported.get(def.id) ?? null,
        paused: typeof fresh.paused === "string" ? fresh.paused : null,
        expectsRecurring: fresh.expectsRecurring !== false,
      });
      const prev = existing.get(def.id);
      const since = prev && prev.status === verdict.status ? prev.statusSince : ctx.nowMs;
      const action = incidentAction({
        status: verdict.status,
        since,
        nowMs: ctx.nowMs,
        previous: prev ? { status: prev.status, reason: prev.reason, updatedAt: prev.updatedAt } : null,
        reason: verdict.reason,
      });
      if (BAD_STATUSES.includes(verdict.status)) badNow.push(def.id);
      if (action !== "none") transitions.push({ def, action, to: verdict.status, reason: verdict.reason, since });
      const attrsJson = JSON.stringify({ ...mergedAttrs, cadenceSeconds: cadence });
      statements.push(sql`
        INSERT INTO obs_pipelines (connection_id, pipeline_id, kind, engine, name, source_label, source_node, target_node, status, status_reason, status_since, last_sample_at, unsupported, attrs, updated_at)
        VALUES (${connectionId}, ${def.id}, ${def.kind}, ${def.engine}, ${def.name}, ${def.sourceLabel}, ${def.sourceNode}, ${def.targetNode}, ${verdict.status}, ${verdict.reason}, ${since}, ${sample ? ctx.nowMs : null}, ${unsupported.get(def.id) ?? null}, ${attrsJson}, ${ctx.nowMs})
        ON CONFLICT (connection_id, pipeline_id) DO UPDATE SET
          kind = ${def.kind}, engine = ${def.engine}, name = ${def.name}, source_label = ${def.sourceLabel}, source_node = ${def.sourceNode},
          target_node = ${def.targetNode}, status = ${verdict.status}, status_reason = ${verdict.reason}, status_since = ${since},
          last_sample_at = ${sample ? ctx.nowMs : null}, unsupported = ${unsupported.get(def.id) ?? null}, attrs = ${attrsJson}, updated_at = ${ctx.nowMs}
      `);
      if (sample) {
        statements.push(sql`
          INSERT INTO obs_pipeline_samples (connection_id, pipeline_id, granularity, sampled_at, units_in, bytes_in, last_success_at, lag_seconds, backlog, backlog_unit, errors, error_sample, error_class, progressing)
          VALUES (${connectionId}, ${def.id}, 'minute', ${ctx.nowMs}, ${sample.unitsIn}, ${sample.bytesIn}, ${sample.lastSuccessAt}, ${sample.lagSeconds}, ${sample.backlog}, ${sample.backlogUnit}, ${sample.errors}, ${sample.errorSample?.slice(0, 2000) ?? null}, ${sample.errorClass}, ${sample.progressing === null ? null : sample.progressing ? 1 : 0})
          ON CONFLICT (connection_id, pipeline_id, granularity, sampled_at) DO NOTHING
        `);
      }
    }
    // Pipelines whose object disappeared from the catalog are removed (writers age out after 24h).
    const keep = [...defs.keys()];
    if (keep.length > 0) {
      statements.push(sql`DELETE FROM obs_pipelines WHERE connection_id = ${connectionId} AND pipeline_id NOT IN (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})`);
    } else {
      statements.push(sql`DELETE FROM obs_pipelines WHERE connection_id = ${connectionId}`);
    }
    // Pipeline history keeps 48h of minute samples.
    statements.push(sql`DELETE FROM obs_pipeline_samples WHERE connection_id = ${connectionId} AND sampled_at < ${ctx.nowMs - 48 * 3600 * 1000}`);
    await runBatch(statements);
    await ctx.setWatermark(ctx.nowMs);
    // Only a pipeline that is bad right now may hold an open incident. This also
    // closes incidents of pipelines that disappeared (job deleted, view dropped)
    // and ones opened under older, looser rules.
    await recoverIncidentsExcept(connectionId, "pipeline", badNow);

    for (const t of transitions) {
      if (t.action === "recover") {
        await recoverIncident(connectionId, "pipeline", t.def.id);
        continue;
      }
      const input = {
        connectionId,
        kind: "pipeline" as const,
        subjectRef: t.def.id,
        subjectNode: t.def.targetNode,
        severity: STATUS_SEVERITY[t.to] >= STATUS_SEVERITY.failing ? "critical" as const : "warning" as const,
        summary: `${t.def.name}: ${t.reason}`,
        onsetAt: t.since,
      };
      if (t.action === "open") await openOrUpdateIncident(input);
      else await updateActiveIncident(input);
    }
  },
};
