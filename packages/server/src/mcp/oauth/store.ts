/**
 * Storage for MCP OAuth (ADR 0028 §2): agents, sign-ins in progress with their
 * one-time codes, grants (rows in rbac_api_keys with kind = 'oauth') and their
 * access and refresh tokens.
 *
 * Every state change that two replicas could race on (deciding a sign-in,
 * redeeming a code, exchanging a refresh token) is a conditional UPDATE …
 * RETURNING, so exactly one of them wins. Codes and tokens are stored hashed.
 */

import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";

import { getDatabase, getSchema } from "../../rbac/db";
import { resolveKeyIdentity, type VerifiedPat } from "../../rbac/services/personalAccessTokens";
import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../services/observe/db";
import { AppError } from "../../types";
import { logger } from "../../utils/logger";
import { hashSecret, newClientId, OAUTH_ACCESS_PREFIX, OAUTH_REFRESH_PREFIX, randomSecret, verifyPkce } from "./secrets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export const OAUTH_GRANT_KIND = "oauth";
export const REQUEST_TTL_MS = 10 * 60_000;
export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const GRANT_NAME_MAX = 64;
const INVALID_TOKEN = "Invalid OAuth access token";

export const CLIENT_STATUSES = ["allowed", "pending", "blocked"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  status: ClientStatus;
  clientUri: string | null;
  softwareId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

function toStatus(value: unknown): ClientStatus {
  const status = str(value);
  return (CLIENT_STATUSES as readonly string[]).includes(status) ? (status as ClientStatus) : "blocked";
}

function toClient(row: Row): OAuthClient {
  return {
    id: str(row.id),
    name: str(row.name),
    redirectUris: json<unknown[]>(row.redirect_uris, []).filter((u): u is string => typeof u === "string"),
    status: toStatus(row.status),
    clientUri: strOrNull(row.client_uri),
    softwareId: strOrNull(row.software_id),
    createdAt: num(row.created_at),
    lastUsedAt: numOrNull(row.last_used_at),
    decidedBy: strOrNull(row.decided_by),
    decidedAt: numOrNull(row.decided_at),
  };
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

// --- Clients -----------------------------------------------------------------

export interface NewClient {
  name: string;
  redirectUris: string[];
  status: ClientStatus;
  clientUri: string | null;
  softwareId: string | null;
}

export async function registerClient(input: NewClient, now = Date.now()): Promise<OAuthClient> {
  const id = newClientId();
  await run(sql`
    INSERT INTO oauth_clients (id, name, redirect_uris, status, client_uri, software_id, created_at)
    VALUES (${id}, ${input.name}, ${JSON.stringify(input.redirectUris)}, ${input.status}, ${input.clientUri}, ${input.softwareId}, ${now})`);
  const client = await getClient(id);
  if (!client) throw new Error("The agent's registration was not saved");
  return client;
}

export async function getClient(id: string): Promise<OAuthClient | null> {
  const row = await one(sql`SELECT * FROM oauth_clients WHERE id = ${id}`);
  return row ? toClient(row) : null;
}

export interface ClientSummary extends OAuthClient {
  /** People with a live grant through this agent. */
  people: number;
}

export async function listClients(now = Date.now()): Promise<ClientSummary[]> {
  const clients = (await all(sql`SELECT * FROM oauth_clients ORDER BY created_at DESC`)).map(toClient);
  const grants = await liveGrantRows(now);
  return clients.map((client) => ({
    ...client,
    people: new Set(grants.filter((g) => g.oauthClientId === client.id).map((g) => g.userId)).size,
  }));
}

/** Approve or block an agent. Blocking revokes everyone's access through it at once. */
export async function setClientStatus(id: string, status: Exclude<ClientStatus, "pending">, actorId: string, now = Date.now()): Promise<OAuthClient | null> {
  await run(sql`UPDATE oauth_clients SET status = ${status}, decided_by = ${actorId}, decided_at = ${now} WHERE id = ${id}`);
  const client = await getClient(id);
  if (client && status === "blocked") {
    for (const grant of (await liveGrantRows(now)).filter((g) => g.oauthClientId === id)) await revokeGrant(grant.id, now);
  }
  return client;
}

async function touchClient(id: string, now: number): Promise<void> {
  await run(sql`UPDATE oauth_clients SET last_used_at = ${now} WHERE id = ${id}`).catch((error: unknown) => {
    logger.warn({ module: "McpOAuth", err: error instanceof Error ? error.message : String(error) }, "Could not record the agent's last use");
  });
}

// --- Sign-ins in progress ----------------------------------------------------

export interface NewRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
}

export interface PendingRequest extends NewRequest {
  id: string;
  expiresAt: number;
}

export async function createRequest(input: NewRequest, now = Date.now()): Promise<PendingRequest> {
  const id = randomSecret(24);
  const expiresAt = now + REQUEST_TTL_MS;
  await run(sql`
    INSERT INTO oauth_requests (id, client_id, redirect_uri, state, code_challenge, resource, expires_at, created_at)
    VALUES (${id}, ${input.clientId}, ${input.redirectUri}, ${input.state}, ${input.codeChallenge}, ${input.resource}, ${expiresAt}, ${now})`);
  return { ...input, id, expiresAt };
}

function toRequest(row: Row): PendingRequest {
  return {
    id: str(row.id),
    clientId: str(row.client_id),
    redirectUri: str(row.redirect_uri),
    state: strOrNull(row.state),
    codeChallenge: str(row.code_challenge),
    resource: str(row.resource),
    expiresAt: num(row.expires_at),
  };
}

/** A sign-in nobody has decided yet and that hasn't expired. */
export async function getPendingRequest(id: string, now = Date.now()): Promise<PendingRequest | null> {
  const row = await one(sql`SELECT * FROM oauth_requests WHERE id = ${id} AND decision IS NULL AND expires_at > ${now}`);
  return row ? toRequest(row) : null;
}

/**
 * Record the person's decision; only the first decision on a live request
 * counts. Returns the one-time code for an approval, or null when the request
 * was already decided or expired.
 */
export async function decideRequest(
  id: string,
  userId: string,
  decision: { approved: true; grantId: string } | { approved: false },
  now = Date.now(),
): Promise<{ code: string | null } | null> {
  const code = decision.approved ? randomSecret(32) : null;
  const rows = await all(sql`
    UPDATE oauth_requests
    SET decision = ${decision.approved ? "approved" : "denied"}, user_id = ${userId},
        grant_id = ${decision.approved ? decision.grantId : null},
        code_hash = ${code ? hashSecret(code) : null}, code_expires_at = ${code ? now + CODE_TTL_MS : null}
    WHERE id = ${id} AND decision IS NULL AND expires_at > ${now}
    RETURNING id`);
  return rows.length === 1 ? { code } : null;
}

export type CodeRedemption = { ok: true; grantId: string } | { ok: false; reason: string; revokedGrantId?: string };

/**
 * Exchange a one-time code (RFC 6749 §4.1.3 with PKCE). A code used twice
 * revokes the grant it produced (OAuth 2.1 §4.1.3), since one of the two
 * callers stole it.
 */
export async function redeemCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }, now = Date.now()): Promise<CodeRedemption> {
  const codeHash = hashSecret(input.code);
  const row = await one(sql`SELECT * FROM oauth_requests WHERE code_hash = ${codeHash}`);
  if (!row || str(row.decision) !== "approved") return { ok: false, reason: "The code is not valid" };
  const grantId = strOrNull(row.grant_id);
  if (!grantId) return { ok: false, reason: "The code is not valid" };
  if (str(row.client_id) !== input.clientId) return { ok: false, reason: "The code was issued to another client" };
  if (row.code_used_at !== null && row.code_used_at !== undefined) {
    await revokeGrant(grantId, now);
    return { ok: false, reason: "The code was already used", revokedGrantId: grantId };
  }
  if (num(row.code_expires_at) <= now) return { ok: false, reason: "The code has expired" };
  if (str(row.redirect_uri) !== input.redirectUri) return { ok: false, reason: "redirect_uri does not match the one used to sign in" };
  if (!verifyPkce(input.verifier, str(row.code_challenge))) return { ok: false, reason: "code_verifier does not match the code challenge" };
  const claimed = await all(sql`UPDATE oauth_requests SET code_used_at = ${now} WHERE code_hash = ${codeHash} AND code_used_at IS NULL RETURNING id`);
  if (claimed.length !== 1) {
    await revokeGrant(grantId, now);
    return { ok: false, reason: "The code was already used", revokedGrantId: grantId };
  }
  return { ok: true, grantId };
}

// --- Grants ------------------------------------------------------------------

interface GrantRow {
  id: string;
  userId: string;
  name: string;
  oauthClientId: string | null;
  scopes: unknown;
  expiresAt: unknown;
  revokedAt: unknown;
  createdAt: unknown;
  lastUsedAt: unknown;
}

async function grantRow(id: string): Promise<GrantRow | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = (await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.kind, OAUTH_GRANT_KIND)))
    .limit(1)) as GrantRow[];
  return rows[0] ?? null;
}

async function liveGrantRows(now: number, userId?: string): Promise<GrantRow[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const filters = [eq(schema.apiKeys.kind, OAUTH_GRANT_KIND), isNull(schema.apiKeys.revokedAt)];
  if (userId) filters.push(eq(schema.apiKeys.userId, userId));
  const rows = (await db.select().from(schema.apiKeys).where(and(...filters))) as GrantRow[];
  return rows.filter((row) => {
    const expires = toMs(row.expiresAt);
    return expires === null || expires > now;
  });
}

/**
 * Create the grant a sign-in approves. Approving the same agent again
 * replaces the person's earlier grant for it.
 */
export async function createGrant(userId: string, client: OAuthClient, expiresAt: number, now = Date.now()): Promise<string> {
  for (const old of (await liveGrantRows(now, userId)).filter((g) => g.oauthClientId === client.id)) await revokeGrant(old.id, now);
  const id = randomUUID();
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.insert(schema.apiKeys).values({
    id,
    userId,
    name: client.name.slice(0, GRANT_NAME_MAX),
    // A grant is never presented itself (its tokens are), so its hash only has to be unique and unguessable.
    keyHash: hashSecret(`oauth-grant:${randomSecret()}`),
    keyPrefix: "oauth",
    scopes: [],
    expiresAt: new Date(expiresAt),
    createdAt: new Date(now),
    kind: OAUTH_GRANT_KIND,
    oauthClientId: client.id,
  });
  return id;
}

/** Revoke a grant and drop its tokens. Idempotent. */
export async function revokeGrant(grantId: string, now = Date.now()): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const live = await grantRow(grantId);
  if (!live) return false;
  if (live.revokedAt === null || live.revokedAt === undefined) {
    await db.update(schema.apiKeys).set({ revokedAt: new Date(now) }).where(and(eq(schema.apiKeys.id, grantId), eq(schema.apiKeys.kind, OAUTH_GRANT_KIND)));
  }
  await run(sql`DELETE FROM oauth_tokens WHERE grant_id = ${grantId}`);
  return true;
}

export interface GrantView {
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientStatus: ClientStatus;
  redirectUris: string[];
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  user: { email: string; username: string; displayName: string | null } | null;
}

/** Live grants, everyone's or one person's, newest first. */
export async function listGrants(filter: { userId?: string } = {}, now = Date.now()): Promise<GrantView[]> {
  const rows = await liveGrantRows(now, filter.userId);
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((r) => r.oauthClientId).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const clients = new Map(
    (clientIds.length ? await all(sql`SELECT * FROM oauth_clients WHERE id IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`) : [])
      .map((row) => [str(row.id), toClient(row)]),
  );
  const users = new Map(
    (await all(sql`SELECT id, email, username, display_name FROM rbac_users WHERE id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`))
      .map((row) => [str(row.id), { email: str(row.email), username: str(row.username), displayName: strOrNull(row.display_name) }]),
  );
  return rows
    .map((row): GrantView => {
      const client = row.oauthClientId ? clients.get(row.oauthClientId) : undefined;
      return {
        id: row.id,
        userId: row.userId,
        clientId: row.oauthClientId ?? "",
        clientName: client?.name ?? row.name,
        clientStatus: client?.status ?? "blocked",
        redirectUris: client?.redirectUris ?? [],
        createdAt: toMs(row.createdAt),
        expiresAt: toMs(row.expiresAt),
        lastUsedAt: toMs(row.lastUsedAt),
        user: users.get(row.userId) ?? null,
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// --- Tokens ------------------------------------------------------------------

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** A new access + refresh pair for a live grant, neither outliving the grant. */
export async function issueTokens(grantId: string, now = Date.now()): Promise<IssuedTokens> {
  const grant = await grantRow(grantId);
  const grantExpires = grant ? toMs(grant.expiresAt) : null;
  if (!grant || (grant.revokedAt !== null && grant.revokedAt !== undefined) || (grantExpires !== null && grantExpires <= now)) {
    throw new Error("The grant is no longer valid");
  }
  const limit = grantExpires ?? Number.POSITIVE_INFINITY;
  const accessExpires = Math.min(now + ACCESS_TTL_MS, limit);
  const refreshExpires = Math.min(now + REFRESH_TTL_MS, limit);
  const accessToken = `${OAUTH_ACCESS_PREFIX}${randomSecret()}`;
  const refreshToken = `${OAUTH_REFRESH_PREFIX}${randomSecret()}`;
  await run(sql`
    INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at, created_at)
    VALUES (${hashSecret(accessToken)}, ${grantId}, 'access', ${accessExpires}, ${now}),
           (${hashSecret(refreshToken)}, ${grantId}, 'refresh', ${refreshExpires}, ${now})`);
  return { accessToken, refreshToken, expiresIn: Math.max(1, Math.floor((accessExpires - now) / 1000)) };
}

export type RefreshOutcome =
  | { ok: true; tokens: IssuedTokens; grantId: string }
  | { ok: false; reason: string; reused?: { grantId: string; userId: string } };

/**
 * Exchange a refresh token for a new pair. Each refresh token works once; one
 * presented again means it was copied, so the whole grant is revoked.
 */
export async function rotateRefreshToken(raw: string, clientId: string, now = Date.now()): Promise<RefreshOutcome> {
  if (!raw.startsWith(OAUTH_REFRESH_PREFIX)) return { ok: false, reason: "The refresh token is not valid" };
  const tokenHash = hashSecret(raw);
  const row = await one(sql`SELECT * FROM oauth_tokens WHERE token_hash = ${tokenHash} AND kind = 'refresh'`);
  if (!row) return { ok: false, reason: "The refresh token is not valid" };
  const grantId = str(row.grant_id);
  const grant = await grantRow(grantId);
  if (!grant || grant.oauthClientId !== clientId) return { ok: false, reason: "The refresh token was issued to another client" };
  if (row.used_at !== null && row.used_at !== undefined) {
    await revokeGrant(grantId, now);
    return { ok: false, reason: "The refresh token was already used", reused: { grantId, userId: grant.userId } };
  }
  if (num(row.expires_at) <= now) return { ok: false, reason: "The refresh token has expired" };
  try {
    await resolveKeyIdentity(grant, "The grant is no longer valid");
  } catch {
    return { ok: false, reason: "The grant is no longer valid" };
  }
  const client = await getClient(clientId);
  if (!client || client.status !== "allowed") return { ok: false, reason: "The agent is not allowed" };
  const claimed = await all(sql`UPDATE oauth_tokens SET used_at = ${now} WHERE token_hash = ${tokenHash} AND used_at IS NULL RETURNING token_hash`);
  if (claimed.length !== 1) {
    await revokeGrant(grantId, now);
    return { ok: false, reason: "The refresh token was already used", reused: { grantId, userId: grant.userId } };
  }
  return { ok: true, tokens: await issueTokens(grantId, now), grantId };
}

/**
 * RFC 7009: revoke a token the client holds. A refresh token takes its whole
 * grant with it; an access token only itself. Unknown tokens are not an error.
 */
export async function revokeToken(raw: string, clientId: string, now = Date.now()): Promise<{ revokedGrantId: string | null; userId: string | null }> {
  const row = await one(sql`SELECT * FROM oauth_tokens WHERE token_hash = ${hashSecret(raw)}`);
  if (!row) return { revokedGrantId: null, userId: null };
  const grantId = str(row.grant_id);
  const grant = await grantRow(grantId);
  if (!grant || grant.oauthClientId !== clientId) return { revokedGrantId: null, userId: null };
  if (str(row.kind) === "refresh") {
    await revokeGrant(grantId, now);
    return { revokedGrantId: grantId, userId: grant.userId };
  }
  await run(sql`DELETE FROM oauth_tokens WHERE token_hash = ${hashSecret(raw)}`);
  return { revokedGrantId: null, userId: grant.userId };
}

/**
 * The live identity behind an access token, or a 401. Fails closed when the
 * token, its grant, its agent or its owner is no longer valid.
 */
export async function verifyAccessToken(raw: string, now = Date.now()): Promise<VerifiedPat & { clientId: string }> {
  if (!raw.startsWith(OAUTH_ACCESS_PREFIX)) throw AppError.unauthorized(INVALID_TOKEN);
  let row: Row | null;
  try {
    row = await one(sql`SELECT grant_id, expires_at FROM oauth_tokens WHERE token_hash = ${hashSecret(raw)} AND kind = 'access'`);
  } catch {
    throw AppError.unauthorized(INVALID_TOKEN);
  }
  if (!row || num(row.expires_at) <= now) throw AppError.unauthorized(INVALID_TOKEN);
  const grant = await grantRow(str(row.grant_id));
  if (!grant || !grant.oauthClientId) throw AppError.unauthorized(INVALID_TOKEN);
  const client = await getClient(grant.oauthClientId);
  if (!client || client.status !== "allowed") throw AppError.unauthorized(INVALID_TOKEN);
  const identity = await resolveKeyIdentity(grant, INVALID_TOKEN);
  void touchGrant(grant.id, client.id, now);
  return { ...identity, patName: client.name, clientId: client.id };
}

async function touchGrant(grantId: string, clientId: string, now: number): Promise<void> {
  try {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    await db.update(schema.apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(schema.apiKeys.id, grantId));
  } catch (error) {
    logger.warn({ module: "McpOAuth", err: error instanceof Error ? error.message : String(error) }, "Could not record the grant's last use");
  }
  await touchClient(clientId, now);
}

/** Drop sign-ins and tokens that can no longer be used. Best effort; runs as new ones are made. */
export async function purgeExpired(now = Date.now()): Promise<void> {
  try {
    await run(sql`DELETE FROM oauth_tokens WHERE expires_at <= ${now}`);
    await run(sql`DELETE FROM oauth_requests WHERE expires_at <= ${now - REQUEST_TTL_MS} AND (code_expires_at IS NULL OR code_expires_at <= ${now - REQUEST_TTL_MS})`);
  } catch (error) {
    logger.warn({ module: "McpOAuth", err: error instanceof Error ? error.message : String(error) }, "Could not purge expired OAuth rows");
  }
}
