/**
 * Data Access Middleware
 *
 * Filters databases/tables by RBAC data access rules, and decides whether a
 * non-admin may run a SQL statement (ADR 0030): ClickHouse parses the exact
 * text that will run, `sqlAccess/` walks the tree under an allow-list policy,
 * and every table and database it touches is checked here.
 */

import { Context, Next } from 'hono';
import { extractTokenFromHeader } from '../rbac/services/jwt';
import { verifyBearer } from '../rbac/services/patAuth';
import {
  checkUserAccess,
  filterDatabasesForUser,
  filterTablesForUser,
  type AccessType
} from '../rbac/services/dataAccess';
import { isMcpSubrequestFor } from '../mcp/inProcess';
import { AppError } from '../types';
import {
  clickhouseParsePort,
  parseStatementAccess,
  type DenyCode,
  type SqlParsePort,
  type StatementType,
} from './sqlAccess';

// ============================================
// Middleware
// ============================================

/**
 * Optional RBAC context middleware
 * Extracts RBAC user info if JWT is present (doesn't fail if missing)
 */
export async function optionalRbacMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = extractTokenFromHeader(authHeader);

  if (token) {
    try {
      const identity = await verifyBearer(token, { allowOAuth: isMcpSubrequestFor(token) });
      c.set('rbacUserId', identity.userId);
      c.set('rbacRoles', identity.roles);
      c.set('rbacPermissions', identity.permissions);
      c.set('isRbacAdmin', identity.roles.includes('super_admin') || identity.roles.includes('admin'));
      // Agent governance and log_comment attribution key off these; without them token
      // requests (MCP, CLI) skipped budgets, the pause switch and session counting.
      c.set('authMethod', identity.authMethod);
      if (identity.patId) {
        c.set('patId', identity.patId);
      }
    } catch {
      // Token invalid, continue without RBAC context
    }
  }

  await next();
}

// ============================================
// Data Access Helpers
// ============================================

/**
 * Check if user has access to a database
 */
export async function checkDatabaseAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  connectionId?: string,
  accessType: AccessType = 'read'
): Promise<boolean> {
  // Admins have full access
  if (isAdmin) return true;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for database access checks');
  }

  const result = await checkUserAccess(userId, database, null, accessType, connectionId);
  return result.allowed;
}

/**
 * Check if user has access to a table
 */
export async function checkTableAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  table: string,
  connectionId?: string,
  accessType: AccessType = 'read'
): Promise<boolean> {
  // Admins have full access
  if (isAdmin) return true;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for table access checks');
  }

  const result = await checkUserAccess(userId, database, table, accessType, connectionId);
  return result.allowed;
}

// System databases that should be hidden from non-admin users
const SYSTEM_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];

/**
 * Filter databases based on user access
 * System databases are hidden from non-admin users
 */
export async function filterDatabases(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  databases: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all (including system databases)
  if (isAdmin) return databases;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for database filtering');
  }

  // Filter out system databases for non-admin users
  const filtered = await filterDatabasesForUser(userId, databases, connectionId);
  return filtered.filter(db => !SYSTEM_DATABASES.includes(db));
}

/**
 * Filter tables based on user access
 * System tables are hidden from non-admin users
 */
export async function filterTables(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  tables: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all (including system tables)
  if (isAdmin) return tables;

  // RBAC user is required
  if (!userId) {
    throw new Error('RBAC user is required for table filtering');
  }

  // For system database, hide all tables from non-admin users
  if (SYSTEM_DATABASES.includes(database)) {
    return [];
  }

  return filterTablesForUser(userId, database, tables, connectionId);
}

// ============================================
// Statement access (ADR 0030)
// ============================================

export interface QueryAccessInput {
  userId: string | undefined;
  isAdmin: boolean | undefined;
  permissions: string[] | undefined;
  /** The exact text that will run. */
  sql: string;
  /** The query parameters it runs with (`{name:Type}`). */
  params?: Record<string, unknown>;
  /** The connection it runs on: the parse and the rules are both per connection. */
  connectionId: string | undefined;
  /** Test seam; defaults to `EXPLAIN AST` on the connection. */
  parser?: SqlParsePort;
}

export interface QueryAccessResult {
  allowed: boolean;
  reason?: string;
  code?: DenyCode;
  /** HTTP status for a refusal: 400 for bad SQL, 503 when the check couldn't run, else 403. */
  status?: 400 | 403 | 503;
  statementType?: StatementType;
}

/** HTTP status for a refusal code. */
export function accessDeniedStatus(code: DenyCode | undefined): 400 | 403 | 503 {
  if (code === 'SQL_SYNTAX' || code === 'QUERY_PARAM_UNBOUND') return 400;
  if (code === 'CHECK_UNAVAILABLE') return 503;
  return 403;
}

/** The AppError to throw for a refusal, with its status (400 / 403 / 503). */
export function accessDeniedError(result: QueryAccessResult, fallback = 'Access denied to one or more tables in query'): AppError {
  const message = result.reason || fallback;
  if (result.status === 400) return AppError.badRequest(message);
  if (result.status === 503) return AppError.unavailable(message);
  return AppError.forbidden(message);
}

function refuse(code: DenyCode, reason: string): QueryAccessResult {
  return { allowed: false, code, reason, status: accessDeniedStatus(code) };
}

const ACCESS_TYPE: Record<StatementType, AccessType> = {
  select: 'read', show: 'misc', describe: 'misc', exists: 'misc', check: 'misc', explain: 'misc',
  use: 'misc', set: 'misc', kill: 'misc',
  insert: 'write', update: 'write', delete: 'write',
  create: 'admin', drop: 'admin', alter: 'admin', truncate: 'admin',
};

/**
 * May this user run this statement? Admins always may. Everyone else needs the
 * statement's permission and data access to every table and database it
 * touches, as ClickHouse itself parses it. Any doubt is a refusal.
 */
export async function validateQueryAccess(input: QueryAccessInput): Promise<QueryAccessResult> {
  if (input.isAdmin) return { allowed: true };

  if (!input.userId) {
    return refuse('PERMISSION_DENIED', 'RBAC authentication is required. Please login with RBAC credentials.');
  }
  if (!input.sql.trim()) return refuse('SQL_SYNTAX', 'No SQL statement found');
  if (!input.connectionId && !input.parser) {
    return refuse('CHECK_UNAVAILABLE', 'No ClickHouse connection is selected, so the query can\'t be checked against your data access rules.');
  }

  const parser = input.parser ?? clickhouseParsePort(input.connectionId as string);
  const parsed = await parseStatementAccess(input.sql, input.params, parser);
  if (!parsed.ok) return refuse(parsed.code, parsed.reason);

  const { access, defaultDatabase } = parsed;
  const permissions = input.permissions ?? [];
  if (!permissions.includes(access.permission)) {
    return { ...refuse('PERMISSION_DENIED', `Permission '${access.permission}' required for this ${access.type} statement`), statementType: access.type };
  }

  const accessType = ACCESS_TYPE[access.type];
  const seen = new Set<string>();
  for (const ref of [...access.targets, ...access.reads]) {
    const database = ref.database ?? defaultDatabase;
    const key = `${database}\u0000${ref.table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await checkUserAccess(input.userId, database, ref.table, accessType, input.connectionId);
    if (!result.allowed) {
      return { ...refuse('TABLE_DENIED', `Access denied to ${database}.${ref.table} (requires ${accessType} permission)`), statementType: access.type };
    }
  }
  for (const name of access.databases) {
    const database = name || defaultDatabase;
    const result = await checkUserAccess(input.userId, database, null, accessType, input.connectionId);
    if (!result.allowed) {
      return { ...refuse('TABLE_DENIED', `Access denied to database ${database}`), statementType: access.type };
    }
  }

  return { allowed: true, statementType: access.type };
}
