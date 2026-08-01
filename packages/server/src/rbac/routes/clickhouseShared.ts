/**
 * Shared helpers for the native ClickHouse access-control routes
 * (clickhouse-users + clickhouse-roles).
 */

import type { Context } from 'hono';
import { z } from 'zod';
import type { ClickHouseService } from '../../services/clickhouse';
import { CONNECTION_ID_HEADER, CONNECTION_ID_COOKIE, getCookie } from '../../middleware/connectionContext';
import {
  resolveDefaultConnection,
  resolveRequestedConnection,
} from '../../services/connectionResolver';

/**
 * Resolve the ClickHouseService for this request (ADR 0010).
 *
 * Previously this read a pod-local session map, so these admin routes managed
 * native ClickHouse users and roles on whichever cluster the serving replica
 * happened to have a session for — a particularly bad thing to get wrong.
 * Resolution is now per request, from the connection the client names.
 */
export async function getClickHouseService(c: Context): Promise<ClickHouseService> {
  const rbacUserId = c.get('rbacUserId') as string | undefined;
  if (!rbacUserId) {
    throw new Error('RBAC authentication is required. Please login first.');
  }
  const isSuperAdmin = ((c.get('rbacRoles') as string[] | undefined) ?? []).includes('super_admin');
  const connectionId = getConnectionId(c);

  const resolved = connectionId
    ? await resolveRequestedConnection(rbacUserId, isSuperAdmin, connectionId)
    : await resolveDefaultConnection(rbacUserId, isSuperAdmin);
  return resolved.service;
}

/** The RBAC connection id this request names, if any. */
export function getConnectionId(c: Context): string | undefined {
  return c.req.header(CONNECTION_ID_HEADER) || getCookie(c, CONNECTION_ID_COOKIE);
}

function isSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('session') || message.includes('Session') || message.includes('connect');
}

function isReadonlyStorageError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('readonly') || message.includes('read-only') || message.includes('read only');
}

function isRoleInUseError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('still assigned to');
}

/**
 * Map an error to a `{ code, message, statusCode }` shape. Session, read-only
 * storage and role-in-use errors are user errors (400); anything else is 500.
 */
export function handleError(
  error: unknown,
  defaultCode: string,
  defaultMessage: string,
): { code: string; message: string; statusCode: 400 | 500 } {
  const rawMessage = error instanceof Error ? error.message : defaultMessage;
  if (isRoleInUseError(error)) {
    return { code: 'ROLE_IN_USE', message: rawMessage, statusCode: 400 };
  }
  if (isReadonlyStorageError(error)) {
    return {
      code: 'READONLY_STORAGE',
      message: 'This user/role is managed in ClickHouse config (e.g. users.xml) and cannot be modified via SQL.',
      statusCode: 400,
    };
  }
  const session = isSessionError(error);
  return {
    code: session ? 'NO_SESSION' : defaultCode,
    message: rawMessage,
    statusCode: session ? 400 : 500,
  };
}

// ============================================
// Shared validation schemas
// ============================================

/** A structured ClickHouse grant (matches CHGrant in clickhousePrivileges.ts). */
export const grantSchema = z.object({
  privileges: z.array(z.string().min(1)).min(1),
  database: z.string().nullable(),
  table: z.string().nullable(),
  columns: z.array(z.string().min(1)).optional(),
  grantOption: z.boolean(),
});

export const grantsSchema = z.array(grantSchema);

/** Default-role selection: a list of role names or the literal 'ALL'. */
export const defaultRolesSchema = z.union([z.array(z.string()), z.literal('ALL')]);
