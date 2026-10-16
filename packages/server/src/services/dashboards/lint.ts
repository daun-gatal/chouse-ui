/**
 * Panel lint (ADR 0021 §9): charts that render and are wrong. The same rules
 * run in the editor, on save and on AI drafts. A finding never blocks a save
 * and is never applied for the user; where the fix is mechanical it carries the
 * fixed SQL for the user to apply.
 */

import { scanMacros } from "./macros";
import { NUMERIC_TYPES, TIME_SERIES_TYPES, type VizSpec } from "./spec";

export type LintCode =
  | "cumulative_counter"
  | "missing_unit"
  | "avg_of_quantiles"
  | "unbounded_log_scan"
  | "pie_without_limit";

export interface LintFinding {
  code: LintCode;
  message: string;
  /** The panel SQL with the fix applied, when the fix is mechanical. */
  fixedSql?: string;
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
