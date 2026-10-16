import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { getAiEgress, getAiUsageByModel, getAiUsageRequest, getAiUsageSummary, listAiUsageRequests } from "./aiUsage";

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
    expect((await getAiUsageRequest("r 1")).request.id).toBe("r 1");

    expect(seen).toEqual([
      { path: "/api/ai-usage/summary", query: { days: "7" } },
      { path: "/api/ai-usage/models", query: { days: "7" } },
      { path: "/api/ai-usage/egress", query: { days: "30" } },
      { path: "/api/ai-usage/egress", query: { days: "30", q: "crm" } },
      { path: "/api/ai-usage/requests", query: { days: "1", q: "orders", limit: "25", offset: "50" } },
      { path: "/api/ai-usage/requests", query: { days: "1" } },
      { path: "/api/ai-usage/requests/r%201", query: {} },
    ]);
  });

  it("surfaces server errors", async () => {
    server.use(http.get("/api/ai-usage/summary", () => HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "One of these permissions required" } }, { status: 403 })));
    await expect(getAiUsageSummary(7)).rejects.toThrow(/permissions required/);
  });
});
