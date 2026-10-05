/**
 * Bounded, aggregate-only profile of ONE table for the Context AI draft.
 *
 * The model never writes or runs SQL: the server builds this query from
 * catalog names only, runs it read-only with hard limits, and hands the model
 * summary numbers. Raw rows never leave ClickHouse; values are only shared for
 * low-cardinality columns that do not look personal, and even then each value
 * is screened.
 */

import { redactSecrets } from "../../mcp/safety";
import { clientForConnection } from "../scheduledQueries/chClient";

/** Columns profiled per table; wide tables keep their first columns. */
export const MAX_PROFILED_COLUMNS = 40;
/** Rows read before the profile stops early (`read_overflow_mode = 'break'`). */
export const PROFILE_MAX_ROWS = 10_000_000;
/** Top values are only shared when the column has at most this many distinct values. */
const LOW_CARDINALITY = 50;

const PII_NAME = /(e_?mail|phone|mobile|msisdn|ssn|passport|national_?id|tax_?id|password|passwd|secret|token|api_?key|credential|address|street|zip|postal|postcode|(^|_)ip($|_)|ip_?addr|ipv[46]|birth|dob|first_?name|last_?name|full_?name|surname|card|iban|account_?number|lat(itude)?$|lon(gitude)?$)/i;

/** Values that look personal even in a column with an innocent name. */
const PII_VALUE = /@|\d{9,}/;

export type ProfileKind = "numeric" | "temporal" | "text" | "identifier";

export interface ProfileColumn {
  name: string;
  type: string;
}

export interface ColumnProfile {
  name: string;
  type: string;
  /** Personal-looking column: only its null share and distinct count are profiled. */
  pii: boolean;
  nullRatio: number | null;
  distinct: number | null;
  min: string | number | null;
  max: string | number | null;
  topValues: string[] | null;
}

export interface TableProfile {
  rows: number;
  /** True when the table is larger than the read cap, so ratios are from a prefix of the data. */
  partial: boolean;
  columns: ColumnProfile[];
  /** Columns that were not profiled (complex types or past the column cap). */
  skipped: string[];
}

interface PlannedColumn extends ProfileColumn {
  alias: string;
  kind: ProfileKind;
  pii: boolean;
  nullable: boolean;
}

export function isPiiColumn(name: string): boolean {
  return PII_NAME.test(name);
}

/** Backtick-quote an identifier taken from the catalog. */
export function quoteIdent(name: string): string {
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function unwrap(type: string): { base: string; nullable: boolean } {
  let base = type.trim();
  let nullable = false;
  for (;;) {
    const m = /^(Nullable|LowCardinality)\((.*)\)$/.exec(base);
    if (!m) break;
    if (m[1] === "Nullable") nullable = true;
    base = m[2].trim();
  }
  return { base, nullable };
}

/** How a column type is profiled; null for types that are skipped (arrays, maps, JSON, states…). */
export function profileKind(type: string): ProfileKind | null {
  const { base } = unwrap(type);
  if (/^(U?Int\d+|Float\d+|Decimal\d*)\b/.test(base)) return "numeric";
  if (/^(Date|Date32|DateTime|DateTime64)\b/.test(base)) return "temporal";
  if (/^(String|FixedString|Enum8|Enum16|Bool)\b/.test(base)) return "text";
  if (/^(UUID|IPv4|IPv6)\b/.test(base)) return "identifier";
  return null;
}

export function planProfile(columns: ProfileColumn[], tablePii: boolean): { planned: PlannedColumn[]; skipped: string[] } {
  const planned: PlannedColumn[] = [];
  const skipped: string[] = [];
  for (const column of columns) {
    const kind = profileKind(column.type);
    if (!kind || planned.length >= MAX_PROFILED_COLUMNS) {
      skipped.push(column.name);
      continue;
    }
    const { base, nullable } = unwrap(column.type);
    const pii = tablePii || (kind === "identifier" && /^IPv/.test(base)) || isPiiColumn(column.name);
    planned.push({ ...column, alias: `c${planned.length}`, kind, pii, nullable });
  }
  return { planned, skipped };
}

export function buildProfileQuery(database: string, table: string, planned: PlannedColumn[]): string {
  const select = ["count() AS rows"];
  for (const c of planned) {
    const col = quoteIdent(c.name);
    if (c.nullable) select.push(`countIf(isNull(${col})) AS ${c.alias}_nulls`);
    select.push(`uniq(${col}) AS ${c.alias}_uniq`);
    if (c.pii) continue;
    if (c.kind === "numeric") select.push(`min(${col}) AS ${c.alias}_min`, `max(${col}) AS ${c.alias}_max`);
    if (c.kind === "temporal") select.push(`toString(min(${col})) AS ${c.alias}_min`, `toString(max(${col})) AS ${c.alias}_max`);
    if (c.kind === "text") select.push(`arrayMap(x -> substring(toString(x), 1, 64), topK(5)(${col})) AS ${c.alias}_top`);
  }
  return `SELECT ${select.join(", ")} FROM ${quoteIdent(database)}.${quoteIdent(table)}`;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function scalar(value: unknown): string | number | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

/** Screen top values: drop anything personal-looking and redact secret-shaped strings. */
export function safeTopValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const strings = values.filter((v): v is string => typeof v === "string" && v.length > 0 && !PII_VALUE.test(v));
  const redacted = redactSecrets(strings);
  return Array.isArray(redacted) ? redacted.filter((v): v is string => typeof v === "string") : [];
}

export function parseProfile(row: Record<string, unknown>, planned: PlannedColumn[], skipped: string[], catalogRows: number | null): TableProfile {
  const rows = numberOrNull(row.rows) ?? 0;
  const columns = planned.map((c): ColumnProfile => {
    const nulls = c.nullable ? numberOrNull(row[`${c.alias}_nulls`]) : 0;
    const distinct = numberOrNull(row[`${c.alias}_uniq`]);
    const lowCardinality = distinct !== null && distinct <= LOW_CARDINALITY;
    return {
      name: c.name,
      type: c.type,
      pii: c.pii,
      nullRatio: rows > 0 && nulls !== null ? Math.round((nulls / rows) * 1000) / 1000 : null,
      distinct,
      min: c.pii ? null : scalar(row[`${c.alias}_min`]),
      max: c.pii ? null : scalar(row[`${c.alias}_max`]),
      topValues: !c.pii && c.kind === "text" && lowCardinality ? safeTopValues(row[`${c.alias}_top`]) : null,
    };
  });
  return { rows, partial: (catalogRows ?? 0) > PROFILE_MAX_ROWS, columns, skipped };
}

/** Run the profile under the connection's own credentials, read-only and capped. */
export async function profileTable(connectionId: string, database: string, table: string, columns: ProfileColumn[], options: { tablePii: boolean; catalogRows: number | null }): Promise<TableProfile> {
  const { planned, skipped } = planProfile(columns, options.tablePii);
  const client = await clientForConnection(connectionId, JSON.stringify({ source: "observe", collector: "context_draft" }));
  const result = await client.query({
    query: buildProfileQuery(database, table, planned),
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: 10,
      max_rows_to_read: String(PROFILE_MAX_ROWS),
      read_overflow_mode: "break",
      max_result_rows: "1",
      output_format_json_quote_64bit_integers: 0,
    },
  });
  const rows = (await result.json()) as Array<Record<string, unknown>>;
  return parseProfile(rows[0] ?? {}, planned, skipped, options.catalogRows);
}
