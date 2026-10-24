/**
 * What the browser does for CHouse Assistant's UI tools (ADR 0025 §5). The
 * server validated the call; the browser checks again with its own rules, so
 * a model can only ever open CHouse's own pages or put SQL in a new editor
 * tab — never run, save, or go elsewhere.
 */

export type UiAction =
  | { kind: "navigate"; path: string }
  | { kind: "fill_sql"; sql: string };

export const UI_TOOL_NAMES: readonly string[] = ["navigate", "open_entity", "fill_form"];

const NAVIGABLE = ["/fleet", "/overview", "/monitoring", "/dashboards", "/data", "/ai", "/explorer", "/admin", "/preferences", "/doctor"];
const PATH_PATTERN = /^\/[A-Za-z0-9\-_/.~%?=&+:,]*$/;
const MAX_SQL = 20_000;

/** One of CHouse's own pages, or null. */
export function safeAppPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (path.length > 300 || !PATH_PATTERN.test(path) || path.startsWith("//") || path.includes("..")) return null;
  const bare = path.split(/[?#]/)[0];
  return NAVIGABLE.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`)) ? path : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const enc = encodeURIComponent;

function entityPath(args: Record<string, unknown>): string | null {
  const id = str(args.id);
  switch (args.kind) {
    case "incident":
      return id && (args.source === "data_health" || args.source === "observe") ? `/data/incidents/${args.source}/${enc(id)}` : null;
    case "scheduled_job":
      return id ? `/data/scheduled-queries/jobs?job=${enc(id)}` : null;
    case "dashboard":
      return id ? `/dashboards/${enc(id)}` : null;
    case "dataset": {
      const database = str(args.database);
      const table = str(args.table);
      return database && table ? `/data/datasets/${enc(database)}/${enc(table)}` : null;
    }
    case "doctor_report":
      return id ? `/doctor/${enc(id)}` : null;
    case "health_promises":
      return "/data/datasets?view=promises";
    case "data_incidents":
      return "/data/incidents";
    case "approvals":
      return "/ai/approvals";
    default:
      return null;
  }
}

/** The browser's part of a finished UI tool call, or null when there is none it may do. */
export function uiActionFor(step: { name: string; args: Record<string, unknown> }): UiAction | null {
  if (step.name === "navigate") {
    const path = safeAppPath(step.args.path);
    return path ? { kind: "navigate", path } : null;
  }
  if (step.name === "open_entity") {
    const path = safeAppPath(entityPath(step.args));
    return path ? { kind: "navigate", path } : null;
  }
  if (step.name === "fill_form" && step.args.form === "sql_editor") {
    const values = step.args.values;
    const sql = values && typeof values === "object" && "sql" in values ? str(values.sql) : null;
    return sql && sql.length <= MAX_SQL ? { kind: "fill_sql", sql } : null;
  }
  return null;
}
