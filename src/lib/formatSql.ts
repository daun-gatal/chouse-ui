import { formatDialect, clickhouse } from "sql-formatter";
import type { FormatOptions } from "sql-formatter";
import { log } from "@/lib/log";

type FormatSqlOptions = Partial<Omit<FormatOptions, "language">>;

const DEFAULT_OPTIONS: FormatSqlOptions = {
  tabWidth: 2,
  keywordCase: "upper",
  indentStyle: "standard",
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
