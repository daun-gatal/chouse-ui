/**
 * The permission list of the token a request authenticated with (ADR 0011).
 *
 * A personal access token, or an agent's OAuth grant, carries its owner's
 * live permissions narrowed to the token's scope. Many checks ask "does this
 * account hold permission X" by account id, which answers from the owner's
 * roles and so knows nothing of the token. While a token's request runs, this
 * holds the token's own list, and those checks answer from it: a token can
 * never do more than its scope, whichever way a route asks.
 *
 * The holder is opened once for a whole request (`withRequestScope`, the
 * outermost middleware) and filled when the credential is verified, so it
 * covers every handler however a router calls its auth middleware. A browser
 * session leaves it empty: its permission questions keep being answered from
 * the database, so a permission granted a minute ago works without signing in
 * again.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TokenScope {
  userId: string;
  permissions: readonly string[];
  /** True when the token names a scope, so it carries less than its owner holds. */
  narrowed: boolean;
  /** True when the token's owner is an administrator, whom data access rules do not restrict. */
  adminOwner: boolean;
}

/** One per request. `scope` is set when a token is verified and cleared when a session is. */
interface Holder {
  scope: TokenScope | null;
}

const storage = new AsyncLocalStorage<Holder>();

/** Open the holder for one request. Everything the request runs, at any depth, sees what is put in it. */
export function withRequestScope<T>(fn: () => T): T {
  return storage.run({ scope: null }, fn);
}

/**
 * Record the credential the current request was verified with: a token's
 * scope, or null for a browser session. Returns false when no holder is open
 * (code running outside a request), so the caller can open one itself.
 */
export function setTokenScope(scope: TokenScope | null): boolean {
  const holder = storage.getStore();
  if (!holder) return false;
  holder.scope = scope;
  return true;
}

/** Run `fn` as a request made with a token of `userId` that carries exactly `permissions`. */
export function runWithTokenScope<T>(userId: string, permissions: readonly string[], fn: () => T, about: { narrowed?: boolean; adminOwner?: boolean } = {}): T {
  return storage.run({ scope: { userId, permissions, narrowed: about.narrowed === true, adminOwner: about.adminOwner === true } }, fn);
}

/**
 * The permissions of the token behind the current request, when it was made
 * with one and the question is about that token's owner. Null otherwise: a
 * browser session, background work, or a question about another account.
 */
export function tokenPermissionsFor(userId: string): readonly string[] | null {
  const scope = storage.getStore()?.scope;
  return scope && scope.userId === userId ? scope.permissions : null;
}

/**
 * True when the current request was made with a narrowed token whose owner is
 * an administrator. Such a token is not treated as an administrator where a
 * permission is decided (its scope would mean nothing), but its owner's
 * exemption from data access rules is the account's, not the token's.
 */
export function narrowedAdminToken(userId: string | undefined): boolean {
  const scope = storage.getStore()?.scope;
  return scope !== null && scope !== undefined && scope.userId === userId && scope.narrowed && scope.adminOwner;
}
