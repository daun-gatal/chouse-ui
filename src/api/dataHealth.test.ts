import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import {
  acknowledgeDataHealthIncident,
  createDataHealthPromise,
  deleteDataHealthPromise,
  getDataHealthOverview,
  listDataHealthIncidents,
  listDataHealthPromises,
  previewDataHealthPromise,
  recoverDataHealthPromise,
  rerunDataHealthRun,
  runDataHealthPromise,
  snoozeDataHealthIncident,
  backtestDataHealthPromise,
  diagnoseDataHealthCheck,
  type DataHealthPromiseInput,
} from "./dataHealth";

const input: DataHealthPromiseInput = {
  name: "Orders ready", connectionId: "conn-1", source: { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at", eventTimeType: "DateTime", eventTimeEncoding: "native" },
  criticality: "critical", enabled: true, frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1,
  graceSecs: 900, breachAfter: 1, recoverAfter: 2, retentionDays: 90, timeoutSecs: 60, channelIds: [], runNow: true,
  checks: [{ checkKey: "row_count", name: "Row volume", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
};

describe("Data Health API", () => {
  it("lists promises and overview state", async () => {
    expect((await listDataHealthPromises())[0].status).toBe("healthy");
    expect((await getDataHealthOverview()).byStatus.healthy).toBe(1);
  });

  it("scopes promises, overview, and incidents to a connection when one is provided", async () => {
    const seen: Array<string | null> = [];
    const capture = (request: Request): void => {
      seen.push(new URL(request.url).searchParams.get("connectionId"));
    };
    server.use(
      http.get("/api/data-health", ({ request }) => {
        capture(request);
        return HttpResponse.json({ success: true, data: { promises: [] } });
      }),
      http.get("/api/data-health/overview", ({ request }) => {
        capture(request);
        return HttpResponse.json({ success: true, data: { totalPromises: 0, byStatus: {}, openIncidents: 0, unownedCritical: 0, needsAttention: [], coverageGaps: [] } });
      }),
      http.get("/api/data-health/incidents", ({ request }) => {
        capture(request);
        return HttpResponse.json({ success: true, data: { incidents: [] } });
      }),
    );
    await listDataHealthPromises("conn-2");
    await getDataHealthOverview("conn-2");
    await listDataHealthIncidents("conn-2");
    await listDataHealthPromises();
    expect(seen).toEqual(["conn-2", "conn-2", "conn-2", null]);
  });

  it("previews and creates a promise", async () => {
    expect((await previewDataHealthPromise(input)).metricCheckKeys).toEqual(["row_count"]);
    expect((await createDataHealthPromise(input)).id).toBe("dh-new");
  });

  it("sends the upstream job link for event-triggered promises", async () => {
    let sent: { frequency?: string; upstreamJobId?: string | null } = {};
    server.use(
      http.post("/api/data-health", async ({ request }) => {
        sent = await request.json() as typeof sent;
        return HttpResponse.json({ success: true, data: { promise: { id: "dh-event" }, initialRun: null } }, { status: 201 });
      }),
    );
    const created = await createDataHealthPromise({ ...input, frequency: "event", upstreamJobId: "sq-1" });
    expect(created.id).toBe("dh-event");
    expect(sent).toMatchObject({ frequency: "event", upstreamJobId: "sq-1" });
  });

  it("runs and deletes a promise", async () => {
    expect((await runDataHealthPromise("dh-1"))?.conditionValue).toBe("healthy");
    await expect(deleteDataHealthPromise("dh-1")).resolves.toBeUndefined();
  });

  it("supports incident operations", async () => {
    expect((await listDataHealthIncidents())[0].status).toBe("open");
    expect((await acknowledgeDataHealthIncident("incident-1"))?.status).toBe("acknowledged");
    expect((await snoozeDataHealthIncident("incident-1", 1800000000000))?.status).toBe("snoozed");
  });

  it("backtests promises and fetches bounded diagnostic evidence", async () => {
    expect((await backtestDataHealthPromise("dh-1", 7)).summary.healthy).toBe(1);
    const diagnostic = await diagnoseDataHealthCheck("dh-1", "row_count");
    expect(diagnostic.supported).toBe(true);
    expect(diagnostic.rows).toEqual([{ id: 1 }]);
  });

  it("reruns a single historical evaluation", async () => {
    const run = await rerunDataHealthRun("dh-1", "dh-run-9");
    expect(run?.status).toBe("success");
    expect(run?.message).toBe("rerun of dh-run-9");
  });

  it("previews and executes a clear-and-rerun recovery range", async () => {
    const preview = await recoverDataHealthPromise("dh-1", { from: 1, to: 2 });
    expect(preview.plan).toEqual([{ slotAt: 1700000000000, hasSamples: true }]);
    expect(preview.runs).toBeUndefined();
    const executed = await recoverDataHealthPromise("dh-1", { from: 1, to: 2, execute: true, confirm: true });
    expect(executed.runs?.[0].status).toBe("success");
  });
});
