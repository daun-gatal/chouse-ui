import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { closeDatabase } from "../../db";
import { runMigrations } from "../../db/migrations";
import { freshDatabase } from "../../db/migrationTestHarness";
import { stashTokens, claimTokens, markAssertionSeen } from "./handoff";

const payload = { user: { id: "u1" } as never, tokens: { accessToken: "a" } as never, redirect: "/dash" };

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
});

afterEach(async () => {
  await closeDatabase();
});

describe("token handoff", () => {
  it("returns the payload exactly once, then null (single-use)", async () => {
    const code = await stashTokens(payload, 60_000, new Date(0));
    expect((await claimTokens(code, new Date(1_000)))?.redirect).toBe("/dash");
    expect(await claimTokens(code, new Date(2_000))).toBeNull();
  });
  it("expires after TTL", async () => {
    const code = await stashTokens(payload, 60_000, new Date(0));
    expect(await claimTokens(code, new Date(61_000))).toBeNull();
  });
  it("returns null for an unknown code", async () => {
    expect(await claimTokens("nope", new Date(0))).toBeNull();
  });
  it("survives being claimed by a different process than stashed it", async () => {
    // The shared table is the whole point: ACS runs on one replica, the SPA's
    // exchange on another. Nothing in this module holds per-process state, so a
    // fresh import resolves a code stashed earlier.
    const code = await stashTokens(payload, 60_000, new Date(0));
    const { claimTokens: claimFromElsewhere } = await import("./handoff");
    expect((await claimFromElsewhere(code, new Date(1_000)))?.redirect).toBe("/dash");
  });
  it("only one of several concurrent claims wins", async () => {
    const code = await stashTokens(payload, 60_000, new Date(0));
    const results = await Promise.all([
      claimTokens(code, new Date(1_000)),
      claimTokens(code, new Date(1_000)),
      claimTokens(code, new Date(1_000)),
    ]);
    expect(results.filter((r) => r !== null).length).toBe(1);
  });
  it("does not store the payload in plaintext", async () => {
    const code = await stashTokens(
      { ...payload, tokens: { accessToken: "super-secret-token" } as never },
      60_000,
      new Date(0),
    );
    const { rawAll } = await import("../../db/raw");
    const { sql } = await import("drizzle-orm");
    const rows = await rawAll(sql`SELECT payload FROM rbac_saml_handoff_codes WHERE code = ${code}`);
    expect(String(rows[0].payload)).not.toContain("super-secret-token");
  });
});

describe("replay cache", () => {
  it("accepts an assertion id once, rejects the second time", async () => {
    expect(await markAssertionSeen("_a1", new Date(60_000), new Date(0))).toBe(true);
    expect(await markAssertionSeen("_a1", new Date(60_000), new Date(1_000))).toBe(false);
  });
  it("forgets ids past their notOnOrAfter (sweep)", async () => {
    expect(await markAssertionSeen("_a2", new Date(1_000), new Date(0))).toBe(true);
    // after _a2 expired, a later assertion with a fresh id triggers sweep; _a2 can be reused
    expect(await markAssertionSeen("_a3", new Date(120_000), new Date(2_000))).toBe(true);
    expect(await markAssertionSeen("_a2", new Date(180_000), new Date(2_000))).toBe(true);
  });
  it("rejects a replay presented against a second replica", async () => {
    expect(await markAssertionSeen("_shared", new Date(60_000), new Date(0))).toBe(true);
    // A different pod re-importing the module shares the table, so the replay
    // is caught — this is the case the in-memory Map silently allowed.
    const { markAssertionSeen: markOnOtherPod } = await import("./handoff");
    expect(await markOnOtherPod("_shared", new Date(60_000), new Date(1_000))).toBe(false);
  });
});
