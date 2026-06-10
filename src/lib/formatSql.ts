import { formatDialect, clickhouse } from "sql-formatter";
import type { FormatOptions } from "sql-formatter";
import { log } from "@/lib/log";

type FormatSqlOptions = Partial<Omit<FormatOptions, "language">>;

const DEFAULT_OPTIONS: FormatSqlOptions = {
  tabWidth: 2,
  indentStyle: "standard",
  // PRESERVE case for everything. ClickHouse is case-sensitive for function and
  // identifier names, and sql-formatter's ClickHouse dialect over-classifies some
  // case-sensitive tokens as reserved keywords (e.g. the interval-unit alias `h`,
  // functions like `sumIf`). With keywordCase:"upper" those get uppercased and the
  // query breaks — and identifierCase/functionCase can't rescue them because they're
  // treated as keywords. So we never rewrite token case; the formatter still handles
  // indentation, one-clause-per-line, and spacing.
  keywordCase: "preserve",
  identifierCase: "preserve",
  functionCase: "preserve",
  dataTypeCase: "preserve",
};

/**
 * Format a SQL query using the ClickHouse dialect.
 * Falls back to the original query if formatting fails.
 */
export function formatClickHouseSQL(
  sql: string,
  options?: FormatSqlOptions
): string {
  if (!sql) return "";

  try {
    return formatDialect(sql, {
      dialect: clickhouse,
      ...DEFAULT_OPTIONS,
      ...options,
    });
  } catch {
    log.warn("Failed to format SQL query");
    return sql.trim();
  }
}
