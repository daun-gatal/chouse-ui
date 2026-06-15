/**
 * DoctorScheduler persistence + per-slot claim tests (SQLite in-memory).
 *
 * Covers the DB-backed schedule (replacing the old local JSON file) and the
 * atomic slot claim that makes scheduled scans safe under multiple replicas:
 * for one slot, exactly one holder wins claimScheduledSlot(); the rest stand by.
 */
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase } from "../rbac/db/migrationTestHarness";
import {
  loadSchedule,
  saveSchedule,
  claimScheduledSlot,
  type DoctorSchedule,
} from "./doctorScheduler";

async function setupDb(): Promise<void> {
  delete process.env.DOCTOR_SCHEDULE_FILE;
  await freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
}

afterAll(async () => {
  await closeDatabase();
});

describe("doctorScheduler persistence", () => {
  beforeEach(async () => {
    await setupDb();
  });

  it("returns defaults from the migration-seeded row (disabled, no backfill)", async () => {
    const cfg = await loadSchedule();
    expect(cfg.enabled).toBe(false);
    expect(cfg.frequency).toBe("daily");
    expect(cfg.lastRunAt).toBe(0);
  });

  it("round-trips a saved schedule, splitting lastRunAt into its own column", async () => {
    const next: DoctorSchedule = {
      enabled: true,
      frequency: "weekly",
      hour: 9,
      dayOfWeek: 3,
      dayOfMonth: 1,
      modelId: "cfg-123",
      hours: 12,
      connectionIds: ["a", "b"],
      deliver: false,
      lastRunAt: 1_700_000_000_000,
    };
    await saveSchedule(next);

    const loaded = await loadSchedule();
    expect(loaded.enabled).toBe(true);
    expect(loaded.frequency).toBe("weekly");
    expect(loaded.hour).toBe(9);
    expect(loaded.dayOfWeek).toBe(3);
    expect(loaded.modelId).toBe("cfg-123");
    expect(loaded.hours).toBe(12);
    expect(loaded.connectionIds).toEqual(["a", "b"]);
    expect(loaded.deliver).toBe(false);
    expect(loaded.lastRunAt).toBe(1_700_000_000_000);
  });

  it("clamps out-of-range values on load", async () => {
    await saveSchedule({
      enabled: true,
      frequency: "daily",
      hour: 99,
      dayOfWeek: 9,
      dayOfMonth: 99,
      hours: 9999,
      deliver: true,
      lastRunAt: 0,
    } as DoctorSchedule);
    const loaded = await loadSchedule();
    expect(loaded.hour).toBe(23); // clamped to max
    expect(loaded.dayOfWeek).toBe(6); // clamped to max
    expect(loaded.dayOfMonth).toBe(28); // clamped to max
    expect(loaded.hours).toBe(72); // clamped to max
  });
});

describe("doctorScheduler per-slot claim (multi-instance dedup)", () => {
  beforeEach(async () => {
    await setupDb();
  });

  it("lets exactly one holder win a slot; others stand by", async () => {
    const fireAt = 1_000_000;
    const now = 1_000_500;

    // Two replicas contend for the same slot back-to-back (writes are
    // serialized, so this models the race deterministically).
    const first = await claimScheduledSlot("pod-A", fireAt, now);
    const second = await claimScheduledSlot("pod-B", fireAt, now + 1);

    expect(first).toBe(true);
    expect(second).toBe(false);

    // The winner's stamp is what persisted.
    const loaded = await loadSchedule();
    expect(loaded.lastRunAt).toBe(now);
  });

  it("does not re-fire a slot already claimed in a previous tick", async () => {
    const fireAt = 2_000_000;
    expect(await claimScheduledSlot("pod-A", fireAt, 2_000_100)).toBe(true);
    // Same slot, later tick — already stamped at/after fireAt, so no win.
    expect(await claimScheduledSlot("pod-A", fireAt, 2_000_200)).toBe(false);
  });

  it("allows the next slot to be claimed once fireAt advances", async () => {
    expect(await claimScheduledSlot("pod-A", 3_000_000, 3_000_100)).toBe(true);
    // A later slot (fireAt past the stored lastRunAt) is claimable again.
    expect(await claimScheduledSlot("pod-A", 4_000_000, 4_000_100)).toBe(true);
  });
});

describe("doctorScheduler legacy-file import (migration 1.37.0)", () => {
  let dir = "";

  afterAll(() => {
    delete process.env.DOCTOR_SCHEDULE_FILE;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imports an existing doctor-schedule.json (config + lastRunAt) on first migration", async () => {
    dir = mkdtempSync(join(tmpdir(), "doctor-sched-"));
    const file = join(dir, "doctor-schedule.json");
    writeFileSync(
      file,
      JSON.stringify({
        enabled: true,
        frequency: "weekly",
        hour: 7,
        dayOfWeek: 2,
        hours: 24,
        deliver: false,
        lastRunAt: 1_650_000_000_000,
      }),
    );
    process.env.DOCTOR_SCHEDULE_FILE = file;

    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });

    const loaded = await loadSchedule();
    expect(loaded.enabled).toBe(true);
    expect(loaded.frequency).toBe("weekly");
    expect(loaded.hour).toBe(7);
    expect(loaded.dayOfWeek).toBe(2);
    expect(loaded.hours).toBe(24);
    expect(loaded.deliver).toBe(false);
    // lastRunAt is split out of the blob into its own column and preserved.
    expect(loaded.lastRunAt).toBe(1_650_000_000_000);
  });
});
