/**
 * Panel lint (ADR 0021 §9): charts that render and are wrong. The same rules
 * run in the editor, on save and on AI drafts. A finding never blocks a save
 * and is never applied for the user; where the fix is mechanical it carries the
 * fixed SQL for the user to apply.
 */

import { scanMacros } from "./macros";
import { isTimeType } from "./time";
import { NUMERIC_TYPES, TIME_SERIES_TYPES, type VizSpec } from "./spec";

export type LintCode =
  | "cumulative_counter"
  | "missing_unit"
  | "avg_of_quantiles"
  | "unbounded_log_scan"
  | "pie_without_limit"
  | ChartFitCode;

/** Chart-fit findings (ADR 0023 §4): read from a result, not from the SQL. */
export type ChartFitCode = "too_many_slices" | "time_axis_not_time" | "too_many_series" | "too_many_categories";

export interface LintFinding {
  code: LintCode;
  message: string;
  /** The panel SQL with the fix applied, when the fix is mechanical. */
  fixedSql?: string;
  /** The chart settings with the fix applied, when the fix is mechanical. */
  fixedViz?: VizSpec;
}

/** The SQL with quoted strings, quoted identifiers and comments blanked out. */
export function codeOnly(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      const stop = Math.min(j + 1, sql.length);
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** System tables whose numbers only ever grow. */
const CUMULATIVE_TABLE_RE = /\bsystem\s*\.\s*(events|errors|kafka_consumers)\b/i;
const DELTA_FN_RE = /\b(runningDifference|lagInFrame|deltaSum|deltaSumTimestamp|nonNegativeDerivative|neighbor)\s*\(/i;
const AVG_QUANTILE_RE = /\bavg\s*\(\s*quantile\w*\s*\(/i;
const SYSTEM_LOG_RE = /\bsystem\s*\.\s*(\w+_log)\b/i;
const LIMIT_RE = /\blimit\b/i;
const TRAILING_CLAUSE_RE = /\b(settings|format)\b/i;

export function lintPanel(sql: string, viz: VizSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  const code = codeOnly(sql);

  const counter = CUMULATIVE_TABLE_RE.exec(code);
  if (TIME_SERIES_TYPES.has(viz.type) && counter && !DELTA_FN_RE.test(code)) {
    findings.push({
      code: "cumulative_counter",
      message: `system.${counter[1]} holds running totals, so this line only ever goes up. Plot the change per bucket instead (for example with runningDifference), or read per-interval values from system.metric_log.`,
    });
  }

  if (NUMERIC_TYPES.has(viz.type) && viz.type !== "histogram" && viz.unit === "none") {
    findings.push({
      code: "missing_unit",
      message: "Pick a unit so the axis says what the numbers are. Use count for plain counts.",
    });
  }

  if (AVG_QUANTILE_RE.test(code)) {
    findings.push({
      code: "avg_of_quantiles",
      message: "An average of quantiles is not a quantile of the data. Compute the quantile over the raw values for the whole bucket instead.",
    });
  }

  const log = SYSTEM_LOG_RE.exec(code);
  const scan = scanMacros(sql);
  const usesFrom = scan.ok && scan.tokens.some((t) => t.macro.kind === "from");
  if (log && !usesFrom) {
    findings.push({
      code: "unbounded_log_scan",
      message: `system.${log[1]} grows without bound, so this reads all of it on every refresh. Add WHERE event_time >= {{from}} AND event_time < {{to}}.`,
    });
  }

  if ((viz.type === "pie" || viz.type === "donut") && !LIMIT_RE.test(code)) {
    const trimmed = sql.trimEnd().replace(/;\s*$/, "");
    const mechanical = !TRAILING_CLAUSE_RE.test(code);
    findings.push({
      code: "pie_without_limit",
      message: "A pie with many slices is unreadable. Order by the value and keep the top 12.",
      ...(mechanical ? { fixedSql: `${trimmed}\nLIMIT 12` } : {}),
    });
  }

  return findings;
}

// ============================================
// Chart fit (ADR 0023 §4)
// ============================================

const SLICE_TYPES = new Set<VizSpec["type"]>(["pie", "donut", "treemap", "funnel"]);
const BAR_TYPES = new Set<VizSpec["type"]>(["bar", "horizontal_bar", "grouped_bar", "stacked_bar"]);
export const MAX_SLICES = 8;
export const MAX_FIT_SERIES = 12;
export const MAX_CATEGORIES = 50;

export { isTimeType };

export interface FitResult {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
}

/**
 * Whether the chart suits what the query returned: too many slices, a trend
 * over something that is not time, too many series, too many bars. Run on a
 * real result (the AI draft's dry run, the editor's preview), so it never
 * guesses from the SQL.
 */
export function chartFit(viz: VizSpec, result: FitResult): LintFinding[] {
  const findings: LintFinding[] = [];
  const rows = result.rows.length;
  if (SLICE_TYPES.has(viz.type) && rows > MAX_SLICES) {
    findings.push({
      code: "too_many_slices",
      message: `The query returned ${rows} rows: a ${viz.type} with more than ${MAX_SLICES} slices is unreadable. Show them as horizontal bars.`,
      fixedViz: { ...viz, type: "horizontal_bar" },
    });
  }
  if (TIME_SERIES_TYPES.has(viz.type) && viz.x !== null) {
    const x = result.columns.find((c) => c.name === viz.x);
    if (x && !isTimeType(x.type)) {
      findings.push({
        code: "time_axis_not_time",
        message: `${viz.x} is ${x.type}, not a date or time, so a ${viz.type} draws a trend that is not there. Show it as bars.`,
        fixedViz: { ...viz, type: "bar", baseline: null },
      });
    }
  }
  const series = viz.series;
  if (series !== null) {
    const distinct = new Set(result.rows.map((row) => String(row[series]))).size;
    if (distinct > MAX_FIT_SERIES) {
      findings.push({
        code: "too_many_series",
        message: `Splitting by ${series} makes ${distinct} series; keep the top ${MAX_FIT_SERIES} with a subquery and LIMIT, or filter with a variable.`,
      });
    }
  }
  if (BAR_TYPES.has(viz.type) && rows > MAX_CATEGORIES) {
    findings.push({
      code: "too_many_categories",
      message: `The query returned ${rows} bars; aggregate further or keep the top ${MAX_CATEGORIES} with ORDER BY … LIMIT.`,
    });
  }
  return findings;
}
