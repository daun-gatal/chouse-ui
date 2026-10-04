/**
 * Codec trials (ADR 0016 §9): measure a candidate codec on a 1M-row sample in
 * the scratch database (OBSERVE_SCRATCH_DATABASE) and drop the copy. This is
 * the only operator-started write besides remediation, and it uses the same
 * dedicated remediation credential — never the read credential.
 */

import { randomUUID } from "crypto";

import { getConnectionWithPassword } from "../../rbac/services/connections";
import type { ConnectionConfig } from "../../types";
import { logger } from "../../utils/logger";
import { ClientManager } from "../clientManager";
import { getCredential } from "../remediation/store";
import { quoteIdent, quoteString } from "../remediation/catalog";
import { selectRows } from "./clickhouse";
import { run, sql } from "./db";

export const SCRATCH_DATABASE = process.env.OBSERVE_SCRATCH_DATABASE || "chouse_scratch";
const SAMPLE_ROWS = 1_000_000;
const CODEC = /^[A-Za-z0-9_(), ]{1,100}$/;

export interface TrialInput {
  connectionId: string;
  database: string;
  table: string;
  column: string;
  candidateCodec: string;
}

export async function startCodecTrial(input: TrialInput, actorId: string | null): Promise<string> {
  for (const ident of [input.database, input.table, input.column]) quoteIdent(ident);
  if (!CODEC.test(input.candidateCodec)) throw new Error("Unsupported codec expression");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(SCRATCH_DATABASE)) throw new Error("OBSERVE_SCRATCH_DATABASE must be a plain identifier");
  const credential = await getCredential(input.connectionId);
  if (!credential) throw new Error("Codec trials need the connection's remediation credential");
  const id = randomUUID();
  await run(sql`
    INSERT INTO obs_codec_trials (id, connection_id, database_name, table_name, column_name, candidate_codec, status, requested_by, created_at)
    VALUES (${id}, ${input.connectionId}, ${input.database}, ${input.table}, ${input.column}, ${input.candidateCodec}, 'running', ${actorId}, ${Date.now()})
  `);
  void runTrial(id, input, credential.username, credential.password);
  return id;
}

async function runTrial(id: string, input: TrialInput, username: string, password: string): Promise<void> {
  const trialTable = `trial_${id.replace(/-/g, "").slice(0, 16)}`;
  const scratch = `${quoteIdent(SCRATCH_DATABASE)}.${quoteIdent(trialTable)}`;
  try {
    const conn = await getConnectionWithPassword(input.connectionId);
    if (!conn) throw new Error("Connection not found");
    const config: ConnectionConfig = { url: `${conn.sslEnabled ? "https" : "http"}://${conn.host}:${conn.port}`, username, password, database: conn.database || undefined };
    const client = ClientManager.getInstance().getClient(config, JSON.stringify({ source: "observe", collector: "codec_trial", trial_id: id }));
    const [column] = await selectRows<{ type: string; codec: string; compressed: number; uncompressed: number }>(client, `
      SELECT type, compression_codec AS codec, data_compressed_bytes AS compressed, data_uncompressed_bytes AS uncompressed
      FROM system.columns WHERE database = ${quoteString(input.database)} AND table = ${quoteString(input.table)} AND name = ${quoteString(input.column)}`);
    if (!column) throw new Error("Column not found");
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${quoteIdent(SCRATCH_DATABASE)}` });
    await client.command({ query: `CREATE TABLE ${scratch} (${quoteIdent(input.column)} ${column.type} CODEC(${input.candidateCodec})) ENGINE = MergeTree ORDER BY tuple()` });
    try {
      await client.command({ query: `INSERT INTO ${scratch} SELECT ${quoteIdent(input.column)} FROM ${quoteIdent(input.database)}.${quoteIdent(input.table)} LIMIT ${SAMPLE_ROWS}`, clickhouse_settings: { max_execution_time: 300 } });
      await client.command({ query: `OPTIMIZE TABLE ${scratch} FINAL` });
      const [after] = await selectRows<{ compressed: number; uncompressed: number }>(client, `
        SELECT sum(column_data_compressed_bytes) AS compressed, sum(column_data_uncompressed_bytes) AS uncompressed
        FROM system.parts_columns WHERE active AND database = ${quoteString(SCRATCH_DATABASE)} AND table = ${quoteString(trialTable)}`);
      const ratioBefore = Number(column.compressed) > 0 ? Number(column.uncompressed) / Number(column.compressed) : null;
      const ratioAfter = after && Number(after.compressed) > 0 ? Number(after.uncompressed) / Number(after.compressed) : null;
      const saved = ratioBefore && ratioAfter ? Number(column.uncompressed) / ratioBefore - Number(column.uncompressed) / ratioAfter : null;
      await run(sql`
        UPDATE obs_codec_trials SET status = 'done', current_codec = ${column.codec || "default"}, ratio_before = ${ratioBefore}, ratio_after = ${ratioAfter}, saved_bytes = ${saved}, finished_at = ${Date.now()}
        WHERE id = ${id}`);
    } finally {
      await client.command({ query: `DROP TABLE IF EXISTS ${scratch} SYNC` }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ module: "Observe", trialId: id, err: message }, "Codec trial failed");
    await run(sql`UPDATE obs_codec_trials SET status = 'failed', error = ${message.slice(0, 1000)}, finished_at = ${Date.now()} WHERE id = ${id}`);
  }
}

export async function setCostRates(currency: string, perTibRead: number, perCpuHour: number, actorId: string | null): Promise<void> {
  const now = Date.now();
  await run(sql`
    INSERT INTO obs_cost_rates (id, currency, per_tib_read, per_cpu_hour, updated_by, updated_at) VALUES (1, ${currency}, ${perTibRead}, ${perCpuHour}, ${actorId}, ${now})
    ON CONFLICT (id) DO UPDATE SET currency = ${currency}, per_tib_read = ${perTibRead}, per_cpu_hour = ${perCpuHour}, updated_by = ${actorId}, updated_at = ${now}
  `);
}

