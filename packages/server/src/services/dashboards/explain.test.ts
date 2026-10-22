/**
 * Explain this spike gathers its evidence as the viewer, through the panel
 * pipeline; what it cannot read is reported, never hidden.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

const runs: Array<{ sql: string; from: number; to: number }> = [];
let failOn: RegExp | null = null;
mock.module("./runner", () => ({
  runPanelWindow: async (_viewer: unknown, _conn: string, query: { sql: string }, window: { from: number; to: number }) => {
    runs.push({ sql: query.sql, from: window.from, to: window.to });
    if (failOn?.test(query.sql)) throw new Error("Access denied to system.mutations");
    return { data: { rows: [{ t: "x", v: 1 }], columns: [], timezone: "UTC" } };
  },
  viewerConnection: async (_viewer: unknown, connectionId: string) => {
    if (connectionId !== "c1") throw new Error("You do not have access to this connection");
    return { id: connectionId };
  },
}));

let user: Record<string, unknown> | null = null;
mock.module("../../rbac/services/rbac", () => ({ getUserById: async () => user }));

const PANEL = { id: "p1", kind: "chart", title: "Latency", sql: "SELECT t, v FROM x", viz: { type: "line", unit: "ms", x: "t", y: ["v"] } };
let detail: Record<string, unknown> | null = null;
mock.module("./store", () => ({ getDashboard: async () => detail }));
mock.module("./annotations", () => ({
  loadAnnotations: async () => [
    { source: "ddl", ok: true, events: [{ id: "e1", source: "ddl", at: 1_800_000_000_000, title: "ALTER shop.orders", detail: null, objectRef: "shop.orders" }], truncated: false },
    { source: "alerts", ok: false, error: "Needs alerting:view" },
  ],
}));

const { gatherEvidence } = await import("./explain");

const REQUEST = { dashboardId: "d1", panelId: "p1", fromMs: 1_800_000_000_000, toMs: 1_800_000_600_000, values: {}, connectionId: "c1" };

beforeEach(() => {
  runs.length = 0;
  failOn = null;
  user = { id: "u1", isActive: true, roles: ["team-a"], permissions: ["dashboards:view", "query:execute"] };
  detail = { dashboard: { id: "d1", title: "Orders", ownerId: "u1", variables: [], connectionScope: { kind: "any" } }, panels: [PANEL], shares: [] };
});

describe("gatherEvidence", () => {
  it("runs the panel now and a week earlier, plus the slow queries, mutations and merges, for the range", async () => {
    const evidence = await gatherEvidence(REQUEST, "u1");
    expect(runs.map((r) => [r.from, r.to])).toEqual([
      [1_800_000_000, 1_800_000_600],
      [1_800_000_000 - 604_800, 1_800_000_600 - 604_800],
      [1_800_000_000, 1_800_000_600],
      [1_800_000_000, 1_800_000_600],
      [1_800_000_000, 1_800_000_600],
    ]);
    expect(runs[2].sql).toContain("system.query_log");
    expect(runs[2].sql).toContain("'dashboards'");
    expect(evidence.panel).toEqual({ title: "Latency", sql: "SELECT t, v FROM x", chart: "line", unit: "ms", x: "t", y: ["v"] });
    expect(evidence.changes).toEqual([{ id: "e1", source: "ddl", at: "2027-01-15T08:00:00.000Z", title: "ALTER shop.orders", detail: null, objectRef: "shop.orders" }]);
    expect(evidence.unavailable).toEqual([{ part: "alerts annotations", reason: "Needs alerting:view" }]);
  });

  it("lists a part it may not read as unavailable and carries on", async () => {
    failOn = /system\.mutations/;
    const evidence = await gatherEvidence(REQUEST, "u1");
    expect(evidence.mutations).toBeNull();
    expect(evidence.unavailable[0]).toEqual({ part: "mutations (system.mutations)", reason: "Access denied to system.mutations" });
    expect(evidence.merges).not.toBeNull();
  });

  it("refuses a viewer without access, a text panel, another connection and no query:execute", async () => {
    user = { ...user, roles: ["team-b"] };
    detail = { ...detail, dashboard: { ...(detail as { dashboard: object }).dashboard, ownerId: "someone" } };
    await expect(gatherEvidence(REQUEST, "u1")).rejects.toThrow("Dashboard not found");
    user = { id: "u1", isActive: true, roles: [], permissions: ["dashboards:view"] };
    await expect(gatherEvidence(REQUEST, "u1")).rejects.toThrow("needs query:execute");
    user = { id: "u1", isActive: true, roles: [], permissions: ["dashboards:view", "query:execute"] };
    detail = { dashboard: { id: "d1", title: "Orders", ownerId: "u1", variables: [], connectionScope: { kind: "any" } }, panels: [{ id: "p1", kind: "text" }], shares: [] };
    await expect(gatherEvidence(REQUEST, "u1")).rejects.toThrow("Only chart panels can be explained");
    detail = { dashboard: { id: "d1", title: "Orders", ownerId: "u1", variables: [], connectionScope: { kind: "only", connectionIds: ["c9"] } }, panels: [PANEL], shares: [] };
    await expect(gatherEvidence(REQUEST, "u1")).rejects.toThrow("not assigned to the connection");
    await expect(gatherEvidence(REQUEST, undefined)).rejects.toThrow("signed-in user");
  });
});
