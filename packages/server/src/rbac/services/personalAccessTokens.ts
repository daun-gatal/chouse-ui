/**
 * Personal Access Tokens Service
 *
 * Machine credentials for the future CLI and MCP server. A PAT carries no
 * permissions of its own: every verification re-resolves the owner's live
 * roles/permissions from the database and intersects them with the token's
 * optional scope subset (empty scopes = full inherit).
 *
 * Storage reuses the existing `rbac_api_keys` table. Secrets are SHA-256
 * hashed (fast indexed lookup of a 256-bit secret); the raw token is returned
 * exactly once at creation and never persisted or logged.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getDatabase, getSchema } from "../db";
import { PERMISSIONS } from "../schema/base";
import { AppError } from "../../types";
import { logger } from "../../utils/logger";
import { getUserById, getUserPermissions, getUserRoles } from "./rbac";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Token prefix: greppable, secret-scanner friendly, distinct from JWTs. */
export const PAT_PREFIX = "ch_pat_";

/** Display prefix length (first N chars of the encoded secret). */
const PAT_DISPLAY_PREFIX_LENGTH = 8;

const PAT_NAME_MIN_LENGTH = 1;
const PAT_NAME_MAX_LENGTH = 64;

const ALL_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

export interface CreatePatInput {
  name: string;
  /** Null/undefined = never expires. */
  expiresAt?: Date | string | null;
  /** Optional subset of the owner's permissions. Empty/omitted = full inherit. */
  scopes?: string[];
}

export interface PatInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CreatedPat extends PatInfo {
  /** Raw secret. Returned exactly once — the caller must show it now. */
  rawToken: string;
}

export interface VerifiedPat {
  userId: string;
  email: string;
  username: string;
  roles: string[];
  /** Live owner permissions intersected with the token scopes. */
  permissions: string[];
  patId: string;
  patName: string;
}

/**
 * SHA-256 hash of a raw token for storage/lookup.
 */
export function hashPatToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  return new Date(value as string | number);
}

function toPatInfo(row: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: unknown;
  expiresAt: unknown;
  lastUsedAt: unknown;
  createdAt: unknown;
  revokedAt: unknown;
}): PatInfo {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    expiresAt: toDateOrNull(row.expiresAt),
    lastUsedAt: toDateOrNull(row.lastUsedAt),
    createdAt: (toDateOrNull(row.createdAt) ?? new Date()) as Date,
    revokedAt: toDateOrNull(row.revokedAt),
  };
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < PAT_NAME_MIN_LENGTH || trimmed.length > PAT_NAME_MAX_LENGTH) {
    throw AppError.badRequest(
      `Token name must be between ${PAT_NAME_MIN_LENGTH} and ${PAT_NAME_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

function validateExpiresAt(expiresAt: Date | string | null | undefined): Date | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    throw AppError.badRequest("Invalid expiry date");
  }
  if (date.getTime() <= Date.now()) {
    throw AppError.badRequest("Expiry date must be in the future");
  }
  return date;
}

function validateScopes(scopes: string[] | undefined): string[] {
  if (!scopes || scopes.length === 0) return [];
  const unique = [...new Set(scopes)];
  for (const scope of unique) {
    if (!ALL_PERMISSIONS.has(scope)) {
      throw AppError.badRequest(`Unknown permission scope: '${scope}'`);
    }
  }
  return unique;
}

/**
 * Create a personal access token for a user. Scopes must be a subset of the
 * owner's live permissions — a token can never exceed what its owner can do.
 */
export async function createPat(userId: string, input: CreatePatInput): Promise<CreatedPat> {
  const name = validateName(input.name);
  const expiresAt = validateExpiresAt(input.expiresAt);
  const scopes = validateScopes(input.scopes);

  const owner = await getUserById(userId);
  if (!owner) {
    throw AppError.notFound("User not found");
  }
  if (!owner.isActive) {
    throw AppError.forbidden("User account is deactivated");
  }

  if (scopes.length > 0) {
    const livePermissions = await getUserPermissions(userId);
    const outside = scopes.filter((s) => !livePermissions.includes(s));
    if (outside.length > 0) {
      throw AppError.forbidden(
        `Token scopes exceed your permissions: ${outside.join(", ")}`
      );
    }
  }

  const secret = randomBytes(32).toString("base64url");
  const rawToken = `${PAT_PREFIX}${secret}`;
  const keyHash = hashPatToken(rawToken);
  const keyPrefix = secret.slice(0, PAT_DISPLAY_PREFIX_LENGTH);

  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const now = new Date();

  try {
    await db.insert(schema.apiKeys).values({
      id: randomUUID(),
      userId,
      name,
      keyHash,
      keyPrefix,
      scopes,
      expiresAt,
      createdAt: now,
    });
  } catch (error) {
    // Practically impossible hash collision — surface as retryable, not a leak.
    logger.warn(
      { module: "PAT", userId, err: error instanceof Error ? error.message : String(error) },
      "createPat: token insert failed"
    );
    throw AppError.internal("Failed to create token. Please try again.");
  }

  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);
  if (rows.length === 0) {
    throw AppError.internal("Failed to create token. Please try again.");
  }

  return { ...toPatInfo(rows[0]), rawToken };
}

/**
 * List a user's active tokens (metadata only — hashes are never returned).
 * Revoked tokens are hidden; they remain auditable via the audit log.
 */
export async function listPats(userId: string): Promise<PatInfo[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
    .orderBy(desc(schema.apiKeys.createdAt));

  return rows.map(toPatInfo);
}

/**
 * Revoke a token. Owner-scoped (returns null for foreign ids to avoid
 * cross-user enumeration) and idempotent.
 */
export async function revokePat(userId: string, id: string): Promise<PatInfo | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;

  const info = toPatInfo(rows[0]);
  if (info.revokedAt !== null) return info;

  const now = new Date();
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: now })
    .where(eq(schema.apiKeys.id, id));

  return { ...info, revokedAt: now };
}

/**
 * Rotate a token: revoke the old secret and mint a replacement with identical
 * name, scopes, and expiry. Owner-scoped (null for foreign ids) and safe to
 * retry only via a fresh call — each call mints exactly one new secret.
 */
export async function rotatePat(userId: string, id: string): Promise<CreatedPat | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;

  const current = toPatInfo(rows[0]);
  if (current.revokedAt !== null) {
    throw AppError.badRequest("Token is already revoked");
  }

  const owner = await getUserById(userId);
  if (!owner) {
    throw AppError.notFound("User not found");
  }
  if (!owner.isActive) {
    throw AppError.forbidden("User account is deactivated");
  }

  // Scopes could have left the owner's grant since creation — re-check so a
  // rotation can never widen what the owner can currently do.
  if (current.scopes.length > 0) {
    const livePermissions = await getUserPermissions(userId);
    const outside = current.scopes.filter((s) => !livePermissions.includes(s));
    if (outside.length > 0) {
      throw AppError.forbidden(
        `Token scopes exceed your permissions: ${outside.join(", ")}`
      );
    }
  }

  const secret = randomBytes(32).toString("base64url");
  const rawToken = `${PAT_PREFIX}${secret}`;
  const newId = randomUUID();
  const now = new Date();

  try {
    await db.insert(schema.apiKeys).values({
      id: newId,
      userId,
      name: current.name,
      keyHash: hashPatToken(rawToken),
      keyPrefix: secret.slice(0, PAT_DISPLAY_PREFIX_LENGTH),
      scopes: current.scopes,
      expiresAt: current.expiresAt,
      createdAt: now,
    });
  } catch (error) {
    logger.warn(
      { module: "PAT", userId, err: error instanceof Error ? error.message : String(error) },
      "rotatePat: replacement insert failed"
    );
    throw AppError.internal("Failed to rotate token. Please try again.");
  }

  // Revoke the old secret only after the replacement exists.
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: now })
    .where(eq(schema.apiKeys.id, id));

  return {
    id: newId,
    name: current.name,
    keyPrefix: secret.slice(0, PAT_DISPLAY_PREFIX_LENGTH),
    scopes: current.scopes,
    expiresAt: current.expiresAt,
    lastUsedAt: null,
    createdAt: now,
    revokedAt: null,
    rawToken,
  };
}

/**
 * Generic failure message — identical for unknown/revoked/expired/inactive.
 * Deliberately free of the word "expired": rbacAuthMiddleware maps errors
 * containing it to a "refresh your token" hint, which is wrong for PATs
 * (they have no refresh flow).
 */
const PAT_INVALID_MESSAGE = "Invalid personal access token";

/**
 * Verify a raw PAT secret. Resolves live owner roles/permissions and
 * intersects them with the token scopes. Fail-closed on every branch.
 */
export async function verifyPatToken(rawToken: string): Promise<VerifiedPat> {
  if (!rawToken.startsWith(PAT_PREFIX)) {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  const db = getDatabase() as AnyDb;
  let schema: ReturnType<typeof getSchema>;
  try {
    schema = getSchema();
  } catch {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  let rows: Array<{
    id: string;
    userId: string;
    name: string;
    scopes: unknown;
    expiresAt: unknown;
    revokedAt: unknown;
  }>;
  try {
    rows = await db
      .select({
        id: schema.apiKeys.id,
        userId: schema.apiKeys.userId,
        name: schema.apiKeys.name,
        scopes: schema.apiKeys.scopes,
        expiresAt: schema.apiKeys.expiresAt,
        revokedAt: schema.apiKeys.revokedAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, hashPatToken(rawToken)))
      .limit(1);
  } catch {
    // Table missing (pre-migration DB) or any lookup failure: fail closed.
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  if (rows.length === 0) {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  const row = rows[0];
  if (row.revokedAt !== null && row.revokedAt !== undefined) {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  const expiresAt = toDateOrNull(row.expiresAt);
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  const owner = await getUserById(row.userId);
  if (!owner || !owner.isActive) {
    throw AppError.unauthorized(PAT_INVALID_MESSAGE);
  }

  const [roles, livePermissions] = await Promise.all([
    getUserRoles(row.userId),
    getUserPermissions(row.userId),
  ]);

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  const permissions =
    scopes.length === 0 ? livePermissions : livePermissions.filter((p) => scopes.includes(p));

  return {
    userId: row.userId,
    email: owner.email,
    username: owner.username,
    roles,
    permissions,
    patId: row.id,
    patName: row.name,
  };
}

/**
 * Record token usage. Best-effort: usage tracking must never fail a request.
 */
export async function touchPatLastUsed(patId: string): Promise<void> {
  try {
    const db = getDatabase() as AnyDb;
    const schema = getSchema();
    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, patId));
  } catch (error) {
    logger.warn(
      { module: "PAT", patId, err: error instanceof Error ? error.message : String(error) },
      "touchPatLastUsed: usage update failed"
    );
  }
}
