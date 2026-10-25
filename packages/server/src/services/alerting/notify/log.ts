/**
 * The message log (ADR 0026 §5): one `channel_messages` row per message sent
 * to one channel. Inserting the row is the claim — the unique key on
 * (channel, feature, subject, kind) keeps two replicas, or an outbox retry,
 * from sending the same message twice — and the row remembers where the
 * message landed so the feature can edit it later.
 */

import { randomUUID } from "crypto";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";
import type { NotifyFeature, NotifyMessage, PlatformRef, StoredButton } from "./types";

export type MessageState = "sending" | "sent" | "failed";

export interface ChannelMessage {
  id: string;
  channelId: string;
  feature: NotifyFeature;
  subjectId: string;
  kind: string;
  state: MessageState;
  ref: PlatformRef | null;
  buttons: StoredButton[];
  /** The message as last rendered, so a later edit can start from it. */
  message: NotifyMessage | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

/** A send that crashed mid-way may be claimed again after this. */
const STALE_SENDING_MS = 10 * 60_000;

function rowToMessage(r: Row): ChannelMessage {
  const state = str(r.state);
  return {
    id: str(r.id),
    channelId: str(r.channel_id),
    feature: str(r.feature) as NotifyFeature,
    subjectId: str(r.subject_id),
    kind: str(r.kind),
    state: state === "sent" || state === "failed" ? state : "sending",
    ref: json<PlatformRef | null>(r.platform_ref, null),
    buttons: json<StoredButton[]>(r.buttons, []),
    message: json<NotifyMessage | null>(r.message, null),
    error: strOrNull(r.error),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    closedAt: numOrNull(r.closed_at),
  };
}

export interface MessageKey {
  channelId: string;
  feature: NotifyFeature;
  subjectId: string;
  kind: string;
}

/**
 * Claim the right to send this message. Returns the row id, or null when it
 * was already sent (or is being sent right now). A failed earlier attempt,
 * or one stuck sending, is claimed again.
 */
export async function claimMessage(key: MessageKey, now: number = Date.now()): Promise<string | null> {
  const id = randomUUID();
  const inserted = await one(sql`
    INSERT INTO channel_messages (id, channel_id, feature, subject_id, kind, state, created_at, updated_at)
    VALUES (${id}, ${key.channelId}, ${key.feature}, ${key.subjectId}, ${key.kind}, 'sending', ${now}, ${now})
    ON CONFLICT (channel_id, feature, subject_id, kind) DO NOTHING
    RETURNING id`);
  if (inserted) return id;
  const retried = await one(sql`
    UPDATE channel_messages SET state = 'sending', error = NULL, updated_at = ${now}
    WHERE channel_id = ${key.channelId} AND feature = ${key.feature} AND subject_id = ${key.subjectId} AND kind = ${key.kind}
      AND (state = 'failed' OR (state = 'sending' AND updated_at < ${now - STALE_SENDING_MS}))
    RETURNING id`);
  return retried ? str(retried.id) : null;
}

export async function markSent(id: string, ref: PlatformRef | null, buttons: StoredButton[], message: NotifyMessage): Promise<void> {
  await run(sql`
    UPDATE channel_messages SET state = 'sent', platform_ref = ${ref ? JSON.stringify(ref) : null},
      buttons = ${buttons.length > 0 ? JSON.stringify(buttons) : null}, message = ${JSON.stringify(message)}, error = NULL, updated_at = ${Date.now()}
    WHERE id = ${id}`);
}

export async function markFailed(id: string, error: string): Promise<void> {
  await run(sql`UPDATE channel_messages SET state = 'failed', error = ${error.slice(0, 1000)}, updated_at = ${Date.now()} WHERE id = ${id}`);
}

export async function getMessage(id: string): Promise<ChannelMessage | null> {
  const row = await one(sql`SELECT * FROM channel_messages WHERE id = ${id}`);
  return row ? rowToMessage(row) : null;
}

/** Messages about one subject that landed somewhere they can still be edited. */
export async function openMessages(feature: NotifyFeature, subjectId: string): Promise<ChannelMessage[]> {
  const rows = await all(sql`
    SELECT * FROM channel_messages
    WHERE feature = ${feature} AND subject_id = ${subjectId} AND state = 'sent' AND platform_ref IS NOT NULL AND closed_at IS NULL
    ORDER BY created_at`);
  return rows.map(rowToMessage);
}

/** Record an edit: the new message and buttons (none once decided), and closed when the subject is settled. */
export async function markEdited(id: string, buttons: StoredButton[], message: NotifyMessage | null, close: boolean): Promise<void> {
  const now = Date.now();
  await run(sql`
    UPDATE channel_messages SET buttons = ${buttons.length > 0 ? JSON.stringify(buttons) : null}, updated_at = ${now}
      ${message ? sql`, message = ${JSON.stringify(message)}` : sql``}
      ${close ? sql`, closed_at = ${now}` : sql``}
    WHERE id = ${id}`);
}

export interface ChannelHealth {
  channelId: string;
  lastSentAt: number | null;
  lastFailedAt: number | null;
  lastError: string | null;
  sent24h: number;
  failed24h: number;
}

/** Delivery health per channel, from the log. */
export async function channelHealth(now: number = Date.now()): Promise<Map<string, ChannelHealth>> {
  const since = now - 24 * 60 * 60_000;
  const rows = await all(sql`
    SELECT channel_id,
      MAX(CASE WHEN state = 'sent' THEN updated_at END) AS last_sent,
      MAX(CASE WHEN state = 'failed' THEN updated_at END) AS last_failed,
      SUM(CASE WHEN state = 'sent' AND updated_at >= ${since} THEN 1 ELSE 0 END) AS sent_24h,
      SUM(CASE WHEN state = 'failed' AND updated_at >= ${since} THEN 1 ELSE 0 END) AS failed_24h
    FROM channel_messages GROUP BY channel_id`);
  const errors = await all(sql`
    SELECT m.channel_id, m.error FROM channel_messages m
    WHERE m.state = 'failed' AND m.updated_at = (SELECT MAX(updated_at) FROM channel_messages x WHERE x.channel_id = m.channel_id AND x.state = 'failed')`);
  const lastError = new Map(errors.map((r) => [str(r.channel_id), strOrNull(r.error)]));
  const out = new Map<string, ChannelHealth>();
  for (const r of rows) {
    const channelId = str(r.channel_id);
    out.set(channelId, {
      channelId,
      lastSentAt: numOrNull(r.last_sent),
      lastFailedAt: numOrNull(r.last_failed),
      lastError: lastError.get(channelId) ?? null,
      sent24h: num(r.sent_24h),
      failed24h: num(r.failed_24h),
    });
  }
  return out;
}

/** How long the log keeps rows. Open subjects older than this can no longer be edited. */
export const MESSAGE_RETENTION_MS = 90 * 24 * 60 * 60_000;

export async function pruneMessages(now: number = Date.now()): Promise<void> {
  await run(sql`DELETE FROM channel_messages WHERE created_at < ${now - MESSAGE_RETENTION_MS}`);
}
