import { escapeIdentifier, escapeQualifiedIdentifier } from "../../utils/sqlIdentifier";
import { validateReadOnlySelect } from "../scheduledQueries/validation";
import type { CompiledDataHealthQuery, DataHealthCheckDefinition, DataHealthCompileSource } from "./types";

function sourceSql(source: DataHealthCompileSource): string {
  if (source.sourceType === "table") {
    if (!source.databaseName || !source.tableName) throw new Error("Table sources require a database and table");
    return escapeQualifiedIdentifier([source.databaseName, source.tableName]);
  }
  const query = source.sourceQuery?.trim().replace(/;+$/, "");
  if (!query) throw new Error("Query sources require a read-only source query");
  const validation = validateReadOnlySelect(query);
  if (!validation.ok) throw new Error(validation.error ?? "Invalid source query");
  return `(${query})`;
}

function windowPredicate(eventTimeColumn: string): string {
  const column = escapeIdentifier(eventTimeColumn);
  return `${column} >= {{slot_start}} AND ${column} < {{slot_end}}`;
}

function ratio(numerator: string, denominator: string): string {
  return `if(${denominator} = 0, NULL, toFloat64(${numerator}) / toFloat64(${denominator}))`;
}

function metricExpression(check: DataHealthCheckDefinition, source: DataHealthCompileSource): string | null {
  const eventTime = source.eventTimeColumn;
  const window = eventTime ? windowPredicate(eventTime) : null;
  switch (check.type) {
    case "freshness": {
      const column = escapeIdentifier(check.config.eventTimeColumn);
      const eligible = `${column} < {{slot_end}}`;
      return `if(countIf(${eligible}) = 0, toFloat64(${check.config.maxAgeSeconds + 1}), toFloat64(dateDiff('second', maxIf(${column}, ${eligible}), {{slot_end}})))`;
    }
    case "row_count":
    case "volume_anomaly":
      if (!window) throw new Error(`${check.type} requires an event-time column`);
      return `toFloat64(countIf(${window}))`;
    case "completeness": {
      if (!window) throw new Error("completeness requires an event-time column");
      const column = escapeIdentifier(check.config.column);
      return ratio(`countIf((${window}) AND ${column} IS NOT NULL)`, `countIf(${window})`);
    }
    case "uniqueness": {
      if (!window) throw new Error("uniqueness requires an event-time column");
      const tuple = `tuple(${check.config.columns.map(escapeIdentifier).join(", ")})`;
      const count = `countIf(${window})`;
      return `if(${count} = 0, NULL, 1 - toFloat64(uniqExactIf(${tuple}, ${window})) / toFloat64(${count}))`;
    }
    case "validity":
      if (!window) throw new Error("validity requires an event-time column");
      return ratio(`countIf((${window}) AND (${check.config.predicate}))`, `countIf(${window})`);
    case "custom_metric":
      return `toFloat64OrNull(toString(${check.config.expression}))`;
    case "schema_contract":
      return null;
  }
}

export function compileDataHealthQuery(
  source: DataHealthCompileSource,
  checks: DataHealthCheckDefinition[],
): CompiledDataHealthQuery {
  const enabled = checks.filter((check) => check.enabled);
  if (enabled.length === 0) throw new Error("At least one enabled check is required");
  const aliases = new Set<string>();
  const metrics: string[] = [];
  const metricCheckKeys: string[] = [];
  const schemaCheckKeys: string[] = [];

  for (const check of enabled) {
    if (aliases.has(check.checkKey)) throw new Error(`Duplicate check key: ${check.checkKey}`);
    aliases.add(check.checkKey);
    const expression = metricExpression(check, source);
    if (expression == null) {
      schemaCheckKeys.push(check.checkKey);
      continue;
    }
    metrics.push(`${expression} AS ${escapeIdentifier(check.checkKey)}`);
    metricCheckKeys.push(check.checkKey);
  }

  if (metrics.length === 0) {
    metrics.push("toFloat64(1) AS `dh_schema_probe`");
  }
  const maxFreshnessAge = enabled.reduce(
    (max, check) => check.type === "freshness" ? Math.max(max, check.config.maxAgeSeconds) : max,
    0,
  );
  const scanWindow = source.eventTimeColumn
    ? `${escapeIdentifier(source.eventTimeColumn)} >= {{slot_start${maxFreshnessAge > 0 ? ` - ${maxFreshnessAge}s` : ""}}} AND ${escapeIdentifier(source.eventTimeColumn)} < {{slot_end}}`
    : undefined;
  const filters = [scanWindow, source.rowFilter?.trim()].filter((filter): filter is string => Boolean(filter));
  const where = filters.length > 0 ? `\nWHERE (${filters.join(") AND (")})` : "";
  const sql = `SELECT\n  ${metrics.join(",\n  ")}\nFROM ${sourceSql(source)} AS dh_source${where}`;
  const validation = validateReadOnlySelect(sql);
  if (!validation.ok) throw new Error(validation.error ?? "Generated Data Health query is not read-only");
  return { sql, metricCheckKeys, schemaCheckKeys };
}
