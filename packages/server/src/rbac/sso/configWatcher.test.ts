/**
 * ADR 0010 — the SSO/password-login caches must converge across replicas.
 *
 * These tests stand in for two pods by driving the shared generation counter
 * directly: a "remote" bump (what another replica's admin mutation does) must
 * make this process rebuild, and an unchanged counter must not.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { closeDatabase } from "../db";
import { runMigrations } from "../db/migrations";
import { freshDatabase } from "../db/migrationTestHarness";
import { bumpConfigGeneration, readConfigGeneration } from "../db/configGeneration";
import { getCachedConfigGeneration, refreshSsoConfig, resetSsoConfigCache } from "./config";
import { checkConfigGeneration } from "./configWatcher";

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  resetSsoConfigCache();
});

afterEach(async () => {
  await closeDatabase();
});

describe("config generation counter", () => {
  it("starts seeded at 0 and increases monotonically", async () => {
    expect(await readConfigGeneration()).toBe(0);
    await bumpConfigGeneration();
    expect(await readConfigGeneration()).toBe(1);
    await bumpConfigGeneration();
    expect(await readConfigGeneration()).toBe(2);
  });
});

describe("config generation watcher", () => {
  it("adopts the current generation on refresh", async () => {
    await bumpConfigGeneration();
    await refreshSsoConfig();
    expect(getCachedConfigGeneration()).toBe(1);
  });

  it("rebuilds when another replica bumps the generation", async () => {
    await refreshSsoConfig();
    expect(getCachedConfigGeneration()).toBe(0);

    // Another pod mutates SSO config: the row moves, this process has not noticed.
    await bumpConfigGeneration();

    expect(await checkConfigGeneration()).toBe(true);
    expect(getCachedConfigGeneration()).toBe(1);
  });

  it("does not rebuild when the generation is unchanged", async () => {
    await refreshSsoConfig();
    expect(await checkConfigGeneration()).toBe(false);
    expect(await checkConfigGeneration()).toBe(false);
  });

  it("rebuilds a never-refreshed replica on first check", async () => {
    // cachedGeneration is -1 before any refresh, which must never compare equal
    // to a real generation — otherwise a cold pod would skip its first build.
    expect(getCachedConfigGeneration()).toBe(-1);
    expect(await checkConfigGeneration()).toBe(true);
    expect(getCachedConfigGeneration()).toBe(0);
  });
});
