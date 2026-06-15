/**
 * fleetAlertConfig persistence tests (SQLite in-memory).
 *
 * Covers the DB-backed alert config (replacing alert-config.json) and the
 * one-time backward-compat import of an existing on-disk file by migration
 * 1.36.0.
 */
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase } from "../rbac/db/migrationTestHarness";
import {
  loadRawAlertConfig,
  saveRawAlertConfig,
  type RawAlertConfig,
} from "./fleetAlertConfig";

afterAll(async () => {
  await closeDatabase();
});

describe("fleetAlertConfig persistence", () => {
  beforeEach(async () => {
    delete process.env.ALERT_CONFIG_FILE;
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
  });

  it("starts empty when no legacy file exists", async () => {
    expect(await loadRawAlertConfig()).toEqual({});
  });

  it("round-trips a saved config including secrets and channel flags", async () => {
    const cfg: RawAlertConfig = {
      enabled: true,
      aiRcaOnBreach: true,
      aiRcaModelId: "cfg-9",
      rules: { memoryPercent: 90, queryMemoryGb: 20, longQueryMin: 5, partsEtaMin: 30 },
      slack: { webhookUrl: "https://hooks.slack.com/services/X", enabled: false },
      email: { user: "ops@x.com", password: "secret", to: "team@x.com", enabled: true },
    };
    await saveRawAlertConfig(cfg);
    expect(await loadRawAlertConfig()).toEqual(cfg);
  });

  it("overwrites on subsequent saves (single source of truth)", async () => {
    await saveRawAlertConfig({ enabled: true, rules: { memoryPercent: 50 } });
    await saveRawAlertConfig({ enabled: false, rules: { memoryPercent: 99 } });
    const loaded = await loadRawAlertConfig();
    expect(loaded.enabled).toBe(false);
    expect(loaded.rules?.memoryPercent).toBe(99);
  });
});

describe("fleetAlertConfig legacy-file import (migration 1.36.0)", () => {
  let dir = "";

  afterAll(() => {
    delete process.env.ALERT_CONFIG_FILE;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imports an existing alert-config.json into the DB on first migration", async () => {
    dir = mkdtempSync(join(tmpdir(), "alert-cfg-"));
    const file = join(dir, "alert-config.json");
    const legacy: RawAlertConfig = {
      enabled: true,
      rules: { memoryPercent: 85 },
      slack: { webhookUrl: "https://hooks.slack.com/services/LEGACY", enabled: true },
    };
    writeFileSync(file, JSON.stringify(legacy));
    process.env.ALERT_CONFIG_FILE = file;

    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });

    expect(await loadRawAlertConfig()).toEqual(legacy);
  });
});
