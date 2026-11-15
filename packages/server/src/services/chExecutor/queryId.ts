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
 * Build the id for a request. A nonce that is not usable is replaced by a
 * random one, so a caller can never widen or forge the id through it.
 */
export function makeQueryId(actor: Actor, nonce?: string): string {
  const random = isNonce(nonce) ? nonce : randomUUID();
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
