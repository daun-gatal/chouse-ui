/**
 * The closed remediation action catalog (ADR 0016 §8).
 *
 * Every action is a typed member of a Zod discriminated union. SQL is generated
 * from validated parameters only — never free-form text — and identifiers are
 * checked against a strict pattern before being backtick-quoted. Each type
 * declares its approval class, whether it may only run inside the maintenance
 * window, how to roll back (from state captured before execution), and a
 * read-only verification probe.
 */

import { z } from "zod";

export const ACTION_TYPES = [
  "kill_query",
  "pause_scheduled_job",
  "resume_scheduled_job",
  "delay_scheduled_job",
  "set_profile_setting",
  "optimize_partition",
  "restart_replica",
  "add_skip_index",
  "modify_ttl",
  "modify_column_codec",
  "restart_engine_table",
  "reload_dictionary",
  "refresh_view",
  "flush_distributed",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const ident = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Must be a plain identifier");
const settingValue = z.union([z.string().trim().max(200), z.number().finite(), z.boolean()]);
/** Expressions (TTL, index, codec) are restricted to a conservative character set. */
const expression = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_\s().,+\-*/'<>=!]+$/, "Unsupported characters in expression").refine((v) => !/;|--|\/\*/.test(v), "Expressions cannot contain statement separators or comments");

export const actionParamsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kill_query"), queryId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_\-:.]+$/) }),
  z.object({ type: z.literal("pause_scheduled_job"), jobId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("resume_scheduled_job"), jobId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("delay_scheduled_job"), jobId: z.string().min(1).max(64), until: z.number().int().positive() }),
  z.object({
    type: z.literal("set_profile_setting"),
    targetKind: z.enum(["user", "role", "profile"]),
    targetName: ident,
    setting: ident,
    value: settingValue,
  }),
  z.object({ type: z.literal("optimize_partition"), database: ident, table: ident, partitionId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/), final: z.boolean().default(false) }),
  z.object({ type: z.literal("restart_replica"), database: ident, table: ident }),
  z.object({
    type: z.literal("add_skip_index"),
    database: ident,
    table: ident,
    name: ident,
    expression,
    indexType: z.string().trim().regex(/^(minmax|set\(\d{1,6}\)|bloom_filter(\(0?\.\d+\))?|tokenbf_v1\(\d+, ?\d+, ?\d+\)|ngrambf_v1\(\d+, ?\d+, ?\d+, ?\d+\))$/),
    granularity: z.number().int().min(1).max(1000).default(1),
  }),
  z.object({ type: z.literal("modify_ttl"), database: ident, table: ident, ttl: expression }),
  z.object({ type: z.literal("modify_column_codec"), database: ident, table: ident, column: ident, codec: z.string().trim().regex(/^[A-Za-z0-9_(), ]{1,100}$/) }),
  z.object({ type: z.literal("restart_engine_table"), database: ident, table: ident }),
  z.object({ type: z.literal("reload_dictionary"), database: ident, name: ident }),
  z.object({ type: z.literal("refresh_view"), database: ident, view: ident }),
  z.object({ type: z.literal("flush_distributed"), database: ident, table: ident }),
]);
export type ActionParams = z.infer<typeof actionParamsSchema>;

/** State read from ClickHouse before execution; drives rollback and change detection. */
export interface PriorState {
  /** Rendered SETTINGS list of the user / role / profile ("" = none). */
  settingsList?: string;
  /** Existing TTL clause of the table, without the `TTL` keyword ("" = none). */
  ttl?: string;
  /** Existing CODEC(...) of the column ("" = default). */
  codec?: string;
}

export interface VerificationSpec {
  description: string;
  /** Read-only probe returning one numeric column `value`. */
  sql: string | null;
  comparator: "eq" | "lt" | "lte" | "gt" | "gte";
  threshold: number;
  withinSeconds: number;
}

export interface BuiltAction {
  /** Statements executed in order with the remediation credential; empty for internal actions. */
  statements: string[];
  /** Human-readable preview (what an approver reads). */
  preview: string;
  rollback: string[] | null;
  approvalClass: 1 | 2;
  windowOnly: boolean;
  verification: VerificationSpec;
  /** Internal (CHouse-side) effect for scheduled-job actions. */
  internal: { kind: "job_pause" | "job_resume" | "job_delay"; jobId: string; until?: number } | null;
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `\`${name}\``;
}

export function quoteString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function literal(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return /^-?\d+(\.\d+)?$/.test(value) ? value : quoteString(value);
}

function table(database: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(name)}`;
}

const TARGET_KEYWORD = { user: "USER", role: "ROLE", profile: "SETTINGS PROFILE" } as const;

/** Merge one setting into a rendered SETTINGS list, replacing an existing entry of the same name. */
export function mergeSettingsList(existing: string, setting: string, value: string | number | boolean): string {
  const entries = existing.trim() === "" ? [] : splitTopLevel(existing);
  const rendered = `${setting} = ${literal(value)}`;
  const index = entries.findIndex((e) => new RegExp(`^${setting}\\s*=`).test(e.trim()));
  if (index >= 0) entries[index] = rendered;
  else entries.push(rendered);
  return entries.join(", ");
}

function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (const ch of list) {
    if (ch === "'" && !current.endsWith("\\")) quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function buildAction(params: ActionParams, prior: PriorState = {}): BuiltAction {
  switch (params.type) {
    case "kill_query":
      return {
        statements: [`KILL QUERY WHERE query_id = ${quoteString(params.queryId)} SYNC`],
        preview: `Kill query ${params.queryId}`,
        rollback: null,
        approvalClass: 1,
        windowOnly: false,
        verification: { description: "The query is no longer running", sql: `SELECT count() AS value FROM system.processes WHERE query_id = ${quoteString(params.queryId)}`, comparator: "eq", threshold: 0, withinSeconds: 60 },
        internal: null,
      };
    case "pause_scheduled_job":
      return { statements: [], preview: `Pause scheduled job ${params.jobId}`, rollback: null, approvalClass: 1, windowOnly: false, verification: { description: "The job is paused", sql: null, comparator: "eq", threshold: 1, withinSeconds: 5 }, internal: { kind: "job_pause", jobId: params.jobId } };
    case "resume_scheduled_job":
      return { statements: [], preview: `Resume scheduled job ${params.jobId}`, rollback: null, approvalClass: 1, windowOnly: false, verification: { description: "The job is active", sql: null, comparator: "eq", threshold: 1, withinSeconds: 5 }, internal: { kind: "job_resume", jobId: params.jobId } };
    case "delay_scheduled_job":
      return { statements: [], preview: `Pause scheduled job ${params.jobId} until ${new Date(params.until).toISOString()}, then resume it`, rollback: null, approvalClass: 1, windowOnly: false, verification: { description: "The job is paused until the delay ends", sql: null, comparator: "eq", threshold: 1, withinSeconds: 5 }, internal: { kind: "job_delay", jobId: params.jobId, until: params.until } };
    case "set_profile_setting": {
      const keyword = TARGET_KEYWORD[params.targetKind];
      const target = quoteIdent(params.targetName);
      const previous = prior.settingsList ?? "";
      const next = mergeSettingsList(previous, params.setting, params.value);
      return {
        statements: [`ALTER ${keyword} ${target} SETTINGS ${next}`],
        preview: `Set ${params.setting} = ${literal(params.value)} for ${params.targetKind} ${params.targetName}`,
        rollback: [`ALTER ${keyword} ${target} SETTINGS ${previous.trim() === "" ? "NONE" : previous}`],
        approvalClass: 1,
        windowOnly: false,
        verification: {
          description: `${params.setting} is applied to ${params.targetKind} ${params.targetName}`,
          sql: `SELECT count() AS value FROM system.settings_profile_elements WHERE ${params.targetKind === "profile" ? "profile_name" : params.targetKind === "user" ? "user_name" : "role_name"} = ${quoteString(params.targetName)} AND setting_name = ${quoteString(params.setting)}`,
          comparator: "gte",
          threshold: 1,
          withinSeconds: 30,
        },
        internal: null,
      };
    }
    case "optimize_partition":
      return {
        statements: [`OPTIMIZE TABLE ${table(params.database, params.table)} PARTITION ID ${quoteString(params.partitionId)}${params.final ? " FINAL" : ""}`],
        preview: `Merge partition ${params.partitionId} of ${params.database}.${params.table}${params.final ? " (FINAL)" : ""}`,
        rollback: null,
        approvalClass: 1,
        windowOnly: true,
        verification: { description: "Active parts in the partition dropped", sql: `SELECT count() AS value FROM system.parts WHERE active AND database = ${quoteString(params.database)} AND table = ${quoteString(params.table)} AND partition_id = ${quoteString(params.partitionId)}`, comparator: "lte", threshold: 10, withinSeconds: 1800 },
        internal: null,
      };
    case "restart_replica":
      return {
        statements: [`SYSTEM RESTART REPLICA ${table(params.database, params.table)}`],
        preview: `Restart replica of ${params.database}.${params.table}`,
        rollback: null,
        approvalClass: 2,
        windowOnly: false,
        verification: { description: "The replica is writable again", sql: `SELECT toUInt8(is_readonly) AS value FROM system.replicas WHERE database = ${quoteString(params.database)} AND table = ${quoteString(params.table)}`, comparator: "eq", threshold: 0, withinSeconds: 300 },
        internal: null,
      };
    case "add_skip_index":
      return {
        statements: [`ALTER TABLE ${table(params.database, params.table)} ADD INDEX ${quoteIdent(params.name)} ${params.expression} TYPE ${params.indexType} GRANULARITY ${params.granularity}`],
        preview: `Add ${params.indexType} skip index ${params.name} on ${params.expression} to ${params.database}.${params.table}`,
        rollback: [`ALTER TABLE ${table(params.database, params.table)} DROP INDEX ${quoteIdent(params.name)}`],
        approvalClass: 2,
        windowOnly: false,
        verification: { description: "The index exists", sql: `SELECT count() AS value FROM system.data_skipping_indices WHERE database = ${quoteString(params.database)} AND table = ${quoteString(params.table)} AND name = ${quoteString(params.name)}`, comparator: "eq", threshold: 1, withinSeconds: 60 },
        internal: null,
      };
    case "modify_ttl": {
      const previous = (prior.ttl ?? "").trim();
      return {
        statements: [`ALTER TABLE ${table(params.database, params.table)} MODIFY TTL ${params.ttl}`],
        preview: `Set TTL of ${params.database}.${params.table} to ${params.ttl}`,
        rollback: [previous ? `ALTER TABLE ${table(params.database, params.table)} MODIFY TTL ${previous}` : `ALTER TABLE ${table(params.database, params.table)} REMOVE TTL`],
        approvalClass: 2,
        windowOnly: true,
        verification: { description: "The table TTL is set", sql: `SELECT toUInt8(position(create_table_query, 'TTL') > 0) AS value FROM system.tables WHERE database = ${quoteString(params.database)} AND name = ${quoteString(params.table)}`, comparator: "eq", threshold: 1, withinSeconds: 60 },
        internal: null,
      };
    }
    case "modify_column_codec": {
      const previous = (prior.codec ?? "").trim();
      const ref = table(params.database, params.table);
      return {
        statements: [`ALTER TABLE ${ref} MODIFY COLUMN ${quoteIdent(params.column)} CODEC(${params.codec})`],
        preview: `Change codec of ${params.database}.${params.table}.${params.column} to ${params.codec}`,
        rollback: [previous ? `ALTER TABLE ${ref} MODIFY COLUMN ${quoteIdent(params.column)} ${previous}` : `ALTER TABLE ${ref} MODIFY COLUMN ${quoteIdent(params.column)} REMOVE CODEC`],
        approvalClass: 2,
        windowOnly: true,
        verification: { description: "The new codec is set", sql: `SELECT toUInt8(position(compression_codec, ${quoteString(params.codec.split("(")[0])}) > 0) AS value FROM system.columns WHERE database = ${quoteString(params.database)} AND table = ${quoteString(params.table)} AND name = ${quoteString(params.column)}`, comparator: "eq", threshold: 1, withinSeconds: 60 },
        internal: null,
      };
    }
    case "restart_engine_table":
      return {
        statements: [`DETACH TABLE ${table(params.database, params.table)}`, `ATTACH TABLE ${table(params.database, params.table)}`],
        preview: `Restart engine table ${params.database}.${params.table} (detach + attach)`,
        rollback: null,
        approvalClass: 1,
        windowOnly: false,
        verification: { description: "The table is attached again", sql: `SELECT count() AS value FROM system.tables WHERE database = ${quoteString(params.database)} AND name = ${quoteString(params.table)}`, comparator: "eq", threshold: 1, withinSeconds: 60 },
        internal: null,
      };
    case "reload_dictionary":
      return {
        statements: [`SYSTEM RELOAD DICTIONARY ${table(params.database, params.name)}`],
        preview: `Reload dictionary ${params.database}.${params.name}`,
        rollback: null,
        approvalClass: 1,
        windowOnly: false,
        verification: { description: "The dictionary is loaded", sql: `SELECT toUInt8(status = 'LOADED') AS value FROM system.dictionaries WHERE database = ${quoteString(params.database)} AND name = ${quoteString(params.name)}`, comparator: "eq", threshold: 1, withinSeconds: 120 },
        internal: null,
      };
    case "refresh_view":
      return {
        statements: [`SYSTEM REFRESH VIEW ${table(params.database, params.view)}`],
        preview: `Refresh view ${params.database}.${params.view} now`,
        rollback: null,
        approvalClass: 1,
        windowOnly: false,
        verification: { description: "The last refresh succeeded", sql: `SELECT toUInt8(exception = '') AS value FROM system.view_refreshes WHERE database = ${quoteString(params.database)} AND view = ${quoteString(params.view)}`, comparator: "eq", threshold: 1, withinSeconds: 600 },
        internal: null,
      };
    case "flush_distributed":
      return {
        statements: [`SYSTEM FLUSH DISTRIBUTED ${table(params.database, params.table)}`],
        preview: `Flush pending Distributed inserts of ${params.database}.${params.table}`,
        rollback: null,
        approvalClass: 1,
        windowOnly: false,
        verification: { description: "The distribution queue is empty", sql: `SELECT toUInt64(coalesce(sum(data_files), 0)) AS value FROM system.distribution_queue WHERE database = ${quoteString(params.database)} AND table = ${quoteString(params.table)}`, comparator: "eq", threshold: 0, withinSeconds: 300 },
        internal: null,
      };
  }
}

export function compare(value: number, comparator: VerificationSpec["comparator"], threshold: number): boolean {
  switch (comparator) {
    case "eq":
      return value === threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
  }
}

/** Which ClickHouse grants the remediation credential needs per action type (shown in the UI). */
export const REQUIRED_GRANTS: Record<ActionType, string | null> = {
  kill_query: "KILL QUERY",
  pause_scheduled_job: null,
  resume_scheduled_job: null,
  delay_scheduled_job: null,
  set_profile_setting: "ALTER USER, ALTER ROLE, ALTER SETTINGS PROFILE",
  optimize_partition: "OPTIMIZE",
  restart_replica: "SYSTEM RESTART REPLICA",
  add_skip_index: "ALTER ADD INDEX, ALTER DROP INDEX",
  modify_ttl: "ALTER MODIFY TTL",
  modify_column_codec: "ALTER MODIFY COLUMN",
  restart_engine_table: "DETACH TABLE (via DROP TABLE grant), CREATE TABLE",
  reload_dictionary: "SYSTEM RELOAD DICTIONARY",
  refresh_view: "SYSTEM VIEWS",
  flush_distributed: "SYSTEM FLUSH DISTRIBUTED",
};
