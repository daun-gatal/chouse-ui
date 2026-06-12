/**
 * Data Access Policies Service
 *
 * Named, reusable bundles of database/table access rules. A policy groups one or
 * more pattern rules, is scoped to one or more connections (or all connections),
 * and is attached to roles (many-to-many). Roles are the primary access-control
 * mechanism: a user's effective data access is the union of the rules in the
 * policies attached to their role(s).
 */

import { eq, and, inArray, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDatabase, getSchema } from '../db';

// Type helper for working with the dual (SQLite | PostgreSQL) database setup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ============================================
// Types
// ============================================

export interface PolicyRuleInput {
  databasePattern: string;
  tablePattern: string;
  isAllowed?: boolean;
  priority?: number;
  description?: string | null;
}

export interface PolicyRuleResponse {
  id: string;
  policyId: string;
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  description: string | null;
}

export interface DataAccessPolicyInput {
  name: string;
  description?: string | null;
  allConnections?: boolean;
  isSystem?: boolean;
  connectionIds?: string[];
  rules?: PolicyRuleInput[];
}

export interface DataAccessPolicyUpdate {
  name?: string;
  description?: string | null;
  allConnections?: boolean;
  connectionIds?: string[];
  rules?: PolicyRuleInput[];
}

export interface DataAccessPolicyResponse {
  id: string;
  name: string;
  description: string | null;
  allConnections: boolean;
  isSystem: boolean;
  connectionIds: string[];
  rules: PolicyRuleResponse[];
  roleIds: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * Minimal rule shape consumed by the access evaluator in `dataAccess.ts`.
 * Carries provenance (policyId/policyName) for debugging and self-service views.
 */
export interface ResolvedPolicyRule {
  databasePattern: string;
  tablePattern: string;
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

function mapPolicyRule(row: AnyDb): PolicyRuleResponse {
  return {
    id: row.id,
    policyId: row.policyId,
    databasePattern: row.databasePattern,
    tablePattern: row.tablePattern,
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
    allConnections: input.allConnections ?? false,
    isSystem: input.isSystem ?? false,
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy ?? null,
  });

  if (input.rules && input.rules.length > 0) {
    await replacePolicyRules(id, input.rules);
  }
  if (!input.allConnections && input.connectionIds && input.connectionIds.length > 0) {
    await replacePolicyConnections(id, input.connectionIds);
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

  const [ruleRows, connRows, roleRows] = await Promise.all([
    db.select()
      .from(schema.dataAccessPolicyRules)
      .where(eq(schema.dataAccessPolicyRules.policyId, id))
      .orderBy(desc(schema.dataAccessPolicyRules.priority), asc(schema.dataAccessPolicyRules.databasePattern)),
    db.select()
      .from(schema.dataAccessPolicyConnections)
      .where(eq(schema.dataAccessPolicyConnections.policyId, id)),
    db.select()
      .from(schema.roleDataAccessPolicies)
      .where(eq(schema.roleDataAccessPolicies.policyId, id)),
  ]);

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description ?? null,
    allConnections: Boolean(policy.allConnections),
    isSystem: Boolean(policy.isSystem),
    connectionIds: connRows.map((r: AnyDb) => r.connectionId),
    rules: ruleRows.map(mapPolicyRule),
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

  // N is small (admin-managed); resolve each policy's nested data sequentially-safe in parallel.
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
  if (input.allConnections !== undefined) updates.allConnections = input.allConnections;

  await db.update(schema.dataAccessPolicies)
    .set(updates)
    .where(eq(schema.dataAccessPolicies.id, id));

  if (input.rules !== undefined) {
    await replacePolicyRules(id, input.rules);
  }

  // When the policy is set to apply to all connections, clear any explicit links.
  const allConnections = input.allConnections ?? existing.allConnections;
  if (allConnections) {
    await replacePolicyConnections(id, []);
  } else if (input.connectionIds !== undefined) {
    await replacePolicyConnections(id, input.connectionIds);
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
// Rules & connections (replace semantics)
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
  await db.insert(schema.dataAccessPolicyRules).values(
    rules.map((rule) => ({
      id: randomUUID(),
      policyId,
      databasePattern: rule.databasePattern,
      tablePattern: rule.tablePattern,
      isAllowed: rule.isAllowed ?? true,
      priority: rule.priority ?? 0,
      description: rule.description ?? null,
      createdAt: now,
      updatedAt: now,
    }))
  );
}

export async function replacePolicyConnections(
  policyId: string,
  connectionIds: string[]
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();

  await db.delete(schema.dataAccessPolicyConnections)
    .where(eq(schema.dataAccessPolicyConnections.policyId, policyId));

  if (connectionIds.length === 0) return;

  const now = new Date();
  const unique = Array.from(new Set(connectionIds));
  await db.insert(schema.dataAccessPolicyConnections).values(
    unique.map((connectionId) => ({
      id: randomUUID(),
      policyId,
      connectionId,
      createdAt: now,
    }))
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
 * filtered to a connection. A policy contributes its rules when it applies to
 * all connections, or (when `connectionId` is given) when it is linked to that
 * connection. When `connectionId` is omitted, every attached policy contributes.
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

  let applicablePolicies = policies as AnyDb[];

  if (connectionId) {
    const connLinks = await db.select()
      .from(schema.dataAccessPolicyConnections)
      .where(
        and(
          inArray(schema.dataAccessPolicyConnections.policyId, policyIds),
          eq(schema.dataAccessPolicyConnections.connectionId, connectionId)
        )
      );
    const scopedPolicyIds = new Set(connLinks.map((l: AnyDb) => l.policyId));
    applicablePolicies = applicablePolicies.filter(
      (p) => Boolean(p.allConnections) || scopedPolicyIds.has(p.id)
    );
  }

  if (applicablePolicies.length === 0) return [];

  const applicableIds = applicablePolicies.map((p) => p.id);
  const nameById = new Map<string, string>(applicablePolicies.map((p) => [p.id, p.name]));

  const ruleRows = await db.select()
    .from(schema.dataAccessPolicyRules)
    .where(inArray(schema.dataAccessPolicyRules.policyId, applicableIds));

  return ruleRows.map((row: AnyDb) => ({
    databasePattern: row.databasePattern,
    tablePattern: row.tablePattern,
    isAllowed: Boolean(row.isAllowed),
    priority: row.priority,
    policyId: row.policyId,
    policyName: nameById.get(row.policyId) ?? '',
  }));
}
