/**
 * Data Access Service
 * 
 * Manages database and table access rules for RBAC roles.
 * Supports wildcard patterns and deny rules.
 */

import { eq, and, desc, asc, like, or, isNull, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema, isSqlite } from '../db';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export type AccessType = 'read' | 'write' | 'admin' | 'misc';

export interface DataAccessRuleInput {
  roleId?: string | null;  // Either roleId or userId must be set
  userId?: string | null;  // Either roleId or userId must be set
  connectionId?: string | null;
  databasePattern: string;
  tablePattern: string;
  accessType: AccessType;
  isAllowed?: boolean;
  priority?: number;
  description?: string;
}

export interface DataAccessRuleResponse {
  id: string;
  roleId: string | null;
  userId: string | null;
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  accessType: AccessType;
  isAllowed: boolean;
  priority: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccessCheckResult {
  allowed: boolean;
  rule?: DataAccessRuleResponse;
  reason?: string;
}

// ============================================
// Pattern Matching Utilities
// ============================================

/**
 * Convert a simple pattern (with * wildcard) to a regex
 */
function patternToRegex(pattern: string): RegExp {
  // Escape regex special characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Convert * to .*
  const regexStr = `^${escaped.replace(/\*/g, '.*')}$`;
  return new RegExp(regexStr, 'i');
}

/**
 * Check if a value matches a pattern
 * Supports: exact match, * wildcard, regex (if starts with /)
 */
function matchesPattern(value: string, pattern: string): boolean {
  // Wildcard for all
  if (pattern === '*') return true;

  // Regex pattern (starts with /)
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      const regex = new RegExp(pattern.slice(1, -1), 'i');
      return regex.test(value);
    } catch {
      return false;
    }
  }

  // Simple wildcard pattern
  if (pattern.includes('*')) {
    return patternToRegex(pattern).test(value);
  }

  // Exact match (case-insensitive)
  return value.toLowerCase() === pattern.toLowerCase();
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new data access rule
 */
export async function createDataAccessRule(
  input: DataAccessRuleInput,
  createdBy?: string
): Promise<DataAccessRuleResponse> {
  // Validate that either roleId or userId is set, but not both
  if (!input.roleId && !input.userId) {
    throw new Error('Either roleId or userId must be provided');
  }
  if (input.roleId && input.userId) {
    throw new Error('Cannot set both roleId and userId');
  }

  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const id = randomUUID();
  const now = new Date();

  await db.insert(schema.dataAccessRules).values({
    id,
    roleId: input.roleId || null,
    userId: input.userId || null,
    connectionId: input.connectionId || null,
    databasePattern: input.databasePattern,
    tablePattern: input.tablePattern,
    accessType: input.accessType,
    isAllowed: input.isAllowed ?? true,
    priority: input.priority ?? 0,
    description: input.description || null,
    createdAt: now,
    updatedAt: now,
    createdBy,
  });

  return getDataAccessRuleById(id) as Promise<DataAccessRuleResponse>;
}

/**
 * Get a data access rule by ID
 */
export async function getDataAccessRuleById(id: string): Promise<DataAccessRuleResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const results = await db.select()
    .from(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.id, id))
    .limit(1);

  if (results.length === 0) return null;

  return mapRuleToResponse(results[0]);
}

/**
 * List data access rules
 */
export async function listDataAccessRules(options?: {
  roleId?: string;
  userId?: string;
  connectionId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rules: DataAccessRuleResponse[]; total: number }> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const conditions = [];
  if (options?.roleId) {
    conditions.push(eq(schema.dataAccessRules.roleId, options.roleId));
  }
  if (options?.userId) {
    conditions.push(eq(schema.dataAccessRules.userId, options.userId));
  }
  if (options?.connectionId) {
    conditions.push(
      or(
        eq(schema.dataAccessRules.connectionId, options.connectionId),
        isNull(schema.dataAccessRules.connectionId)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db.select()
    .from(schema.dataAccessRules)
    .where(whereClause);
  const total = countResult.length;

  // Get paginated results
  let query = db.select()
    .from(schema.dataAccessRules)
    .where(whereClause)
    .orderBy(desc(schema.dataAccessRules.priority), asc(schema.dataAccessRules.databasePattern));

  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.offset(options.offset);
  }

  const results = await query;

  return {
    rules: results.map(mapRuleToResponse),
    total,
  };
}

/**
 * Get all rules for a role (including inherited)
 */
export async function getRulesForRole(
  roleId: string,
  connectionId?: string
): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const conditions = [eq(schema.dataAccessRules.roleId, roleId)];

  if (connectionId) {
    // Get rules for this specific connection OR global rules (null connectionId)
    conditions.push(
      or(
        eq(schema.dataAccessRules.connectionId, connectionId),
        isNull(schema.dataAccessRules.connectionId)
      )!
    );
  }

  const results = await db.select()
    .from(schema.dataAccessRules)
    .where(and(...conditions))
    .orderBy(desc(schema.dataAccessRules.priority));

  return results.map(mapRuleToResponse);
}

/**
 * Get all rules for a user (combines user-specific rules AND role-based rules)
 */
export async function getRulesForUser(
  userId: string,
  connectionId?: string
): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Get user-specific rules
  const userConditions = [eq(schema.dataAccessRules.userId, userId)];
  if (connectionId) {
    userConditions.push(
      or(
        eq(schema.dataAccessRules.connectionId, connectionId),
        isNull(schema.dataAccessRules.connectionId)
      )!
    );
  }

  const userRules = await db.select()
    .from(schema.dataAccessRules)
    .where(and(...userConditions))
    .orderBy(desc(schema.dataAccessRules.priority));

  // Get user's role IDs
  const userRoles = await db.select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  let roleRules: any[] = [];
  if (userRoles.length > 0) {
    const roleIds = userRoles.map((ur: any) => ur.roleId);

    // Get all rules for those roles
    const roleConditions = [inArray(schema.dataAccessRules.roleId, roleIds)];

    if (connectionId) {
      roleConditions.push(
        or(
          eq(schema.dataAccessRules.connectionId, connectionId),
          isNull(schema.dataAccessRules.connectionId)
        )!
      );
    }

    roleRules = await db.select()
      .from(schema.dataAccessRules)
      .where(and(...roleConditions))
      .orderBy(desc(schema.dataAccessRules.priority));
  }

  // Combine user-specific rules and role-based rules
  // User-specific rules take precedence (higher effective priority)
  const allRules = [...userRules, ...roleRules];
  return allRules.map(mapRuleToResponse);
}

/**
 * Update a data access rule
 */
export async function updateDataAccessRule(
  id: string,
  input: Partial<DataAccessRuleInput>
): Promise<DataAccessRuleResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const existing = await getDataAccessRuleById(id);
  if (!existing) return null;

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.databasePattern !== undefined) updates.databasePattern = input.databasePattern;
  if (input.tablePattern !== undefined) updates.tablePattern = input.tablePattern;
  if (input.accessType !== undefined) updates.accessType = input.accessType;
  if (input.isAllowed !== undefined) updates.isAllowed = input.isAllowed;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.description !== undefined) updates.description = input.description;
  if (input.connectionId !== undefined) updates.connectionId = input.connectionId;

  await db.update(schema.dataAccessRules)
    .set(updates)
    .where(eq(schema.dataAccessRules.id, id));

  return getDataAccessRuleById(id);
}

/**
 * Delete a data access rule
 */
export async function deleteDataAccessRule(id: string): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const result = await db.delete(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.id, id));

  return true;
}

/**
 * Delete all rules for a role
 */
export async function deleteRulesForRole(roleId: string): Promise<number> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const existing = await db.select()
    .from(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.roleId, roleId));

  await db.delete(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.roleId, roleId));

  return existing.length;
}

/**
 * Delete all data access rules for a user
 */
export async function deleteRulesForUser(userId: string): Promise<number> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const existing = await db.select()
    .from(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.userId, userId));

  await db.delete(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.userId, userId));

  return existing.length;
}

/**
 * Get user-specific data access rules only (not role-inherited)
 */
export async function getUserSpecificRules(userId: string): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const rules = await db.select()
    .from(schema.dataAccessRules)
    .where(eq(schema.dataAccessRules.userId, userId))
    .orderBy(desc(schema.dataAccessRules.priority), asc(schema.dataAccessRules.createdAt));

  return rules.map(mapRuleToResponse);
}

// ============================================
// Access Checking
// ============================================

/**
 * Check if a user has access to a specific database/table
 */
export async function checkUserAccess(
  userId: string,
  database: string,
  table: string | null,
  accessType: AccessType,
  connectionId?: string
): Promise<AccessCheckResult> {
  const rules = await getRulesForUser(userId, connectionId);
  return evaluateRules(rules, database, table, accessType);
}

/**
 * Check if a role has access to a specific database/table
 */
export async function checkRoleAccess(
  roleId: string,
  database: string,
  table: string | null,
  accessType: AccessType,
  connectionId?: string
): Promise<AccessCheckResult> {
  const rules = await getRulesForRole(roleId, connectionId);
  return evaluateRules(rules, database, table, accessType);
}

/**
 * Evaluate access rules for a database/table
 * Rules are evaluated in order of priority (highest first)
 * Deny rules take precedence over allow rules at the same priority
 * 
 * Note: accessType is now determined by role permissions, not by individual rules.
 * Data access rules only define WHICH databases/tables a user can access.
 * 
 * System databases are hidden from Explorer UI but queries are allowed by default.
 */
function evaluateRules(
  rules: DataAccessRuleResponse[],
  database: string,
  table: string | null,
  _accessType: AccessType // Kept for API compatibility but not used for matching
): AccessCheckResult {
  // System databases are hidden from Explorer UI but queries are allowed by default
  // This allows users to query system tables even if they're hidden from the UI
  const SYSTEM_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];
  if (SYSTEM_DATABASES.includes(database)) {
    // Allow access to system databases by default for queries
    // (They're still hidden from Explorer UI via filterDatabases/filterTables)
    return { allowed: true, reason: 'System database access allowed by default' };
  }

  // For non-system databases, require explicit rules
  if (rules.length === 0) {
    return { allowed: false, reason: 'No access rules defined' };
  }

  // Sort by priority (highest first), then deny rules before allow
  const sortedRules = [...rules].sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    // At same priority, deny rules come first
    return a.isAllowed === b.isAllowed ? 0 : (a.isAllowed ? 1 : -1);
  });

  // Find matching rule (only check database/table patterns, not access type)
  for (const rule of sortedRules) {
    // Check database pattern
    if (!matchesPattern(database, rule.databasePattern)) {
      continue;
    }

    // Check table pattern (if table is provided)
    if (table !== null && !matchesPattern(table, rule.tablePattern)) {
      continue;
    }

    // Found a matching rule
    return {
      allowed: rule.isAllowed,
      rule,
      reason: rule.isAllowed
        ? `Allowed by rule: ${rule.databasePattern}.${rule.tablePattern}`
        : `Denied by rule: ${rule.databasePattern}.${rule.tablePattern}`,
    };
  }

  // No matching rule = no access
  return { allowed: false, reason: 'No matching access rule' };
}

/**
 * Check if an access type is covered by a rule's access type
 * 'admin' includes 'write' and 'read'
 * 'write' includes 'read'
 */
function accessTypeMatches(ruleType: AccessType, requestedType: AccessType): boolean {
  if (ruleType === 'admin') return true;
  if (ruleType === 'write') return requestedType === 'write' || requestedType === 'read';
  return ruleType === requestedType;
}

// System databases that should be hidden from non-admin users
const SYSTEM_METADATA_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];

/**
 * Filter databases based on user access rules
 * System databases are excluded (will be filtered out by caller for non-admins)
 * 
 * Note: Guest role should only have a rule for 'system.*' tables, which means:
 * - filterDatabasesForUser will only return 'system' database for guest users
 * - filterDatabases will then filter out 'system' database, so guest sees nothing
 * - This is the expected behavior: guest role should not see any databases in Explorer UI
 * - Guest can still query system tables via SQL editor (handled separately)
 */
export async function filterDatabasesForUser(
  userId: string,
  databases: string[],
  connectionId?: string
): Promise<string[]> {
  const rules = await getRulesForUser(userId, connectionId);

  // Debug logging
  console.log('[DataAccess] filterDatabasesForUser:', {
    userId,
    connectionId,
    rulesCount: rules.length,
    rules: rules.map(r => ({
      id: r.id.substring(0, 8),
      roleId: r.roleId?.substring(0, 8),
      userId: r.userId?.substring(0, 8),
      db: r.databasePattern,
      table: r.tablePattern,
      allowed: r.isAllowed
    })),
  });

  // If no rules, return empty (secure by default)
  // System databases will be filtered out by the caller for non-admin users
  if (rules.length === 0) {
    return [];
  }

  // Check each database
  // Note: System databases are not automatically included here
  // They will be filtered out by the caller for non-admin users
  return databases.filter(db => {
    // Skip system databases - they're handled separately
    if (SYSTEM_METADATA_DATABASES.includes(db)) {
      return false;
    }
    const result = evaluateRules(rules, db, null, 'read');
    return result.allowed;
  });
}

/**
 * Filter tables based on user access rules
 */
export async function filterTablesForUser(
  userId: string,
  database: string,
  tables: string[],
  connectionId?: string
): Promise<string[]> {
  const rules = await getRulesForUser(userId, connectionId);

  // If no rules, return empty (secure by default)
  if (rules.length === 0) return [];

  // Check each table
  return tables.filter(table => {
    const result = evaluateRules(rules, database, table, 'read');
    return result.allowed;
  });
}

// ============================================
// Helpers
// ============================================

function mapRuleToResponse(rule: any): DataAccessRuleResponse {
  return {
    id: rule.id,
    roleId: rule.roleId || null,
    userId: rule.userId || null,
    connectionId: rule.connectionId,
    databasePattern: rule.databasePattern,
    tablePattern: rule.tablePattern,
    accessType: rule.accessType as AccessType,
    isAllowed: Boolean(rule.isAllowed),
    priority: rule.priority,
    description: rule.description,
    createdAt: rule.createdAt instanceof Date ? rule.createdAt : new Date(rule.createdAt * 1000),
    updatedAt: rule.updatedAt instanceof Date ? rule.updatedAt : new Date(rule.updatedAt * 1000),
    createdBy: rule.createdBy,
  };
}

// ============================================
// Bulk Operations
// ============================================

/**
 * Set rules for a role (replaces existing rules)
 */
export async function setRulesForRole(
  roleId: string,
  rules: Omit<DataAccessRuleInput, 'roleId' | 'userId'>[],
  createdBy?: string
): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Delete existing rules
  await deleteRulesForRole(roleId);

  // Create new rules
  const createdRules: DataAccessRuleResponse[] = [];
  for (const rule of rules) {
    const created = await createDataAccessRule({ ...rule, roleId, userId: null }, createdBy);
    createdRules.push(created);
  }

  return createdRules;
}

/**
 * Set data access rules for a user (replaces all existing user-level rules)
 */
export async function setRulesForUser(
  userId: string,
  rules: Omit<DataAccessRuleInput, 'roleId' | 'userId'>[],
  createdBy?: string
): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  // Delete existing rules
  await deleteRulesForUser(userId);

  // Create new rules
  const createdRules: DataAccessRuleResponse[] = [];
  for (const rule of rules) {
    const created = await createDataAccessRule({ ...rule, userId, roleId: null }, createdBy);
    createdRules.push(created);
  }

  return createdRules;
}
