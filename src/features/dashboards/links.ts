/**
 * Drill-down (ADR 0023 §6): what a click on a chart's datum or a table's row
 * does for each of the panel's links. A link that needs a value the datum does
 * not have is an error the user sees — it is never followed with that part
 * left out.
 */

import { explorerPath } from "@/lib/explorerPath";
import { IDENTIFIER_RE, type Link, type LinkValue, type TimeRange, type Variable, type VariableValue } from "@/lib/viz/spec";

export type LinkAction =
  | { kind: "navigate"; to: string }
  | { kind: "filter"; variable: string; value: VariableValue }
  | { kind: "error"; message: string };

function valueOf(ref: LinkValue, datum: Record<string, unknown>): { ok: true; value: string } | { ok: false; message: string } {
  if (ref.from === "value") return { ok: true, value: ref.value };
  if (!(ref.column in datum)) return { ok: false, message: `The clicked point has no ${ref.column} (a split chart's point only has its x and the series)` };
  const raw = datum[ref.column];
  if (raw === null || raw === undefined) return { ok: false, message: `${ref.column} is empty here` };
  return { ok: true, value: typeof raw === "object" ? JSON.stringify(raw) : String(raw) };
}

/** The range part of a dashboard link: the current view's range. */
export function rangeParams(range: TimeRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.kind === "relative") params.set("range", range.value);
  else {
    params.set("from", String(range.from));
    params.set("to", String(range.to));
  }
  return params;
}

export function linkAction(link: Link, datum: Record<string, unknown>, range: TimeRange, variables: Variable[]): LinkAction {
  switch (link.kind) {
    case "dashboard": {
      const params = rangeParams(range);
      for (const [name, ref] of Object.entries(link.values)) {
        const value = valueOf(ref, datum);
        if (!value.ok) return { kind: "error", message: value.message };
        params.append(`var-${name}`, value.value);
      }
      return { kind: "navigate", to: `/dashboards/${encodeURIComponent(link.dashboardId)}?${params.toString()}` };
    }
    case "filter": {
      const variable = variables.find((v) => v.name === link.variable);
      if (!variable) return { kind: "error", message: `This dashboard has no variable ${link.variable}` };
      const value = valueOf({ from: "column", column: link.column }, datum);
      if (!value.ok) return { kind: "error", message: value.message };
      if (variable.kind === "identifier" && !IDENTIFIER_RE.test(value.value)) return { kind: "error", message: `${variable.label} takes a database or table name, not "${value.value}"` };
      return { kind: "filter", variable: variable.name, value: variable.kind === "multi" ? [value.value] : value.value };
    }
    case "explorer": {
      const database = valueOf(link.database, datum);
      if (!database.ok) return { kind: "error", message: database.message };
      const table = valueOf(link.table, datum);
      if (!table.ok) return { kind: "error", message: table.message };
      return { kind: "navigate", to: explorerPath(database.value, table.value) };
    }
  }
}

/** The SQL a "queries in this bucket" tab starts with: the slowest finished queries in that window. */
export function bucketQueriesSql(fromMs: number, toMs: number): string {
  const from = Math.floor(fromMs / 1000);
  const to = Math.ceil(toMs / 1000);
  return [
    "SELECT event_time, user, query_duration_ms, read_rows, formatReadableSize(read_bytes) AS read, substring(query, 1, 500) AS query",
    "FROM system.query_log",
    `WHERE type = 'QueryFinish' AND event_time >= toDateTime(${from}) AND event_time < toDateTime(${to})`,
    "ORDER BY query_duration_ms DESC",
    "LIMIT 100",
  ].join("\n");
}
