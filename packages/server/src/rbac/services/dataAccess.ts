/**
 * Data Access Service
 *
 * Evaluates database/table access for users and roles. Access is granted through
 * **data access policies** attached to roles (see `dataAccessPolicies.ts`); a
 * user's effective rules are the flattened pattern rules from the policies on
 * their role(s). Supports wildcard/regex patterns and deny rules.
 */

import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from '../db';
import { logger } from '../../utils/logger';
import { getPolicyRulesForRoleIds, type ResolvedPolicyRule } from './dataAccessPolicies';

// Type helper for working with dual database setup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

// Access type is governed by role permissions (table:select / table:insert / …),
// not by data access rules. Kept here only so the middleware signatures that pass
// an access type stay stable — it is not used for pattern matching.
export type AccessType = 'read' | 'write' | 'admin' | 'misc';

/**
 * A resolved effective rule. Data access rules no longer carry an access type or
 * a per-rule connection — connection scope lives on the owning policy.
 */
export interface DataAccessRuleResponse {
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  policyId: string;
  policyName: string;
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
// Resolution
// ============================================

function mapResolvedRule(rule: ResolvedPolicyRule): DataAccessRuleResponse {
  return {
    databasePattern: rule.databasePattern,
    tablePattern: rule.tablePattern,
    isAllowed: rule.isAllowed,
    priority: rule.priority,
    policyId: rule.policyId,
    policyName: rule.policyName,
  };
}

/**
 * Get the effective rules granted to a role (via its attached policies).
 */
export async function getRulesForRole(
  roleId: string,
  connectionId?: string
): Promise<DataAccessRuleResponse[]> {
  const rules = await getPolicyRulesForRoleIds([roleId], connectionId);
  return rules.map(mapResolvedRule);
}

/**
 * Get the effective rules for a user: resolved from the policies attached to the
 * user's role(s). The app enforces a single role per user, but this stays
 * tolerant of multiple roles (union) as a safety net.
 */
export async function getRulesForUser(
  userId: string,
  connectionId?: string
): Promise<DataAccessRuleResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const userRoles = await db.select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  const roleIds = userRoles.map((ur: AnyDb) => ur.roleId);
  if (roleIds.length === 0) return [];

  const rules = await getPolicyRulesForRoleIds(roleIds, connectionId);
  return rules.map(mapResolvedRule);
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
  _accessType: AccessType,
  connectionId?: string
): Promise<AccessCheckResult> {
  const rules = await getRulesForUser(userId, connectionId);
  return evaluateRules(rules, database, table);
}

/**
 * Check if a role has access to a specific database/table
 */
export async function checkRoleAccess(
  roleId: string,
  database: string,
  table: string | null,
  _accessType: AccessType,
  connectionId?: string
): Promise<AccessCheckResult> {
  const rules = await getRulesForRole(roleId, connectionId);
  return evaluateRules(rules, database, table);
}

/**
 * Evaluate access rules for a database/table.
 * Rules are evaluated in order of priority (highest first); deny rules take
 * precedence over allow rules at the same priority.
 *
 * System databases are hidden from the Explorer UI but queries are allowed by default.
 */
function evaluateRules(
  rules: DataAccessRuleResponse[],
  database: string,
  table: string | null
): AccessCheckResult {
  // System databases are hidden from Explorer UI but queries are allowed by default
  // This allows users to query system tables even if they're hidden from the UI
  const SYSTEM_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];
  if (SYSTEM_DATABASES.includes(database)) {
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
    if (!matchesPattern(database, rule.databasePattern)) {
      continue;
    }
    if (table !== null && !matchesPattern(table, rule.tablePattern)) {
      continue;
    }
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

// System databases that should be hidden from non-admin users
const SYSTEM_METADATA_DATABASES = ['system', 'information_schema', 'INFORMATION_SCHEMA'];

/**
 * Filter databases based on user access rules
 * System databases are excluded (will be filtered out by caller for non-admins)
 */
export async function filterDatabasesForUser(
  userId: string,
  databases: string[],
  connectionId?: string
): Promise<string[]> {
  const rules = await getRulesForUser(userId, connectionId);

  logger.debug(
    {
      module: 'DataAccess',
      userId,
      connectionId,
      rulesCount: rules.length,
      rules: rules.map(r => ({
        policyId: r.policyId.substring(0, 8),
        db: r.databasePattern,
        table: r.tablePattern,
        allowed: r.isAllowed,
      })),
    },
    'filterDatabasesForUser'
  );

  // If no rules, return empty (secure by default)
  if (rules.length === 0) {
    return [];
  }

  return databases.filter(db => {
    // Skip system databases - they're handled separately
    if (SYSTEM_METADATA_DATABASES.includes(db)) {
      return false;
    }
    const result = evaluateRules(rules, db, null);
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

  return tables.filter(table => {
    const result = evaluateRules(rules, database, table);
    return result.allowed;
  });
}
