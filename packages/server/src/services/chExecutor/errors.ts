/**
 * One reading of ClickHouse errors (ADR 0033 §8). It decides from the error
 * code, with the message as a fallback for errors that lost their code on the
 * way. A classified error is a message for the person who sent the statement;
 * it never says anything about a connection's health, because typed text can
 * provoke most codes.
 */

import { AppError } from "../../types";

export type ChErrorClass = "read-only" | "grant" | "identity" | "connection";

export interface ClassifiedError {
  class: ChErrorClass;
  /** The CHouse error code the API returns. */
  code: "READ_ONLY" | "CLICKHOUSE_ACCESS_DENIED" | "IDENTITY_UNAVAILABLE" | "CONNECTION_UNAVAILABLE";
  status: 403 | 503;
  /** What the person is told. */
  message: string;
  /** For a grant error: the grant ClickHouse named, e.g. `SELECT ON db.t`. */
  grant?: string;
}

const READONLY = 164;
const ACCESS_DENIED = 497;
const UNKNOWN_SETTING = 115;
const UNKNOWN_ROLE = 511;
const SET_NON_GRANTED_ROLE = 512;

/** What the classifier may know about where the statement ran. */
export interface ErrorContext {
  /** The connection's kind. On `shared_ceiling` a grant error is about the person's mapped role, not the login. */
  mode?: string;
  /** The connection's stored login. On `personal` a grant error that names it is about impersonation, not about the person. */
  login?: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/** The ClickHouse error code of an error, or null. The client puts it in `code`; a wrapped error keeps it in the text. */
export function clickhouseErrorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" && Number.isInteger(code)) return code;
    if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  }
  const match = /\bCode:\s*(\d+)\b/.exec(messageOf(error));
  return match ? Number(match[1]) : null;
}

/** The server's name for the error (`ACCESS_DENIED`, `UNKNOWN_TABLE`), or an empty string. */
export function clickhouseErrorType(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const type = (error as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "";
}

/** ClickHouse refused for lack of a grant (497). */
export function isGrantError(error: unknown): boolean {
  // The code decides when there is one: a statement can put any words in its own error text.
  const code = clickhouseErrorCode(error);
  if (code !== null) return code === ACCESS_DENIED;
  if (clickhouseErrorType(error) === "ACCESS_DENIED") return true;
  const message = messageOf(error);
  return message.includes("ACCESS_DENIED") || /Not enough privileges/i.test(message);
}

/** ClickHouse refused a change on a read-only request (164). */
export function isReadOnlyError(error: unknown): boolean {
  const code = clickhouseErrorCode(error);
  if (code !== null) return code === READONLY;
  if (clickhouseErrorType(error) === "READONLY") return true;
  return /\(READONLY\)/.test(messageOf(error));
}

/** "…necessary to have the grant SELECT(a, b) ON system.metric_log. (ACCESS_DENIED)" → "SELECT ON system.metric_log". */
export function requiredGrantFromError(message: string): string | null {
  const match = /necessary to have the grant (.+?)\.\s*\(ACCESS_DENIED\)/s.exec(message);
  if (!match) return null;
  return match[1].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/** System tables a grant error names, e.g. `["query_log"]`. Empty when the error is not a grant error. */
export function deniedSystemTables(error: unknown): string[] {
  if (!isGrantError(error)) return [];
  return [...new Set([...messageOf(error).matchAll(/system\.([a-z_0-9]+)/gi)].map((m) => m[1]))];
}

/** Classify an error from ClickHouse; null when it is not one of the classes CHouse words itself. */
export function classifyClickHouseError(error: unknown, context: ErrorContext = {}): ClassifiedError | null {
  const ceiling = context.mode !== undefined && context.mode !== "shared";
  if (isGrantError(error)) {
    const raw = messageOf(error);
    const grant = requiredGrantFromError(raw) ?? undefined;
    const detail = raw.split("\n")[0].trim();
    if (context.mode === "personal") {
      // ClickHouse starts the message with the user it checked: the person's own, or the login when it may not act as them.
      const named = /(?:^|DB::Exception:\s*)([^:\s]+):\s*Not enough privileges/.exec(raw)?.[1];
      if (context.login !== undefined && named === context.login) {
        return {
          class: "identity",
          code: "IDENTITY_UNAVAILABLE",
          status: 403,
          message: "This connection may not run statements as your ClickHouse user. A ClickHouse administrator must grant IMPERSONATE on your user to the connection's impersonation role.",
        };
      }
      return {
        class: "grant",
        code: "CLICKHOUSE_ACCESS_DENIED",
        status: 403,
        grant,
        message: `Your ClickHouse user isn't allowed to do this: ${detail} A ClickHouse administrator can grant it to your user.`,
      };
    }
    return {
      class: "grant",
      code: "CLICKHOUSE_ACCESS_DENIED",
      status: 403,
      grant,
      message: ceiling
        ? `Your ClickHouse role on this connection isn't allowed to do this: ${detail} A ClickHouse administrator can grant it to the role.`
        : `This connection's ClickHouse user isn't allowed to do this: ${detail} Test the connection in Admin › Connections to see the grants it needs.`,
    };
  }
  const code = clickhouseErrorCode(error);
  // Only on a connection where CHouse names a role: there these codes are about the role it named.
  if (ceiling && (code === UNKNOWN_ROLE || code === SET_NON_GRANTED_ROLE)) {
    return {
      class: "identity",
      code: "IDENTITY_UNAVAILABLE",
      status: 403,
      message: `Your ClickHouse role on this connection can't be used: ${messageOf(error).split("\n")[0].trim()} A ClickHouse administrator must create the role and grant it to the connection's user.`,
    };
  }
  if (ceiling && code === UNKNOWN_SETTING && /\bSetting role\b/.test(messageOf(error))) {
    return {
      class: "connection",
      code: "CONNECTION_UNAVAILABLE",
      status: 503,
      message: "This connection limits people to a ClickHouse role, which needs ClickHouse 24.4 or newer. This server does not take a role on a request.",
    };
  }
  if (isReadOnlyError(error)) {
    // The login itself is read-only and refuses a setting CHouse sends with the request.
    const setting = /Cannot modify '([^']+)' setting in readonly mode/.exec(messageOf(error));
    return {
      class: "read-only",
      code: "READ_ONLY",
      status: 403,
      message: setting
        ? `This connection's ClickHouse user is read-only and refused the setting '${setting[1]}' that CHouse sends. A ClickHouse administrator can allow settings for it with readonly = 2.`
        : context.mode === "personal"
          ? "This statement would change data or settings, and it was sent as a read. Here it must be a read: you did not write it, or you may only read. If it is a SELECT with a FORMAT clause, remove the clause."
          : "This statement would change data or settings, and it was sent read-only. You may only read here; ask an admin for write access if you need it.",
    };
  }
  return null;
}

/** The `AppError` for a classified error. */
export function classifiedAppError(classified: ClassifiedError): AppError {
  return new AppError(classified.message, classified.code, classified.class === "connection" ? "connection" : "permission", classified.status, classified.grant ? { grant: classified.grant } : undefined);
}
