import { escapeIdentifier, escapeQualifiedIdentifier } from "../../utils/sqlIdentifier";
import { validateReadOnlySelect } from "../scheduledQueries/validation";
import type {
  CompiledDataHealthQuery,
  DataHealthCheckDefinition,
  DataHealthCompileSource,
  DataHealthEventTimeEncoding,
  DataHealthEventTimeFormat,
} from "./types";

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

const NATIVE_TIME_TYPE = /(^|[^A-Za-z0-9_])(DateTime64|DateTime|Date32|Date)(?=[^A-Za-z0-9_]|$)/;
const INTEGER_TYPE = /(^|[^A-Za-z0-9_])U?Int(?:8|16|32|64|128|256)(?=[^A-Za-z0-9_]|$)/;
const STRING_TYPE = /(^|[^A-Za-z0-9_])(FixedString|String)(?=[^A-Za-z0-9_]|$)/;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function eventTimeExpression(
  eventTimeColumn: string,
  eventTimeType?: string,
  eventTimeEncoding: DataHealthEventTimeEncoding = "auto",
  eventTimeTimezone?: string,
  eventTimeFormat: DataHealthEventTimeFormat = "best_effort",
): string {
  const column = escapeIdentifier(eventTimeColumn);
  const timezone = eventTimeTimezone ? sqlString(eventTimeTimezone) : undefined;
  if (eventTimeEncoding === "native") {
    return timezone
      ? `parseDateTime64BestEffortOrNull(toString(${column}), 3, ${timezone})`
      : column;
  }
  if (eventTimeEncoding === "unix_seconds") return `toDateTime64(toInt64(${column}), 3, 'UTC')`;
  if (eventTimeEncoding === "unix_milliseconds") return `fromUnixTimestamp64Milli(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "unix_microseconds") return `fromUnixTimestamp64Micro(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "unix_nanoseconds") return `fromUnixTimestamp64Nano(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "string") {
    if (eventTimeFormat !== "best_effort") throw new Error(`Unsupported event-time string format: ${eventTimeFormat}`);
    return `parseDateTime64BestEffortOrNull(toString(${column}), 3${timezone ? `, ${timezone}` : ""})`;
  }
  if (!eventTimeType || NATIVE_TIME_TYPE.test(eventTimeType)) return column;
  if (INTEGER_TYPE.test(eventTimeType)) {
    const numeric = `toFloat64(${column})`;
    const seconds = `multiIf(abs(${numeric}) >= 1e18, ${numeric} / 1e9, abs(${numeric}) >= 1e15, ${numeric} / 1e6, abs(${numeric}) >= 1e12, ${numeric} / 1e3, ${numeric})`;
    return `toDateTime64(${seconds}, 3, 'UTC')`;
  }
  if (STRING_TYPE.test(eventTimeType)) return `parseDateTime64BestEffortOrNull(toString(${column}), 3${timezone ? `, ${timezone}` : ""})`;
  return column;
}

export function eventTimeTypeFromSchema(
  eventTimeColumn: string | null | undefined,
  schemaSnapshot: Array<{ name: string; type: string }> | null | undefined,
): string | undefined {
  return schemaSnapshot?.find((column) => column.name === eventTimeColumn)?.type;
}

function normalizedEventTime(source: DataHealthCompileSource, eventTimeColumn = source.eventTimeColumn): string | null {
  if (!eventTimeColumn) return null;
  return eventTimeExpression(
    eventTimeColumn,
    source.eventTimeType,
    source.eventTimeEncoding,
    source.eventTimeTimezone,
    source.eventTimeFormat,
  );
}

function windowPredicate(source: DataHealthCompileSource): string | null {
  const expression = normalizedEventTime(source);
  if (!expression) return null;
  return `${expression} >= {{slot_start}} AND ${expression} < {{slot_end}}`;
}

function ratio(numerator: string, denominator: string): string {
  return `if(${denominator} = 0, NULL, toFloat64(${numerator}) / toFloat64(${denominator}))`;
}

function freshnessExpression(check: Extract<DataHealthCheckDefinition, { type: "freshness" }>, source: DataHealthCompileSource): string {
  const column = normalizedEventTime(source, check.config.eventTimeColumn);
  if (!column) throw new Error("freshness requires an event-time column");
  const freshnessWindow = `${column} >= {{slot_end - ${check.config.maxAgeSeconds}s}} AND ${column} < {{slot_end}}`;
  const filters = [freshnessWindow, source.rowFilter?.trim()].filter((filter): filter is string => Boolean(filter));
  return `(SELECT if(count() = 0, toFloat64(${check.config.maxAgeSeconds + 1}), toFloat64(dateDiff('second', max(${column}), {{slot_end}}))) FROM ${sourceSql(source)} AS dh_freshness WHERE (${filters.join(") AND (")}))`;
}

function metricExpression(check: DataHealthCheckDefinition, source: DataHealthCompileSource): string | null {
  const window = windowPredicate(source);
  switch (check.type) {
    case "freshness":
      return freshnessExpression(check, source);
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
  let needsCadenceSource = false;

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
    if (check.type !== "freshness") needsCadenceSource = true;
  }

  if (metrics.length === 0) {
    metrics.push("toFloat64(1) AS `dh_schema_probe`");
  }
  const scanWindow = needsCadenceSource && source.eventTimeColumn
    ? windowPredicate(source)
    : undefined;
  const filters = [scanWindow, source.rowFilter?.trim()].filter((filter): filter is string => Boolean(filter));
  const where = needsCadenceSource && filters.length > 0 ? `\nWHERE (${filters.join(") AND (")})` : "";
  const from = needsCadenceSource ? `\nFROM ${sourceSql(source)} AS dh_source${where}` : "";
  const sql = `SELECT\n  ${metrics.join(",\n  ")}${from}`;
  const validation = validateReadOnlySelect(sql);
  if (!validation.ok) throw new Error(validation.error ?? "Generated Data Health query is not read-only");
  return { sql, metricCheckKeys, schemaCheckKeys };
}
