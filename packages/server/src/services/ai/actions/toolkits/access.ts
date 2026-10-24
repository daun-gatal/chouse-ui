/**
 * Access toolkit (ADR 0025 §2): users, roles, data access policies and
 * ClickHouse roles. Every tool here is T3: a second person who holds the
 * permission approves it, so nobody — and no agent — changes access alone,
 * including their own. The routes' escalation guards (no granting more than
 * you hold, never super_admin) apply as for a person.
 *
 * Passwords never pass through these tools: a created user's generated
 * password is dropped from what the assistant sees, and is set in
 * Admin › Users (or the user signs in with SSO).
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import type { ActionDefinition } from "../types";
import { given, quote, seg, str } from "./shared";

const policyRule = z.object({
  connectionId: z.string().nullable().optional().describe("null applies to every connection"),
  databasePattern: z.string().min(1).max(255).default("*"),
  tablePattern: z.string().min(1).max(255).default("*"),
  isAllowed: z.boolean().default(true),
  priority: z.number().int().min(-1000).max(1000).default(0),
  description: z.string().max(500).nullable().optional(),
});

const chGrant = z.object({
  privileges: z.array(z.string().min(1)).min(1),
  database: z.string().nullable(),
  table: z.string().nullable(),
  columns: z.array(z.string().min(1)).optional(),
  grantOption: z.boolean(),
});

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export const ACCESS_ACTIONS: ActionDefinition[] = [
  {
    name: "create_user",
    title: "Create a user",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.USERS_CREATE],
    description: "Create a CHouse user with one role. CHouse generates their password and never shows it to the assistant: set it in Admin › Users, or the user signs in with SSO.",
    schema: z.object({
      email: z.string().email(),
      username: z.string().min(3).max(50),
      displayName: z.string().max(100).optional(),
      roleId: z.string().min(1).optional().describe("Role id (from list_roles)"),
    }),
    describe: (args) => `Create the user ${quote(str(args.username))} <${str(args.email)}>${args.roleId ? ` with role ${quote(str(args.roleId))}` : ""}`,
    execute: async (args, ctx) => {
      const created = await ctx.api.post<Record<string, unknown>>("/api/rbac/users", {
        ...given(args, ["email", "username", "displayName"]),
        ...(typeof args.roleId === "string" ? { roleIds: [args.roleId] } : {}),
        generatePassword: true,
      });
      // The generated password is for a person, never for a model or a log.
      const { generatedPassword: _dropped, ...rest } = created;
      return { ...rest, message: "Created. Set their password in Admin › Users, or they sign in with SSO." };
    },
  },
  {
    name: "update_user",
    title: "Edit a user",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.USERS_UPDATE],
    description: "Change a user's email, username or display name. Use assign_role to change their role, deactivate_user to block them.",
    schema: z.object({
      id: z.string().min(1).describe("User id (from list_users)"),
      email: z.string().email().optional(),
      username: z.string().min(3).max(50).optional(),
      displayName: z.string().max(100).optional(),
    }),
    describe: (args) => `Edit the user ${quote(str(args.id))} (${["email", "username", "displayName"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => ctx.api.patch(`/api/rbac/users/${seg(args.id)}`, given(args, ["email", "username", "displayName"])),
  },
  {
    name: "deactivate_user",
    title: "Deactivate a user",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.USERS_UPDATE],
    description: "Block a user from signing in (their sessions end); activate them again with active true.",
    schema: z.object({ id: z.string().min(1), active: z.boolean().default(false) }),
    describe: (args) => `${args.active === true ? "Reactivate" : "Deactivate"} the user ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.patch(`/api/rbac/users/${seg(args.id)}`, { isActive: args.active === true }),
  },
  {
    name: "assign_role",
    title: "Assign a role",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.ROLES_ASSIGN],
    description: "Give a user a role (a user has exactly one; this replaces it). You can only grant roles whose permissions you hold.",
    schema: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
    describe: (args) => `Give the user ${quote(str(args.userId))} the role ${quote(str(args.roleId))}`,
    execute: async (args, ctx) => ctx.api.post(`/api/rbac/users/${seg(args.userId)}/assign-roles`, { roleIds: [str(args.roleId)] }),
  },
  {
    name: "create_role",
    title: "Create a role",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.ROLES_CREATE],
    description: "Create a role from permission ids (list_permissions) and at least one data access policy (list_data_access_policies). You can only include permissions you hold.",
    schema: z.object({
      name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).min(2).max(50),
      displayName: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
      permissionIds: z.array(z.string()).min(1),
      dataAccessPolicyIds: z.array(z.string()).min(1),
    }),
    describe: (args) => `Create the role ${quote(str(args.name))} with ${count(args.permissionIds)} permission(s) and ${count(args.dataAccessPolicyIds)} data access polic(ies)`,
    execute: async (args, ctx) => ctx.api.post("/api/rbac/roles", given(args, ["name", "displayName", "description", "permissionIds", "dataAccessPolicyIds"])),
  },
  {
    name: "update_role",
    title: "Edit a role",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.ROLES_UPDATE],
    description: "Change a role's name, description, permissions or data access policies. Lists replace what the role has.",
    schema: z.object({
      id: z.string().min(1),
      displayName: z.string().min(2).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      permissionIds: z.array(z.string()).optional(),
      dataAccessPolicyIds: z.array(z.string()).optional(),
    }),
    describe: (args) => `Edit the role ${quote(str(args.id))} (${["displayName", "description", "permissionIds", "dataAccessPolicyIds"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => ctx.api.patch(`/api/rbac/roles/${seg(args.id)}`, given(args, ["displayName", "description", "permissionIds", "dataAccessPolicyIds"])),
  },
  {
    name: "delete_role",
    title: "Delete a role",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.ROLES_DELETE],
    description: "Delete a custom role (system roles and roles still assigned to users cannot be deleted).",
    schema: z.object({ id: z.string().min(1) }),
    describe: (args) => `Delete the role ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/rbac/roles/${seg(args.id)}`),
  },
  {
    name: "create_data_access_policy",
    title: "Create a data access policy",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.DATA_ACCESS_CREATE],
    description: "Create a data access policy: rules allowing or denying database/table patterns, on one connection or all.",
    schema: z.object({
      name: z.string().min(2).max(255),
      description: z.string().max(500).nullable().optional(),
      rules: z.array(policyRule).min(1).max(100),
    }),
    describe: (args) => `Create the data access policy ${quote(str(args.name))} with ${count(args.rules)} rule(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/rbac/data-access-policies", given(args, ["name", "description", "rules"])),
  },
  {
    name: "update_data_access_policy",
    title: "Edit a data access policy",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.DATA_ACCESS_UPDATE],
    description: "Change a data access policy's name, description or rules (the rules list replaces the current one).",
    schema: z.object({
      id: z.string().min(1),
      name: z.string().min(2).max(255).optional(),
      description: z.string().max(500).nullable().optional(),
      rules: z.array(policyRule).min(1).max(100).optional(),
    }),
    describe: (args) => `Edit the data access policy ${quote(str(args.id))} (${["name", "description", "rules"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => ctx.api.patch(`/api/rbac/data-access-policies/${seg(args.id)}`, given(args, ["name", "description", "rules"])),
  },
  {
    name: "delete_data_access_policy",
    title: "Delete a data access policy",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.DATA_ACCESS_DELETE],
    description: "Delete a data access policy (system policies cannot be deleted).",
    schema: z.object({ id: z.string().min(1) }),
    describe: (args) => `Delete the data access policy ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/rbac/data-access-policies/${seg(args.id)}`),
  },
  {
    name: "set_role_policies",
    title: "Set a role's data access policies",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.DATA_ACCESS_ASSIGN],
    description: "Replace the data access policies attached to a role — which connections, databases and tables its users can reach.",
    schema: z.object({ roleId: z.string().min(1), policyIds: z.array(z.string()).max(100) }),
    describe: (args) => `Give the role ${quote(str(args.roleId))} ${count(args.policyIds)} data access polic(ies)`,
    execute: async (args, ctx) => ctx.api.post(`/api/rbac/data-access-policies/role/${seg(args.roleId)}`, { policyIds: args.policyIds }),
  },
  {
    name: "create_clickhouse_role",
    title: "Create a ClickHouse role",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: true,
    permissions: [PERMISSIONS.CH_ROLES_CREATE],
    description: "Create a role in ClickHouse itself (on the active connection) with structured grants.",
    schema: z.object({ name: z.string().min(1).max(255), cluster: z.string().optional(), grants: z.array(chGrant).max(100) }),
    describe: (args) => `Create the ClickHouse role ${quote(str(args.name))} with ${count(args.grants)} grant(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/rbac/clickhouse-roles", given(args, ["name", "cluster", "grants"])),
  },
  {
    name: "update_clickhouse_role",
    title: "Change a ClickHouse role's grants",
    toolkit: "access",
    category: "access",
    tier: "t3",
    connectionScoped: true,
    permissions: [PERMISSIONS.CH_ROLES_UPDATE],
    description: "Replace the grants of a ClickHouse role on the active connection.",
    schema: z.object({ name: z.string().min(1).max(255), cluster: z.string().optional(), grants: z.array(chGrant).max(100) }),
    describe: (args) => `Set ${count(args.grants)} grant(s) on the ClickHouse role ${quote(str(args.name))}`,
    execute: async (args, ctx) => ctx.api.patch(`/api/rbac/clickhouse-roles/${seg(args.name)}`, given(args, ["cluster", "grants"])),
  },
];
