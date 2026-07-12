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
const DATE_ONLY_TYPE = /(^|[^A-Za-z0-9_])(Date32|Date)(?=[^A-Za-z0-9_]|$)/;

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
  if (eventTimeEncoding === "native") return column;
  if (eventTimeEncoding === "unix_seconds") return `toDateTime64(toInt64(${column}), 3, 'UTC')`;
  if (eventTimeEncoding === "unix_milliseconds") return `fromUnixTimestamp64Milli(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "unix_microseconds") return `fromUnixTimestamp64Micro(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "unix_nanoseconds") return `fromUnixTimestamp64Nano(toInt64(${column}), 'UTC')`;
  if (eventTimeEncoding === "string") {
    if (eventTimeFormat !== "best_effort") throw new Error(`Unsupported event-time string format: ${eventTimeFormat}`);
    const parsed = `parseDateTime64BestEffortOrNull(toString(${column}), 3${timezone ? `, ${timezone}` : ""})`;
    return `toTimeZone(${parsed}, 'UTC')`;
  }
  if (!eventTimeType || NATIVE_TIME_TYPE.test(eventTimeType)) return column;
  if (INTEGER_TYPE.test(eventTimeType)) {
    const numeric = `toFloat64(${column})`;
    const seconds = `multiIf(abs(${numeric}) >= 1e18, ${numeric} / 1e9, abs(${numeric}) >= 1e15, ${numeric} / 1e6, abs(${numeric}) >= 1e12, ${numeric} / 1e3, ${numeric})`;
    return `toDateTime64(${seconds}, 3, 'UTC')`;
  }
  if (STRING_TYPE.test(eventTimeType)) {
    const parsed = `parseDateTime64BestEffortOrNull(toString(${column}), 3${timezone ? `, ${timezone}` : ""})`;
    return `toTimeZone(${parsed}, 'UTC')`;
  }
  return column;
}

export function eventTimeTypeFromSchema(
  eventTimeColumn: string | null | undefined,
  schemaSnapshot: Array<{ name: string; type: string }> | null | undefined,
): string | undefined {
  return schemaSnapshot?.find((column) => column.name === eventTimeColumn)?.type;
}

export function isDateOnlyEventTimeType(eventTimeType: string | null | undefined): boolean {
  return Boolean(eventTimeType && DATE_ONLY_TYPE.test(eventTimeType) && !eventTimeType.includes("DateTime"));
}

export function eventTimeWindowPredicate(
  eventTimeColumn: string,
  eventTimeType: string | undefined,
  eventTimeEncoding: DataHealthEventTimeEncoding,
  eventTimeTimezone: string | undefined,
  eventTimeFormat: DataHealthEventTimeFormat,
  slotStart: string,
  slotEnd: string,
): string {
  if (eventTimeEncoding === "native" && isDateOnlyEventTimeType(eventTimeType)) {
    if (!eventTimeTimezone) throw new Error("Date event-time columns require a calendar timezone");
    const column = escapeIdentifier(eventTimeColumn);
    const timezone = sqlString(eventTimeTimezone);
    return `${column} >= toDate(${slotStart}, ${timezone}) AND ${column} < toDate(${slotEnd}, ${timezone})`;
  }
  const expression = eventTimeExpression(eventTimeColumn, eventTimeType, eventTimeEncoding, eventTimeTimezone, eventTimeFormat);
  return `${expression} >= ${slotStart} AND ${expression} < ${slotEnd}`;
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
  if (!source.eventTimeColumn) return null;
  return eventTimeWindowPredicate(
    source.eventTimeColumn,
    source.eventTimeType,
    source.eventTimeEncoding ?? "auto",
    source.eventTimeTimezone,
    source.eventTimeFormat ?? "best_effort",
    "{{slot_start}}",
    "{{slot_end}}",
  );
}

const CALENDAR_PARTITION_FUNCTIONS = [
  "toYYYYMMDD",
  "toStartOfMonth",
  "toStartOfHour",
  "toStartOfDay",
  "toYYYYMM",
  "toDate",
] as const;

function calendarPartitionPredicate(expression: string, fn: string, timezoneArg: string, start: string, end: string): string {
  return `${expression} >= ${fn}(${start}${timezoneArg}) AND ${expression} <= ${fn}(${end}${timezoneArg})`;
}

/**
 * Produces only a coarse, correctness-preserving partition predicate. The exact
 * UTC event-time predicate remains authoritative. A one-day halo covers calendar
 * partitions derived from local wall-clock dates without requiring a business
 * timezone (all real IANA UTC offsets are smaller than 24 hours).
 */
export function timePartitionPredicate(
  partitionKey: string | undefined,
  columns: Array<{ name: string; type: string }> | undefined,
  slotStart = "{{slot_start}}",
  slotEnd = "{{slot_end}}",
  addCalendarHalo = true,
): string | null {
  const key = partitionKey?.trim();
  if (!key) return null;
  const startWithHalo = addCalendarHalo ? slotStart.replace(/}}$/, " - 1d}}") : slotStart;
  const endWithHalo = addCalendarHalo ? slotEnd.replace(/}}$/, " + 1d}}") : slotEnd;

  for (const fn of CALENDAR_PARTITION_FUNCTIONS) {
    const match = key.match(new RegExp(`\\b${fn}\\s*\\(\\s*(\\x60?[A-Za-z_][A-Za-z0-9_]*\\x60?)\\s*(,\\s*'[^']+')?\\s*\\)`));
    if (!match) continue;
    const expression = match[0];
    const timezoneArg = match[2] ?? "";
    return calendarPartitionPredicate(expression, fn, timezoneArg, startWithHalo, endWithHalo);
  }

  const identifier = key.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?$/)?.[1];
  if (!identifier) return null;
  const column = columns?.find((candidate) => candidate.name === identifier);
  if (!column) return null;
  const escaped = escapeIdentifier(identifier);
  if (/(^|\W)Date(?:32)?(?=\W|$)/.test(column.type) && !column.type.includes("DateTime")) {
    return `${escaped} >= toDate(${startWithHalo}) AND ${escaped} <= toDate(${endWithHalo})`;
  }
  if (NATIVE_TIME_TYPE.test(column.type)) {
    return `${escaped} >= ${slotStart} AND ${escaped} < ${slotEnd}`;
  }
  return null;
}

function partitionWindowPredicate(
  source: DataHealthCompileSource,
  slotStart = "{{slot_start}}",
  slotEnd = "{{slot_end}}",
  addCalendarHalo = true,
): string | null {
  if (source.sourceType !== "table") return null;
  return timePartitionPredicate(source.partitionKey, source.partitionColumns, slotStart, slotEnd, addCalendarHalo);
}

function ratio(numerator: string, denominator: string): string {
  return `if(${denominator} = 0, NULL, toFloat64(${numerator}) / toFloat64(${denominator}))`;
}

function freshnessExpression(check: Extract<DataHealthCheckDefinition, { type: "freshness" }>, source: DataHealthCompileSource): string {
  const column = normalizedEventTime(source, check.config.eventTimeColumn);
  if (!column) throw new Error("freshness requires an event-time column");
  const dateOnly = source.eventTimeEncoding === "native" && isDateOnlyEventTimeType(source.eventTimeType);
  const freshnessWindow = eventTimeWindowPredicate(
    check.config.eventTimeColumn,
    source.eventTimeType,
    source.eventTimeEncoding ?? "auto",
    source.eventTimeTimezone,
    source.eventTimeFormat ?? "best_effort",
    `{{slot_end - ${check.config.maxAgeSeconds}s}}`,
    "{{slot_end}}",
  );
  const partitionWindow = partitionWindowPredicate(
    source,
    `{{slot_end - ${check.config.maxAgeSeconds + 86_400}s}}`,
    "{{slot_end + 1d}}",
    false,
  );
  const filters = [freshnessWindow, partitionWindow, source.rowFilter?.trim()].filter((filter): filter is string => Boolean(filter));
  const latestInstant = dateOnly
    ? `toTimeZone(toDateTime(addDays(max(${column}), 1), ${sqlString(source.eventTimeTimezone ?? "UTC")}), 'UTC')`
    : `max(${column})`;
  return `(SELECT if(count() = 0, toFloat64(${check.config.maxAgeSeconds + 1}), toFloat64(dateDiff('second', ${latestInstant}, {{slot_end}}))) FROM ${sourceSql(source)} AS dh_freshness WHERE (${filters.join(") AND (")}))`;
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
  const partitionWindow = scanWindow ? partitionWindowPredicate(source) : null;
  const filters = [scanWindow, partitionWindow, source.rowFilter?.trim()].filter((filter): filter is string => Boolean(filter));
  const where = needsCadenceSource && filters.length > 0 ? `\nWHERE (${filters.join(") AND (")})` : "";
  const from = needsCadenceSource ? `\nFROM ${sourceSql(source)} AS dh_source${where}` : "";
  const sql = `SELECT\n  ${metrics.join(",\n  ")}${from}`;
  const validation = validateReadOnlySelect(sql);
  if (!validation.ok) throw new Error(validation.error ?? "Generated Data Health query is not read-only");
  return { sql, metricCheckKeys, schemaCheckKeys };
}
