/**
 * Shared helpers for the native ClickHouse access-control routes
 * (clickhouse-users + clickhouse-roles).
 */

import type { Context } from 'hono';
import { z } from 'zod';
import { getSession, type ClickHouseService } from '../../services/clickhouse';

/** Resolve the active ClickHouseService from the X-Session-ID header. */
export function getClickHouseService(c: Context): ClickHouseService {
  const sessionId = c.req.header('X-Session-ID');
  if (!sessionId) {
    throw new Error('No active ClickHouse session. Please connect to a ClickHouse server first.');
  }
  const sessionData = getSession(sessionId);
  if (!sessionData) {
    throw new Error('ClickHouse session not found. Please reconnect.');
  }
  return sessionData.service;
}

/** The RBAC connection id backing the active session, if any. */
export function getConnectionId(c: Context): string | undefined {
  const sessionId = c.req.header('X-Session-ID');
  if (!sessionId) return undefined;
  return getSession(sessionId)?.session?.rbacConnectionId;
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
