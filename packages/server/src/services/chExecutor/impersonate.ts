/**
 * Running a statement as a person's own ClickHouse user (ADR 0033 §7.2).
 *
 * On a `personal` connection the service login holds nothing. A person's
 * statement is sent as `EXECUTE AS <bound user> <statement>` with the
 * impersonation role named, so ClickHouse checks that user's own grants.
 *
 * Typed text is never trusted to sit inside the wrapper the way CHouse
 * expects: ClickHouse parses the wrapped text again, and the printout must
 * show the wrapper as the root, the bound user as its target, and under it
 * the same tree the typed text had alone. Anything else is refused.
 */

import { AppError } from "../../types";
import type { ImpersonatedText } from "./checked";

/** One `EXPLAIN AST` of a text. The access check's parse port has this shape. */
export interface PrintoutPort {
  explainAst(sql: string, params?: Record<string, unknown>): Promise<{ ok: true; lines: string[] } | { ok: false; code: string; message: string }>;
}

/**
 * Statement kinds that may be wrapped. For each, a recorded real-server case
 * (`identity.e2e.test.ts`, 26.3.63.123) shows a user without the grant is
 * refused by ClickHouse with error 497 naming that user. `use` and `set` are
 * not here: there is no session to hold their effect.
 */
export const WRAPPABLE_KINDS: ReadonlySet<string> = new Set([
  "select", "show", "describe", "exists", "check", "explain",
  "insert", "update", "delete", "create", "drop", "alter", "truncate", "kill",
]);

/** Kinds whose statement takes a SETTINGS clause, so a read can carry `readonly = 1` itself. */
const CARRIES_READONLY: ReadonlySet<string> = new Set(["select", "explain"]);

/** Kinds that cannot write and cannot carry the clause: the kind from ClickHouse's parse is the guard. */
const READS_BY_KIND: ReadonlySet<string> = new Set(["show", "describe", "exists", "check"]);

/** `EXECUTE AS` and the user, quoted so a name that is also a keyword stays a name. */
export function wrapperFor(user: string): string {
  return `EXECUTE AS \`${user}\` `;
}

/** The statement without the semicolons and blank space after it, so a clause can follow. */
function withoutTerminator(sql: string): string {
  return sql.replace(/[;\s]+$/, "");
}

const CHILDREN = / \(children \d+\)$/;
const isSet = (line: string): boolean => /^\s*Set$/.test(line);

/** A printout without child counts and `Set` nodes, which is all that adding a SETTINGS entry may change. */
function shape(lines: readonly string[]): string[] {
  return lines.filter((line) => !isSet(line)).map((line) => line.replace(CHILDREN, ""));
}

/**
 * True when `wrapped` is the printout of `EXECUTE AS <user>` around exactly
 * the statement `alone` is the printout of, with `addedSets` more `Set` nodes.
 * The wrapper must have two children, the user and the statement: a FORMAT or
 * SETTINGS clause that ClickHouse attached to the wrapper adds a third.
 */
export function isWrapOf(wrapped: readonly string[], alone: readonly string[], user: string, addedSets: 0 | 1): boolean {
  if (wrapped.length < 4 || alone.length === 0) return false;
  if (wrapped[0] !== "ExecuteAsQuery (children 2)") return false;
  if (wrapped[1] !== " UserNameWithHost (children 1)") return false;
  if (wrapped[2] !== `  Identifier ${user}`) return false;
  const inner: string[] = [];
  for (const line of wrapped.slice(3)) {
    if (!line.startsWith(" ")) return false;
    inner.push(line.slice(1));
  }
  if (inner.some((line) => /^\s*ExecuteAsQuery\b/.test(line))) return false;
  if (inner.filter(isSet).length !== alone.filter(isSet).length + addedSets) return false;
  const a = shape(inner);
  const b = shape(alone);
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

export type ImpersonateResult = { ok: true; value: ImpersonatedText } | { ok: false; unavailable: boolean; reason: string };

const NOT_CONFIRMED = "CHouse could not confirm that this statement would run as your own ClickHouse user, so it was not sent. If it ends with a FORMAT clause, remove the clause (CHouse chooses the output format); a comment after a closing semicolon must go too.";

/**
 * Wrap typed text for a bound user and have ClickHouse confirm each text that
 * may be sent. `text` is the statement as ClickHouse is asked to parse it and
 * `alone` is its printout; `kind` is the statement's kind from that parse.
 */
export async function impersonate(text: string, params: Record<string, unknown> | undefined, kind: string, alone: readonly string[], user: string, port: PrintoutPort): Promise<ImpersonateResult> {
  const confirm = async (candidate: string, addedSets: 0 | 1): Promise<boolean | "unavailable"> => {
    const printout = await port.explainAst(candidate, params);
    if (!printout.ok) return printout.code === "CHECK_UNAVAILABLE" ? "unavailable" : false;
    return isWrapOf(printout.lines, alone, user, addedSets);
  };
  const unavailable: ImpersonateResult = { ok: false, unavailable: true, reason: "The statement couldn't be checked because ClickHouse didn't answer. Try again." };

  const sql = `${wrapperFor(user)}${text}`;
  const plain = await confirm(sql, 0);
  if (plain === "unavailable") return unavailable;
  if (!plain) return { ok: false, unavailable: false, reason: NOT_CONFIRMED };

  let readOnlySql: string | null = null;
  if (READS_BY_KIND.has(kind)) {
    readOnlySql = sql;
  } else if (CARRIES_READONLY.has(kind)) {
    const base = `${wrapperFor(user)}${withoutTerminator(text)}`;
    // A new clause, or one more entry in the statement's own trailing clause. The last value wins (observed, 26.3).
    const added = `${base}\nSETTINGS readonly = 1`;
    const first = await confirm(added, 1);
    if (first === "unavailable") return unavailable;
    if (first) {
      readOnlySql = added;
    } else if (alone.some(isSet)) {
      const extended = `${base}\n, readonly = 1`;
      const second = await confirm(extended, 0);
      if (second === "unavailable") return unavailable;
      if (second) readOnlySql = extended;
    }
  }
  return { ok: true, value: { user, sql, readOnlySql } };
}

const LEADING = /^(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/|\()*/;

/**
 * Wrap text CHouse built itself for a bound user. `readOnly` is true when the
 * call asked for `readonly`, which cannot go on the URL here (ClickHouse would
 * apply it to the wrapper and refuse the request): a SELECT, WITH or EXPLAIN
 * carries it in its own SETTINGS clause, a SHOW, DESCRIBE, EXISTS or CHECK
 * cannot write, and anything else is refused, since nothing would hold it to
 * a read. Built text that already ends in SETTINGS or FORMAT is refused by
 * ClickHouse (164) when a clause is added, which fails closed.
 */
export function wrapBuilt(user: string, text: string, readOnly: boolean): string {
  const statement = withoutTerminator(text.trim());
  if (!readOnly) return `${wrapperFor(user)}${statement}`;
  const keyword = /^[A-Za-z]+/.exec(statement.replace(LEADING, ""))?.[0].toUpperCase() ?? "";
  if (keyword === "SELECT" || keyword === "WITH" || keyword === "EXPLAIN") return `${wrapperFor(user)}${statement}\nSETTINGS readonly = 1`;
  if (keyword === "SHOW" || keyword === "DESCRIBE" || keyword === "DESC" || keyword === "EXISTS" || keyword === "CHECK") return `${wrapperFor(user)}${statement}`;
  throw new AppError("A read-only request on a personal connection must be a SELECT, EXPLAIN, SHOW, DESCRIBE, EXISTS or CHECK.", "READ_ONLY", "permission", 403);
}
