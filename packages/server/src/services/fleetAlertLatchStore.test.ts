/**
 * ADR 0010 — breach latches must survive the poller lease moving between
 * replicas, otherwise every rollout re-fires every standing breach.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase } from "../rbac/db/migrationTestHarness";
import {
  getLastAutoRcaAt,
  loadLatches,
  persistLatches,
  setLastAutoRcaAt,
} from "./fleetAlertLatchStore";

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
});

afterEach(async () => {
  await closeDatabase();
});

describe("fleet alert latches", () => {
  it("starts empty", async () => {
    expect((await loadLatches()).size).toBe(0);
  });

  it("round-trips armed and disarmed latches", async () => {
    await persistLatches(new Map([["r1:c1:mem", true], ["r1:c1:cpu", false]]), new Set());
    const latches = await loadLatches();
    expect(latches.get("r1:c1:mem")).toBe(true);
    expect(latches.get("r1:c1:cpu")).toBe(false);
  });

  it("a replica taking over the lease sees the previous holder's latches", async () => {
    // Pod A fires and latches.
    await persistLatches(new Map([["r1:c1:mem", true]]), new Set());
    // Pod B takes the lease and starts its first tick with no memory of its own.
    const asSeenByNextHolder = await loadLatches();
    // Still armed ⇒ the alerter will not re-fire this breach.
    expect(asSeenByNextHolder.get("r1:c1:mem")).toBe(true);
  });

  it("updates an existing latch rather than duplicating it", async () => {
    await persistLatches(new Map([["r1:c1:mem", true]]), new Set());
    await persistLatches(new Map([["r1:c1:mem", false]]), new Set());
    const latches = await loadLatches();
    expect(latches.size).toBe(1);
    expect(latches.get("r1:c1:mem")).toBe(false);
  });

  it("removes latches for queries that are gone", async () => {
    await persistLatches(new Map([["r1:c1:longq:qid", true]]), new Set());
    await persistLatches(new Map(), new Set(["r1:c1:longq:qid"]));
    expect((await loadLatches()).size).toBe(0);
  });

  it("drops latches older than the retention window", async () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await persistLatches(new Map([["stale", true]]), new Set(), old);
    expect((await loadLatches()).size).toBe(0);
  });
});

describe("auto-RCA cooldown", () => {
  it("is seeded at 0 so the first breach can trigger a scan", async () => {
    expect(await getLastAutoRcaAt()).toBe(0);
  });

  it("persists across replicas so a breach storm cannot spawn a scan storm", async () => {
    const at = Date.now();
    await setLastAutoRcaAt(at);
    expect(await getLastAutoRcaAt()).toBe(at);
  });
});
