/**
 * The parse channel (ADR 0030 §4): `EXPLAIN AST` on the connection's own
 * ClickHouse client, so the parse uses the same server and user as execution.
 */
import type { ClickHouseClient } from "@clickhouse/client";

import { clientForConnection } from "../../services/scheduledQueries/chClient";
import { getConnectionById } from "../../rbac/services/connections";
import { logger } from "../../utils/logger";

export type ParseFailureCode = "SQL_SYNTAX" | "QUERY_PARAM_UNBOUND" | "CHECK_UNAVAILABLE";

export type ExplainResult = { ok: true; lines: string[] } | { ok: false; code: ParseFailureCode; message: string };

/** What the access check needs from ClickHouse. Tests pass a fake. */
export interface SqlParsePort {
  /** `EXPLAIN AST <sql>` printout lines, with `params` bound. */
  explainAst(sql: string, params?: Record<string, unknown>): Promise<ExplainResult>;
  /** The database unqualified names resolve against. */
  defaultDatabase(): Promise<string>;
}

const PARSE_TIMEOUT_MS = 5_000;

/** Overflow throws instead of truncating, so a long printout can't silently lose its tail. */
const PARSE_SETTINGS = {
  default_format: "JSONEachRow",
  max_result_rows: "0",
  max_result_bytes: "0",
  result_overflow_mode: "throw",
  max_execution_time: 5,
  log_comment: JSON.stringify({ source: "access_check" }),
};

/**
 * ClickHouse error codes that mean the server couldn't do the parse, not that
 * the statement is wrong: auth, timeouts, overload, network, cancellation.
 */
const UNAVAILABLE_CODES = new Set(["3", "159", "160", "164", "192", "193", "194", "195", "197", "202", "209", "210", "241", "242", "252", "394", "425", "497", "516", "1001"]);

/** The ClickHouse error code, if this is a ClickHouse error. Node network errors (`ECONNREFUSED`, …) have none. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^\d+$/.test(code)) return code;
  }
  const match = /Code: (\d+)/.exec(error instanceof Error ? error.message : String(error));
  return match?.[1];
}

const EXPLAIN_PREFIX = "EXPLAIN AST ";

/** ClickHouse counts positions from the start of `EXPLAIN AST …`; report them in the user's own text. */
function userPositions(message: string): string {
  return message.replace(/position (\d+)/g, (_match, n: string) => `position ${Math.max(0, Number(n) - EXPLAIN_PREFIX.length)}`);
}

/** Classify a failed parse: bad SQL or parameters (400), an unbound parameter (400), or no answer (503). */
export function classifyParseError(error: unknown): { code: ParseFailureCode; message: string } {
  const message = userPositions(error instanceof Error ? error.message : String(error));
  const code = errorCode(error);
  if (code === "456") return { code: "QUERY_PARAM_UNBOUND", message };
  // Any other ClickHouse error about the statement or its parameters is the
  // user's to fix; only errors with no ClickHouse code, or server-side ones, mean "try again".
  if (code && !UNAVAILABLE_CODES.has(code)) return { code: "SQL_SYNTAX", message };
  return { code: "CHECK_UNAVAILABLE", message };
}

async function readAll(stream: AsyncIterable<unknown>): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  return text + decoder.decode();
}

/** Run `EXPLAIN AST` on a client and return the printout lines. */
export async function explainAstOn(client: ClickHouseClient, sql: string, params?: Record<string, unknown>): Promise<ExplainResult> {
  try {
    const result = await client.exec({
      query: `${EXPLAIN_PREFIX}${sql}`,
      query_params: params,
      clickhouse_settings: PARSE_SETTINGS as never,
      abort_signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
    const body = await readAll(result.stream as AsyncIterable<unknown>);
    const lines: string[] = [];
    for (const row of body.split("\n")) {
      if (row.trim() === "") continue;
      const parsed: unknown = JSON.parse(row);
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { explain?: unknown }).explain !== "string") {
        return { ok: false, code: "CHECK_UNAVAILABLE", message: "Unexpected EXPLAIN AST output" };
      }
      lines.push((parsed as { explain: string }).explain);
    }
    return { ok: true, lines };
  } catch (error) {
    return { ok: false, ...classifyParseError(error) };
  }
}

const DEFAULT_DB_TTL_MS = 60_000;
const defaultDbCache = new Map<string, { value: string; expires: number }>();

/** Forget cached default databases (tests, connection edits). */
export function resetDefaultDatabaseCache(): void {
  defaultDbCache.clear();
}

/** The parse port for a stored connection. */
export function clickhouseParsePort(connectionId: string): SqlParsePort {
  let client: Promise<ClickHouseClient> | null = null;
  const getClient = (): Promise<ClickHouseClient> => (client ??= clientForConnection(connectionId));

  return {
    async explainAst(sql, params) {
      try {
        return await explainAstOn(await getClient(), sql, params);
      } catch (error) {
        return { ok: false, code: "CHECK_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) };
      }
    },

    async defaultDatabase() {
      const cached = defaultDbCache.get(connectionId);
      if (cached && cached.expires > Date.now()) return cached.value;
      const connection = await getConnectionById(connectionId);
      let value = connection?.database || "";
      if (!value) {
        // No database on the connection: ClickHouse uses the user's profile default.
        const rs = await (await getClient()).query({ query: "SELECT currentDatabase() AS db", format: "JSONEachRow", abort_signal: AbortSignal.timeout(PARSE_TIMEOUT_MS) });
        const rows = (await rs.json()) as Array<{ db?: string }>;
        value = rows[0]?.db || "default";
      }
      defaultDbCache.set(connectionId, { value, expires: Date.now() + DEFAULT_DB_TTL_MS });
      return value;
    },
  };
}

export function logUnsupported(reason: string): void {
  logger.info({ module: "SqlAccess", reason }, "Statement refused by the access check");
}
