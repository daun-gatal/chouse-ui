/**
 * Guards for the Context AI draft: what evidence may reach the model, and
 * which of its suggestions survive. Everything the model returns is treated as
 * untrusted until it passes these checks.
 */

const METRIC_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Words allowed in a metric expression besides the table's own columns and function names. */
const EXPRESSION_KEYWORDS = new Set([
  "and", "or", "not", "in", "is", "null", "as", "case", "when", "then", "else", "end", "distinct",
  "true", "false", "like", "ilike", "between", "interval", "second", "minute", "hour", "day", "week", "month", "quarter", "year",
]);

/** Statements, subqueries and comments have no place in a single aggregate expression. */
const FORBIDDEN_EXPRESSION = /;|--|\/\*|\b(select|from|join|union|insert|alter|drop|create|system|settings|format)\b/i;

/** Blank out literals in logged query text so values typed into filters never reach the model. */
export function redactQueryLiterals(query: string): string {
  return query
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
    .replace(/\b\d{4,}\b/g, "?")
    .slice(0, 600);
}

/** Naming variants (`orders_v1`, `orders_old`, `orders_20240101`) share a stem; `use instead of` must point at one. */
export function tableStem(name: string): string {
  return name.toLowerCase().replace(/(_v\d+|_old|_new|_legacy|_deprecated|_tmp|_temp|_bak|_backup|_copy|_\d{6,8})+$/, "");
}

/**
 * Accept a metric expression only when it is a single aggregate over this
 * table's columns: at least one function call, no statements or subqueries,
 * and every bare identifier is a known column or SQL keyword.
 */
export function validMetricExpression(expression: string, columns: ReadonlySet<string>): boolean {
  const expr = expression.trim();
  if (!expr || expr.length > 500 || FORBIDDEN_EXPRESSION.test(expr)) return false;
  if (!/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(expr)) return false;
  const withoutLiterals = expr.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  for (const m of withoutLiterals.matchAll(/`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g)) {
    if (m[1] !== undefined) {
      if (!columns.has(m[1])) return false;
      continue;
    }
    if (m[3]) continue;
    const word = m[2];
    if (!columns.has(word) && !EXPRESSION_KEYWORDS.has(word.toLowerCase())) return false;
  }
  return true;
}

export interface DraftMetric {
  name: string;
  expression: string;
  description: string | null;
}

export function validMetrics(metrics: DraftMetric[], columns: ReadonlySet<string>, existingNames: ReadonlySet<string>): { metrics: DraftMetric[]; dropped: number } {
  const kept: DraftMetric[] = [];
  const seen = new Set(existingNames);
  let dropped = 0;
  for (const m of metrics.slice(0, 3)) {
    const name = m.name.trim();
    const expression = m.expression.trim();
    if (!METRIC_NAME.test(name) || seen.has(name) || !validMetricExpression(expression, columns)) {
      dropped++;
      continue;
    }
    seen.add(name);
    kept.push({ name, expression, description: m.description?.trim().slice(0, 500) || null });
  }
  return { metrics: kept, dropped: dropped + Math.max(0, metrics.length - 3) };
}

export function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const t = tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    if (/^[a-z0-9][a-z0-9_-]*$/.test(t)) out.add(t);
    if (out.size >= 8) break;
  }
  return [...out];
}

export function clip(value: string | null | undefined, max: number): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}
