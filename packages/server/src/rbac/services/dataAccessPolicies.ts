/**
 * Data Access Policies Service
 *
 * Named, reusable bundles of database/table access rules. Each rule may be scoped
 * to a specific connection (or null = all connections). Policies are attached to
 * roles (many-to-many). Roles are the primary access-control mechanism: a user's
 * effective data access is the union of the rules in the policies on their role(s).
 */

import { eq, and, inArray, desc, asc, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema } from '../db';
import { DEFAULT_DATA_ACCESS_RULE_PERMISSIONS, type Permission } from '../schema/base';

// Type helper for working with the dual (SQLite | PostgreSQL) database setup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export interface PolicyRuleInput {
  connectionId?: string | null;
  databasePattern: string;
  tablePattern: string;
  permissions?: Permission[];
  isAllowed?: boolean;
  priority?: number;
  description?: string | null;
}

export interface PolicyRuleResponse {
  id: string;
  policyId: string;
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  permissions: Permission[];
  isAllowed: boolean;
  priority: number;
  description: string | null;
}

export interface DataAccessPolicyInput {
  name: string;
  description?: string | null;
  isSystem?: boolean;
  rules?: PolicyRuleInput[];
}

export interface DataAccessPolicyUpdate {
  name?: string;
  description?: string | null;
  rules?: PolicyRuleInput[];
}

export interface DataAccessPolicyResponse {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rules: PolicyRuleResponse[];
  roleIds: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * Minimal rule shape consumed by the access evaluator in `dataAccess.ts`.
 * Carries provenance (policyId/policyName) for debugging and self-service views.
 * Connection filtering happens before this shape is produced.
 */
export interface ResolvedPolicyRule {
  databasePattern: string;
  tablePattern: string;
  permissions: Permission[];
  isAllowed: boolean;
  priority: number;
  policyId: string;
  policyName: string;
}

// ============================================
// Helpers
// ============================================

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date((value as number) * 1000);
}

function normalizeRulePermissions(permissions?: Permission[]): Permission[] {
  const source = permissions && permissions.length > 0
    ? permissions
    : Array.from(DEFAULT_DATA_ACCESS_RULE_PERMISSIONS);
  return Array.from(new Set(source));
}

function mapPolicyRule(row: AnyDb, permissions: Permission[]): PolicyRuleResponse {
  return {
    id: row.id,
    policyId: row.policyId,
    connectionId: row.connectionId ?? null,
    databasePattern: row.databasePattern,
    tablePattern: row.tablePattern,
    permissions,
    isAllowed: Boolean(row.isAllowed),
    priority: row.priority,
    description: row.description ?? null,
  };
}

// ============================================
// CRUD
// ============================================

export async function createPolicy(
  input: DataAccessPolicyInput,
  createdBy?: string
): Promise<DataAccessPolicyResponse> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const id = randomUUID();
  const now = new Date();

  await db.insert(schema.dataAccessPolicies).values({
    id,
    name: input.name,
    description: input.description ?? null,
    isSystem: input.isSystem ?? false,
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy ?? null,
  });

  if (input.rules && input.rules.length > 0) {
    await replacePolicyRules(id, input.rules);
  }

  return getPolicyById(id) as Promise<DataAccessPolicyResponse>;
}

export async function getPolicyById(id: string): Promise<DataAccessPolicyResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const rows = await db.select()
    .from(schema.dataAccessPolicies)
    .where(eq(schema.dataAccessPolicies.id, id))
    .limit(1);
  if (rows.length === 0) return null;

  const policy = rows[0];

  const [ruleRows, roleRows] = await Promise.all([
    db.select()
      .from(schema.dataAccessPolicyRules)
      .where(eq(schema.dataAccessPolicyRules.policyId, id))
      .orderBy(desc(schema.dataAccessPolicyRules.priority), asc(schema.dataAccessPolicyRules.databasePattern)),
    db.select()
      .from(schema.roleDataAccessPolicies)
      .where(eq(schema.roleDataAccessPolicies.policyId, id)),
  ]);
  const ruleIds = ruleRows.map((r: AnyDb) => r.id);
  const permissionRows = ruleIds.length === 0
    ? []
    : await db.select()
      .from(schema.dataAccessPolicyRulePermissions)
      .where(inArray(schema.dataAccessPolicyRulePermissions.ruleId, ruleIds));
  const permissionsByRule = new Map<string, Permission[]>();
  for (const row of permissionRows) {
    const ruleId = String(row.ruleId);
    const values = permissionsByRule.get(ruleId) ?? [];
    values.push(row.permission as Permission);
    permissionsByRule.set(ruleId, values);
  }

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description ?? null,
    isSystem: Boolean(policy.isSystem),
    rules: ruleRows.map((row: AnyDb) => mapPolicyRule(row, normalizeRulePermissions(permissionsByRule.get(row.id)))),
    roleIds: roleRows.map((r: AnyDb) => r.roleId),
    createdAt: toDate(policy.createdAt),
    updatedAt: toDate(policy.updatedAt),
    createdBy: policy.createdBy ?? null,
  };
}

export async function listPolicies(): Promise<DataAccessPolicyResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const policies = await db.select()
    .from(schema.dataAccessPolicies)
    .orderBy(asc(schema.dataAccessPolicies.name));

  return Promise.all(policies.map((p: AnyDb) => getPolicyById(p.id))) as Promise<DataAccessPolicyResponse[]>;
}

export async function updatePolicy(
  id: string,
  input: DataAccessPolicyUpdate
): Promise<DataAccessPolicyResponse | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const existing = await getPolicyById(id);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;

  await db.update(schema.dataAccessPolicies)
    .set(updates)
    .where(eq(schema.dataAccessPolicies.id, id));

  if (input.rules !== undefined) {
    await replacePolicyRules(id, input.rules);
  }

  return getPolicyById(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.dataAccessPolicies)
    .where(eq(schema.dataAccessPolicies.id, id));
  return true;
}

// ============================================
// Rules (replace semantics)
// ============================================

export async function replacePolicyRules(
  policyId: string,
  rules: PolicyRuleInput[]
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.dataAccessPolicyRules)
    .where(eq(schema.dataAccessPolicyRules.policyId, policyId));

  if (rules.length === 0) return;

  const now = new Date();
  const rows = rules.map((rule) => ({
    id: randomUUID(),
    policyId,
    connectionId: rule.connectionId ?? null,
    databasePattern: rule.databasePattern,
    tablePattern: rule.tablePattern,
    isAllowed: rule.isAllowed ?? true,
    priority: rule.priority ?? 0,
    description: rule.description ?? null,
    createdAt: now,
    updatedAt: now,
    permissions: normalizeRulePermissions(rule.permissions),
  }));

  await db.insert(schema.dataAccessPolicyRules).values(
    rows.map(({ permissions, ...rule }) => rule)
  );

  await db.insert(schema.dataAccessPolicyRulePermissions).values(
    rows.flatMap((rule) => rule.permissions.map((permission) => ({
      id: randomUUID(),
      ruleId: rule.id,
      permission,
      createdAt: now,
    })))
  );
}

// ============================================
// Role <-> policy links
// ============================================

export async function getPoliciesForRole(roleId: string): Promise<DataAccessPolicyResponse[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const links = await db.select()
    .from(schema.roleDataAccessPolicies)
    .where(eq(schema.roleDataAccessPolicies.roleId, roleId));

  const policyIds = links.map((l: AnyDb) => l.policyId);
  if (policyIds.length === 0) return [];

  return Promise.all(policyIds.map((pid: string) => getPolicyById(pid)))
    .then((results) => results.filter((p): p is DataAccessPolicyResponse => p !== null));
}

export async function getRolesForPolicy(policyId: string): Promise<string[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const links = await db.select()
    .from(schema.roleDataAccessPolicies)
    .where(eq(schema.roleDataAccessPolicies.policyId, policyId));
  return links.map((l: AnyDb) => l.roleId);
}

/**
 * Replace the set of policies attached to a role.
 */
export async function setPoliciesForRole(roleId: string, policyIds: string[]): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.roleDataAccessPolicies)
    .where(eq(schema.roleDataAccessPolicies.roleId, roleId));

  if (policyIds.length === 0) return;

  const now = new Date();
  const unique = Array.from(new Set(policyIds));
  await db.insert(schema.roleDataAccessPolicies).values(
    unique.map((policyId) => ({
      id: randomUUID(),
      roleId,
      policyId,
      createdAt: now,
    }))
  );
}

export async function getPolicyIdsForRole(roleId: string): Promise<string[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const links = await db.select()
    .from(schema.roleDataAccessPolicies)
    .where(eq(schema.roleDataAccessPolicies.roleId, roleId));
  return links.map((l: AnyDb) => l.policyId);
}

// ============================================
// Resolution (consumed by dataAccess.ts)
// ============================================

/**
 * Resolve the flattened pattern rules granted to a set of roles, optionally
 * filtered to a connection. A rule applies when its `connectionId` is null
 * (all connections) or equals the given `connectionId`. When `connectionId` is
 * omitted, every rule is returned.
 */
export async function getPolicyRulesForRoleIds(
  roleIds: string[],
  connectionId?: string
): Promise<ResolvedPolicyRule[]> {
  if (roleIds.length === 0) return [];

  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  const links = await db.select()
    .from(schema.roleDataAccessPolicies)
    .where(inArray(schema.roleDataAccessPolicies.roleId, roleIds));

  const policyIds = Array.from(new Set(links.map((l: AnyDb) => l.policyId))) as string[];
  if (policyIds.length === 0) return [];

  const policies = await db.select()
    .from(schema.dataAccessPolicies)
    .where(inArray(schema.dataAccessPolicies.id, policyIds));
  const nameById = new Map<string, string>((policies as AnyDb[]).map((p) => [p.id, p.name]));

  // Filter rules by connection: null connection (all) OR the requested connection.
  const baseWhere = inArray(schema.dataAccessPolicyRules.policyId, policyIds);
  const whereClause = connectionId
    ? and(
        baseWhere,
        or(
          isNull(schema.dataAccessPolicyRules.connectionId),
          eq(schema.dataAccessPolicyRules.connectionId, connectionId)
        )
      )
    : baseWhere;

  const ruleRows = await db.select()
    .from(schema.dataAccessPolicyRules)
    .where(whereClause);
  const ruleIds = ruleRows.map((r: AnyDb) => r.id);
  const permissionRows = ruleIds.length === 0
    ? []
    : await db.select()
      .from(schema.dataAccessPolicyRulePermissions)
      .where(inArray(schema.dataAccessPolicyRulePermissions.ruleId, ruleIds));
  const permissionsByRule = new Map<string, Permission[]>();
  for (const row of permissionRows) {
    const ruleId = String(row.ruleId);
    const values = permissionsByRule.get(ruleId) ?? [];
    values.push(row.permission as Permission);
    permissionsByRule.set(ruleId, values);
  }

  return ruleRows.map((row: AnyDb) => ({
    databasePattern: row.databasePattern,
    tablePattern: row.tablePattern,
    permissions: normalizeRulePermissions(permissionsByRule.get(row.id)),
    isAllowed: Boolean(row.isAllowed),
    priority: row.priority,
    policyId: row.policyId,
    policyName: nameById.get(row.policyId) ?? '',
  }));
}
