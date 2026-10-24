/**
 * Chobi's briefing (ADR 0025 §6): built only from routes the viewer could
 * call, grouped by connection, with nothing shown for connections the viewer
 * does not list.
 */

import { describe, expect, it } from "bun:test";

import { PERMISSIONS } from "../../rbac/schema/base";
import type { ActionApi } from "../ai/actions/types";
import { buildBriefing } from "./briefing";

const NOW = 1_800_000_000_000;

type Routes = Record<string, unknown | Error>;

function fakeApi(routes: Routes, calls: string[] = []): ActionApi {
  const respond = async <T>(path: string): Promise<T> => {
    calls.push(path);
    const value = routes[path];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`unexpected ${path}`);
    return value as T;
  };
  return {
    get: (path) => respond(path),
    post: (path) => respond(path),
    put: (path) => respond(path),
    patch: (path) => respond(path),
    delete: (path) => respond(path),
  };
}

const base: Routes = {
  "/api/rbac/connections/my": [
    { id: "prod", name: "Production", metadata: { environment: "production" } },
    { id: "dev", name: "Dev", metadata: null },
  ],
  "/api/observe/incidents": {
    incidents: [
      { source: "data_health", id: "i1", connectionId: "prod", title: "orders is late", status: "open", severity: "critical", openedAt: NOW - 60_000, lastEventAt: NOW - 30_000, subject: "shop.orders", rootCause: { summary: "upstream job failed" } },
      { source: "observe", id: "i2", connectionId: "other", title: "not listed", status: "open", severity: "high", openedAt: NOW, lastEventAt: NOW, subject: null, rootCause: null },
    ],
  },
  "/api/scheduled-queries": {
    jobs: [
      { id: "j1", name: "rollup", kind: "sql_query", connectionId: "dev", enabled: true, lastRun: { status: "failed", error: "Code: 60", startedAt: NOW - 120_000, finishedAt: NOW - 100_000 } },
      { id: "j2", name: "check", kind: "data_health_check", connectionId: "dev", enabled: true, lastRun: { status: "failed", error: "x" } },
      { id: "j3", name: "paused", kind: "sql_query", connectionId: "dev", enabled: false, lastRun: { status: "failed" } },
      { id: "j4", name: "fine", kind: "sql_query", connectionId: "dev", enabled: true, lastRun: { status: "success" } },
    ],
  },
  "/api/fleet/snapshots": {
    workerEnabled: true,
    connections: [
      { connectionId: "prod", capturedAt: (NOW - 30_000) / 1000, metrics: { summary: { error: null } } },
      { connectionId: "dev", capturedAt: (NOW - 30_000) / 1000, metrics: { summary: { error: "Connection refused" } } },
    ],
  },
  "/api/ai-actions/inbox": {
    actions: [
      { id: "a1", title: "Run a scheduled job now", description: "run", status: "pending", tier: "t2", source: "held", origin: "mcp", connectionId: "dev", createdAt: NOW - 5_000, decidedAt: null, undoAvailable: false, canDecide: true, expiresAt: NOW + 60_000 },
      { id: "a2", title: "Drop a table", description: "drop", status: "pending", tier: "t3", source: "background", origin: "chat", connectionId: "prod", createdAt: NOW - 5_000, decidedAt: null, undoAvailable: false, canDecide: false, expiresAt: NOW + 60_000 },
    ],
  },
  "/api/ai-actions/activity": {
    actions: [
      { id: "b1", title: "Save a query", description: "save", status: "executed", tier: "t1", source: "chat", origin: "chat", connectionId: "dev", createdAt: NOW - 1_000, decidedAt: NOW - 1_000, undoAvailable: true, canDecide: false, expiresAt: NOW },
      { id: "b2", title: "Save a query", description: "save", status: "executed", tier: "t1", source: "chat", origin: "chat", connectionId: "dev", createdAt: NOW - 2 * 86_400_000, decidedAt: NOW - 2 * 86_400_000, undoAvailable: false, canDecide: false, expiresAt: NOW },
      { id: "b3", title: "Kill a query", description: "kill", status: "rejected", tier: "t2", source: "chat", origin: "chat", connectionId: "dev", createdAt: NOW - 1_000, decidedAt: NOW - 1_000, undoAvailable: false, canDecide: false, expiresAt: NOW },
    ],
  },
};

const everything = { id: "u1", permissions: [PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.SCHEDULED_QUERIES_VIEW], superAdmin: false };

describe("buildBriefing", () => {
  it("groups what needs a look by connection, worst first", async () => {
    const briefing = await buildBriefing(fakeApi(base), everything, NOW);

    expect(briefing.connections.map((c) => [c.id, c.status, c.production])).toEqual([
      ["prod", "attention", true],
      ["dev", "unreachable", false],
    ]);
    expect(briefing.connections[0].items).toEqual([
      expect.objectContaining({ key: "incident:data_health:i1", kind: "incident", severity: "bad", detail: "upstream job failed", ref: { type: "incident", source: "data_health", id: "i1" } }),
    ]);
    // Unreachable first, then the failing job; Data Health checks and paused jobs are not repeated.
    expect(briefing.connections[1].items.map((i) => [i.kind, i.severity, i.title])).toEqual([
      ["connection", "bad", "Cannot reach the cluster"],
      ["schedule", "warn", "rollup failed"],
    ]);
  });

  it("never shows items for a connection the viewer does not list", async () => {
    const briefing = await buildBriefing(fakeApi(base), everything, NOW);
    const keys = briefing.connections.flatMap((c) => c.items.map((i) => i.key));
    expect(keys).not.toContain("incident:observe:i2");
    expect(briefing.general.map((i) => i.connectionId)).toEqual([null]);
  });

  it("counts only the approvals the viewer can answer, and today's AI changes", async () => {
    const briefing = await buildBriefing(fakeApi(base), everything, NOW);
    expect(briefing.general).toEqual([
      expect.objectContaining({ kind: "approval", title: "1 change waiting for your answer", detail: "1 agent paused until you confirm.", ref: { type: "action", id: "a1" } }),
    ]);
    expect(briefing.ai).toEqual({ changedToday: 1, undoable: 1 });
  });

  it("skips what the viewer may not see, and says so", async () => {
    const calls: string[] = [];
    const briefing = await buildBriefing(fakeApi(base, calls), { id: "u1", permissions: [], superAdmin: false }, NOW);
    expect(calls).not.toContain("/api/observe/incidents");
    expect(calls).not.toContain("/api/scheduled-queries");
    expect(briefing.unavailable).toEqual(["incidents (needs observe:view or data_health:view)", "scheduled queries (needs scheduled_queries:view)"]);
    expect(briefing.connections.find((c) => c.id === "prod")?.items).toEqual([]);
  });

  it("keeps going when a source fails", async () => {
    const briefing = await buildBriefing(fakeApi({ ...base, "/api/observe/incidents": new Error("boom"), "/api/fleet/snapshots": new Error("down") }), everything, NOW);
    expect(briefing.unavailable).toEqual(["incidents", "fleet health"]);
    expect(briefing.connections.find((c) => c.id === "dev")?.items.map((i) => i.kind)).toEqual(["schedule"]);
  });

  it("notes stale fleet data without calling the cluster down", async () => {
    const stale = { ...base, "/api/fleet/snapshots": { workerEnabled: true, connections: [{ connectionId: "prod", capturedAt: (NOW - 3_600_000) / 1000, metrics: { summary: { error: null } } }] } };
    const briefing = await buildBriefing(fakeApi(stale), everything, NOW);
    expect(briefing.connections[0].status).toBe("attention");
    expect(briefing.connections[0].items.at(-1)).toMatchObject({ kind: "connection", severity: "info", title: "No fresh fleet data", detail: "Last snapshot 60 minutes ago.", at: NOW - 3_600_000 });
  });

  it("lists the viewer's own watches that are still running, quietly", async () => {
    const withWatches = {
      ...base,
      "/api/data-health": {
        promises: [
          { id: "w1", name: "Watch: shop.orders", connectionId: "prod", databaseName: "shop", tableName: "orders", ownerId: "u1", status: "healthy", expiresAt: NOW + 3_600_000 },
          { id: "w2", name: "Watch: shop.old", connectionId: "prod", databaseName: "shop", tableName: "old", ownerId: "u1", status: "healthy", expiresAt: NOW - 1 },
          { id: "w3", name: "Bob's watch", connectionId: "prod", databaseName: "shop", tableName: "x", ownerId: "bob", status: "healthy", expiresAt: NOW + 3_600_000 },
          { id: "p1", name: "orders promise", connectionId: "prod", databaseName: "shop", tableName: "orders", ownerId: "u1", status: "healthy", expiresAt: null },
        ],
      },
    };
    const briefing = await buildBriefing(fakeApi(withWatches), { ...everything, permissions: [...everything.permissions, PERMISSIONS.DATA_HEALTH_VIEW] }, NOW);
    const watches = briefing.connections.flatMap((c) => c.items).filter((i) => i.kind === "watch");
    expect(watches).toEqual([
      expect.objectContaining({ key: "watch:w1", severity: "info", title: "Watching shop.orders", detail: "Healthy so far", at: NOW + 3_600_000, ref: { type: "promise", id: "w1" } }),
    ]);
  });

  it("ignores fleet snapshots while the fleet poller is off", async () => {
    const off = { ...base, "/api/fleet/snapshots": { workerEnabled: false, connections: [{ connectionId: "dev", capturedAt: 1, metrics: { summary: { error: "old error" } } }] } };
    const briefing = await buildBriefing(fakeApi(off), everything, NOW);
    expect(briefing.connections.find((c) => c.id === "dev")?.status).toBe("attention");
    expect(briefing.connections.flatMap((c) => c.items).some((i) => i.kind === "connection")).toBe(false);
    expect(briefing.unavailable).toContain("fleet health (the fleet poller is off)");
  });
});
