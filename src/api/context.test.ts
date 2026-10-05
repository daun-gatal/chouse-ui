import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import { compileWatcher, deleteMetric, draftTableContext, getTableContext, importDbtManifest, listContextTables, listMetrics, saveMetric, saveTableContext, verifyTableContext } from "./context";

describe("context API", () => {
  it("projects every context endpoint", async () => {
    const seen: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    server.use(
      http.all("/api/context/*", ({ request }) => {
        const url = new URL(request.url);
        seen.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams) });
        return HttpResponse.json({ success: true, data: { tables: [{ database: "shop", table: "orders" }], metrics: [{ id: "m1" }] } });
      }),
    );
    expect(await listContextTables("ord", "c1")).toEqual([{ database: "shop", table: "orders" }]);
    expect(await listMetrics()).toEqual([{ id: "m1" }]);
    await getTableContext("shop", "orders");
    await saveTableContext("shop", "orders", { deprecated: false, tags: [] });
    await verifyTableContext("shop", "orders");
    await saveMetric("shop", "orders", { name: "gmv", expression: "sum(amount)" });
    await deleteMetric("m1");
    await importDbtManifest({ nodes: {} });
    await compileWatcher("tell me when orders stop arriving");
    await draftTableContext("shop", "order lines", "m1");
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/context/tables",
      "GET /api/context/metrics",
      "GET /api/context/tables/shop/orders",
      "PUT /api/context/tables/shop/orders",
      "POST /api/context/tables/shop/orders/verify",
      "PUT /api/context/tables/shop/orders/metrics",
      "DELETE /api/context/metrics/m1",
      "POST /api/context/dbt-import",
      "POST /api/context/watchers/compile",
      "POST /api/context/tables/shop/order%20lines/draft",
    ]);
    expect(seen[0].params).toEqual({ connectionId: "c1", q: "ord" });
  });
});
