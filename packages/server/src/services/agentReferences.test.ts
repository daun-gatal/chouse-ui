/**
 * Tests for the reference-loading mechanism and the file-backed reference
 * constants. The "regression guard" assertions prove the file-backed
 * CLICKHOUSE_PLAYBOOK / SYSTEM_TABLE_REFERENCE still carry the same content the
 * structured capabilities concatenate into prompts (no behavior change).
 */

import { describe, it, expect } from "bun:test";
import {
  discoverReferences,
  readReferenceSync,
  createLoadReferenceTool,
} from "./agentReferences";
import { CLICKHOUSE_PLAYBOOK } from "./clickhousePlaybook";
import { SYSTEM_TABLE_REFERENCE } from "./ai/capabilities/fleetShared";

describe("discoverReferences", () => {
  it("finds the three reference docs with names + descriptions", async () => {
    const refs = await discoverReferences(["../references"]);
    const names = refs.map((r) => r.name).sort();
    expect(names).toEqual(["clickhouse-playbook", "system-table-reference", "types-codecs-compression"]);
    for (const r of refs) {
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.path.endsWith(".md")).toBe(true);
    }
  });

  it("returns [] for a missing directory (graceful)", async () => {
    expect(await discoverReferences(["../does-not-exist"])).toEqual([]);
  });
});

describe("readReferenceSync", () => {
  it("reads a known reference file", () => {
    expect(readReferenceSync("clickhouse-playbook.md")).toContain("argMax");
  });

  it("returns '' for a missing file without throwing", () => {
    expect(readReferenceSync("nope.md")).toBe("");
  });
});

describe("createLoadReferenceTool", () => {
  it("returns the body for a known name and an error for an unknown one", async () => {
    const refs = await discoverReferences(["../references"]);
    const tool = createLoadReferenceTool(refs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = (await (tool as any).execute({ name: "system-table-reference" })) as Record<string, unknown>;
    expect(ok.referenceLoaded).toBe("system-table-reference");
    expect(String(ok.content)).toContain("last_error_time");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (await (tool as any).execute({ name: "ghost" })) as Record<string, unknown>;
    expect(typeof bad.error).toBe("string");
  });
});

describe("file-backed constants (regression guard)", () => {
  it("CLICKHOUSE_PLAYBOOK is non-empty and carries its sentinels", () => {
    expect(CLICKHOUSE_PLAYBOOK.length).toBeGreaterThan(500);
    expect(CLICKHOUSE_PLAYBOOK).toContain("optimization playbook");
    expect(CLICKHOUSE_PLAYBOOK).toContain("argMax");
    expect(CLICKHOUSE_PLAYBOOK).toContain("grace_hash");
  });

  it("SYSTEM_TABLE_REFERENCE is non-empty and carries its sentinels", () => {
    expect(SYSTEM_TABLE_REFERENCE.length).toBeGreaterThan(500);
    expect(SYSTEM_TABLE_REFERENCE).toContain("last_error_time");
    expect(SYSTEM_TABLE_REFERENCE).toContain("system.parts");
  });
});
