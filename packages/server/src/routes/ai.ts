/**
 * Unified AI route — the single entry point for the query-scoped structured
 * capabilities (optimize-query, debug-query, check-optimize, optimize-log,
 * diagnose-error, diagnose-parts, diagnose-schema).
 *
 * Frontend calls POST /ai/invoke with { capability, input, modelId }. The route
 * looks the capability up in the registry, enforces its permission, validates
 * input, and runs it through the shared engine. Audit + permission live here.
 *
 * Streaming chat (/ai-chat) and the fleet doctor scan (/fleet/doctor) keep
 * their dedicated routes — different auth surfaces — but share the same engine.
 */

import { Hono, type Context } from "hono";
import { AppError } from "../types";
import { queryAuthMiddleware, type Variables } from "./query";
import { getCapability, CAPABILITIES, CAPABILITY_IDS } from "../services/ai/capabilities";
import { runStructuredCapability, isStructured } from "../services/ai/engine";
import type { AgentRunContext } from "../services/ai/types";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { AUDIT_ACTIONS } from "../rbac/schema/base";
import type { Permission } from "../rbac/schema/base";
import { getClientIp } from "../rbac/middleware/rbacAuth";
import { requestLogger } from "../utils/logger";

const ai = new Hono<{ Variables: Variables }>();

ai.use("*", queryAuthMiddleware);

/** Enforce a capability's RBAC permission against the authenticated user. */
async function requireCapabilityPermission(
  c: Context<{ Variables: Variables }>,
  permission: Permission,
): Promise<void> {
  if (c.get("isRbacAdmin")) return;
  const userId = c.get("rbacUserId");
  if (!userId) throw AppError.unauthorized("RBAC authentication is required.");
  if (c.get("rbacPermissions")?.includes(permission)) return;
  if (await userHasPermission(userId, permission)) return;
  throw AppError.forbidden(`Permission '${permission}' required for this action`);
}

/** Build the engine run context from the authenticated request. */
function buildRunContext(
  c: Context<{ Variables: Variables }>,
  modelId?: string,
): AgentRunContext {
  const session = c.get("session");
  return {
    userId: c.get("rbacUserId"),
    isAdmin: c.get("isRbacAdmin"),
    permissions: c.get("rbacPermissions"),
    connectionId: session?.rbacConnectionId ?? c.get("rbacConnectionId"),
    clickhouseService: c.get("service"),
    defaultDatabase: session?.connectionConfig?.database,
    modelId,
  };
}

/**
 * POST /ai/invoke — run a structured capability.
 * Body: { capability: string, input: object, modelId?: string }
 */
ai.post("/invoke", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { capability?: string; input?: unknown; modelId?: string }
    | null;

  const capId = body?.capability;
  if (!capId) throw AppError.badRequest("'capability' is required");

  const cap = getCapability(capId);
  if (!cap) throw AppError.badRequest(`Unknown capability: ${capId}`);
  if (!isStructured(cap)) {
    throw AppError.badRequest(`Capability '${capId}' is streaming; use its dedicated endpoint.`);
  }

  // Preserve the legacy AI_OPTIMIZER_ENABLED gate for the optimizer-family
  // capabilities (config.ts exposes this flag to the frontend, which hides the
  // Optimize/Debug UI when off). check-optimize degrades softly, debug throws —
  // matching the previous /query/debug + /query/check-optimization behavior.
  if (process.env.AI_OPTIMIZER_ENABLED !== "true") {
    if (capId === "check-optimize") {
      return c.json({ success: true, data: { canOptimize: false, reason: "AI Optimizer disabled" } });
    }
    if (capId === "debug-query") {
      throw AppError.badRequest("AI Optimizer is not enabled on this server.");
    }
  }

  await requireCapabilityPermission(c, cap.permission);

  const parsedInput = cap.inputSchema.parse(body?.input ?? {});
  const ctx = buildRunContext(c, body?.modelId);

  const result = await runStructuredCapability(cap, parsedInput, ctx);

  // Audit (best-effort, mirrors the old per-route logging).
  const userId = c.get("rbacUserId");
  if (userId) {
    createAuditLogWithContext(c, AUDIT_ACTIONS.CH_QUERY_EXECUTE, userId, {
      resourceType: "ai",
      resourceId: capId,
      details: { capability: capId, connectionId: ctx.connectionId, timestamp: Date.now() },
      ipAddress: getClientIp(c),
      status: "success",
    }).catch((err: unknown) => {
      requestLogger(c.get("requestId")).error(
        { module: "AI", capability: capId, err: err instanceof Error ? err.message : String(err) },
        "Failed to create AI audit log",
      );
    });
  }

  return c.json({ success: true, data: result });
});

/**
 * GET /ai/capabilities — capabilities the caller may use, so the UI can show or
 * hide AI buttons. Returns id + permission + delivery for each.
 */
ai.get("/capabilities", async (c) => {
  const isAdmin = c.get("isRbacAdmin") ?? false;
  const perms = c.get("rbacPermissions") ?? [];
  const list = CAPABILITY_IDS.map((id) => {
    const cap = CAPABILITIES[id];
    return {
      id,
      permission: cap.permission,
      delivery: cap.delivery,
      allowed: isAdmin || perms.includes(cap.permission),
    };
  });
  return c.json({ success: true, data: list });
});

/**
 * GET /ai/models — active AI deployments for the model picker (no secrets).
 * Unifies the old /query/optimize-models, /ai-chat/models, /fleet/doctor/models.
 */
ai.get("/models", async (c) => {
  try {
    const { listAiConfigs } = await import("../rbac/services/aiModels");
    const { configs } = await listAiConfigs({ activeOnly: true });
    return c.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: configs.map((cfg: any) => ({
        id: cfg.id,
        label: cfg.name,
        model: cfg.model?.modelId ?? cfg.model?.name ?? "",
        provider: cfg.provider?.name ?? cfg.provider?.providerType ?? "",
        isDefault: Boolean(cfg.isDefault),
      })),
    });
  } catch {
    return c.json({ success: true, data: [] });
  }
});

export default ai;
