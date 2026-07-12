/**
 * Tests for the Scheduled Queries API client. Exercises the response-envelope
 * unwrapping (`data.data`) and request shaping against MSW handlers.
 */

import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";

import { server } from "@/test/mocks/server";
import {
  listScheduledQueries,
  getOverview,
  previewScheduledQuery,
  runScheduledQuery,
  listRuns,
  createScheduledQuery,
  deleteScheduledQuery,
  getLineage,
  recoverScheduledQuery,
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

  it("scopes list and overview to a connection when one is provided", async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get("/api/scheduled-queries", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("connectionId"));
        return HttpResponse.json({ success: true, data: { jobs: [] } });
      }),
      http.get("/api/scheduled-queries/overview", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("connectionId"));
        return HttpResponse.json({ success: true, data: { kpis: {}, byCadence: {}, byOutputMode: {}, upcoming: [], topFailing: [] } });
      }),
    );
    await listScheduledQueries("conn-2");
    await getOverview(14, "conn-2");
    await listScheduledQueries();
    expect(seen).toEqual(["conn-2", "conn-2", null]);
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

  it("previews and executes bounded recovery", async () => {
    const preview = await recoverScheduledQuery("sq-1", { from: 1, to: 2 });
    expect(preview.runnable).toBe(1);
    const executed = await recoverScheduledQuery("sq-1", { from: 1, to: 2, execute: true, confirm: true });
    expect(executed.runs?.[0].status).toBe("success");
  });
});
