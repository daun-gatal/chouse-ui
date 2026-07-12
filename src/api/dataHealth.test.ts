import { describe, expect, it } from "vitest";

import {
  acknowledgeDataHealthIncident,
  createDataHealthPromise,
  deleteDataHealthPromise,
  getDataHealthOverview,
  listDataHealthIncidents,
  listDataHealthPromises,
  previewDataHealthPromise,
  runDataHealthPromise,
  snoozeDataHealthIncident,
  backtestDataHealthPromise,
  diagnoseDataHealthCheck,
  type DataHealthPromiseInput,
} from "./dataHealth";

const input: DataHealthPromiseInput = {
  name: "Orders ready", connectionId: "conn-1", source: { sourceType: "table", databaseName: "analytics", tableName: "orders", eventTimeColumn: "created_at" },
  criticality: "critical", timezone: "Asia/Jakarta", enabled: true, frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1,
  graceSecs: 900, breachAfter: 1, recoverAfter: 2, retentionDays: 90, timeoutSecs: 60, channelIds: [], runNow: true,
  checks: [{ checkKey: "row_count", name: "Row volume", type: "row_count", severity: "critical", enabled: true, config: { min: 1 } }],
};

describe("Data Health API", () => {
  it("lists promises and overview state", async () => {
    expect((await listDataHealthPromises())[0].status).toBe("healthy");
    expect((await getDataHealthOverview()).byStatus.healthy).toBe(1);
  });

  it("previews and creates a promise", async () => {
    expect((await previewDataHealthPromise(input)).metricCheckKeys).toEqual(["row_count"]);
    expect((await createDataHealthPromise(input)).id).toBe("dh-new");
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
});
