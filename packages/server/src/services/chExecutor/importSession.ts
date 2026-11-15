/**
 * Sending rows on a `personal` connection (ADR 0033 §7.7). An `INSERT` with
 * rows cannot be one `EXECUTE AS` request, so this operation, and no other,
 * opens a ClickHouse session: the first request switches the session to the
 * person's user, the second sends the rows in it. Typed text never runs in
 * such a session; the insert statement is built by the client from a table
 * name the caller already checked.
 */

import { randomBytes } from "node:crypto";

import { wrapperFor } from "./impersonate";

/** The session lives only as long as the two requests need. */
export const IMPORT_SESSION_SECONDS = 60;

export interface ImportSends<T> {
  /** Send `EXECUTE AS <user>` in a new session, with the impersonation role named. */
  open(query: string, sessionId: string): Promise<unknown>;
  /** Send the rows in that session with `session_check = 1` and no role. */
  insert(sessionId: string): Promise<T>;
}

/**
 * Run the two requests. `session_check = 1` on the second makes ClickHouse
 * refuse it when the session is not there (another node, or it expired), so
 * the rows can never arrive as a bare request from the empty login.
 */
export async function importAs<T>(user: string, role: string | undefined, sends: ImportSends<T>): Promise<T> {
  if (!role) throw new Error("An import on a personal connection needs the impersonation role");
  const sessionId = `chouse-import-${randomBytes(16).toString("hex")}`;
  await sends.open(wrapperFor(user).trim(), sessionId);
  return sends.insert(sessionId);
}
