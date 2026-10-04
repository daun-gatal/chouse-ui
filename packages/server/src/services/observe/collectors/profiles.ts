/**
 * `profiles` collector (ADR 0016 §5): sampled column profiles for critical
 * tables and tables with a `distribution` promise — null ratio, distinct
 * count, p50/p95 for numbers and top values for low-cardinality strings. The
 * read is bounded: SAMPLE when the table has a sampling key, else the newest
 * part of the table via LIMIT.
 */

import { sql, type SQL } from "drizzle-orm";

import { selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, runBatch, str } from "../db";

const MAX_TABLES = 20;
const MAX_COLUMNS = 12;
const SAMPLE_ROWS = 200_000;

const NUMERIC = /^(Nullable\()?(U?Int\d+|Float\d+|Decimal)/;
const STRINGY = /^(Nullable\()?(LowCardinality\()?(Nullable\()?(String|FixedString|Enum)/;

export function quoteId(name: string): string {
  return `\`${name.replace(/`/g, "")}\``;
}

export function profileSelect(columns: Array<{ name: string; type: string }>): string {
  const parts: string[] = ["count() AS __rows"];
  columns.forEach((c, i) => {
    const col = quoteId(c.name);
    parts.push(`countIf(isNull(${col})) AS n${i}`, `uniq(${col}) AS d${i}`);
    if (NUMERIC.test(c.type)) parts.push(`toFloat64(quantile(0.5)(${col})) AS p50_${i}`, `toFloat64(quantile(0.95)(${col})) AS p95_${i}`);
    else if (STRINGY.test(c.type)) parts.push(`topK(5)(toString(${col})) AS top${i}`);
  });
  return parts.join(", ");
}

export const profilesCollector: ConnectionCollector = {
  name: "profiles",
  scope: "connection",
  intervalMs: 15 * 60 * 1000,
  requires: ["columns"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const candidates = await all(sql`
      SELECT b.database_name, b.table_name, t.sampling_key FROM obs_table_baselines b
      JOIN obs_catalog_tables t ON t.connection_id = b.connection_id AND t.database_name = b.database_name AND t.table_name = b.table_name
      WHERE b.connection_id = ${connectionId} AND (b.criticality = 'critical' OR EXISTS (
        SELECT 1 FROM data_health_promise_checks c JOIN data_health_promises p ON p.id = c.promise_id
        WHERE p.connection_id = b.connection_id AND p.database_name = b.database_name AND p.table_name = b.table_name AND c.type = 'distribution'))
      ORDER BY b.reads_7d DESC LIMIT ${MAX_TABLES}`);
    const statements: SQL[] = [];
    for (const t of candidates) {
      const database = str(t.database_name);
      const table = str(t.table_name);
      const cols = (await all(sql`SELECT column_name, column_type FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} ORDER BY position`))
        .map((c) => ({ name: str(c.column_name), type: str(c.column_type) }))
        .filter((c) => NUMERIC.test(c.type) || STRINGY.test(c.type))
        .slice(0, MAX_COLUMNS);
      if (cols.length === 0) continue;
      const source = str(t.sampling_key)
        ? `${quoteId(database)}.${quoteId(table)} SAMPLE ${SAMPLE_ROWS}`
        : `(SELECT ${cols.map((c) => quoteId(c.name)).join(", ")} FROM ${quoteId(database)}.${quoteId(table)} LIMIT ${SAMPLE_ROWS})`;
      try {
        const [row] = await selectRows<Record<string, unknown>>(ctx.client, `SELECT ${profileSelect(cols)} FROM ${source}`, { maxExecutionTime: 30 });
        if (!row) continue;
        const total = Number(row.__rows ?? 0);
        cols.forEach((c, i) => {
          const nullRatio = total > 0 ? Number(row[`n${i}`] ?? 0) / total : null;
          statements.push(sql`
            INSERT INTO obs_column_profiles (connection_id, database_name, table_name, column_name, profiled_at, null_ratio, distinct_count, p50, p95, top_values, sample_rows)
            VALUES (${connectionId}, ${database}, ${table}, ${c.name}, ${now}, ${nullRatio}, ${Number(row[`d${i}`] ?? 0)},
              ${row[`p50_${i}`] === undefined ? null : Number(row[`p50_${i}`])}, ${row[`p95_${i}`] === undefined ? null : Number(row[`p95_${i}`])},
              ${JSON.stringify(row[`top${i}`] ?? [])}, ${total})
            ON CONFLICT (connection_id, database_name, table_name, column_name, profiled_at) DO NOTHING
          `);
        });
      } catch {
        // A table we cannot read (data access, dropped) is skipped; other tables still profile.
      }
    }
    statements.push(sql`DELETE FROM obs_column_profiles WHERE connection_id = ${connectionId} AND profiled_at < ${now - 30 * 24 * 3600 * 1000}`);
    await runBatch(statements);
  },
};

