/**
 * Tests for the Scheduled Queries API client. Exercises the response-envelope
 * unwrapping (`data.data`) and request shaping against MSW handlers.
 */

import { describe, it, expect } from "vitest";

import {
  listScheduledQueries,
  getOverview,
  previewScheduledQuery,
  runScheduledQuery,
  listRuns,
  createScheduledQuery,
  deleteScheduledQuery,
  getLineage,
  type ScheduledQueryInput,
} from "./scheduledQueries";

const baseInput: ScheduledQueryInput = {
  name: "test",
  connectionId: "conn-1",
  query: "SELECT 1",
  enabled: true,
  frequency: "daily",
  hour: 8,
  dayOfWeek: 1,
  dayOfMonth: 1,
  outputMode: "none",
  maxRows: 100,
  timeoutSecs: 60,
  useFinal: false,
  seqConsistency: false,
  maxAttempts: 2,
  retentionDays: 90,
  channelIds: [],
};

describe("Scheduled Queries API", () => {
  it("lists jobs with their last-run summary", async () => {
    const jobs = await listScheduledQueries();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("sq-1");
    expect(jobs[0].lastRun?.status).toBe("success");
    expect(jobs[0].channelIds).toEqual(["ch-1"]);
  });

  it("fetches the overview aggregation", async () => {
    const overview = await getOverview(14);
    expect(overview.kpis.totalJobs).toBe(2);
    expect(overview.kpis.enabledJobs).toBe(1);
    expect(overview.kpis.successRateWindow).toBe(100);
    expect(overview.byCadence.daily).toBe(1);
    expect(overview.upcoming.length).toBe(1);
  });

  it("validates a read-only query via preview", async () => {
    const ok = await previewScheduledQuery({ query: "SELECT 1" });
    expect(ok.readOnly.ok).toBe(true);
    expect(ok.nextFireTimes).toBeDefined();

    const bad = await previewScheduledQuery({ query: "INSERT INTO t VALUES (1)" });
    expect(bad.readOnly.ok).toBe(false);
  });

  it("triggers a manual run", async () => {
    const res = await runScheduledQuery("sq-1");
    expect(res.run?.status).toBe("success");
  });

  it("lists runs for a job", async () => {
    const runs = await listRuns("sq-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("scheduled");
  });

  it("creates a job", async () => {
    const created = await createScheduledQuery(baseInput);
    expect(created.id).toBe("sq-new");
    expect(created.name).toBe("test");
  });

  it("deletes a job without throwing", async () => {
    await expect(deleteScheduledQuery("sq-1")).resolves.toBeUndefined();
  });

  it("fetches the observed-runtime lineage graph for a job", async () => {
    const graph = await getLineage("sq-1", 14);
    expect(graph.focusJobId).toBe("sq-1");
    expect(graph.windowDays).toBe(14);
    expect(graph.nodes).toHaveLength(3);
    const write = graph.edges.find((e) => e.kind === "write");
    expect(write?.from).toBe("job:sq-1");
    expect(write?.to).toBe("table:db.out");
    expect(write?.columns).toEqual(["a"]);
  });
});
