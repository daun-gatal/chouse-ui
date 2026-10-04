/**
 * Monitoring suggestions (ADR 0016 §5). Learned baselines and usage turn into
 * Data Health promise drafts; accepting one opens the existing promise wizard
 * pre-filled, so every accepted suggestion is an ordinary promise.
 */

import { all, json, num, numOrNull, one, run, sql, str } from "./db";
import { staleAfterSeconds } from "./baselines";

export interface PromiseDraft {
  name: string;
  connectionId: string;
  source: { sourceType: "table"; databaseName: string; tableName: string; eventTimeColumn?: string; eventTimeType?: string; eventTimeEncoding?: "native" };
  criticality: "standard" | "important" | "critical";
  frequency: "hourly" | "daily";
  checks: Array<Record<string, unknown>>;
}

export interface Suggestion {
  key: string;
  connectionId: string;
  database: string;
  table: string;
  kind: "freshness" | "volume" | "schema_contract" | "distribution";
  why: string;
  check: string;
  learnedFrom: string;
  score: number;
  draft: PromiseDraft;
}

const TIME_TYPE = /^(Nullable\()?(DateTime|DateTime64|Date|Date32)\b/;

function pickEventTime(columns: Array<{ name: string; type: string }>, sortingKey: string): { name: string; type: string } | null {
  const timeColumns = columns.filter((c) => TIME_TYPE.test(c.type));
  if (timeColumns.length === 0) return null;
  const keyed = timeColumns.find((c) => sortingKey.split(",").map((k) => k.trim()).some((k) => k === c.name || k.includes(`(${c.name})`)));
  if (keyed) return keyed;
  return timeColumns.find((c) => /event|created|ts|time|date/i.test(c.name)) ?? timeColumns[0];
}

function humanSeconds(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export async function computeSuggestions(connectionId: string, limit = 50): Promise<Suggestion[]> {
  const baselines = await all(sql`
    SELECT b.*, t.sorting_key FROM obs_table_baselines b
    LEFT JOIN obs_catalog_tables t ON t.connection_id = b.connection_id AND t.database_name = b.database_name AND t.table_name = b.table_name
    WHERE b.connection_id = ${connectionId}`);
  const promised = new Set((await all(sql`SELECT database_name, table_name FROM data_health_promises WHERE connection_id = ${connectionId}`)).map((r) => `${str(r.database_name)}.${str(r.table_name)}`));
  const dismissed = new Set((await all(sql`SELECT suggestion_key FROM obs_suggestion_dismissals WHERE connection_id = ${connectionId}`)).map((r) => str(r.suggestion_key)));
  const ddlCounts = new Map((await all(sql`
    SELECT object_ref, COUNT(*) AS n FROM obs_change_events WHERE connection_id = ${connectionId} AND kind = 'ddl' AND occurred_at >= ${Date.now() - 30 * 86_400_000}
    GROUP BY object_ref`)).map((r) => [str(r.object_ref), num(r.n)]));
  const suggestions: Suggestion[] = [];

  for (const b of baselines) {
    const database = str(b.database_name);
    const table = str(b.table_name);
    const fq = `${database}.${table}`;
    if (promised.has(fq)) continue;
    const reads = num(b.reads_7d);
    const readers = num(b.readers_7d);
    const criticality = (str(b.criticality) || "standard") as PromiseDraft["criticality"];
    if (criticality === "standard" && reads < 100) continue;
    const columns = (await all(sql`SELECT column_name, column_type FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} ORDER BY position`)).map((c) => ({ name: str(c.column_name), type: str(c.column_type) }));
    const eventTime = pickEventTime(columns, str(b.sorting_key));
    const why = `Read ${reads}× by ${readers} readers this week${criticality !== "standard" ? ` · ${criticality}` : ""}, no promise`;
    const score = reads * Math.log2(2 + readers) * (criticality === "critical" ? 3 : criticality === "important" ? 2 : 1);
    const baseDraft = (checks: Array<Record<string, unknown>>, frequency: PromiseDraft["frequency"]): PromiseDraft => ({
      name: `${fq} health`,
      connectionId,
      source: { sourceType: "table", databaseName: database, tableName: table, ...(eventTime ? { eventTimeColumn: eventTime.name, eventTimeType: eventTime.type, eventTimeEncoding: "native" as const } : {}) },
      criticality,
      frequency,
      checks,
    });
    const p99 = numOrNull(b.cadence_p99_s);
    const p50 = numOrNull(b.cadence_p50_s);
    if (eventTime && p99 !== null && p50 !== null) {
      const maxAge = Math.max(300, Math.round(staleAfterSeconds({ p50Seconds: p50, p99Seconds: p99, samples: 0 })));
      const key = `freshness:${fq}`;
      if (!dismissed.has(key)) {
        suggestions.push({
          key, connectionId, database, table, kind: "freshness", why, score,
          check: `freshness ≤ ${humanSeconds(maxAge)}`,
          learnedFrom: `writes every ${humanSeconds(p50)} (p99 ${humanSeconds(p99)})`,
          draft: baseDraft([{ checkKey: "freshness", name: "Freshness", type: "freshness", severity: criticality === "critical" ? "critical" : "warning", enabled: true, config: { eventTimeColumn: eventTime.name, maxAgeSeconds: maxAge } }], maxAge < 3600 ? "hourly" : "daily"),
        });
      }
    }
    const band = json<Record<string, { n: number }>>(b.volume_band, {});
    if (eventTime && Object.values(band).some((slot) => slot.n >= 3)) {
      const key = `volume:${fq}`;
      if (!dismissed.has(key)) {
        suggestions.push({
          key, connectionId, database, table, kind: "volume", why, score: score * 0.9,
          check: "volume within its learned range",
          learnedFrom: "28-day hourly pattern",
          draft: baseDraft([{ checkKey: "volume", name: "Volume", type: "volume_anomaly", severity: "warning", enabled: true, config: { minSamples: 7, sensitivity: 3, minRelativeBand: 0.2 } }], "hourly"),
        });
      }
    }
    const schemaChanges = ddlCounts.get(fq) ?? 0;
    if (schemaChanges >= 3) {
      const key = `schema:${fq}`;
      if (!dismissed.has(key)) {
        suggestions.push({
          key, connectionId, database, table, kind: "schema_contract", why: `Schema changed ${schemaChanges}× in 30 days; ${why.toLowerCase()}`, score: score * 0.8,
          check: "schema contract", learnedFrom: "current columns",
          draft: baseDraft([{ checkKey: "schema", name: "Schema contract", type: "schema_contract", severity: "warning", enabled: true, config: { expectedColumns: columns.map((c) => ({ name: c.name, type: c.type })), allowAdditionalColumns: true } }], "daily"),
        });
      }
    }
  }

  // Drift: a profiled column whose latest p50 moved ≥ 3× from its 14-day median.
  const drifted = await all(sql`
    SELECT p.database_name, p.table_name, p.column_name, p.p50, p.profiled_at FROM obs_column_profiles p
    WHERE p.connection_id = ${connectionId} AND p.p50 IS NOT NULL
      AND p.profiled_at = (SELECT MAX(p2.profiled_at) FROM obs_column_profiles p2 WHERE p2.connection_id = p.connection_id AND p2.database_name = p.database_name AND p2.table_name = p.table_name AND p2.column_name = p.column_name)`);
  for (const d of drifted) {
    const database = str(d.database_name);
    const table = str(d.table_name);
    const column = str(d.column_name);
    const history = (await all(sql`
      SELECT p50 FROM obs_column_profiles WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND column_name = ${column}
        AND profiled_at >= ${Date.now() - 14 * 86_400_000} AND profiled_at < ${num(d.profiled_at)}`)).map((h) => num(h.p50)).filter((v) => v !== 0);
    if (history.length < 3) continue;
    const sorted = [...history].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ratio = median === 0 ? 0 : num(d.p50) / median;
    if (ratio < 3 && ratio > 1 / 3) continue;
    const key = `distribution:${database}.${table}.${column}`;
    if (dismissed.has(key)) continue;
    const eventTime = pickEventTime((await all(sql`SELECT column_name, column_type FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`)).map((c) => ({ name: str(c.column_name), type: str(c.column_type) })), "");
    if (!eventTime) continue;
    suggestions.push({
      key, connectionId, database, table, kind: "distribution",
      why: `Drift detected on ${column} (p50 ${ratio.toFixed(1)}× its 14-day median)`,
      check: `p50(${column}) within 3×`, learnedFrom: "14-day sample profile", score: 1e9,
      draft: {
        name: `${database}.${table} ${column} distribution`, connectionId,
        source: { sourceType: "table", databaseName: database, tableName: table, eventTimeColumn: eventTime.name, eventTimeType: eventTime.type, eventTimeEncoding: "native" },
        criticality: "important", frequency: "hourly",
        checks: [{ checkKey: `${column}_p50`.slice(0, 64).toLowerCase().replace(/[^a-z0-9_]/g, "_"), name: `${column} p50`, type: "distribution", severity: "warning", enabled: true, config: { column, statistic: "p50", tolerance: 3, minSamples: 7 } }],
      },
    });
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function dismissSuggestion(connectionId: string, key: string, actorId: string | null): Promise<void> {
  await run(sql`
    INSERT INTO obs_suggestion_dismissals (connection_id, suggestion_key, dismissed_by, dismissed_at)
    VALUES (${connectionId}, ${key}, ${actorId}, ${Date.now()}) ON CONFLICT (connection_id, suggestion_key) DO NOTHING
  `);
}

export async function pinCriticality(connectionId: string, database: string, table: string, criticality: "critical" | "important" | "standard" | null): Promise<boolean> {
  const existing = await one(sql`SELECT 1 AS x FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  if (!existing) return false;
  if (criticality === null) {
    await run(sql`UPDATE obs_table_baselines SET criticality_pinned = 0 WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  } else {
    await run(sql`UPDATE obs_table_baselines SET criticality = ${criticality}, criticality_pinned = 1 WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  }
  return true;
}
