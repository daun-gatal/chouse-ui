/**
 * Grants (ADR 0025 §1): "allow this tool for this thread" or "for an hour",
 * given when confirming a T2 call in chat. A grant only ever skips a T2
 * confirmation, never a T3 approval, and never after the run read untrusted
 * data (the chat checks taint before it looks for a grant).
 */

import { randomUUID } from "crypto";

import { one, run, sql } from "../../observe/db";

export const GRANT_SCOPES = ["thread", "hour"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

/** A thread grant lasts as long as a working session reasonably does. */
const THREAD_GRANT_TTL_MS = 12 * 60 * 60_000;
const HOUR_GRANT_TTL_MS = 60 * 60_000;

export async function createGrant(input: { userId: string; tool: string; scope: GrantScope; threadId: string | null }): Promise<void> {
  if (input.scope === "thread" && !input.threadId) throw new Error("A thread grant needs the thread");
  const now = Date.now();
  const ttl = input.scope === "thread" ? THREAD_GRANT_TTL_MS : HOUR_GRANT_TTL_MS;
  await run(sql`
    INSERT INTO ai_action_grants (id, user_id, tool, scope, thread_id, expires_at, created_at)
    VALUES (${randomUUID()}, ${input.userId}, ${input.tool}, ${input.scope}, ${input.scope === "thread" ? input.threadId : null}, ${now + ttl}, ${now})`);
}

/** Whether the user granted this tool for this thread, or for the hour. */
export async function hasGrant(userId: string, tool: string, threadId: string | null, now: number = Date.now()): Promise<boolean> {
  const row = await one(sql`
    SELECT 1 AS ok FROM ai_action_grants
    WHERE user_id = ${userId} AND tool = ${tool} AND expires_at > ${now}
      AND (scope = 'hour' OR (scope = 'thread' AND thread_id = ${threadId ?? ""}))
    LIMIT 1`);
  return row !== null;
}

export async function pruneGrants(now: number = Date.now()): Promise<void> {
  await run(sql`DELETE FROM ai_action_grants WHERE expires_at <= ${now}`);
}
