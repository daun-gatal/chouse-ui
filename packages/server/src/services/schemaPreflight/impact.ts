/**
 * Schema change preflight (ADR 0016 §11): what a DDL statement breaks or
 * affects before it runs — views and materialized views, dictionaries,
 * Distributed tables, scheduled jobs, Data Health promises, saved queries and
 * agents. A statement that breaks dependents needs `schema:override` and an
 * explicit confirmation (§18: Admin and Super admin hold it by default).
 */

import { all, json, num, one, sql, str } from "../observe/db";
import { parseDistributed } from "../observe/catalogParse";
import { parseDdl, referencesColumn, referencesTable, type ColumnChange, type ParsedDdl } from "./parse";

export type ImpactSeverity = "breaks" | "affects" | "info";
export type ImpactKind = "view" | "materialized_view" | "dictionary" | "distributed" | "scheduled_job" | "promise" | "saved_query" | "agent" | "replication";

export interface ImpactItem {
  severity: ImpactSeverity;
  kind: ImpactKind;
  ref: string;
  label: string;
  reason: string;
}

export interface PreflightResult {
  parsed: ParsedDdl;
  analyzed: boolean;
  breaking: boolean;
  items: ImpactItem[];
  notes: string[];
  saferPlan: string | null;
}

interface Target {
  database: string;
  table: string;
}

function changeColumns(changes: ColumnChange[]): { removed: string[]; renamed: Array<{ from: string; to: string }>; modified: string[]; added: string[] } {
  const removed: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const modified: string[] = [];
  const added: string[] = [];
  for (const c of changes) {
    if (c.op === "drop_column") removed.push(c.column);
    if (c.op === "rename_column") renamed.push({ from: c.column, to: c.to });
    if (c.op === "modify_column") modified.push(c.column);
    if (c.op === "add_column") added.push(c.column);
  }
  return { removed, renamed, modified, added };
}

/** Classify one dependent text (view SELECT, job SQL, saved query) against the change. */
function classifyReference(text: string, target: Target, parsed: ParsedDdl, sameDatabase: boolean): { severity: ImpactSeverity; reason: string } | null {
  if (!referencesTable(text, target.database, target.table, sameDatabase)) return null;
  switch (parsed.kind) {
    case "drop_table":
      return { severity: "breaks", reason: `reads ${target.database}.${target.table}, which would be dropped` };
    case "rename_table":
      return { severity: "breaks", reason: `reads ${target.database}.${target.table} by name, which would be renamed` };
    case "drop_database":
      return { severity: "breaks", reason: `reads ${target.database}.${target.table}, whose database would be dropped` };
    case "exchange_tables":
      return { severity: "affects", reason: "reads a table whose contents would be swapped" };
    case "truncate":
      return { severity: "info", reason: "reads a table that would be emptied" };
    case "alter": {
      const { removed, renamed, modified } = changeColumns(parsed.changes);
      const gone = [...removed, ...renamed.map((r) => r.from)].filter((c) => referencesColumn(text, c));
      if (gone.length > 0) return { severity: "breaks", reason: `references column ${gone.join(", ")}, which would no longer exist` };
      const retyped = modified.filter((c) => referencesColumn(text, c));
      if (retyped.length > 0) return { severity: "affects", reason: `references column ${retyped.join(", ")}, whose type would change` };
      return null;
    }
    default:
      return null;
  }
}

function targetsOf(parsed: ParsedDdl, defaultDatabase: string): Target[] {
  switch (parsed.kind) {
    case "alter":
    case "drop_table":
    case "truncate":
    case "rename_table":
      return [{ database: parsed.database ?? defaultDatabase, table: parsed.table }];
    case "exchange_tables":
      return [{ database: parsed.database ?? defaultDatabase, table: parsed.table }, { database: parsed.otherDatabase ?? defaultDatabase, table: parsed.otherTable }];
    default:
      return [];
  }
}

export async function analyzeDdl(connectionId: string, statement: string, defaultDatabase: string): Promise<PreflightResult> {
  const parsed = parseDdl(statement);
  const result: PreflightResult = { parsed, analyzed: parsed.kind !== "unknown", breaking: false, items: [], notes: [], saferPlan: null };
  if (parsed.kind === "unknown") {
    result.notes.push("Impact is not analysed for this statement type; review dependents manually.");
    return result;
  }
  let targets = targetsOf(parsed, defaultDatabase);
  if (parsed.kind === "drop_database") {
    targets = (await all(sql`SELECT table_name FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND database_name = ${parsed.database}`)).map((r) => ({ database: parsed.database, table: str(r.table_name) }));
  }
  const objects = await all(sql`SELECT database_name, table_name, engine, engine_full, create_query FROM obs_catalog_tables WHERE connection_id = ${connectionId}`);
  const jobs = await all(sql`SELECT id, name, query, dest_database, dest_table FROM scheduled_queries WHERE connection_id = ${connectionId}`);
  const saved = await all(sql`SELECT id, name, query FROM rbac_saved_queries WHERE connection_id = ${connectionId} OR connection_id IS NULL`);
  const add = (item: ImpactItem): void => {
    if (!result.items.some((i) => i.kind === item.kind && i.ref === item.ref)) result.items.push(item);
  };

  for (const target of targets) {
    const fq = `${target.database}.${target.table}`;
    const self = objects.find((o) => str(o.database_name) === target.database && str(o.table_name) === target.table);
    for (const o of objects) {
      const engine = str(o.engine);
      const objectFq = `${str(o.database_name)}.${str(o.table_name)}`;
      if (objectFq === fq) continue;
      if (parsed.kind === "drop_database" && str(o.database_name) === parsed.database) continue;
      const createQuery = str(o.create_query);
      if (engine === "MaterializedView" || engine === "View" || engine === "Dictionary") {
        const verdict = classifyReference(createQuery, target, parsed, str(o.database_name) === target.database);
        if (verdict) {
          const kind: ImpactKind = engine === "MaterializedView" ? "materialized_view" : engine === "View" ? "view" : "dictionary";
          const reason = engine === "MaterializedView" && verdict.severity === "breaks"
            ? `${verdict.reason}; every insert into ${fq} would then fail (queue engines would retry forever)`
            : verdict.reason;
          add({ severity: verdict.severity, kind, ref: objectFq, label: objectFq, reason });
        }
      }
      const dest = engine === "Distributed" ? parseDistributed(str(o.engine_full), str(o.database_name)) : null;
      if (dest && dest.database === target.database && dest.table === target.table) {
        const severity: ImpactSeverity = parsed.kind === "drop_table" || parsed.kind === "rename_table" || parsed.kind === "drop_database" ? "breaks" : parsed.kind === "alter" ? "affects" : "info";
        add({ severity, kind: "distributed", ref: objectFq, label: objectFq, reason: severity === "breaks" ? `forwards inserts to ${fq}` : `forwards to ${fq}; keep the schemas in sync on every shard` });
      }
    }
    for (const job of jobs) {
      const verdict = classifyReference(str(job.query), target, parsed, false);
      if (verdict) add({ severity: verdict.severity, kind: "scheduled_job", ref: str(job.id), label: str(job.name), reason: verdict.reason });
      if (str(job.dest_database) === target.database && str(job.dest_table) === target.table && (parsed.kind === "drop_table" || parsed.kind === "rename_table")) {
        add({ severity: "affects", kind: "scheduled_job", ref: str(job.id), label: str(job.name), reason: `materializes into ${fq}` });
      }
    }
    for (const q of saved) {
      const verdict = classifyReference(str(q.query), target, parsed, false);
      if (verdict) add({ severity: verdict.severity === "breaks" ? "affects" : verdict.severity, kind: "saved_query", ref: str(q.id), label: str(q.name), reason: verdict.reason });
    }

    // Data Health promises on the table.
    const promises = await all(sql`SELECT id, name, event_time_column FROM data_health_promises WHERE connection_id = ${connectionId} AND database_name = ${target.database} AND table_name = ${target.table}`);
    for (const p of promises) {
      if (parsed.kind === "drop_table" || parsed.kind === "rename_table" || parsed.kind === "drop_database") {
        add({ severity: "breaks", kind: "promise", ref: str(p.id), label: str(p.name), reason: `monitors ${fq}` });
        continue;
      }
      if (parsed.kind !== "alter") continue;
      const { removed, renamed, modified, added } = changeColumns(parsed.changes);
      const gone = new Set([...removed, ...renamed.map((r) => r.from)]);
      const checks = await all(sql`SELECT type, config FROM data_health_promise_checks WHERE promise_id = ${str(p.id)}`);
      const reasons: string[] = [];
      if (p.event_time_column && gone.has(str(p.event_time_column))) reasons.push(`event-time column ${str(p.event_time_column)} would disappear`);
      for (const c of checks) {
        const config = json<Record<string, unknown>>(c.config, {});
        const text = JSON.stringify(config);
        for (const col of gone) if (referencesColumn(text, col)) reasons.push(`a ${str(c.type)} check uses ${col}`);
        if (str(c.type) === "schema_contract") {
          const expected = (config.expectedColumns as Array<{ name: string }> | undefined) ?? [];
          if (expected.some((e) => gone.has(e.name) || modified.includes(e.name))) reasons.push("the schema contract expects the old column definition");
          if (added.length > 0 && config.allowAdditionalColumns === false) reasons.push("the schema contract forbids additional columns");
        }
      }
      if (reasons.length > 0) add({ severity: "breaks", kind: "promise", ref: str(p.id), label: str(p.name), reason: [...new Set(reasons)].join("; ") });
    }

    // Agents that read the table in the last 7 days.
    const agents = await one(sql`
      SELECT COUNT(DISTINCT principal_id) AS n, SUM(reads) AS reads FROM obs_usage_rollups
      WHERE connection_id = ${connectionId} AND database_name = ${target.database} AND table_name = ${target.table} AND principal_kind = 'agent' AND day >= ${Date.now() - 7 * 86_400_000}`);
    if (agents && num(agents.n) > 0) {
      add({ severity: "affects", kind: "agent", ref: fq, label: `${num(agents.n)} agents`, reason: `${num(agents.reads)} agent queries read ${fq} this week; agent context updates on apply` });
    }

    if (self && str(self.engine).startsWith("Replicated") && "onCluster" in parsed && !parsed.onCluster && parsed.kind !== "truncate") {
      result.notes.push(`${fq} is replicated; without ON CLUSTER the change applies to this replica only for statements that are not replicated.`);
    }
    if (parsed.kind === "alter") {
      const rename = parsed.changes.find((c): c is Extract<ColumnChange, { op: "rename_column" }> => c.op === "rename_column");
      if (rename && result.items.some((i) => i.severity === "breaks")) {
        const columnType = await one(sql`SELECT column_type FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${target.database} AND table_name = ${target.table} AND column_name = ${rename.column}`);
        const type = columnType ? str(columnType.column_type) : "<type>";
        result.saferPlan = [
          `-- Step 1 · now, nothing breaks: expose the new name as an alias`,
          `ALTER TABLE \`${target.database}\`.\`${target.table}\` ADD COLUMN \`${rename.to}\` ${type} ALIAS \`${rename.column}\`;`,
          ``,
          `-- Step 2 · move dependents to \`${rename.to}\`: ${result.items.filter((i) => i.severity === "breaks").map((i) => i.label).join(", ")}`,
          ``,
          `-- Step 3 · once nothing reads \`${rename.column}\` (check Coverage & usage), swap the columns in a later change.`,
        ].join("\n");
      }
    }
  }
  result.breaking = result.items.some((i) => i.severity === "breaks");
  return result;
}
