/**
 * Tests for observed-runtime lineage graph assembly. Exercises the read/write
 * split (write target from job config, reads from query_log), cross-job chaining,
 * system-table filtering, column attribution, and connected-component scoping.
 */

import { describe, it, expect } from "bun:test";

import { assembleGraph, clampWindowDays, type JobObservation } from "./lineage";
import type { ScheduledQueryRow } from "./types";

function job(over: Partial<ScheduledQueryRow> & Pick<ScheduledQueryRow, "id" | "name">): ScheduledQueryRow {
  return {
    description: null,
    kind: "sql_query",
    connectionId: "conn-1",
    query: "SELECT 1",
    enabled: true,
    frequency: "daily",
    hour: 8,
    dayOfWeek: 1,
    dayOfMonth: 1,
    cronExpr: null,
    outputMode: "none",
    destDatabase: null,
    destTable: null,
    outputConfig: null,
    maxRows: 100,
    timeoutSecs: 60,
    useFinal: false,
    seqConsistency: false,
    lastRunAt: 0,
    lastRunBy: null,
    maxAttempts: 2,
    retentionDays: 90,
    createdBy: "u1",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function obs(over: Partial<JobObservation> & Pick<JobObservation, "jobId">): JobObservation {
  return { tables: [], columns: [], runCount: 1, lastSeen: 1700000000000, ...over };
}

describe("assembleGraph", () => {
  it("splits the write target from reads and attributes columns", () => {
    const jobA = job({ id: "A", name: "A", outputMode: "append", destDatabase: "db", destTable: "out" });
    const observations = new Map<string, JobObservation>([
      ["A", obs({ jobId: "A", tables: ["db.src", "db.out", "system.numbers"], columns: ["db.src.a", "db.src.b", "db.out.a"] })],
    ]);

    const { nodes, edges } = assembleGraph(jobA, [jobA], observations);

    // system.* table is filtered out; src + out + job remain.
    const tables = nodes.filter((n) => n.kind === "table").map((n) => n.label).sort();
    expect(tables).toEqual(["db.out", "db.src"]);

    const read = edges.find((e) => e.kind === "read");
    expect(read?.from).toBe("table:db.src");
    expect(read?.to).toBe("job:A");
    expect(read?.columns).toEqual(["a", "b"]);

    const write = edges.find((e) => e.kind === "write");
    expect(write?.from).toBe("job:A");
    expect(write?.to).toBe("table:db.out");
    expect(write?.columns).toEqual(["a"]);

    const out = nodes.find((n) => n.id === "table:db.out");
    expect(out?.kind === "table" && out.produced).toBe(true);
  });

  it("chains jobs when one job's destination is another job's source", () => {
    const jobA = job({ id: "A", name: "A", outputMode: "append", destDatabase: "db", destTable: "mid" });
    const jobB = job({ id: "B", name: "B", outputMode: "append", destDatabase: "db", destTable: "final" });
    const observations = new Map<string, JobObservation>([
      ["A", obs({ jobId: "A", tables: ["db.raw", "db.mid"] })],
      ["B", obs({ jobId: "B", tables: ["db.mid", "db.other", "db.final"] })],
    ]);

    const { nodes, edges } = assembleGraph(jobA, [jobA, jobB], observations);

    // Both jobs reachable through the shared db.mid table.
    expect(nodes.filter((n) => n.kind === "job").map((n) => n.id).sort()).toEqual(["job:A", "job:B"]);
    // A writes mid; B reads mid.
    expect(edges.some((e) => e.kind === "write" && e.from === "job:A" && e.to === "table:db.mid")).toBe(true);
    expect(edges.some((e) => e.kind === "read" && e.from === "table:db.mid" && e.to === "job:B")).toBe(true);
  });

  it("returns only the connected component containing the focus job", () => {
    const focus = job({ id: "A", name: "A", outputMode: "append", destDatabase: "db", destTable: "out" });
    const unrelated = job({ id: "Z", name: "Z", outputMode: "append", destDatabase: "db", destTable: "zout" });
    const observations = new Map<string, JobObservation>([
      ["A", obs({ jobId: "A", tables: ["db.src", "db.out"] })],
      ["Z", obs({ jobId: "Z", tables: ["db.zsrc", "db.zout"] })],
    ]);

    const { nodes } = assembleGraph(focus, [focus, unrelated], observations);
    expect(nodes.some((n) => n.id === "job:Z")).toBe(false);
    expect(nodes.some((n) => n.id === "table:db.zsrc")).toBe(false);
    expect(nodes.some((n) => n.id === "job:A")).toBe(true);
  });

  it("returns an empty graph when the focus job has no observations", () => {
    const focus = job({ id: "A", name: "A" });
    const { nodes, edges } = assembleGraph(focus, [focus], new Map());
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("clampWindowDays", () => {
  it("clamps to [1, 90] and defaults non-finite input", () => {
    expect(clampWindowDays(14)).toBe(14);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(500)).toBe(90);
    expect(clampWindowDays(NaN)).toBe(14);
  });
});
