import { describe, expect, it } from "bun:test";

import { buildScheduledQueryEvidence, clearDataOpsAiCache, evidenceFingerprint, getDataOpsAiCache, setDataOpsAiCache } from "./dataOpsEvidence";
import type { ScheduledQueryRow, ScheduledQueryRunRow } from "../scheduledQueries/types";

const job: ScheduledQueryRow = {
  id: "job-1", name: "orders", description: null, kind: "sql_query", connectionId: "conn-1", query: "SELECT 1", enabled: true,
  frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC", outputMode: "none",
  destDatabase: null, destTable: null, outputConfig: null, maxRows: 100, timeoutSecs: 60, useFinal: false, seqConsistency: false,
  lastRunAt: 0, lastRunBy: null, maxAttempts: 2, retentionDays: 90, createdBy: "user-1", createdAt: 1, updatedAt: 2,
};

function run(id: string, status: ScheduledQueryRunRow["status"], durationMs: number): ScheduledQueryRunRow {
  return { id, queryId: job.id, trigger: "scheduled", status, slotAt: 10, attempt: 1, runnerId: null, deadline: null, rowCount: 1, truncated: false, writtenRows: null, resultJson: null, conditionValue: null, conditionMet: null, durationMs, message: status === "error" ? "boom" : null, notified: false, startedAt: 10, finishedAt: 11 };
}

describe("DataOps evidence", () => {
  it("fingerprints objects independently of key insertion order", () => {
    expect(evidenceFingerprint({ a: 1, b: 2 })).toBe(evidenceFingerprint({ b: 2, a: 1 }));
  });

  it("computes success rate, failure streak, and duration change", () => {
    const evidence = buildScheduledQueryEvidence(job, [run("r1", "error", 200), run("r2", "error", 180), run("r3", "success", 160), run("r4", "success", 100)], 1000);
    expect(evidence.successRate).toBe(0.5);
    expect(evidence.failureStreak).toBe(2);
    expect(evidence.latestRun?.id).toBe("r1");
    expect(evidence.references).toHaveLength(5);
  });

  it("stores and clears evidence-keyed results", () => {
    clearDataOpsAiCache();
    setDataOpsAiCache("x", { ok: true });
    expect(getDataOpsAiCache<{ ok: boolean }>("x")?.ok).toBe(true);
    clearDataOpsAiCache();
    expect(getDataOpsAiCache("x")).toBeUndefined();
  });
});
