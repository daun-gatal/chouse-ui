/**
 * Query ids the executor makes (ADR 0033 §2): `chouse:p:<account id>:<random>`
 * for a person and `chouse:s:<purpose>:<random>` for a service purpose. A
 * statement cannot change its own query id, so the id says who it was sent for.
 * It proves that only on rows whose ClickHouse `user` is the connection's own
 * login: anyone with their own ClickHouse login can pick any id.
 */

import { randomUUID } from "node:crypto";

import { SERVICE_PURPOSES, type Actor, type ServicePurpose } from "./types";

const PREFIX = "chouse";
const NONCE = /^[A-Za-z0-9_-]{1,64}$/;
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

export type QueryOwner = { kind: "person"; accountId: string } | { kind: "service"; purpose: ServicePurpose };

/** True when a caller-supplied value may be used as the random part. */
export function isNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

/**
 * The random part of a request CHouse builds for one of its own features
 * (collection, a dashboard panel, a remediation preflight) starts with this.
 * Reports leave such requests out. Only the executor can put it there: a
 * nonce from a caller that starts with it is replaced.
 */
export const INTERNAL_NONCE_PREFIX = "i-";

function randomPart(nonce: string | undefined, internal: boolean): string {
  const given = isNonce(nonce) ? nonce : null;
  if (internal) {
    if (given?.startsWith(INTERNAL_NONCE_PREFIX)) return given;
    const marked = `${INTERNAL_NONCE_PREFIX}${given ?? randomUUID()}`;
    return NONCE.test(marked) ? marked : `${INTERNAL_NONCE_PREFIX}${randomUUID()}`;
  }
  return given && !given.startsWith(INTERNAL_NONCE_PREFIX) ? given : randomUUID();
}

/**
 * Build the id for a request. A nonce that is not usable is replaced by a
 * random one, so a caller can never widen or forge the id through it.
 * `internal` marks a request of one of CHouse's own features.
 */
export function makeQueryId(actor: Actor, nonce?: string, internal = false): string {
  const random = randomPart(nonce, internal);
  if (actor.kind === "person") {
    if (!ACCOUNT.test(actor.accountId)) throw new Error("Account id cannot be carried in a query id");
    return `${PREFIX}:p:${actor.accountId}:${random}`;
  }
  if (actor.kind !== "service" || !(SERVICE_PURPOSES as readonly string[]).includes(actor.purpose)) {
    throw new Error("A ClickHouse request needs a person or a known service purpose");
  }
  return `${PREFIX}:s:${actor.purpose}:${random}`;
}

/** Who a query id says the statement was sent for; null when it is not one of ours. */
export function parseQueryId(queryId: string | null | undefined): (QueryOwner & { nonce: string }) | null {
  if (typeof queryId !== "string") return null;
  const parts = queryId.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, kind, subject, nonce] = parts;
  if (!NONCE.test(nonce)) return null;
  if (kind === "p" && ACCOUNT.test(subject)) return { kind: "person", accountId: subject, nonce };
  if (kind === "s" && (SERVICE_PURPOSES as readonly string[]).includes(subject)) {
    return { kind: "service", purpose: subject as ServicePurpose, nonce };
  }
  return null;
}

/** The account a query id names, or null. */
export function accountOfQueryId(queryId: string | null | undefined): string | null {
  const owner = parseQueryId(queryId);
  return owner?.kind === "person" ? owner.accountId : null;
}

/** SQL `LIKE` pattern matching every id made for one account. Account ids hold no LIKE wildcards except `_`, which is escaped. */
export function accountQueryIdLike(accountId: string): string {
  if (!ACCOUNT.test(accountId)) throw new Error("Account id cannot be carried in a query id");
  return `${PREFIX}:p:${accountId.replace(/_/g, "\\_")}:%`;
}

/** SQL `LIKE` pattern matching every id made for one service purpose. */
export function purposeQueryIdLike(purpose: ServicePurpose): string {
  return `${PREFIX}:s:${purpose}:%`;
}

const PERSON_ID_RE = `^${PREFIX}:p:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$`;

/**
 * The CHouse account a logged statement was sent for, or null (ADR 0033 §2).
 * Only a row whose ClickHouse `user` is the connection's own login can name
 * one: anyone with their own login can pick any query id. On such a row the
 * id decides; `log_comment` is read only for an id that is not one of ours,
 * which is a row logged before query ids carried the account. A statement
 * can set its own `log_comment`, so it never overrides the id.
 */
export function ownerAccount(row: { queryId: unknown; logComment?: unknown; user?: unknown }, login: string | undefined): string | null {
  if (login !== undefined && row.user !== login) return null;
  const queryId = typeof row.queryId === "string" ? row.queryId : "";
  const owner = parseQueryId(queryId);
  if (owner) return owner.kind === "person" ? owner.accountId : null;
  if (queryId.startsWith(`${PREFIX}:`)) return null;
  if (typeof row.logComment !== "string" || row.logComment === "") return null;
  try {
    const parsed = JSON.parse(row.logComment) as { rbac_user_id?: unknown };
    return typeof parsed.rbac_user_id === "string" && parsed.rbac_user_id !== "" ? parsed.rbac_user_id : null;
  } catch {
    return null;
  }
}

/** Column names (or expressions) of a `system.query_log` or `system.processes` row. */
export interface LogColumns {
  queryId: string;
  logComment: string;
  user: string;
}

// `initial_query_id` equals `query_id` for a statement CHouse sent, and on a
// shard it is the id of the statement that fanned out. A shard-side row has a
// query id the server made, so reading `query_id` there would fall through to
// `log_comment`, which the statement controls.
const QUERY_LOG: LogColumns = { queryId: "initial_query_id", logComment: "log_comment", user: "user" };

/**
 * `ownerAccount` as a ClickHouse expression: the account, or an empty string.
 * The login is `currentUser()`, so it is right only on a request sent with the
 * connection's own login.
 */
export function ownerAccountSql(columns: LogColumns = QUERY_LOG): string {
  return `if(${columns.user} = currentUser(), multiIf(match(${columns.queryId}, '${PERSON_ID_RE}'), splitByChar(':', ${columns.queryId})[3], startsWith(${columns.queryId}, '${PREFIX}:'), '', JSONExtractString(${columns.logComment}, 'rbac_user_id')), '')`;
}

/**
 * A ClickHouse condition that is true for statements CHouse sent for its own
 * features, which reports leave out: collection and remediation by id, a
 * feature request made for a person by its marked random part, and, for rows
 * logged before query ids carried this, the `source` in `log_comment`.
 */
export function internalTrafficSql(legacySources: readonly string[], columns: LogColumns = QUERY_LOG): string {
  const sources = legacySources.map((s) => `'${s.replace(/[^a-z_]/g, "")}'`).join(", ");
  return `(startsWith(${columns.queryId}, '${PREFIX}:s:collector:') OR startsWith(${columns.queryId}, '${PREFIX}:s:remediation:') OR match(${columns.queryId}, '^${PREFIX}:p:[A-Za-z0-9_-]{1,64}:${INTERNAL_NONCE_PREFIX}') OR (NOT startsWith(${columns.queryId}, '${PREFIX}:') AND JSONExtractString(${columns.logComment}, 'source') IN (${sources})))`;
}
