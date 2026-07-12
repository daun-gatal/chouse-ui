import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware } from "../rbac/middleware/rbacAuth";
import * as store from "../services/queryHistory/store";

const queryHistory = new Hono();
queryHistory.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status?: 200 | 201): any {
  return c.json({ success: true, data }, status ?? 200);
}

const historyItemSchema = z.object({
  id: z.string().min(1).max(100),
  query: z.string().min(1).max(100_000),
  connectionId: z.string().max(100).nullish(),
  connectionName: z.string().max(255).nullish(),
  executedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  status: z.enum(["success", "error", "cancelled"]),
  error: z.string().max(2_000).optional(),
});

queryHistory.get("/", zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) })), async (c) => {
  return ok(c, await store.listQueryHistory(getRbacUser(c).sub, c.req.valid("query").limit));
});

queryHistory.post("/", zValidator("json", historyItemSchema), async (c) => {
  const item = c.req.valid("json");
  await store.recordQueryHistory(getRbacUser(c).sub, {
    ...item,
    connectionId: item.connectionId ?? null,
    connectionName: item.connectionName ?? null,
  });
  return ok(c, item, 201);
});

queryHistory.delete("/", async (c) => {
  await store.clearQueryHistory(getRbacUser(c).sub);
  return ok(c, { deleted: true });
});

queryHistory.delete("/:id", async (c) => {
  await store.deleteQueryHistoryItem(getRbacUser(c).sub, c.req.param("id"));
  return ok(c, { deleted: true });
});

export default queryHistory;
