/**
 * Data Access Middleware
 * 
 * Middleware for filtering databases/tables based on RBAC data access rules.
 * Combines ClickHouse session with RBAC user context.
 */

import { Context, Next } from 'hono';
import { verifyAccessToken, extractTokenFromHeader, type TokenPayload } from '../rbac/services/jwt';
import { 
  checkUserAccess, 
  filterDatabasesForUser, 
  filterTablesForUser,
  type AccessType 
} from '../rbac/services/dataAccess';
import { AppError } from '../types';

// ============================================
// Context Extension
// ============================================

export interface DataAccessContext {
  rbacUserId?: string;
  rbacRoles?: string[];
  rbacPermissions?: string[];
  isRbacAdmin?: boolean;
}

// ============================================
// Permission Constants (for access type mapping)
// ============================================

const READ_PERMISSIONS = ['table:select', 'query:execute', 'database:view', 'table:view'];
const WRITE_PERMISSIONS = ['table:insert', 'table:update', 'table:delete', 'query:execute:dml'];
const ADMIN_PERMISSIONS = ['table:create', 'table:alter', 'table:drop', 'database:create', 'database:drop', 'query:execute:ddl'];

/**
 * Check if user has permission for an access type based on their role permissions
 */
function hasPermissionForAccessType(permissions: string[], accessType: AccessType): boolean {
  switch (accessType) {
    case 'read':
      return permissions.some(p => READ_PERMISSIONS.includes(p));
    case 'write':
      return permissions.some(p => WRITE_PERMISSIONS.includes(p));
    case 'admin':
      return permissions.some(p => ADMIN_PERMISSIONS.includes(p));
    default:
      return false;
  }
}

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
      const payload = await verifyAccessToken(token);
      c.set('rbacUserId', payload.sub);
      c.set('rbacRoles', payload.roles);
      c.set('rbacPermissions', payload.permissions);
      c.set('isRbacAdmin', payload.roles.includes('super_admin') || payload.roles.includes('admin'));
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
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return true;

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
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return true;

  const result = await checkUserAccess(userId, database, table, accessType, connectionId);
  return result.allowed;
}

/**
 * Filter databases based on user access
 */
export async function filterDatabases(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  databases: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all
  if (isAdmin) return databases;
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return databases;

  return filterDatabasesForUser(userId, databases, connectionId);
}

/**
 * Filter tables based on user access
 */
export async function filterTables(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  database: string,
  tables: string[],
  connectionId?: string,
  _accessType: AccessType = 'read' // Access type is now determined by role permissions
): Promise<string[]> {
  // Admins see all
  if (isAdmin) return tables;
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return tables;

  return filterTablesForUser(userId, database, tables, connectionId);
}

/**
 * Extract database and table from a SQL query (basic parser)
 */
export function extractTablesFromQuery(sql: string): { database?: string; table?: string }[] {
  const results: { database?: string; table?: string }[] = [];
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();
  
  // Match FROM/INTO/UPDATE/TABLE patterns
  const patterns = [
    /FROM\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /FROM\s+([`"]?[\w]+[`"]?)/gi,
    /INTO\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /INTO\s+([`"]?[\w]+[`"]?)/gi,
    /UPDATE\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /UPDATE\s+([`"]?[\w]+[`"]?)/gi,
    /TABLE\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /TABLE\s+([`"]?[\w]+[`"]?)/gi,
    /JOIN\s+([`"]?[\w]+[`"]?)\.([`"]?[\w]+[`"]?)/gi,
    /JOIN\s+([`"]?[\w]+[`"]?)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalizedSql)) !== null) {
      const clean = (s: string) => s.replace(/[`"]/g, '');
      if (match[2]) {
        // database.table format
        results.push({ database: clean(match[1]), table: clean(match[2]) });
      } else {
        // Just table name (uses default database)
        results.push({ table: clean(match[1]) });
      }
    }
  }

  return results;
}

/**
 * Determine access type needed for a query
 */
export function getQueryAccessType(sql: string): AccessType {
  const normalizedSql = sql.trim().toUpperCase();
  
  if (normalizedSql.startsWith('SELECT') || normalizedSql.startsWith('SHOW') || normalizedSql.startsWith('DESCRIBE')) {
    return 'read';
  }
  
  if (normalizedSql.startsWith('INSERT') || normalizedSql.startsWith('UPDATE') || normalizedSql.startsWith('DELETE')) {
    return 'write';
  }
  
  // DDL operations
  if (normalizedSql.startsWith('CREATE') || normalizedSql.startsWith('DROP') || 
      normalizedSql.startsWith('ALTER') || normalizedSql.startsWith('TRUNCATE')) {
    return 'admin';
  }
  
  return 'read';
}

/**
 * Validate query access for a user
 */
export async function validateQueryAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  permissions: string[] | undefined,
  sql: string,
  defaultDatabase?: string,
  connectionId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Admins have full access
  if (isAdmin) return { allowed: true };
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return { allowed: true };

  const accessType = getQueryAccessType(sql);
  
  // Check if user has permission for this type of operation (based on role)
  if (permissions && !hasPermissionForAccessType(permissions, accessType)) {
    return {
      allowed: false,
      reason: `No permission for ${accessType} operations`,
    };
  }

  const tables = extractTablesFromQuery(sql);
  
  // If no tables detected, allow (might be a system query)
  if (tables.length === 0) {
    return { allowed: true };
  }

  // System metadata tables that are always allowed for read operations
  const SYSTEM_METADATA_TABLES = [
    'databases', 'tables', 'columns', 'parts', 'parts_columns',
    'table_engines', 'data_type_families', 'settings', 'functions', 'formats',
    'clusters', 'macros', 'dictionaries', 'users', 'roles', 'grants',
    'query_log', 'processes', 'metrics', 'events', 'asynchronous_metrics',
    'disks', 'storage_policies', 'merges', 'mutations', 'replicas',
    'replication_queue', 'distribution_queue'
  ];

  // Check each table against data access rules
  for (const { database, table } of tables) {
    const db = database || defaultDatabase || 'default';
    const tbl = table || '*';
    
    // Always allow SELECT from system metadata tables
    if (accessType === 'read' && db.toLowerCase() === 'system' && 
        SYSTEM_METADATA_TABLES.includes(tbl.toLowerCase())) {
      continue;
    }
    
    // Always allow SELECT from INFORMATION_SCHEMA
    if (accessType === 'read' && db.toLowerCase() === 'information_schema') {
      continue;
    }
    
    const result = await checkUserAccess(userId, db, tbl, accessType, connectionId);
    
    if (!result.allowed) {
      return { 
        allowed: false, 
        reason: `Access denied to ${db}.${tbl}` 
      };
    }
  }

  return { allowed: true };
}
