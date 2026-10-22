/**
 * Panel rollups (ADR 0023 §10): whether a panel's SQL can be served from a
 * pre-aggregated table, and the SQL that reads it once it exists.
 *
 * A panel is eligible when its SQL is one SELECT from one table, bucketing a
 * time column with toStartOfInterval(col, INTERVAL {{interval_s}} SECOND),
 * bounded by col >= {{from}} AND col < {{to}}, with any other WHERE conditions
 * plain column-to-value comparisons, grouped by the bucket and plain columns,
 * and selecting only those and aggregate calls on plain columns. Anything else
 * is not eligible, with the first reason. Parsing uses node-sql-parser, as the
 * read-only validator does.
 *
 * The plan is fully typed — columns, aggregate kinds and comparisons — so the
 * remediation catalog builds every statement from it without free-form SQL.
 */

import { createHash } from "crypto";

import { Parser } from "node-sql-parser";

export const ROLLUP_AGGREGATES = ["count", "sum", "min", "max", "avg", "uniqExact"] as const;
export type RollupAggregate = (typeof ROLLUP_AGGREGATES)[number];
export const ROLLUP_OPS = ["=", "!=", "<", "<=", ">", ">="] as const;
export type RollupOp = (typeof ROLLUP_OPS)[number];

export interface RollupPlan {
  database: string;
  table: string;
  timeColumn: string;
  /** The bucket's output name in the panel. */
  bucketAlias: string;
  groups: Array<{ column: string; alias: string }>;
  aggregates: Array<{ fn: RollupAggregate; column: string | null; alias: string }>;
  filters: Array<{ column: string; op: RollupOp; value: string | number }>;
}

export type Eligibility = { ok: true; plan: RollupPlan } | { ok: false; reason: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const parser = new Parser();

// Stand-ins the parser can read; each must survive parsing unchanged so it can be recognised.
const FROM = "__chouse_from__";
const TO = "__chouse_to__";
const INTERVAL = 987_654_321;

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

function columnOf(node: unknown): string | null {
  if (!isNode(node) || node.type !== "column_ref" || node.table !== null) return null;
  const column = node.column;
  const name = isNode(column) && isNode(column.expr) ? column.expr.value : column;
  return typeof name === "string" && IDENT.test(name) ? name : null;
}

function functionName(node: Node): string | null {
  if (node.type === "aggr_func" && typeof node.name === "string") return node.name;
  if (node.type !== "function" || !isNode(node.name)) return null;
  const parts = Array.isArray(node.name.name) ? node.name.name : [];
  const first = parts[0];
  return isNode(first) && typeof first.value === "string" ? first.value : null;
}

function functionArgs(node: Node): unknown[] {
  if (node.type === "aggr_func") {
    const args = node.args;
    if (!isNode(args)) return [];
    if (isNode(args.expr) && args.expr.type === "star") return [];
    return args.expr === undefined ? [] : [args.expr];
  }
  const args = node.args;
  return isNode(args) && Array.isArray(args.value) ? args.value : [];
}

function literalOf(node: unknown): string | number | null {
  if (!isNode(node)) return null;
  if (node.type === "number" && typeof node.value === "number") return node.value;
  if ((node.type === "single_quote_string" || node.type === "string") && typeof node.value === "string") return node.value;
  return null;
}

function andTerms(node: unknown): unknown[] {
  if (isNode(node) && node.type === "binary_expr" && node.operator === "AND") return [...andTerms(node.left), ...andTerms(node.right)];
  return [node];
}

/** Whether the panel's SQL can be rolled up; the plan, or the first reason it cannot. */
export function analyzeRollup(sql: string): Eligibility {
  const no = (reason: string): Eligibility => ({ ok: false, reason });
  if (/\{\{\s*var\./.test(sql)) return no("it uses dashboard variables, which a rollup cannot pre-aggregate");
  const prepared = sql
    .replace(/\{\{\s*from\s*\}\}/g, `'${FROM}'`)
    .replace(/\{\{\s*to\s*\}\}/g, `'${TO}'`)
    .replace(/\{\{\s*interval_s\s*\}\}/g, String(INTERVAL))
    .trim()
    .replace(/;\s*$/, "");
  let ast: unknown;
  try {
    ast = parser.astify(prepared, { database: "postgresql" });
  } catch {
    return no("its SQL could not be parsed as one simple SELECT");
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) return no("it has more than one statement");
    ast = ast[0];
  }
  if (!isNode(ast) || ast.type !== "select") return no("it is not a SELECT");
  if (ast.with) return no("it uses WITH");
  if (ast._next || ast.set_op) return no("it uses UNION");
  if (ast.having) return no("it uses HAVING");
  if (isNode(ast.distinct) && ast.distinct.type) return no("it uses DISTINCT");
  const from = Array.isArray(ast.from) ? ast.from : [];
  if (from.length !== 1) return no(from.length === 0 ? "it reads no table" : "it reads more than one table (JOIN)");
  const source = from[0];
  if (!isNode(source) || typeof source.table !== "string" || source.join || source.expr) return no("it reads a subquery or a join, not one table");
  const database = typeof source.db === "string" ? source.db : null;
  if (!database) return no("its table must be written as database.table");
  if (!IDENT.test(database) || !IDENT.test(source.table)) return no("its table name is not a plain identifier");

  // The select list: one bucket, plain columns, aggregates.
  let bucket: { column: string; alias: string } | null = null;
  const groups: RollupPlan["groups"] = [];
  const aggregates: RollupPlan["aggregates"] = [];
  for (const item of Array.isArray(ast.columns) ? ast.columns : []) {
    if (!isNode(item)) return no("its select list could not be read");
    const expr = item.expr;
    const alias = typeof item.as === "string" ? item.as : null;
    const column = columnOf(expr);
    if (column) {
      groups.push({ column, alias: alias ?? column });
      continue;
    }
    if (!isNode(expr)) return no("its select list could not be read");
    if (isNode(expr) && expr.type === "star") return no("it selects *; name each column");
    const name = functionName(expr);
    const args = functionArgs(expr);
    if (name === "toStartOfInterval") {
      const [col, interval] = args;
      const timeColumn = columnOf(col);
      const usesMacro = isNode(interval) && interval.type === "interval" && isNode(interval.expr) && interval.expr.value === INTERVAL && String(interval.unit).toLowerCase() === "second";
      if (!timeColumn || !usesMacro) return no("its bucket must be toStartOfInterval(<time column>, INTERVAL {{interval_s}} SECOND)");
      if (bucket) return no("it has more than one time bucket");
      if (!alias) return no("its bucket needs a name (AS t)");
      bucket = { column: timeColumn, alias };
      continue;
    }
    const fn = ROLLUP_AGGREGATES.find((a) => a.toLowerCase() === (name ?? "").toLowerCase());
    if (!fn) return no(`${name ?? "an expression"} in the select list is not one of ${ROLLUP_AGGREGATES.join(", ")} on a plain column`);
    if (!alias) return no(`${fn}(…) needs a name (AS …)`);
    if (fn === "count") {
      if (args.length !== 0) return no("count must be count() (count(column) skips NULLs the rollup cannot tell apart)");
      aggregates.push({ fn, column: null, alias });
      continue;
    }
    const argColumn = args.length === 1 ? columnOf(args[0]) : null;
    if (!argColumn) return no(`${fn} must take one plain column`);
    aggregates.push({ fn, column: argColumn, alias });
  }
  if (!bucket) return no("it has no toStartOfInterval(<time column>, INTERVAL {{interval_s}} SECOND) bucket");
  if (aggregates.length === 0) return no("it computes no aggregates");
  const names = [bucket.alias, ...groups.map((g) => g.alias), ...aggregates.map((a) => a.alias)];
  if (new Set(names).size !== names.length) return no("two of its columns have the same name");

  // WHERE: the window on the bucket's column, and plain comparisons.
  let lower = false;
  let upper = false;
  const filters: RollupPlan["filters"] = [];
  for (const term of ast.where ? andTerms(ast.where) : []) {
    if (!isNode(term) || term.type !== "binary_expr") return no("its WHERE may only AND together comparisons");
    const op = String(term.operator);
    if (op === "OR") return no("its WHERE uses OR; only conditions joined by AND are supported");
    const column = columnOf(term.left);
    const value = literalOf(term.right);
    if (!column || value === null) return no("its WHERE may only compare a column with a value");
    if (value === FROM || value === TO) {
      if (column !== bucket.column) return no("{{from}} and {{to}} must bound the bucket's time column");
      if (value === FROM && op === ">=") lower = true;
      else if (value === TO && op === "<") upper = true;
      else return no("the window must be <time column> >= {{from}} AND <time column> < {{to}}");
      continue;
    }
    if (typeof value === "string" && value.includes("__chouse_")) return no("its WHERE uses a macro outside the window");
    const rollupOp = ROLLUP_OPS.find((o) => o === (op === "<>" ? "!=" : op));
    if (!rollupOp) return no(`its WHERE uses ${op}; only =, !=, <, <=, > and >= are supported`);
    filters.push({ column, op: rollupOp, value });
  }
  if (!lower || !upper) return no("it is not bounded by <time column> >= {{from}} AND <time column> < {{to}}");

  // GROUP BY: the bucket and every plain column, nothing else.
  const grouped = (isNode(ast.groupby) && Array.isArray(ast.groupby.columns) ? ast.groupby.columns : Array.isArray(ast.groupby) ? ast.groupby : []).map(columnOf);
  if (grouped.some((g) => g === null)) return no("its GROUP BY may only list the bucket and plain columns");
  const want = new Set([bucket.alias, ...groups.map((g) => g.alias)]);
  const have = new Set(grouped.map((g) => (g === bucket?.column ? bucket.alias : g)).filter((g): g is string => g !== null).map((g) => groups.find((x) => x.column === g)?.alias ?? g));
  if (want.size !== have.size || [...want].some((w) => !have.has(w))) return no("its GROUP BY must list the bucket and every plain column it selects");
  if (ast.limit && isNode(ast.limit) && Array.isArray(ast.limit.value) && ast.limit.value.length > 0) return no("it uses LIMIT");

  return { ok: true, plan: { database, table: source.table, timeColumn: bucket.column, bucketAlias: bucket.alias, groups, aggregates, filters } };
}

/** A stable name for the rollup of this plan: the same panel query always maps to the same table. */
export function rollupTarget(plan: RollupPlan): string {
  const hash = createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 12);
  return `chouse_rollup_${hash}`;
}

/** Whether a panel's SQL reads a rollup this feature made (the panel then says it has 1-minute resolution). */
export function readsRollup(sql: string): boolean {
  return /\bchouse_rollup_[0-9a-f]{12}\b/.test(sql);
}
