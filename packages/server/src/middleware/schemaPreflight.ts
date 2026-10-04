/**
 * Schema change preflight gate (ADR 0016 §11, §18). Every DDL path — Explorer
 * SQL, Explorer drop buttons, API, CLI and MCP — calls this before running a
 * statement. A change that breaks dependents returns 409 with the impact
 * unless the caller holds schema:override (Admin and Super admin by default)
 * and confirmed with `X-Schema-Override: confirm`.
 */

import type { Context } from "hono";

import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { analyzeDdl } from "../services/schemaPreflight/impact";
import { parseDdl } from "../services/schemaPreflight/parse";

export async function enforceSchemaPreflight(c: Context, connectionId: string | undefined, statement: string, defaultDatabase: string | undefined): Promise<Response | null> {
  if (!connectionId || parseDdl(statement).kind === "unknown") return null;
  const impact = await analyzeDdl(connectionId, statement, defaultDatabase || "default");
  if (!impact.breaking) return null;
  const userId: string | undefined = c.get("rbacUserId");
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  const isAdmin = Boolean(c.get("isRbacAdmin"));
  const canOverride = isAdmin || permissions.includes(PERMISSIONS.SCHEMA_OVERRIDE) || (userId ? await userHasPermission(userId, PERMISSIONS.SCHEMA_OVERRIDE) : false);
  const confirmed = c.req.header("X-Schema-Override") === "confirm";
  if (!canOverride || !confirmed) {
    return c.json({
      success: false,
      error: {
        code: "SCHEMA_PREFLIGHT_BREAKS",
        message: canOverride
          ? "This change breaks dependents. Review the impact and confirm to run it anyway."
          : "This change breaks dependents and needs the schema:override permission.",
        details: { impact, canOverride },
      },
    }, 409);
  }
  if (userId) {
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SCHEMA_OVERRIDE, userId, {
      resourceType: "query",
      details: { connectionId, query: statement.substring(0, 500), breaks: impact.items.filter((i) => i.severity === "breaks").map((i) => i.label) },
    });
  }
  return null;
}
