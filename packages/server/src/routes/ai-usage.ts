/**
 * AI usage and data egress (ADR 0020 §5–6), shown in AI Governance › AI activity.
 *
 *   GET /summary        totals, cost and unpriced models for the window
 *   GET /models         usage by model
 *   GET /egress         data sent to providers, by source (top 100, search, total)
 *   GET /requests       recent AI requests (search, origin filter, paging)
 *   GET /requests/:id   one request with its steps and egress
 *
 * `ai_usage:view` reads everyone's requests. Users with `ai:chat` or
 * `ai:optimize` but not `ai_usage:view` read only their own; every response
 * says which (`scope`).
 */

import { Hono, type Context } from "hono";

import { getRbacUser, rbacAuthMiddleware, requireAnyPermission } from "../rbac/middleware/rbacAuth";
import { PERMISSIONS } from "../rbac/schema/base";
import { userHasPermission } from "../rbac/services/rbac";
import { egressBySource, listUsageRequests, MAX_EGRESS_SOURCES, REQUEST_ORIGINS, usageByModel, usageRequestDetail, usageSummary, type RequestOrigin, type UsageScope } from "../services/ai/usage/queries";
import { usageRetentionDays } from "../services/ai/usage/store";
import { AppError, requireParam } from "../types";

const aiUsage = new Hono();
aiUsage.use("*", rbacAuthMiddleware);
aiUsage.use("*", requireAnyPermission([PERMISSIONS.AI_USAGE_VIEW, PERMISSIONS.AI_CHAT, PERMISSIONS.AI_OPTIMIZE]));

const DAY_MS = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

/** Whether the caller reads everyone's usage. Checked against the database too, like requirePermission. */
async function seesAll(c: Context): Promise<boolean> {
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  if (permissions.includes(PERMISSIONS.AI_USAGE_VIEW)) return true;
  return userHasPermission(getRbacUser(c).sub, PERMISSIONS.AI_USAGE_VIEW);
}

/** `days` from the query, 1 … retention (default 7). */
export function windowDays(raw: string | undefined, retentionDays: number = usageRetentionDays()): number {
  const parsed = Number(raw ?? 7);
  if (!Number.isFinite(parsed)) throw AppError.badRequest("Query parameter 'days' must be a number");
  return Math.min(retentionDays, Math.max(1, Math.floor(parsed)));
}

/** `origin` from the query: one of REQUEST_ORIGINS, or absent for every origin. */
export function originParam(raw: string | undefined): RequestOrigin | undefined {
  if (raw === undefined || raw === "") return undefined;
  const origin = REQUEST_ORIGINS.find((o) => o === raw);
  if (!origin) throw AppError.badRequest(`Query parameter 'origin' must be one of: ${REQUEST_ORIGINS.join(", ")}`);
  return origin;
}

async function scopeOf(c: Context): Promise<{ scope: UsageScope; label: "all" | "own"; days: number }> {
  const days = windowDays(c.req.query("days"));
  const all = await seesAll(c);
  return {
    scope: { userId: all ? null : getRbacUser(c).sub, since: Date.now() - days * DAY_MS },
    label: all ? "all" : "own",
    days,
  };
}

aiUsage.get("/summary", async (c) => {
  const { scope, label, days } = await scopeOf(c);
  return ok(c, { scope: label, days, retentionDays: usageRetentionDays(), ...(await usageSummary(scope)) });
});

aiUsage.get("/models", async (c) => {
  const { scope, label, days } = await scopeOf(c);
  return ok(c, { scope: label, days, models: await usageByModel(scope) });
});

aiUsage.get("/egress", async (c) => {
  const { scope, label, days } = await scopeOf(c);
  const q = c.req.query("q")?.slice(0, 200);
  return ok(c, { scope: label, days, limit: MAX_EGRESS_SOURCES, ...(await egressBySource(scope, { q })) });
});

aiUsage.get("/requests", async (c) => {
  const { scope, label, days } = await scopeOf(c);
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) throw AppError.badRequest("limit and offset must be numbers");
  const q = c.req.query("q")?.slice(0, 200);
  const origin = originParam(c.req.query("origin"));
  return ok(c, { scope: label, days, ...(await listUsageRequests(scope, { q, origin, limit, offset })) });
});

aiUsage.get("/requests/:id", async (c) => {
  const id = requireParam(c, "id");
  const all = await seesAll(c);
  const detail = await usageRequestDetail(id, all ? null : getRbacUser(c).sub);
  if (!detail) throw AppError.notFound("AI request not found");
  return ok(c, detail);
});

export default aiUsage;
