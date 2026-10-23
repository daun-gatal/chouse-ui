import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { createAiBudget, deleteAiBudget, getAiEgress, getAiUsageByModel, getAiUsageRequest, getAiUsageSummary, listAiBudgets, listAiUsageRequests, updateAiBudget, type AiBudgetInput } from "./aiUsage";

describe("AI usage API", () => {
  it("calls each endpoint with the window and unwraps the payload", async () => {
    const seen: Array<{ path: string; query: Record<string, string> }> = [];
    server.use(
      http.get("/api/ai-usage/*", ({ request }) => {
        const url = new URL(request.url);
        seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const data: Record<string, unknown> = url.pathname.endsWith("/models")
          ? { scope: "all", days: 7, models: [{ name: "Sonnet" }] }
          : url.pathname.endsWith("/egress")
            ? { scope: "all", days: 7, sources: [{ source: "sales.orders" }], total: 140, limit: 100 }
            : url.pathname.endsWith("/summary")
              ? { scope: "own", days: 7, requests: 3 }
              : url.pathname.endsWith("/requests")
                ? { scope: "all", days: 7, requests: [], total: 0 }
                : { request: { id: "r 1" }, steps: [], egress: [], connections: {} };
        return HttpResponse.json({ success: true, data });
      }),
    );

    expect(await getAiUsageSummary(7)).toMatchObject({ scope: "own", requests: 3 });
    expect(await getAiUsageByModel(7)).toEqual([{ name: "Sonnet" }]);
    expect(await getAiEgress(30)).toEqual({ sources: [{ source: "sales.orders" }], total: 140, limit: 100 });
    await getAiEgress(30, " crm ");
    expect(await listAiUsageRequests({ days: 1, q: "  orders ", limit: 25, offset: 50 })).toMatchObject({ total: 0 });
    await listAiUsageRequests({ days: 1, q: "   " });
    await listAiUsageRequests({ days: 30, origin: "mcp" });
    expect((await getAiUsageRequest("r 1")).request.id).toBe("r 1");

    expect(seen).toEqual([
      { path: "/api/ai-usage/summary", query: { days: "7" } },
      { path: "/api/ai-usage/models", query: { days: "7" } },
      { path: "/api/ai-usage/egress", query: { days: "30" } },
      { path: "/api/ai-usage/egress", query: { days: "30", q: "crm" } },
      { path: "/api/ai-usage/requests", query: { days: "1", q: "orders", limit: "25", offset: "50" } },
      { path: "/api/ai-usage/requests", query: { days: "1" } },
      { path: "/api/ai-usage/requests", query: { days: "30", origin: "mcp" } },
      { path: "/api/ai-usage/requests/r%201", query: {} },
    ]);
  });

  it("surfaces server errors", async () => {
    server.use(http.get("/api/ai-usage/summary", () => HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "One of these permissions required" } }, { status: 403 })));
    await expect(getAiUsageSummary(7)).rejects.toThrow(/permissions required/);
  });
});

describe("AI budgets API", () => {
  const input: AiBudgetInput = {
    name: "Chat per user", featureId: "chat", appliesTo: "each_user", userId: null, period: "day",
    limitTokens: 100_000, limitCostUsd: null, onExhaust: "stop", fallbackModelConfigId: null, enabled: true,
  };

  it("lists budgets with spend and sends create, update and delete", async () => {
    const calls: Array<[string, unknown]> = [];
    server.use(
      http.get("/api/ai-usage/budgets", () => HttpResponse.json({ success: true, data: { canManage: true, budgets: [{ ...input, id: "b1", spend: { tokens: 5, costUsd: 0 }, exhausted: false, exhaustedUsers: 0, resetsAt: 1, createdBy: null, createdAt: 0, updatedAt: 0 }] } })),
      http.post("/api/ai-usage/budgets", async ({ request }) => {
        calls.push(["create", await request.json()]);
        return HttpResponse.json({ success: true, data: { ...input, id: "b2" } }, { status: 201 });
      }),
      http.put("/api/ai-usage/budgets/b2", async ({ request }) => {
        calls.push(["update", await request.json()]);
        return HttpResponse.json({ success: true, data: { ...input, id: "b2", name: "Renamed" } });
      }),
      http.delete("/api/ai-usage/budgets/b2", () => {
        calls.push(["delete", null]);
        return HttpResponse.json({ success: true, data: { id: "b2" } });
      }),
    );
    const list = await listAiBudgets();
    expect(list.canManage).toBe(true);
    expect(list.budgets[0].spend.tokens).toBe(5);
    expect((await createAiBudget(input)).id).toBe("b2");
    expect((await updateAiBudget("b2", { ...input, name: "Renamed" })).name).toBe("Renamed");
    await deleteAiBudget("b2");
    expect(calls.map(([kind]) => kind)).toEqual(["create", "update", "delete"]);
    expect(calls[0][1]).toEqual(input);
  });

  it("surfaces the server's validation message", async () => {
    server.use(http.post("/api/ai-usage/budgets", () => HttpResponse.json({ success: false, error: { code: "BAD_REQUEST", message: "Set a token limit, a cost limit or both" } }, { status: 400 })));
    await expect(createAiBudget({ ...input, limitTokens: null })).rejects.toThrow("Set a token limit, a cost limit or both");
  });
});
