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
import { 
  splitSqlStatements, 
  parseStatement, 
  getAccessTypeFromStatementType,
  type ParsedStatement 
} from './sqlParser';

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
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return databases;

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
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return tables;

  // For system database, hide all tables from non-admin users
  if (SYSTEM_DATABASES.includes(database)) {
    return [];
  }

  return filterTablesForUser(userId, database, tables, connectionId);
}

/**
 * Extract database and table from a SQL query using AST parser
 * Falls back to regex if parsing fails
 */
export function extractTablesFromQuery(sql: string): { database?: string; table?: string }[] {
  try {
    const parsed = parseStatement(sql);
    return parsed.tables;
  } catch (error) {
    // Fallback to empty array if parsing fails completely
    console.warn('[DataAccess] Failed to extract tables from query:', error);
    return [];
  }
}

/**
 * Determine access type needed for a query using AST parser
 * Falls back to pattern matching if parsing fails
 */
export function getQueryAccessType(sql: string): AccessType {
  try {
    const parsed = parseStatement(sql);
    return getAccessTypeFromStatementType(parsed.type);
  } catch (error) {
    // Fallback to simple pattern matching
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
}

/**
 * Validate a single SQL statement
 * 
 * Checks:
 * 1. User has required permissions for the operation type (read/write/admin)
 * 2. User has data access rules allowing access to all referenced tables
 * 
 * @param statement - Single SQL statement to validate
 * @param statementIndex - Zero-based index of the statement (for error reporting)
 * @param userId - RBAC user ID
 * @param permissions - User's role permissions
 * @param defaultDatabase - Default database context
 * @param connectionId - Connection ID for data access rules
 * @returns Validation result with detailed error message if denied
 */
async function validateSingleStatement(
  statement: string,
  statementIndex: number,
  userId: string,
  permissions: string[],
  defaultDatabase: string | undefined,
  connectionId: string | undefined
): Promise<{ allowed: boolean; reason?: string; statementIndex?: number }> {
  // Parse statement using AST parser for robust analysis
  let parsed: ParsedStatement;
  try {
    parsed = parseStatement(statement);
  } catch (error) {
    // If parsing fails completely, deny access for security
    return {
      allowed: false,
      reason: `Statement ${statementIndex + 1}: Failed to parse SQL statement`,
      statementIndex,
    };
  }

  const accessType = getAccessTypeFromStatementType(parsed.type);
  
  // Check if user has permission for this type of operation (based on role)
  if (!hasPermissionForAccessType(permissions, accessType)) {
    return {
      allowed: false,
      reason: `Statement ${statementIndex + 1}: No permission for ${accessType} operations (${parsed.type} statement)`,
      statementIndex,
    };
  }

  const tables = parsed.tables;
  
  // If no tables detected, allow (might be a system query)
  if (tables.length === 0) {
    return { allowed: true };
  }

  // Known system tables that should be checked against 'system' database
  // even if parsed as being in another database
  const SYSTEM_TABLES = [
    // Log tables
    'query_log', 'query_thread_log', 'part_log', 'metric_log', 'trace_log',
    'text_log', 'asynchronous_metric_log', 'session_log', 'zookeeper_log',
    'system_log', 'crash_log', 'asynchronous_insert_log', 'backup_log',
    // Metrics tables (current metrics, not logs)
    'metrics', 'asynchronous_metrics',
    // System information tables
    'processes', 'mutations', 'replicas', 'databases', 'tables', 'columns',
    'functions', 'dictionaries', 'formats', 'table_functions', 'table_engines',
    'settings', 'users', 'roles', 'quotas', 'row_policies', 'grants',
    'clusters', 'macros', 'merges', 'parts', 'detached_parts', 'data_skipping_indices',
    'distribution_queue', 'distributed_ddl_queue', 'replication_queue',
    'zookeeper', 'disks', 'storage_policies', 'merge_tree_settings',
    'build_options', 'licenses', 'server_settings', 'time_zones',
  ];

  // Check each table against data access rules
  // Note: System databases are hidden from UI but queries are still allowed if user has permissions
  for (const { database, table } of tables) {
    let db = database || defaultDatabase || 'default';
    let tbl = table || '*';
    
    // Fix for parser errors: If table is 'system' but we're checking against 'default' database,
    // it's likely the parser incorrectly extracted 'system' as the table name from 'system.tableName'
    // Try to extract the correct database.table from the statement
    if (db !== 'system' && tbl === 'system') {
      const systemTableMatch = statement.match(/FROM\s+system\.([`"]?[\w]+[`"]?)/i);
      if (systemTableMatch) {
        db = 'system';
        tbl = systemTableMatch[1].replace(/[`"]/g, '');
      }
    }
    
    // If table is a known system table but database is not 'system', check against 'system' database
    if (tbl !== '*' && SYSTEM_TABLES.includes(tbl.toLowerCase()) && db !== 'system') {
      db = 'system';
    }
    
    // Additional fix: If database is 'system' but table is still 'system' or '*', extract from statement
    if (db === 'system' && (tbl === 'system' || tbl === '*')) {
      const fallbackMatch = statement.match(/FROM\s+system\.([`"]?[\w]+[`"]?)/i);
      if (fallbackMatch) {
        tbl = fallbackMatch[1].replace(/[`"]/g, '');
      }
    }
    
    // System databases are hidden from Explorer UI but queries are still allowed
    // Check user access normally (don't block system database queries)
    const result = await checkUserAccess(userId, db, tbl, accessType, connectionId);
    
    if (!result.allowed) {
      return { 
        allowed: false, 
        reason: `Statement ${statementIndex + 1}: Access denied to ${db}.${tbl} (requires ${accessType} permission)`,
        statementIndex,
      };
    }
  }

  return { allowed: true };
}

/**
 * Validate query access for a user
 * 
 * SECURITY: Advanced multi-statement validation
 * - Splits SQL query into individual statements
 * - Validates EACH statement separately for:
 *   1. Operation type permissions (read/write/admin based on role)
 *   2. Data access rules (which databases/tables user can access)
 * 
 * This prevents security vulnerabilities where users with limited permissions
 * could execute dangerous operations by combining statements:
 * 
 * Example attack prevented:
 *   SELECT * FROM safe_table; DROP TABLE sensitive_data;
 * 
 * The first statement would pass (read permission), but the second would be
 * rejected (requires admin permission), preventing the entire query.
 * 
 * @param userId - RBAC user ID (undefined = legacy mode, no filtering)
 * @param isAdmin - Whether user is admin (admins bypass all checks)
 * @param permissions - User's role permissions array
 * @param sql - SQL query string (may contain multiple statements separated by semicolons)
 * @param defaultDatabase - Default database context for table references
 * @param connectionId - Connection ID for connection-specific data access rules
 * @returns Validation result with detailed error message including statement index if denied
 */
export async function validateQueryAccess(
  userId: string | undefined,
  isAdmin: boolean | undefined,
  permissions: string[] | undefined,
  sql: string,
  defaultDatabase?: string,
  connectionId?: string
): Promise<{ allowed: boolean; reason?: string; statementIndex?: number }> {
  // Admins have full access
  if (isAdmin) return { allowed: true };
  
  // No RBAC user = no filtering (legacy mode)
  if (!userId) return { allowed: true };

  // Split SQL into individual statements
  const statements = splitSqlStatements(sql);
  
  // If no valid statements found, deny
  if (statements.length === 0) {
    return {
      allowed: false,
      reason: 'No valid SQL statements found',
    };
  }

  // Validate each statement individually
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const validation = await validateSingleStatement(
      statement,
      i,
      userId,
      permissions || [],
      defaultDatabase,
      connectionId
    );

    if (!validation.allowed) {
      // Provide detailed error message
      const statementPreview = statement.substring(0, 50).replace(/\s+/g, ' ');
      return {
        allowed: false,
        reason: `${validation.reason}${statements.length > 1 ? `\nStatement: ${statementPreview}...` : ''}`,
        statementIndex: validation.statementIndex,
      };
    }
  }

  // All statements passed validation
  return { allowed: true };
}
