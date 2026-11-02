/**
 * Try it on this server (ADR 0029 §9): plan the workload's top read-only
 * query shapes on the current server, once with the settings each ran with
 * and once with the target version's settings, and report the shapes that
 * only fail with the target's. Many of a new version's behaviours already
 * exist as settings the current server ships switched off (the analyzer
 * above all), so this finds which queries an upgrade breaks before it
 * happens, without a second cluster.
 *
 * Only `EXPLAIN PLAN` runs: no query is executed. Every statement is
 * read-only, capped in time and in rows read (a constant subquery can't scan
 * a table), runs one at a time inside a total budget, and is tagged as
 * CHouse's own so it never shows up as workload.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { NOT_OBSERVE, selectRows, stripFormat } from "../observe/clickhouse";

const SHAPES = 200;
const STATEMENT_SECONDS = 10;
const BUDGET_MS = 60_000;
const MAX_CAUSE_TRIES = 15;

/** Settings CHouse sets itself, or that only shape how a query talks to its client: never copied from the log. */
const NOT_COPIED = /^(readonly|log_comment|query_id|max_execution_time|max_rows_to_read|max_bytes_to_read|read_overflow_mode|max_result_rows|max_result_bytes|result_overflow_mode|wait_end_of_query|send_progress_in_http_headers|http_.*|output_format_.*|session_.*|.*_timeout(_ms)?|log_queries.*|log_profile_events|insert_.*|async_insert.*|wait_for_async_insert.*|max_query_size|default_format|format_.*)$/;

/** Queries whose plan legitimately differs between runs, or that touch system tables, are not tried. */
export function triable(query: string): boolean {
  const q = query.toLowerCase();
  if (!/^\s*(with|select)\b/.test(q)) return false;
  if (/\bsystem\./.test(q)) return false;
  return true;
}

/** Plan text with whitespace collapsed, so only real plan changes count. */
export function normalisePlan(plan: string): string {
  return plan.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** The settings a shape ran with, minus those CHouse sets or that don't change planning. */
export function copiedSettings(logged: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(logged).filter(([k]) => !NOT_COPIED.test(k)));
}

const OFF = new Set(["0", "false"]);

export interface TryPlan {
  /** The analyzer setting this server knows (`enable_analyzer`, or the older name), or null. */
  analyzer: string | null;
  /** Whether this server turns the analyzer on by default (off before 24.3). */
  analyzerDefaultOn?: boolean;
  /** Changed defaults at the target's value, only those this server knows. */
  changed: Record<string, string>;
}

/** The settings a shape gets "after the upgrade": its own, with the target's defaults and the analyzer on. */
export function targetSettings(logged: Record<string, string>, plan: TryPlan): Record<string, string> {
  // A pinned compatibility keeps the old defaults after the upgrade too; the analyzer it no longer reverts (26.9+).
  const changed = logged.compatibility ? {} : plan.changed;
  const out = { ...logged, ...changed };
  if (plan.analyzer) {
    out[plan.analyzer] = "1";
    if (plan.analyzer !== "enable_analyzer") delete out.enable_analyzer;
    if (plan.analyzer !== "allow_experimental_analyzer") delete out.allow_experimental_analyzer;
  }
  return out;
}

/** Whether a shape ran with the analyzer: its own setting, else the server's default. */
export function analyzerOn(settings: Record<string, string>, analyzer: string | null, defaultOn = true): boolean {
  if (!analyzer) return true;
  const v = settings.enable_analyzer ?? settings.allow_experimental_analyzer;
  return v === undefined ? defaultOn : !OFF.has(v.toLowerCase());
}

export interface TryShape {
  hash: string;
  query: string;
  settings: Record<string, string>;
  users: string[];
  clients: string[];
  runs7d: number;
  tables: string[];
}

export interface TriedShape extends TryShape {
  error?: { type: string; message: string };
  /** The setting whose target value alone breaks the shape; null when only the combination does. */
  cause?: string | null;
}

export interface TryResult {
  readable: boolean;
  tried: number;
  skipped: number;
  failing: TriedShape[];
  planChanged: TriedShape[];
  /** Plans compared only where the shape already ran with the analyzer: otherwise every plan reads differently. */
  compared: number;
  applied: Record<string, string>;
  dropped: string[];
  budgetExhausted: boolean;
}

export class ExplainError extends Error {
  constructor(readonly type: string, message: string) {
    super(message);
  }
}

/**
 * ClickHouse's error, short and without query text: no "Code: n. DB::Exception:"
 * prefix, nothing from "In scope" / "In query" / "While processing" on (each
 * quotes the query), no build tag.
 */
export function shortError(message: string): string {
  return message
    .replace(/^Code:\s*\d+\.\s*/, "")
    .replace(/^DB::Exception:\s*/, "")
    .replace(/\s*(In scope|In query|While processing)[\s\S]*$/, "")
    .replace(/\s*\(version [^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function errorType(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { type?: unknown; code?: unknown; message?: unknown };
    if (typeof e.type === "string" && e.type) return e.type;
    const fromMessage = typeof e.message === "string" ? /\(([A-Z_]{3,})\)\s*(\(version [^)]*\))?\s*$/.exec(e.message)?.[1] : undefined;
    if (fromMessage) return fromMessage;
    if (e.code !== undefined) return `CODE_${String(e.code)}`;
  }
  return "ERROR";
}

export type Explain = (query: string, settings: Record<string, string>) => Promise<string>;

/** EXPLAIN PLAN on `client`, read-only and capped. Throws ExplainError. */
export function explainOn(client: ClickHouseClient, comment: string): Explain {
  return async (query, settings) => {
    const body = stripFormat(query).replace(/;\s*$/, "");
    try {
      const result = await client.query({
        query: `EXPLAIN PLAN ${body}`,
        format: "JSONEachRow",
        abort_signal: AbortSignal.timeout((STATEMENT_SECONDS + 5) * 1000),
        clickhouse_settings: {
          ...settings,
          // readonly = 2: read-only, but settings may change, which is the point.
          readonly: "2",
          max_execution_time: STATEMENT_SECONDS,
          max_rows_to_read: "100000",
          read_overflow_mode: "throw",
          max_result_rows: "10000",
          log_comment: comment,
        } as Record<string, string | number>,
      });
      const rows = (await result.json()) as Array<{ explain?: string }>;
      return rows.map((r) => r.explain ?? "").join("\n");
    } catch (error) {
      throw new ExplainError(errorType(error), shortError(error instanceof Error ? error.message : String(error)));
    }
  };
}

const WINDOW = `event_date >= today() - 30 AND event_time > now() - INTERVAL 30 DAY AND type = 'QueryFinish' AND ${NOT_OBSERVE}`;

/** The top read-only shapes by total time, each with the settings, callers and tables of its latest run. */
export async function loadShapes(client: ClickHouseClient, limit = SHAPES): Promise<TryShape[]> {
  const rows = await selectRows<{ hash: string; query: string; settings: Record<string, string>; users: string[]; clients: string[]; runs7d: number; tbls: string[] }>(client, `
    SELECT toString(normalized_query_hash) AS hash,
      argMax(query, event_time) AS query,
      argMax(Settings, event_time) AS settings,
      groupUniqArray(5)(user) AS users,
      groupUniqArray(5)(if(client_name != '', client_name, substring(http_user_agent, 1, 60))) AS clients,
      countIf(event_time > now() - INTERVAL 7 DAY) AS runs7d,
      argMax(tables, event_time) AS tbls,
      sum(query_duration_ms) AS total
    FROM system.query_log
    WHERE ${WINDOW} AND query_kind = 'Select'
      AND NOT hasAny(databases, ['system', 'INFORMATION_SCHEMA', 'information_schema'])
    GROUP BY hash ORDER BY total DESC LIMIT ${limit * 2}`, { maxExecutionTime: 60 });
  return rows
    .filter((r) => triable(r.query))
    .slice(0, limit)
    .map((r) => ({
      hash: r.hash,
      query: r.query,
      settings: copiedSettings(r.settings ?? {}),
      users: r.users.filter(Boolean),
      clients: r.clients.filter(Boolean),
      runs7d: Number(r.runs7d),
      tables: r.tbls ?? [],
    }));
}

/** Drop target settings this server refuses, so one bad value doesn't fail every shape. */
async function usableSettings(explain: Explain, changed: Record<string, string>, deadline: number): Promise<{ applied: Record<string, string>; dropped: string[] }> {
  try {
    await explain("SELECT 1", changed);
    return { applied: changed, dropped: [] };
  } catch {
    const applied: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(changed)) {
      if (Date.now() > deadline) {
        dropped.push(k);
        continue;
      }
      try {
        await explain("SELECT 1", { [k]: v });
        applied[k] = v;
      } catch {
        dropped.push(k);
      }
    }
    return { applied, dropped };
  }
}

/**
 * Plan each shape with its own settings, then with the target's. A shape that
 * fails today too is skipped; one that fails only with the target's settings
 * is retried with the analyzer alone, then each changed setting alone, to
 * name the cause.
 */
export async function tryShapes(explain: Explain, shapes: TryShape[], plan: TryPlan, now: () => number = Date.now): Promise<TryResult> {
  const deadline = now() + BUDGET_MS;
  const { applied, dropped } = await usableSettings(explain, plan.changed, deadline);
  const usable: TryPlan = { analyzer: plan.analyzer, analyzerDefaultOn: plan.analyzerDefaultOn, changed: applied };
  const result: TryResult = { readable: true, tried: 0, skipped: 0, failing: [], planChanged: [], compared: 0, applied, dropped, budgetExhausted: false };
  for (const shape of shapes) {
    if (now() > deadline) {
      result.budgetExhausted = true;
      break;
    }
    let before: string;
    try {
      before = await explain(shape.query, shape.settings);
    } catch {
      result.skipped++;
      continue;
    }
    result.tried++;
    const target = targetSettings(shape.settings, usable);
    try {
      const after = await explain(shape.query, target);
      if (analyzerOn(shape.settings, plan.analyzer, plan.analyzerDefaultOn ?? true)) {
        result.compared++;
        if (normalisePlan(before) !== normalisePlan(after)) result.planChanged.push(shape);
      }
    } catch (error) {
      const e = error instanceof ExplainError ? { type: error.type, message: error.message } : { type: "ERROR", message: "" };
      result.failing.push({ ...shape, error: e, cause: await findCause(explain, shape, usable, deadline, now) });
    }
  }
  return result;
}

async function findCause(explain: Explain, shape: TryShape, plan: TryPlan, deadline: number, now: () => number): Promise<string | null> {
  const fails = async (settings: Record<string, string>): Promise<boolean> => {
    try {
      await explain(shape.query, settings);
      return false;
    } catch {
      return true;
    }
  };
  if (plan.analyzer && !analyzerOn(shape.settings, plan.analyzer, plan.analyzerDefaultOn ?? true)) {
    if (await fails(targetSettings(shape.settings, { analyzer: plan.analyzer, changed: {} }))) return plan.analyzer;
  }
  if (shape.settings.compatibility) return null;
  let tries = 0;
  for (const [k, v] of Object.entries(plan.changed)) {
    if (tries++ >= MAX_CAUSE_TRIES || now() > deadline) break;
    if (shape.settings[k] === v) continue;
    if (await fails({ ...shape.settings, [k]: v })) return k;
  }
  return null;
}
