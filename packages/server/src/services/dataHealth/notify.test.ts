/**
 * Data Health and remediation alerts in chat (ADR 0026 §6): the buttons and
 * status line each state shows.
 */

import { describe, expect, it } from "bun:test";

import { incidentButtons, withIncidentState } from "./notify";
import { remediationMessage } from "../remediation/notify";
import type { DataHealthIncidentRow } from "./types";
import type { RemediationAction } from "../remediation/store";

const incident = (over: Partial<DataHealthIncidentRow>): DataHealthIncidentRow => ({
  id: "inc-1", promiseId: "p1", status: "open", severity: "critical", kind: "data", summary: "late", openedAt: 1, acknowledgedBy: null, acknowledgedAt: null, snoozedUntil: null, recoveredAt: null, lastEventAt: 1, createdAt: 1, updatedAt: 1, ...over,
} as DataHealthIncidentRow);

describe("Data Health incident messages", () => {
  it("offers what still makes sense in each state", () => {
    expect(incidentButtons(incident({})).map((b) => b.action)).toEqual(["data_health.ack", "data_health.snooze"]);
    expect(incidentButtons(incident({ status: "acknowledged" })).map((b) => b.action)).toEqual(["data_health.snooze"]);
    expect(incidentButtons(incident({ status: "snoozed" })).map((b) => b.action)).toEqual(["data_health.ack"]);
    expect(incidentButtons(incident({ status: "recovered" }))).toEqual([]);
  });

  it("replaces the status line instead of adding one per change", () => {
    const posted = { title: "🔴 Data Health breach — orders", facts: [{ label: "Owner", value: "ana" }] };
    const names = new Map([["u1", "Ana"]]);
    const acked = withIncidentState(posted, incident({ status: "acknowledged", acknowledgedBy: "u1" }), names);
    expect(acked.facts).toEqual([{ label: "Owner", value: "ana" }, { label: "Status", value: "Acknowledged by Ana" }]);
    const recovered = withIncidentState(acked, incident({ status: "recovered", recoveredAt: Date.UTC(2026, 9, 25, 10, 52) }), names);
    expect(recovered.facts).toEqual([{ label: "Owner", value: "ana" }, { label: "Status", value: "Recovered Sun, 25 Oct 2026 10:52 UTC" }]);
    expect(recovered.severity).toBe("success");
    expect(recovered.buttons).toEqual([]);
  });
});

describe("remediation approval messages", () => {
  const action = (over: Partial<RemediationAction>): RemediationAction => ({
    id: "r1", title: "Kill query", status: "proposed", approvalClass: 2, windowOnly: false, rationale: "runaway", previewSql: "KILL QUERY WHERE query_id = 'x'", verification: { description: "query gone" },
    ...over,
  } as RemediationAction);

  it("asks for approval while proposed, with the count for two-person actions", () => {
    const waiting = remediationMessage(action({}), 1);
    expect(waiting.buttons?.map((b) => b.action)).toEqual(["remediation.approve", "remediation.reject"]);
    expect(waiting.facts?.find((f) => f.label === "Status")?.value).toBe("1 of 2 approvals");
    expect(waiting.facts?.find((f) => f.label === "Risk")?.value).toBe("Class 2 · two approvers, not the proposer");
  });

  it("drops the buttons once decided", () => {
    const done = remediationMessage(action({ status: "rejected" }), 0);
    expect(done.buttons).toEqual([]);
    expect(done.facts?.find((f) => f.label === "Status")?.value).toBe("⛔ Rejected");
  });
});
