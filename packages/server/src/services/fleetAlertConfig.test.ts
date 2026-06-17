/**
 * fleetAlertConfig adapter-shim tests (SQLite in-memory).
 *
 * fleetAlertConfig is now an adapter over the normalized alerting tables
 * (notification_channels / alert_rules / alert_rule_channels). These tests cover
 * the load/save round-trip through that shim, encryption of channel secrets at
 * rest, and the legacy-file → blob → normalized import path (migrations 1.36.0
 * then 1.39.0).
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
import { getChannel } from "./alerting/store";
import { decryptSecret } from "../rbac/services/connections";

afterAll(async () => {
  await closeDatabase();
});

describe("fleetAlertConfig persistence (normalized)", () => {
  beforeEach(async () => {
    delete process.env.ALERT_CONFIG_FILE;
    await freshDatabase("sqlite");
    await runMigrations({ skipSeed: true });
  });

  it("starts empty when no fleet rule exists", async () => {
    expect(await loadRawAlertConfig()).toEqual({});
  });

  it("round-trips the meaningful config fields and channel flags", async () => {
    const cfg: RawAlertConfig = {
      enabled: true,
      aiRcaOnBreach: true,
      aiRcaModelId: "cfg-9",
      rules: { memoryPercent: 90, queryMemoryGb: 20, longQueryMin: 5, partsEtaMin: 30 },
      slack: { webhookUrl: "https://hooks.slack.com/services/X", enabled: false },
      email: { user: "ops@x.com", password: "secret", to: "team@x.com", enabled: true },
    };
    await saveRawAlertConfig(cfg);

    const loaded = await loadRawAlertConfig();
    expect(loaded.enabled).toBe(true);
    expect(loaded.aiRcaOnBreach).toBe(true);
    expect(loaded.aiRcaModelId).toBe("cfg-9");
    expect(loaded.rules).toEqual({ memoryPercent: 90, queryMemoryGb: 20, longQueryMin: 5, partsEtaMin: 30 });
    expect(loaded.slack).toEqual({ webhookUrl: "https://hooks.slack.com/services/X", enabled: false });
    expect(loaded.email?.user).toBe("ops@x.com");
    expect(loaded.email?.password).toBe("secret");
    expect(loaded.email?.to).toBe("team@x.com");
    expect(loaded.email?.enabled).toBe(true);
  });

  it("encrypts channel secrets at rest", async () => {
    await saveRawAlertConfig({
      enabled: true,
      rules: { memoryPercent: 80 },
      slack: { webhookUrl: "https://hooks.slack.com/services/SECRET", enabled: true },
    });

    const channel = await getChannel("fleet-slack");
    expect(channel).not.toBeNull();
    const stored = JSON.parse(channel!.config) as { webhookUrl: string };
    // The stored value is ciphertext, not the plaintext webhook URL.
    expect(stored.webhookUrl).not.toBe("https://hooks.slack.com/services/SECRET");
    expect(decryptSecret(stored.webhookUrl)).toBe("https://hooks.slack.com/services/SECRET");
  });

  it("overwrites on subsequent saves and removes dropped channels", async () => {
    await saveRawAlertConfig({
      enabled: true,
      rules: { memoryPercent: 50 },
      slack: { webhookUrl: "https://hooks.slack.com/services/A", enabled: true },
    });
    await saveRawAlertConfig({ enabled: false, rules: { memoryPercent: 99 } });

    const loaded = await loadRawAlertConfig();
    expect(loaded.enabled).toBe(false);
    expect(loaded.rules?.memoryPercent).toBe(99);
    expect(loaded.slack).toBeUndefined();
    expect(await getChannel("fleet-slack")).toBeNull();
  });

  it("keeps an existing channel secret when the save omits it (blank = keep)", async () => {
    await saveRawAlertConfig({
      enabled: true,
      rules: { memoryPercent: 70 },
      email: { user: "ops@x.com", password: "smtp-secret", to: "team@x.com", enabled: true },
    });
    // Re-save with a blank password (mirrors the UI sending no new secret).
    await saveRawAlertConfig({
      enabled: true,
      rules: { memoryPercent: 70 },
      email: { user: "ops@x.com", password: "", to: "team@x.com", enabled: true },
    });
    const loaded = await loadRawAlertConfig();
    expect(loaded.email?.password).toBe("smtp-secret");
  });
});

describe("fleetAlertConfig legacy import (migrations 1.36.0 → 1.39.0)", () => {
  let dir = "";

  afterAll(() => {
    delete process.env.ALERT_CONFIG_FILE;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imports an existing alert-config.json all the way into the normalized tables", async () => {
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

    const loaded = await loadRawAlertConfig();
    expect(loaded.enabled).toBe(true);
    expect(loaded.rules?.memoryPercent).toBe(85);
    expect(loaded.slack?.webhookUrl).toBe("https://hooks.slack.com/services/LEGACY");
    expect(loaded.slack?.enabled).toBe(true);
  });
});
