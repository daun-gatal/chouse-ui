/**
 * The self-test of a `personal` connection (ADR 0033 §7.1). A server may run
 * people's statements as their own ClickHouse users only while it passes four
 * checks, each one statement sent with the impersonation role and without a
 * side effect. The second matters most: some ClickHouse builds run `CREATE`
 * under `EXECUTE AS` without checking the target user's grants, so on them a
 * person with no grants could create objects.
 */

import { clickhouseErrorCode } from "./errors";
import { wrapperFor } from "./impersonate";

export interface SelfTestCheck {
  id: "impersonation" | "create_checked" | "format" | "no_nesting";
  label: string;
  ok: boolean;
  detail: string;
}

/** Send one statement with the impersonation role and return its body. Throws what ClickHouse answered. */
export type SelfTestSend = (query: string) => Promise<string>;

const ACCESS_DENIED = 497;
const SYNTAX_ERROR = 62;

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0].trim().slice(0, 240);
}

/** The statement of the second check. `system` always exists, so even a build that skips the access check changes nothing. */
export function createCheckStatement(login: string): string {
  return `${wrapperFor(login)}CREATE DATABASE IF NOT EXISTS system`;
}

/** Null when ClickHouse access-checks `CREATE` under `EXECUTE AS`, else why it cannot be relied on. */
export async function createCheckFailure(send: SelfTestSend, login: string): Promise<string | null> {
  try {
    await send(createCheckStatement(login));
  } catch (error) {
    if (clickhouseErrorCode(error) === ACCESS_DENIED && /CREATE DATABASE/.test(error instanceof Error ? error.message : String(error))) return null;
    return `Could not confirm that this server checks grants for CREATE under EXECUTE AS: ${firstLine(error)}`;
  }
  return "This ClickHouse build runs CREATE under EXECUTE AS without checking the user's grants, so a personal connection is not safe on it. Use a build that passes this check (26.3.63 does; the fix is listed for 26.10).";
}

/** The four checks, in order. Later checks still run after a failure, so the report is complete. */
export async function runSelfTest(send: SelfTestSend, login: string): Promise<SelfTestCheck[]> {
  const checks: SelfTestCheck[] = [];
  const wrapper = wrapperFor(login);

  const works = "The impersonation role can run a statement as another user";
  try {
    const body = (await send(`${wrapper}SELECT 1`)).trim();
    checks.push(body === "1"
      ? { id: "impersonation", label: works, ok: true, detail: "EXECUTE AS works." }
      : { id: "impersonation", label: works, ok: false, detail: `EXECUTE AS ${login} SELECT 1 answered "${body.slice(0, 60)}" instead of 1.` });
  } catch (error) {
    const code = clickhouseErrorCode(error);
    const detail = code === ACCESS_DENIED
      ? `The impersonation role lacks IMPERSONATE on ${login}. Run: GRANT IMPERSONATE ON ${login} TO <impersonation role>`
      : code === SYNTAX_ERROR
        ? "This server does not know EXECUTE AS. Personal connections need a ClickHouse build that has it."
        : `EXECUTE AS ${login} SELECT 1 failed: ${firstLine(error)}`;
    checks.push({ id: "impersonation", label: works, ok: false, detail });
  }

  const create = await createCheckFailure(send, login);
  checks.push({ id: "create_checked", label: "CREATE under EXECUTE AS is checked against the user's grants", ok: create === null, detail: create ?? "Refused for the missing grant, as it should be." });

  const format = "A FORMAT clause is honoured under EXECUTE AS";
  try {
    const body = (await send(`${wrapper}SELECT 1 AS a FORMAT JSONEachRow`)).trim();
    checks.push(body === '{"a":1}'
      ? { id: "format", label: format, ok: true, detail: "Honoured." }
      : { id: "format", label: format, ok: false, detail: `The reply was "${body.slice(0, 60)}" instead of {"a":1}.` });
  } catch (error) {
    checks.push({ id: "format", label: format, ok: false, detail: `Failed: ${firstLine(error)}` });
  }

  const nesting = "EXECUTE AS cannot be nested";
  try {
    await send(`${wrapper}${wrapper}SELECT 1`);
    checks.push({ id: "no_nesting", label: nesting, ok: false, detail: "A nested EXECUTE AS ran. CHouse relies on it being a syntax error." });
  } catch (error) {
    checks.push(clickhouseErrorCode(error) === SYNTAX_ERROR
      ? { id: "no_nesting", label: nesting, ok: true, detail: "A syntax error, as it should be." }
      : { id: "no_nesting", label: nesting, ok: false, detail: `Expected a syntax error, got: ${firstLine(error)}` });
  }
  return checks;
}

/** How long a passed `CREATE` check lets statements through before it is repeated. */
export const CREATE_RECHECK_MS = 60_000;

const createPassedAt = new Map<string, number>();

/**
 * Repeat the `CREATE` check for a connection unless it passed within the last
 * minute. The health timer runs every five minutes; a server upgraded between
 * two rounds must not run one unchecked `CREATE`. Throws the reason when the
 * check does not pass; a failure is never remembered.
 */
export async function ensureCreateChecked(key: string, send: SelfTestSend, login: string, now: number = Date.now()): Promise<void> {
  const passed = createPassedAt.get(key);
  if (passed !== undefined && now - passed < CREATE_RECHECK_MS) return;
  const failure = await createCheckFailure(send, login);
  if (failure !== null) {
    createPassedAt.delete(key);
    throw new Error(failure);
  }
  createPassedAt.set(key, now);
}

/** Forget every remembered pass (tests, and a connection whose login changed). */
export function resetCreateChecks(): void {
  createPassedAt.clear();
}
