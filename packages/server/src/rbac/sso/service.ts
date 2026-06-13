/**
 * SSO Provisioning Service
 *
 * Turns a verified SSO identity into a local user + session:
 *   1. existing identity link -> that user
 *   2. else verified-email match (when auto_link_by_email) -> link + that user
 *   3. else JIT-create with default role
 * Providers with role_mapping re-sync roles on every login.
 */

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from '../db';
import {
  createSessionAndTokens,
  createUser,
  getUserByEmail,
  getUserByUsername,
  getRoleByName,
  getUserRoles,
} from '../services/rbac';
import { getUserIdentity, createUserIdentity, touchUserIdentity } from './identity';
import { getSsoConfig, type SsoProviderConfig } from './config';
import type { SsoIdentity } from './client';
import { logger } from '../../utils/logger';
import { AppError } from '../../types';
import { SYSTEM_ROLES } from '../schema/base';
import type { User, UserResponse } from '../schema';
import type { TokenPair } from '../services/jwt';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function provisionSsoUser(
  provider: SsoProviderConfig,
  identity: SsoIdentity,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: UserResponse; tokens: TokenPair }> {
  const config = getSsoConfig();
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  let user: User | null = null;

  // 1. Existing identity link
  const existing = await getUserIdentity(provider.id, identity.subject);
  if (existing) {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, existing.userId))
      .limit(1);
    user = rows[0] || null;
    // Fix 5 (path 1): check isActive before any side effects
    if (user && !user.isActive) {
      throw AppError.unauthorized('This account is inactive. Contact an administrator to reactivate it.');
    }
    if (user) await touchUserIdentity(existing.id);
  }

  // 2. Link by verified email
  if (!user && config.autoLinkByEmail && identity.email && identity.emailVerified) {
    const byEmail = await getUserByEmail(identity.email);
    if (byEmail) {
      // Fix 5 (path 2): check isActive before createUserIdentity side effect
      if (!byEmail.isActive) {
        throw AppError.unauthorized('This account is inactive. Contact an administrator to reactivate it.');
      }
      await createUserIdentity({
        userId: byEmail.id,
        provider: provider.id,
        subject: identity.subject,
        email: identity.email,
      });
      user = byEmail;
      logger.info(
        { module: 'SSO', provider: provider.id, userId: byEmail.id },
        'Linked SSO identity to existing user by email'
      );
    }
  }

  // 3. JIT create
  if (!user) {
    if (!identity.email) {
      throw AppError.unauthorized(
        'Your identity provider did not supply an email address; cannot create an account.'
      );
    }
    const username = await pickAvailableUsername(identity.username || identity.email.split('@')[0]);
    const defaultRole = await getRoleByName(config.defaultRole);

    // handle concurrent first-login race — two requests may attempt to
    // create the same user simultaneously; catch the unique violation and
    // re-resolve to whichever row won the race.
    try {
      const created = await createUser({
        email: identity.email,
        username,
        // Random unusable password — SSO users authenticate at the IdP.
        password: `${randomUUID()}Aa1!${randomUUID()}`,
        displayName: identity.displayName || username,
        roleIds: defaultRole ? [defaultRole.id] : [],
      });
      await createUserIdentity({
        userId: created.id,
        provider: provider.id,
        subject: identity.subject,
        email: identity.email,
      });
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, created.id))
        .limit(1);
      user = rows[0] || null;
      logger.info(
        { module: 'SSO', provider: provider.id, userId: created.id },
        'JIT-provisioned user from SSO login'
      );
    } catch (err) {
      if (!isUniqueError(err)) throw err;
      // Race: another request created the same identity/user concurrently.
      // Re-resolve via identity lookup first, then fall back to email.
      const raceIdentity = await getUserIdentity(provider.id, identity.subject);
      if (raceIdentity) {
        const rows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, raceIdentity.userId))
          .limit(1);
        user = rows[0] || null;
      }
      if (!user && identity.email) {
        const byEmail = await getUserByEmail(identity.email);
        user = byEmail ?? null;
      }
      if (!user) throw err;
      logger.info(
        { module: 'SSO', provider: provider.id, userId: user.id },
        'JIT race resolved: using winner row from concurrent first-login'
      );
    }
  }

  // backstop — final guard before session creation
  if (!user || !user.isActive) {
    throw AppError.unauthorized('This account is inactive. Contact an administrator to reactivate it.');
  }

  // Optional role sync
  if (provider.roleMapping && provider.roleMappingClaim) {
    await syncMappedRoles(
      user.id,
      provider,
      provider.roleMappingClaim,
      provider.roleMapping,
      identity.claims
    );
  }

  return createSessionAndTokens(user, ipAddress, userAgent);
}

/** Lowercase, strip disallowed chars, suffix 2,3,... on collision; cap at 50, then UUID fallback. */
async function pickAvailableUsername(base: string): Promise<string> {
  const sanitized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 64) || 'user';
  let candidate = sanitized;
  // cap collision loop at 50 iterations to avoid infinite loops
  for (let i = 2; i <= 50 && (await getUserByUsername(candidate)); i++) {
    candidate = `${sanitized}${i}`;
  }
  // If still taken after 50 tries, use a UUID suffix
  if (await getUserByUsername(candidate)) {
    candidate = `${sanitized}-${randomUUID().slice(0, 8)}`;
  }
  return candidate;
}

/**
 * Replace the user's roles with those mapped from the IdP claim.
 * If no mapped role resolves to a known role, keep existing roles (avoid lockout).
 * If the user currently holds super_admin, skip sync entirely to avoid demotion.
 *
 * accepts explicit claimName + mapping so no `as` casts are needed.
 */
async function syncMappedRoles(
  userId: string,
  provider: SsoProviderConfig,
  claimName: string,
  mapping: Record<string, string>,
  claims: Record<string, unknown>
): Promise<void> {
  const raw = claims[claimName];
  const values: string[] = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? [raw]
      : [];

  const targetRoleNames = [...new Set(values.map((v) => mapping[v]).filter(Boolean))];
  const targetRoles = (
    await Promise.all(targetRoleNames.map((n) => getRoleByName(n)))
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  if (targetRoles.length === 0) {
    logger.warn(
      { module: 'SSO', provider: provider.id, userId, claimValues: values },
      'Role mapping produced no known roles; keeping existing roles'
    );
    return;
  }

  // never demote a super_admin via role sync
  const currentNames = await getUserRoles(userId);
  if (currentNames.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    logger.warn(
      { module: 'SSO', provider: provider.id, userId },
      'Skipping role sync for super_admin user'
    );
    return;
  }

  const targetNames = targetRoles.map((r) => r.name).sort();
  if (JSON.stringify([...currentNames].sort()) === JSON.stringify(targetNames)) return;

  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  await db.insert(schema.userRoles).values(
    targetRoles.map((role) => ({
      id: randomUUID(),
      userId,
      roleId: role.id,
      assignedAt: new Date(),
      assignedBy: `sso:${provider.id}`,
    }))
  );
  logger.info(
    { module: 'SSO', provider: provider.id, userId, roles: targetNames },
    'Synced roles from IdP claim'
  );
}

/** Returns true if the error is a unique-constraint violation (SQLite or PostgreSQL). */
function isUniqueError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // PostgreSQL: SQLSTATE 23505 = unique_violation (message text may vary).
  if ((err as { code?: string }).code === '23505') return true;
  // SQLite: bun:sqlite errors say "UNIQUE constraint failed: ...".
  return err.message.includes('UNIQUE') || err.message.includes('unique');
}
