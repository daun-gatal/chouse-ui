import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import * as dashboards from "./dashboards";

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
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
    const input: dashboards.DashboardInput = { title: "T", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: ["ddl"], panels: [] };
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
    await dashboards.arrangePanels([]);
    await dashboards.tidyPanels([]);
    await dashboards.listVersions("d1");
    await dashboards.getVersion("d1", 2);
    await dashboards.restorePreview("d1", 2);
    await dashboards.restoreVersion("d1", 2, 5);
    await dashboards.importDashboard({ format: "chouse.dashboard/v1" });
    await dashboards.createSnapshot("d1", { name: "S", from: 1, to: 2, values: {}, roleIds: [], expiresInDays: 7, incidentId: null });
    await dashboards.listSnapshots("d1");
    await dashboards.getSnapshot("d1", "s/1");
    await dashboards.deleteSnapshot("d1", "s1");
    const report = { name: "R", connectionId: "c1", schedule: { kind: "daily" as const, dayOfWeek: null, hour: 9, minute: 0, timezone: "UTC" }, range: "24h" as const, onlyIfAlert: false, enabled: true, channelIds: ["ch1"] };
    await dashboards.listReports("d1");
    await dashboards.createReport("d1", report);
    await dashboards.updateReport("d1", "r1", report);
    await dashboards.deleteReport("d1", "r1");
    await dashboards.sendReport("d1", "r/1");
    await dashboards.previewGrafana({ panels: [] }, { kind: "any" });
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
      "POST /api/dashboards/layout",
      "POST /api/dashboards/layout",
      "GET /api/dashboards/d1/versions",
      "GET /api/dashboards/d1/versions/2",
      "GET /api/dashboards/d1/versions/2/restore-preview",
      "POST /api/dashboards/d1/versions/2/restore",
      "POST /api/dashboards/import",
      "POST /api/dashboards/d1/snapshots",
      "GET /api/dashboards/d1/snapshots",
      "GET /api/dashboards/d1/snapshots/s%2F1",
      "DELETE /api/dashboards/d1/snapshots/s1",
      "GET /api/dashboards/d1/reports",
      "POST /api/dashboards/d1/reports",
      "PUT /api/dashboards/d1/reports/r1",
      "DELETE /api/dashboards/d1/reports/r1",
      "POST /api/dashboards/d1/reports/r%2F1/send",
      "POST /api/dashboards/import/grafana",
    ]);
    expect(bodies[26]).toEqual({ name: "S", from: 1, to: 2, values: {}, roleIds: [], expiresInDays: 7, incidentId: null });
    expect(bodies[3]).toEqual({ version: 3, dashboard: input });
    expect(bodies[19]).toEqual({ mode: "arrange", sections: [] });
    expect(bodies[20]).toEqual({ mode: "tidy", panels: [] });
    expect(bodies[24]).toEqual({ currentVersion: 5 });
  });

  it("surfaces the server's error message", async () => {
    server.use(http.post("/api/dashboards/d1/panels/p1/run", () => HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Access denied to secret.payments", category: "auth" } }, { status: 403 })));
    await expect(dashboards.runPanel("d1", "p1", { range: RANGE, values: {} })).rejects.toThrow("Access denied to secret.payments");
  });

  it("maps a detail back to the input a save takes", () => {
    const meta = { dashboardId: "d1", position: 0, createdAt: 0, updatedAt: 0 };
    const chart = { ...meta, id: "p1", kind: "chart" as const, title: "P", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 2, w: 12, h: 9 } };
    const text = { ...meta, id: "p2", kind: "text" as const, title: "", markdown: "**hi**", layout: { x: 12, y: 2, w: 6, h: 4 } };
    const heading = { ...meta, id: "p3", kind: "heading" as const, title: "H", description: "d", layout: { x: 0, y: 0, w: 24, h: 2 } };
    const dashboard = { id: "d1", title: "T", description: "x", ownerId: "u", timeRange: "1h" as const, refreshSeconds: 30 as const, connectionScope: { kind: "only" as const, connectionIds: ["c1"] }, variables: [], annotations: ["alerts" as const], version: 2, createdAt: 0, updatedAt: 0 };
    expect(dashboards.toInput({ dashboard, panels: [chart, text, heading] })).toEqual({
      title: "T", description: "x", timeRange: "1h", refreshSeconds: 30, connectionScope: { kind: "only", connectionIds: ["c1"] }, variables: [], annotations: ["alerts"],
      panels: [
        { id: "p1", kind: "chart", title: "P", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 2, w: 12, h: 9 } },
        { id: "p2", kind: "text", title: "", markdown: "**hi**", layout: { x: 12, y: 2, w: 6, h: 4 } },
        { id: "p3", kind: "heading", title: "H", description: "d", layout: { x: 0, y: 0, w: 24, h: 2 } },
      ],
    });
  });
});
