import { describe, expect, it } from "vitest";

import { AlertSeverity, AlertSourceType, type AlertRule } from "@/api/alerting";
import type { DataHealthPromise } from "@/api/dataHealth";
import type { ScheduledQuery } from "@/api/scheduledQueries";
import { filterSources, toSourceRows } from "./sources";

const rule: AlertRule = { id: "r1", name: "Node memory", sourceType: AlertSourceType.FleetThreshold, severity: AlertSeverity.Critical, enabled: true, aiRcaEnabled: false, aiRcaModelId: null, config: {}, channelIds: ["c1"] };
const promise = { id: "p1", name: "orders fresh", scheduledQueryId: "j1", enabled: true, status: "unhealthy", channelIds: ["c2"] } as unknown as DataHealthPromise;
const promiseJob = { id: "j1", name: "orders fresh (monitor)", enabled: true, channelIds: ["c2"], lastRun: null } as unknown as ScheduledQuery;
const job = { id: "j2", name: "Nightly rollup", enabled: true, channelIds: ["c1"], lastRun: { status: "error" } } as unknown as ScheduledQuery;
const silentJob = { id: "j3", name: "No alerts", enabled: true, channelIds: [], lastRun: null } as unknown as ScheduledQuery;

describe("alert sources", () => {
  const rows = toSourceRows({
    rules: [rule],
    panelAlerts: [{ id: "a1", name: "Orders low", dashboardId: "d1", dashboardTitle: "Shop", severity: "warning", enabled: true, channelIds: [], status: { state: "firing" } }],
    promises: [promise],
    jobs: [promiseJob, job, silentJob],
    triage: [{ trigger: "fleet_alert", label: "Fleet alert", enabled: false, channelIds: ["c1"] } as never],
    remediation: { channelIds: [] },
  });

  it("lists every source once: a promise's monitor job is the promise, a job with no channel is not an alert", () => {
    expect(rows.map((r) => [r.kind, r.name, r.state])).toEqual([
      ["fleet", "Node memory", "ok"],
      ["dashboard", "Orders low", "firing"],
      ["dataHealth", "orders fresh", "firing"],
      ["scheduled", "Nightly rollup", "error"],
      ["triage", "Triage: Fleet alert", "disabled"],
      ["remediation", "Remediation approvals", "disabled"],
    ]);
    expect(rows.find((r) => r.kind === "fleet")?.link).toBeNull();
    expect(rows.find((r) => r.kind === "dashboard")?.link).toBe("/dashboards/d1");
  });

  it("filters by text, kind, state, severity, channel and 'no channel'", () => {
    const base = { q: "", kind: "" as const, state: "" as const, severity: "", channelId: "" };
    expect(filterSources(rows, { ...base, q: "SHOP" }).map((r) => r.name)).toEqual(["Orders low"]);
    expect(filterSources(rows, { ...base, state: "firing" }).map((r) => r.kind)).toEqual(["dashboard", "dataHealth"]);
    expect(filterSources(rows, { ...base, state: "nochannel" }).map((r) => r.kind)).toEqual(["dashboard", "remediation"]);
    expect(filterSources(rows, { ...base, channelId: "c1" }).map((r) => r.kind)).toEqual(["fleet", "scheduled", "triage"]);
    expect(filterSources(rows, { ...base, kind: "fleet", severity: "critical" })).toHaveLength(1);
    expect(filterSources(rows, { ...base, q: "zzz" })).toEqual([]);
  });
});
