import { describe, expect, it } from "vitest";

import type { AgentPolicy } from "@/api/agents";
import { assignment, budgetShare, formToSettings, groupPolicies, policyToForm, targetKey } from "./policyForm";

const GIB = 1024 ** 3;

function policy(id: string, scopeKind: AgentPolicy["scopeKind"], scopeId: string, dailyBytes: number | null, scopeLabel?: string): AgentPolicy {
  return { id, scopeKind, scopeId, scopeLabel, maxBytesPerQuery: null, dailyBytes, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null, updatedBy: null, updatedAt: 0 };
}

describe("agent policy form", () => {
  it("defaults to no limits", () => {
    expect(formToSettings(policyToForm())).toEqual({ maxBytesPerQuery: null, dailyBytes: null, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null });
  });

  it("converts GiB to bytes and round-trips", () => {
    const settings = formToSettings({ maxGiBPerQuery: "200", dailyGiB: "500", partitionFilterGiB: "1024", incidentMode: "block", alertMultiplier: "10" });
    expect(settings).toEqual({ maxBytesPerQuery: 200 * GIB, dailyBytes: 500 * GIB, partitionFilterBytes: 1024 * GIB, incidentMode: "block", alertMultiplier: 10 });
    if ("error" in settings) throw new Error("unexpected");
    expect(policyToForm(settings)).toMatchObject({ maxGiBPerQuery: "200", dailyGiB: "500", alertMultiplier: "10" });
  });

  it("rejects invalid limits", () => {
    expect(formToSettings({ ...policyToForm(), dailyGiB: "-1" })).toEqual({ error: "Daily read budget must be a positive number" });
    expect(formToSettings({ ...policyToForm(), alertMultiplier: "0.5" })).toEqual({ error: "Alert multiplier must be between 1 and 1000" });
  });

  it("computes budget share", () => {
    expect(budgetShare(250, 1000)).toBe(0.25);
    expect(budgetShare(2000, 1000)).toBe(1);
    expect(budgetShare(5, null)).toBeNull();
  });
});

describe("groupPolicies", () => {
  it("groups targets that share limits into one policy, default group first", () => {
    const groups = groupPolicies([
      policy("1", "role", "analyst", 10 * GIB, "Analyst"),
      policy("2", "pat", "t1", 10 * GIB, "bot"),
      policy("3", "role", "admin", 10 * GIB, "Administrator"),
      policy("4", "default", "*", 50 * GIB),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].members.map((m) => m.id)).toEqual(["4"]);
    // Roles before tokens, then by display name.
    expect(groups[1].members.map((m) => m.id)).toEqual(["3", "1", "2"]);
    expect(groups[1].settings.dailyBytes).toBe(10 * GIB);
  });

  it("keeps policies with different limits apart", () => {
    expect(groupPolicies([policy("1", "role", "a", 1), policy("2", "role", "b", 2)])).toHaveLength(2);
    expect(groupPolicies([])).toEqual([]);
  });
});

describe("assignment", () => {
  it("removes the deselected targets of the edited policy", () => {
    const [group] = groupPolicies([policy("1", "role", "analyst", 1), policy("2", "pat", "t1", 1)]);
    const plan = assignment(group, [{ scopeKind: "role", scopeId: "analyst" }, { scopeKind: "role", scopeId: "viewer" }]);
    expect(plan).toEqual({ targets: [{ scopeKind: "role", scopeId: "analyst" }, { scopeKind: "role", scopeId: "viewer" }], removeIds: ["2"] });
  });

  it("removes nothing for a new policy and needs a target", () => {
    expect(assignment(undefined, [{ scopeKind: "default", scopeId: "*" }])).toEqual({ targets: [{ scopeKind: "default", scopeId: "*" }], removeIds: [] });
    expect(assignment(undefined, [])).toEqual({ error: "Choose at least one role, token or every agent" });
  });

  it("keys targets by kind and id", () => {
    expect(targetKey({ scopeKind: "pat", scopeId: "abc" })).toBe("pat:abc");
  });
});
