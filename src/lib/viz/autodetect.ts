/**
 * A starting viz spec for a query result, from its column types (ADR 0021 §12):
 * what the SQL workspace's Chart tab and a new panel open with. It is only a
 * suggestion — the user sees every field and changes what they want — and it
 * is always a valid spec.
 */

import { MAX_Y_COLUMNS, type Unit, type VizSpec } from "./spec";
import type { ResultColumn } from "./resolve";

const NUMERIC_RE = /^(?:Nullable\()?(?:LowCardinality\()?(?:U?Int\d+|Float\d+|Decimal)/i;
const TIME_RE = /^(?:Nullable\()?(?:Date|DateTime)/i;

export function isNumericType(type: string): boolean {
  return NUMERIC_RE.test(type);
}

export function isTimeType(type: string): boolean {
  return TIME_RE.test(type);
}

/** A unit from a column name's usual suffix (`duration_ms`, `read_bytes`…). */
export function unitFromName(name: string): Unit {
  const n = name.toLowerCase();
  if (/(^|_)ms$|_ms_|milliseconds/.test(n)) return "ms";
  if (/(^|_)us$|microseconds/.test(n)) return "us";
  if (/bytes|(^|_)size$/.test(n)) return "bytes";
  if (/(^|_)pct$|percent/.test(n)) return "percent";
  if (/per_s(ec)?$|_rate$|qps$/.test(n)) return "per_s";
  if (/(^|_)rows$/.test(n)) return "rows";
  if (/(^|_)(seconds|secs|sec|s)$|delay$/.test(n)) return "s";
  return "count";
}

function base(): Omit<VizSpec, "type" | "x" | "y" | "unit"> {
  return { version: 2, series: null, decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null };
}

export function suggestSpec(columns: ResultColumn[], rowCount: number): VizSpec {
  const numeric = columns.filter((c) => isNumericType(c.type));
  const time = columns.find((c) => isTimeType(c.type));
  const category = columns.find((c) => !isNumericType(c.type) && !isTimeType(c.type));

  if (time && numeric.length > 0) {
    const y = numeric.filter((c) => c.name !== time.name).slice(0, MAX_Y_COLUMNS);
    if (y.length > 0) {
      // One measure plus one text column reads as one line per value of that column.
      const series = y.length === 1 && category ? category.name : null;
      return { ...base(), type: "line", x: time.name, y: y.map((c) => c.name), series, unit: unitFromName(y[0].name) };
    }
  }
  if (rowCount === 1 && numeric.length >= 1 && columns.length <= 2) {
    return { ...base(), type: "stat", x: null, y: [numeric[0].name], unit: unitFromName(numeric[0].name), reduce: "last" };
  }
  if (category && numeric.length > 0) {
    const y = numeric.slice(0, MAX_Y_COLUMNS);
    return { ...base(), type: rowCount > 8 ? "horizontal_bar" : "bar", x: category.name, y: y.map((c) => c.name), unit: unitFromName(y[0].name) };
  }
  if (numeric.length >= 2) {
    return { ...base(), type: "line", x: numeric[0].name, y: numeric.slice(1, MAX_Y_COLUMNS + 1).map((c) => c.name), unit: unitFromName(numeric[1].name) };
  }
  return { ...base(), type: "table", x: null, y: [], unit: "none" };
}
