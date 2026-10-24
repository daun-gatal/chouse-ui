import { describe, expect, it } from "bun:test";

import { healthPromiseBody, isNotFound, RESOURCES, scheduledJobBody, stableJson, tableContextId } from "./resources";
import { bumpTier, environmentOf, highestTier } from "./tiers";
import type { ActionApi } from "./types";

describe("tiers (ADR 0025)", () => {
  it("bumps one step, never past T3", () => {
    expect(bumpTier("t1")).toBe("t2");
    expect(bumpTier("t2")).toBe("t3");
    expect(bumpTier("t3")).toBe("t3");
  });

  it("finds the highest tier of a plan", () => {
    expect(highestTier(["t1", "t3", "t2"])).toBe("t3");
    expect(highestTier([])).toBeNull();
  });

  it("reads only known environments from connection metadata", () => {
    expect(environmentOf({ environment: "production" })).toBe("production");
    expect(environmentOf({ environment: "prod" })).toBeNull();
    expect(environmentOf(null)).toBeNull();
    expect(environmentOf({})).toBeNull();
  });
});

describe("undo adapters", () => {
  it("print the same object the same way whatever the key order", () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(stableJson({ a: [{ c: null, d: 2 }], b: 1 }));
    expect(stableJson({ a: undefined })).toBe("{}");
  });

  it("rebuild a scheduled query edit body from a job, without volatile fields", () => {
    const body = scheduledJobBody({ id: "j1", name: "x", connectionId: "c", query: "SELECT 1", enabled: false, frequency: "daily", hour: 6, description: null, lastRun: { id: "r" }, channelIds: undefined, cronExpr: null, nextRunAt: 5 });
    expect(body).toMatchObject({ name: "x", connectionId: "c", query: "SELECT 1", enabled: false, frequency: "daily", hour: 6, description: null, cronExpr: null, channelIds: [] });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("lastRun");
    expect(body).not.toHaveProperty("nextRunAt");
  });

  it("rebuild a Data Health edit body from a promise", () => {
    const body = healthPromiseBody({
      name: "orders fresh", connectionId: "c", sourceType: "table", databaseName: "sales", tableName: "orders", eventTimeColumn: "ts",
      eventTimeType: null, eventTimeEncoding: "native", rowFilter: null, ownerId: "u1", criticality: "important", enabled: true, upstreamJobId: null,
      graceSecs: 0, breachAfter: 2, recoverAfter: 2, retentionDays: 90, channelIds: ["ch"], checks: [{ checkKey: "f", type: "freshness" }],
      schedule: { frequency: "hourly", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timeoutSecs: 60 }, status: "healthy",
    });
    expect(body.source).toEqual({ sourceType: "table", databaseName: "sales", tableName: "orders", eventTimeColumn: "ts", eventTimeEncoding: "native", rowFilter: null });
    expect(body).toMatchObject({ frequency: "hourly", criticality: "important", channelIds: ["ch"], runNow: false, timezone: "UTC" });
    expect(body).not.toHaveProperty("status");
  });

  it("encode table context ids so names with dots stay unambiguous", () => {
    expect(tableContextId("a.b", "c")).not.toBe(tableContextId("a", "b.c"));
  });

  it("treat a 404 as gone and anything else as an error", async () => {
    const failing = (status: number): ActionApi => ({
      get: async () => { throw Object.assign(new Error("x"), { status }); },
      post: async () => undefined as never,
      put: async () => undefined as never,
      patch: async () => undefined as never,
      delete: async () => undefined as never,
    });
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound(new Error("x"))).toBe(false);
    expect(await RESOURCES.saved_query.read(failing(404), "x")).toBeNull();
    await expect(RESOURCES.saved_query.read(failing(403), "x")).rejects.toThrow();
  });

  it("restore a table context from its snapshot through PUT", async () => {
    const puts: Array<[string, unknown]> = [];
    const api: ActionApi = {
      get: async <T>() => ({ curated: { description: "now", tags: ["x"] } }) as T,
      post: async () => undefined as never,
      put: async <T>(path: string, body: unknown) => { puts.push([path, body]); return undefined as T; },
      patch: async () => undefined as never,
      delete: async () => undefined as never,
    };
    const id = tableContextId("sales", "orders");
    const current = await RESOURCES.table_context.read(api, id);
    expect(current).toMatchObject({ description: "now", tags: ["x"], deprecated: false });
    await RESOURCES.table_context.restore?.(api, id, { description: "before", tags: [] }, current ?? {});
    expect(puts).toEqual([["/api/context/tables/sales/orders", { description: "before", grain: null, owner: null, insteadOf: null, deprecated: false, tags: [] }]]);
  });
});
