/**
 * What the AI may never do (ADR 0025 §2). Every permission that changes
 * something either has a write tool, or an entry here saying why it has none.
 * A test fails when a new write permission has neither, so a feature cannot
 * quietly skip the decision.
 */

import { PERMISSIONS, type Permission } from "../../../rbac/schema/base";

/** Permissions that only let someone read (or ask the AI): not part of the write coverage. */
export const READ_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set([
  PERMISSIONS.QUERY_EXECUTE,
  PERMISSIONS.TABLE_SELECT,
  PERMISSIONS.AI_CHAT,
  PERMISSIONS.AI_OPTIMIZE,
]);

/** A permission that changes something (anything that is not a view or read-only permission). */
export function isWritePermission(permission: Permission): boolean {
  return !permission.includes(":view") && !READ_ONLY_PERMISSIONS.has(permission);
}

/** Write permissions with no AI tool, and why. */
export const NOT_FOR_AI: Readonly<Partial<Record<Permission, string>>> = {
  [PERMISSIONS.USERS_DELETE]: "Deleting a user is permanent; deactivate_user blocks access and can be reversed.",
  [PERMISSIONS.CH_USERS_CREATE]: "ClickHouse users carry passwords, which never pass through AI.",
  [PERMISSIONS.CH_USERS_UPDATE]: "ClickHouse users carry passwords, which never pass through AI.",
  [PERMISSIONS.CH_USERS_DELETE]: "ClickHouse users carry passwords and are managed by a person in Admin.",
  [PERMISSIONS.CH_ROLES_DELETE]: "Dropping a ClickHouse role revokes it everywhere at once; a person does it in Admin.",
  [PERMISSIONS.CH_ROLES_ASSIGN]: "Assigning ClickHouse roles changes password-bearing ClickHouse users; a person does it in Admin.",
  [PERMISSIONS.QUERY_EXECUTE_MISC]: "SYSTEM and other administrative statements stay in the SQL editor.",
  [PERMISSIONS.AUDIT_EXPORT]: "A bulk export of the audit trail is a person's download.",
  [PERMISSIONS.AUDIT_DELETE]: "AI never deletes audit entries.",
  [PERMISSIONS.CONNECTIONS_DELETE]: "Connections hold credentials; a person adds, edits and removes them.",
  [PERMISSIONS.AI_ACT]: "Approving AI actions is a person's decision.",
  [PERMISSIONS.AI_MODELS_CREATE]: "Model configs hold provider keys, which never pass through AI.",
  [PERMISSIONS.AI_MODELS_UPDATE]: "Model configs hold provider keys, which never pass through AI.",
  [PERMISSIONS.AI_MODELS_DELETE]: "AI never changes its own models.",
  [PERMISSIONS.AI_GUARDRAILS_MANAGE]: "AI never changes its own guardrails.",
  [PERMISSIONS.AI_BUDGETS_MANAGE]: "AI never changes its own budgets.",
  [PERMISSIONS.AI_MEMORIES_MANAGE]: "Reviewing team memories is a person's decision.",
  [PERMISSIONS.SSO_EDIT]: "SSO holds client secrets and decides who can sign in.",
  [PERMISSIONS.SSO_DELETE]: "SSO decides who can sign in.",
  [PERMISSIONS.SCHEDULED_QUERIES_WRITE]: "Materializing jobs write into tables on a schedule; a person sets them up in Scheduled.",
  [PERMISSIONS.REMEDIATION_APPROVE]: "Approving a fix is a person's decision.",
  [PERMISSIONS.REMEDIATION_APPROVE_HIGH]: "Approving a high-risk fix is a person's decision.",
  [PERMISSIONS.SCHEMA_OVERRIDE]: "Confirming a schema change that breaks its dependents is a person's decision in the SQL editor.",
  [PERMISSIONS.AGENTS_MANAGE]: "AI never changes external agent (MCP) governance.",
  [PERMISSIONS.DASHBOARDS_MANAGE]: "Managing other people's dashboards uses the same tools as editing; the routes decide who may.",
};

// Never tools either, though their permission is covered by other tools: creating or editing
// connections (connections:edit covers only the collection schedule), personal access tokens,
// passwords, and file uploads or dbt manifest imports.
