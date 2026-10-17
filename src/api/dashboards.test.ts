import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import * as dashboards from "./dashboards";

const VIZ = { version: 1 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null };
const RANGE = { kind: "relative" as const, value: "6h" as const };

describe("dashboards API", () => {
  it("calls every endpoint with the right method and path", async () => {
    const seen: string[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.all("/api/dashboards*", async ({ request }) => {
        const url = new URL(request.url);
        seen.push(`${request.method} ${url.pathname}`);
        bodies.push(request.method === "GET" || request.method === "DELETE" ? null : await request.json().catch(() => null));
        return HttpResponse.json({ success: true, data: {} });
      }),
    );
    const input: dashboards.DashboardInput = { title: "T", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], panels: [] };
    await dashboards.listDashboards();
    await dashboards.getDashboard("d/1");
    await dashboards.createDashboard(input);
    await dashboards.updateDashboard("d1", 3, input);
    await dashboards.deleteDashboard("d1");
    await dashboards.duplicateDashboard("d1");
    await dashboards.setShares("d1", [{ roleId: "r", canEdit: true }]);
    await dashboards.listShareTargets();
    await dashboards.setPinned("d1", true);
    await dashboards.setPinned("d1", false);
    await dashboards.exportDashboard("d1");
    await dashboards.runPanel("d1", "p1", { range: RANGE, values: {} });
    await dashboards.previewPanel({ sql: "SELECT 1", viz: VIZ, fleet: false, variables: [], values: {}, range: RANGE, connectionScope: { kind: "any" } });
    await dashboards.lintPanel("SELECT 1", VIZ);
    await dashboards.variableOptions("d1", "db");
    await dashboards.listTemplates();
    await dashboards.instantiateTemplate("replication", { kind: "any" });
    await dashboards.listAlerts("d1");
    await dashboards.listAllAlerts();
    expect(seen).toEqual([
      "GET /api/dashboards",
      "GET /api/dashboards/d%2F1",
      "POST /api/dashboards",
      "PUT /api/dashboards/d1",
      "DELETE /api/dashboards/d1",
      "POST /api/dashboards/d1/duplicate",
      "PUT /api/dashboards/d1/shares",
      "GET /api/dashboards/share-targets",
      "POST /api/dashboards/d1/pin",
      "DELETE /api/dashboards/d1/pin",
      "GET /api/dashboards/d1/export",
      "POST /api/dashboards/d1/panels/p1/run",
      "POST /api/dashboards/preview",
      "POST /api/dashboards/lint",
      "POST /api/dashboards/d1/variables/db/options",
      "GET /api/dashboards/templates",
      "POST /api/dashboards/templates/replication/instantiate",
      "GET /api/dashboards/d1/alerts",
      "GET /api/dashboards/alerts",
    ]);
    expect(bodies[3]).toEqual({ version: 3, dashboard: input });
  });

  it("surfaces the server's error message", async () => {
    server.use(http.post("/api/dashboards/d1/panels/p1/run", () => HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Access denied to secret.payments", category: "auth" } }, { status: 403 })));
    await expect(dashboards.runPanel("d1", "p1", { range: RANGE, values: {} })).rejects.toThrow("Access denied to secret.payments");
  });

  it("maps a detail back to the input a save takes", () => {
    const panel = { id: "p1", dashboardId: "d1", position: 0, title: "P", sql: "SELECT 1", viz: VIZ, width: 6 as const, height: "m" as const, fleet: false, createdAt: 0, updatedAt: 0 };
    const dashboard = { id: "d1", title: "T", description: "x", ownerId: "u", timeRange: "1h" as const, refreshSeconds: 30 as const, connectionScope: { kind: "only" as const, connectionIds: ["c1"] }, variables: [], version: 2, createdAt: 0, updatedAt: 0 };
    expect(dashboards.toInput({ dashboard, panels: [panel] })).toEqual({
      title: "T", description: "x", timeRange: "1h", refreshSeconds: 30, connectionScope: { kind: "only", connectionIds: ["c1"] }, variables: [],
      panels: [{ id: "p1", title: "P", sql: "SELECT 1", viz: VIZ, width: 6, height: "m", fleet: false }],
    });
  });
});
