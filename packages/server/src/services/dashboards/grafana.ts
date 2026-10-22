/**
 * Grafana import (ADR 0023 §14): a Grafana dashboard JSON (schema 30 or later)
 * converted to a dashboard document, as a preview that saves nothing. Every
 * panel says what happened to it — `ready`, `changed` with each change, or
 * `skipped` with the reason — and only ready and changed panels are in the
 * document. The user imports that document through the normal import, so
 * every save check applies again.
 *
 * Only ClickHouse panels convert (the grafana-clickhouse-datasource and
 * vertamedia-clickhouse-datasource plugins). Grafana's 24-column grid maps one
 * to one; overlaps from collapsed rows are pushed down.
 */

import { panelProblems, variableProblems } from "./validate";
import {
  DEFAULT_ANNOTATION_SOURCES,
  GRID_COLUMNS,
  IDENTIFIER_RE,
  MAX_CHART_PANELS,
  MAX_LAYOUT_Y,
  MAX_MARKDOWN_LENGTH,
  MAX_PANEL_ROWS,
  MAX_PANELS,
  MAX_VARIABLES,
  MAX_Y_COLUMNS,
  REFRESH_SECONDS,
  RELATIVE_RANGES,
  RELATIVE_RANGE_KEYS,
  VARIABLE_NAME_RE,
  dashboardInputSchema,
  overlaps,
  sizeLimits,
  type ChartType,
  type ConnectionScope,
  type DashboardInput,
  type Layout,
  type PanelInput,
  type RelativeRange,
  type Unit,
  type Variable,
  type VizSpec,
} from "./spec";

export const MIN_GRAFANA_SCHEMA = 30;
const CLICKHOUSE_PLUGINS = new Set(["grafana-clickhouse-datasource", "vertamedia-clickhouse-datasource"]);

const TYPE_MAP: Record<string, ChartType | "text" | "heading"> = {
  timeseries: "line",
  graph: "line",
  barchart: "bar",
  stat: "stat",
  gauge: "stat",
  table: "table",
  piechart: "pie",
  heatmap: "heatmap",
  text: "text",
  row: "heading",
};

const UNIT_MAP: Record<string, Unit> = {
  ms: "ms",
  s: "s",
  µs: "us",
  us: "us",
  bytes: "bytes",
  decbytes: "bytes",
  percent: "percent",
  reqps: "per_s",
  rps: "per_s",
  ops: "per_s",
  wps: "per_s",
  iops: "per_s",
};
/** Grafana's plain number formats: nothing to say when they become none. */
const PLAIN_UNITS = new Set(["", "none", "short", "locale", "sishort"]);

export type PanelStatus = "ready" | "changed" | "skipped";

export interface PanelPreview {
  title: string;
  grafanaType: string;
  status: PanelStatus;
  changes: string[];
  reason: string | null;
}

export interface VariablePreview {
  name: string;
  status: PanelStatus;
  changes: string[];
  reason: string | null;
}

export interface GrafanaPreview {
  dashboard: DashboardInput;
  panels: PanelPreview[];
  variables: VariablePreview[];
  /** Dashboard-level changes (time range, refresh, panel limits). */
  notes: string[];
}

export type ConversionResult = { ok: true; preview: GrafanaPreview } | { ok: false; error: string };

// ============================================
// Reading untyped JSON
// ============================================

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const int = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// ============================================
// Data sources
// ============================================

/** Data source names and variables that stand for the ClickHouse plugin (from __inputs and datasource variables). */
function clickhouseAliases(doc: Json, root: Json): Set<string> {
  const aliases = new Set<string>();
  for (const input of list(root.__inputs)) {
    if (isObject(input) && CLICKHOUSE_PLUGINS.has(text(input.pluginId))) aliases.add(`\${${text(input.name)}}`);
  }
  for (const v of list(isObject(doc.templating) ? doc.templating.list : [])) {
    if (isObject(v) && v.type === "datasource" && CLICKHOUSE_PLUGINS.has(text(v.query))) {
      aliases.add(`$${text(v.name)}`);
      aliases.add(`\${${text(v.name)}}`);
    }
  }
  return aliases;
}

function isClickhouse(datasource: unknown, aliases: Set<string>): boolean | null {
  if (datasource === undefined || datasource === null) return null;
  if (typeof datasource === "string") return aliases.has(datasource) ? true : CLICKHOUSE_PLUGINS.has(datasource) ? true : false;
  if (isObject(datasource)) {
    const type = text(datasource.type);
    if (type !== "") return CLICKHOUSE_PLUGINS.has(type);
    const uid = text(datasource.uid);
    return aliases.has(uid) ? true : null;
  }
  return false;
}

// ============================================
// Variables
// ============================================

interface ConvertedVariable {
  grafanaName: string;
  variable: Variable;
}

/** A Grafana variable name as ours: lowercase letters, digits and _. */
export function variableName(name: string): string | null {
  let out = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z]/.test(out)) out = `v_${out}`;
  out = out.slice(0, 40);
  return VARIABLE_NAME_RE.test(out) ? out : null;
}

function currentValues(v: Json): string[] {
  const current = isObject(v.current) ? v.current.value : undefined;
  const values = Array.isArray(current) ? current : current === undefined ? [] : [current];
  return values.map((x) => text(x)).filter((x) => x !== "" && x !== "$__all");
}

/** How a variable is used in the panels' SQL: as a table or column name, or as a value. */
function usedAsIdentifier(grafanaName: string, sqls: string[]): boolean {
  const ref = `\\$(?:\\{${escape(grafanaName)}(?::\\w+)?\\}|${escape(grafanaName)}\\b)`;
  const re = new RegExp(`(?:\\b(?:FROM|JOIN)\\s+(?:\\w+\\.)?${ref})|(?:${ref}\\s*\\.)|(?:\\.\\s*${ref})`, "i");
  return sqls.some((s) => re.test(s));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function convertVariable(v: Json, sqls: string[]): { converted: ConvertedVariable | null; preview: VariablePreview } {
  const grafanaName = text(v.name);
  const type = text(v.type);
  const changes: string[] = [];
  const skip = (reason: string): { converted: null; preview: VariablePreview } => ({ converted: null, preview: { name: grafanaName, status: "skipped", changes: [], reason } });
  const name = variableName(grafanaName);
  if (!name) return skip("its name cannot be made a variable name");
  if (name !== grafanaName) changes.push(`renamed to ${name}`);
  const label = (text(v.label) || grafanaName).slice(0, 80);
  const multi = v.multi === true || v.includeAll === true;

  let options: Variable["options"];
  let known: string[] = [];
  if (type === "custom") {
    known = text(v.query).split(",").map((o) => o.split(" : ").pop()?.trim() ?? "").filter((o) => o !== "");
    if (known.length === 0) return skip("a custom variable without options");
    options = { source: "static", values: known.slice(0, 200) };
  } else if (type === "query") {
    const query = isObject(v.query) ? text(v.query.rawSql) || text(v.query.query) : text(v.query);
    if (query.trim() === "") return skip("a query variable without a query");
    if (query.includes("$")) return skip("its options query uses Grafana macros or variables");
    options = { source: "query", sql: query.trim() };
  } else if (type === "constant" || type === "textbox") {
    const value = text(v.query) || currentValues(v)[0] || "";
    known = value === "" ? [] : [value];
    if (known.length === 0) return skip(`a ${type} variable without a value`);
    options = { source: "static", values: known };
  } else {
    return skip(`a ${type || "untyped"} variable has no equivalent`);
  }

  let defaults = currentValues(v);
  if (defaults.length === 0 && known.length > 0) {
    defaults = multi ? known : [known[0]];
    changes.push(multi ? "defaults to every option (it defaulted to All)" : `defaults to ${known[0]}`);
  }
  if (defaults.length === 0) return skip("no default value could be found (set one in Grafana and export again)");

  let variable: Variable;
  if (multi) {
    if (v.includeAll === true && v.multi !== true) changes.push("All became a multi-value variable");
    variable = { name, label, kind: "multi", options, default: [...new Set(defaults)].slice(0, 100) };
  } else if (usedAsIdentifier(grafanaName, sqls)) {
    if (!IDENTIFIER_RE.test(defaults[0])) return skip(`it names a table or column, and its default "${defaults[0]}" is not an identifier`);
    variable = { name, label, kind: "identifier", options, default: defaults[0] };
  } else {
    variable = { name, label, kind: "string", options, default: defaults[0] };
  }
  const problems = variableProblems(variable);
  if (problems.length > 0) return skip(problems[0]);
  return { converted: { grafanaName, variable }, preview: { name: grafanaName, status: changes.length > 0 ? "changed" : "ready", changes, reason: null } };
}

// ============================================
// SQL
// ============================================

type SqlResult = { ok: true; sql: string; changes: string[] } | { ok: false; reason: string };

/** Rewrite Grafana macros and variables into ours. A macro or variable with no equivalent skips the panel. */
export function convertSql(sql: string, variables: Map<string, Variable>): SqlResult {
  const changes = new Set<string>();
  let out = sql;
  const replace = (re: RegExp, to: (...m: string[]) => string, change: string): void => {
    if (re.test(out)) {
      out = out.replace(re, to);
      changes.add(change);
    }
  };
  replace(/\$__timeFilter\(\s*([^()]+?)\s*\)/g, (_m, col: string) => `${col} >= {{from}} AND ${col} < {{to}}`, "$__timeFilter(col) became col >= {{from}} AND col < {{to}}");
  replace(/\$__timeInterval\(\s*([^()]+?)\s*\)/g, (_m, col: string) => `toStartOfInterval(${col}, INTERVAL {{interval_s}} SECOND)`, "$__timeInterval(col) became toStartOfInterval(col, INTERVAL {{interval_s}} SECOND)");
  replace(/\$__fromTime\b(?!_)/g, () => "{{from}}", "$__fromTime became {{from}}");
  replace(/\$__toTime\b(?!_)/g, () => "{{to}}", "$__toTime became {{to}}");
  replace(/\$__interval_s\b/g, () => "{{interval_s}}", "$__interval_s became {{interval_s}}");
  replace(/\$__interval\b(?!_)/g, () => "{{interval_s}}", "$__interval became {{interval_s}} (seconds)");
  const unknownMacro = /\$__\w+/.exec(out);
  if (unknownMacro) return { ok: false, reason: `the macro ${unknownMacro[0]} has no equivalent` };

  // Variables: an IN list, a quoted value, then a bare reference.
  const ref = String.raw`\$(?:\{(\w+)(?::\w+)?\}|(\w+))|\[\[(\w+)\]\]`;
  let missing: string | null = null;
  const target = (a?: string, b?: string, c?: string): string | null => {
    const grafanaName = a ?? b ?? c ?? "";
    const variable = variables.get(grafanaName);
    if (!variable) {
      missing ??= grafanaName;
      return null;
    }
    changes.add(`$${grafanaName} became {{var.${variable.name}}}`);
    return `{{var.${variable.name}}}`;
  };
  out = out.replace(new RegExp(String.raw`\bIN\s*\(\s*'?(?:${ref})'?\s*\)`, "gi"), (m, a?: string, b?: string, c?: string) => {
    const t = target(a, b, c);
    return t === null ? m : `IN ${t}`;
  });
  out = out.replace(new RegExp(String.raw`'(?:${ref})'`, "g"), (m, a?: string, b?: string, c?: string) => target(a, b, c) ?? m);
  out = out.replace(new RegExp(ref, "g"), (m, a?: string, b?: string, c?: string) => target(a, b, c) ?? m);
  if (missing !== null) return { ok: false, reason: `it uses $${missing}, which is not a variable that could be converted` };
  return { ok: true, sql: out.trim(), changes: [...changes] };
}

/**
 * The output column names of a SELECT, read from its select list: an alias,
 * or a plain (possibly qualified) column. Null when a column has no name the
 * chart could refer to (`*`, an unaliased expression).
 */
export function selectColumns(sql: string): string[] | null {
  const code = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  // With a WITH clause the first SELECT is a CTE's, not the result's.
  if (/^\s*WITH\b/i.test(code)) return null;
  const start = /\bSELECT\b/i.exec(code);
  if (!start) return null;
  let depth = 0;
  let quote: string | null = null;
  const items: string[] = [];
  let current = "";
  let i = start.index + start[0].length;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      current += ch;
      if (ch === "\\") { current += code[++i] ?? ""; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /^\bFROM\b/i.test(code.slice(i, i + 5)) && /\s/.test(code[i - 1] ?? " ")) break;
    if (depth === 0 && ch === ",") { items.push(current); current = ""; continue; }
    current += ch;
  }
  items.push(current);
  const names: string[] = [];
  for (const raw of items) {
    const item = raw.trim().replace(/^DISTINCT\s+/i, "");
    const alias = /\bAS\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s*$/i.exec(item);
    if (alias) { names.push(alias[1]); continue; }
    const column = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)*[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?$/.exec(item);
    if (column) { names.push(column[1]); continue; }
    return null;
  }
  return names.length > 0 ? names : null;
}

// ============================================
// Panels
// ============================================

function vizFor(type: ChartType, columns: string[], unit: Unit, changes: string[]): VizSpec | string {
  const base = { version: 2 as const, series: null, unit, decimals: null, thresholds: [], colorScheme: "violet" as const, links: [], baseline: null };
  if (type === "table") return { ...base, type, x: null, y: [], reduce: null };
  if (type === "stat") {
    const y = columns[columns.length - 1];
    if (columns.length > 1) changes.push(`shows ${y}, the last column`);
    return { ...base, type, x: null, y: [y], reduce: "last" };
  }
  if (columns.length < 2) return "a chart needs at least two columns (x and a value)";
  const [x, ...rest] = columns;
  if (type === "pie") {
    if (rest.length > 1) changes.push(`plots ${rest[0]}, the second column`);
    return { ...base, type, x, y: [rest[0]], reduce: null };
  }
  if (rest.length > MAX_Y_COLUMNS) changes.push(`plots the first ${MAX_Y_COLUMNS} value columns`);
  return { ...base, type, x, y: rest.slice(0, MAX_Y_COLUMNS), reduce: null };
}

function unitOf(panel: Json, changes: string[]): Unit {
  const defaults = isObject(panel.fieldConfig) && isObject(panel.fieldConfig.defaults) ? panel.fieldConfig.defaults : {};
  const unit = text(defaults.unit);
  if (PLAIN_UNITS.has(unit)) return "none";
  const mapped = UNIT_MAP[unit];
  if (mapped) {
    if (unit === "decbytes") changes.push("the unit decbytes (1000-based) is shown as bytes (1024-based)");
    return mapped;
  }
  changes.push(unit === "percentunit" ? "the unit percentunit (0–1) has no equivalent and became none" : `the unit ${unit} has no equivalent and became none`);
  return "none";
}

function layoutOf(panel: Json, kind: PanelInput["kind"], chartType: ChartType | null): Layout {
  const pos = isObject(panel.gridPos) ? panel.gridPos : {};
  const limits = sizeLimits(kind, chartType);
  const w = Math.min(GRID_COLUMNS, Math.max(limits.minW, int(pos.w, 12)));
  const h = Math.min(limits.maxH, Math.max(limits.minH, int(pos.h, 8)));
  const x = Math.min(GRID_COLUMNS - w, Math.max(0, int(pos.x, 0)));
  const y = Math.min(MAX_LAYOUT_Y, Math.max(0, int(pos.y, 0)));
  return { x, y, w, h: Math.min(h, MAX_PANEL_ROWS) };
}

/** Grafana's panels in order, with each collapsed row's panels after it. */
function flatten(panels: unknown[]): Json[] {
  const out: Json[] = [];
  for (const p of panels) {
    if (!isObject(p)) continue;
    out.push(p);
    if (p.type === "row") out.push(...list(p.panels).filter(isObject));
  }
  return out;
}

/**
 * Push each panel down, in Grafana's order, until it overlaps nothing placed
 * before it. Grafana's order keeps a collapsed row's panels under their row.
 */
export function settle(layouts: Layout[]): Layout[] {
  const placed: Layout[] = [];
  for (const layout of layouts) {
    const next = { ...layout };
    for (;;) {
      const hit = placed.find((p) => overlaps(p, next));
      if (!hit) break;
      next.y = hit.y + hit.h;
    }
    next.y = Math.min(next.y, MAX_LAYOUT_Y);
    placed.push(next);
  }
  return placed;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 };

function nearestRange(from: string): RelativeRange | null {
  const m = /^now-(\d+)([mhdw])$/.exec(from.trim());
  if (!m) return null;
  const seconds = Number(m[1]) * (UNIT_SECONDS[m[2]] ?? 0);
  return RELATIVE_RANGE_KEYS.find((key) => RELATIVE_RANGES[key] === seconds) ?? null;
}

function refreshOf(refresh: unknown): (typeof REFRESH_SECONDS)[number] | null {
  const m = /^(\d+)([smh])$/.exec(text(refresh));
  if (!m) return null;
  const seconds = Number(m[1]) * (UNIT_SECONDS[m[2]] ?? 0);
  return REFRESH_SECONDS.find((r) => r === seconds) ?? null;
}

// ============================================
// The conversion
// ============================================

export function convertGrafana(raw: unknown, connectionScope: ConnectionScope): ConversionResult {
  if (!isObject(raw)) return { ok: false, error: "That is not a Grafana dashboard JSON object" };
  // The API's export wraps the dashboard; the UI's "Export → JSON" does not.
  const doc = isObject(raw.dashboard) && Array.isArray(raw.dashboard.panels) ? raw.dashboard : raw;
  if (!Array.isArray(doc.panels)) return { ok: false, error: "That is not a Grafana dashboard: it has no panels" };
  const schema = int(doc.schemaVersion, 0);
  if (schema < MIN_GRAFANA_SCHEMA) return { ok: false, error: `Grafana dashboards of schema ${MIN_GRAFANA_SCHEMA} or later (Grafana 8+) can be imported; this one is schema ${schema || "unknown"}. Open and save it in a newer Grafana first.` };

  const notes: string[] = [];
  const aliases = clickhouseAliases(doc, raw);
  const grafanaPanels = flatten(doc.panels);
  const sqlOf = (p: Json): string => {
    const target = list(p.targets).find(isObject);
    return target ? text(target.rawSql) || text(target.query) : "";
  };
  const allSql = grafanaPanels.map(sqlOf);

  const variables: VariablePreview[] = [];
  const converted = new Map<string, Variable>();
  for (const v of list(isObject(doc.templating) ? doc.templating.list : []).filter(isObject)) {
    if (v.type === "datasource") continue;
    if (converted.size >= MAX_VARIABLES) {
      variables.push({ name: text(v.name), status: "skipped", changes: [], reason: `a dashboard has at most ${MAX_VARIABLES} variables` });
      continue;
    }
    const { converted: c, preview } = convertVariable(v, allSql);
    if (c && [...converted.values()].some((x) => x.name === c.variable.name)) {
      variables.push({ ...preview, status: "skipped", changes: [], reason: `another variable already became ${c.variable.name}` });
      continue;
    }
    if (c) converted.set(c.grafanaName, c.variable);
    variables.push(preview);
  }

  const panels: PanelPreview[] = [];
  const kept: Array<{ panel: PanelInput; grafana: Json }> = [];
  let charts = 0;
  for (const p of grafanaPanels) {
    const title = (text(p.title) || "Untitled").trim().slice(0, 200);
    const grafanaType = text(p.type);
    const changes: string[] = [];
    const skip = (reason: string): void => { panels.push({ title, grafanaType, status: "skipped", changes: [], reason }); };
    const mapped = TYPE_MAP[grafanaType];
    if (!mapped) { skip(`the panel type ${grafanaType || "(none)"} has no equivalent`); continue; }
    if (kept.length >= MAX_PANELS) { skip(`a dashboard has at most ${MAX_PANELS} panels`); continue; }
    if (mapped === "heading") {
      kept.push({ grafana: p, panel: { id: null, kind: "heading", title: title === "Untitled" ? "Section" : title, description: "", layout: layoutOf(p, "heading", null) } });
      panels.push({ title, grafanaType, status: "ready", changes, reason: null });
      continue;
    }
    if (mapped === "text") {
      const options = isObject(p.options) ? p.options : {};
      const mode = text(options.mode) || "markdown";
      const content = (text(options.content) || text(p.content)).trim();
      if (content === "") { skip("the text panel is empty"); continue; }
      if (mode !== "markdown") changes.push(`its ${mode} content is shown as Markdown, so HTML is not rendered`);
      kept.push({ grafana: p, panel: { id: null, kind: "text", title, markdown: content.slice(0, MAX_MARKDOWN_LENGTH), layout: layoutOf(p, "text", null) } });
      panels.push({ title, grafanaType, status: changes.length > 0 ? "changed" : "ready", changes, reason: null });
      continue;
    }
    const target = list(p.targets).find(isObject);
    const ds = isClickhouse(p.datasource, aliases) ?? isClickhouse(target?.datasource, aliases);
    if (ds !== true) { skip("it reads another data source (only ClickHouse panels convert)"); continue; }
    if (charts >= MAX_CHART_PANELS) { skip(`a dashboard has at most ${MAX_CHART_PANELS} chart panels`); continue; }
    const rawSql = sqlOf(p);
    if (rawSql.trim() === "") { skip("it has no SQL query"); continue; }
    if (list(p.targets).length > 1) changes.push("only its first query is kept");
    const sql = convertSql(rawSql, converted);
    if (!sql.ok) { skip(sql.reason); continue; }
    changes.push(...sql.changes);
    const columns = selectColumns(sql.sql);
    if (!columns) { skip("its columns could not be read from the SQL (name every column with AS)"); continue; }
    const unit = unitOf(p, changes);
    const viz = vizFor(mapped, columns, unit, changes);
    if (typeof viz === "string") { skip(viz); continue; }
    const problems = panelProblems({ sql: sql.sql, viz, fleet: false }, [...converted.values()]);
    if (problems.length > 0) { skip(problems[0]); continue; }
    charts++;
    kept.push({ grafana: p, panel: { id: null, kind: "chart", title: title || "Chart", sql: sql.sql, viz, fleet: false, layout: layoutOf(p, "chart", mapped) } });
    panels.push({ title, grafanaType, status: changes.length > 0 ? "changed" : "ready", changes, reason: null });
  }

  const settled = settle(kept.map((k) => k.panel.layout));
  if (settled.some((l, i) => l.y !== kept[i].panel.layout.y)) notes.push("Panels that overlapped (from collapsed rows) were moved down");
  const time = isObject(doc.time) ? text(doc.time.from) : "";
  const timeRange = nearestRange(time);
  if (!timeRange) notes.push(`The time range ${time || "(none)"} has no equivalent; the dashboard opens on the last 6 hours`);
  const refresh = refreshOf(doc.refresh);
  if (doc.refresh && refresh === null) notes.push(`The refresh ${text(doc.refresh)} has no equivalent; auto-refresh is off`);

  const dashboard: DashboardInput = {
    title: (text(doc.title) || "Grafana import").trim().slice(0, 200),
    description: text(doc.description).trim().slice(0, 1_000),
    timeRange: timeRange ?? "6h",
    refreshSeconds: refresh ?? 0,
    connectionScope,
    variables: [...converted.values()],
    annotations: [...DEFAULT_ANNOTATION_SOURCES],
    panels: kept.map((k, i) => ({ ...k.panel, layout: settled[i] })),
  };
  const parsed = dashboardInputSchema.safeParse(dashboard);
  if (!parsed.success) return { ok: false, error: `The converted dashboard is not valid: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  return { ok: true, preview: { dashboard: parsed.data, panels, variables, notes } };
}
