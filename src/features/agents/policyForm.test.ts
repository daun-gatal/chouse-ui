import { describe, expect, it } from "vitest";

import { budgetShare, formToPolicy, policyToForm } from "./policyForm";

const GIB = 1024 ** 3;

describe("agent policy form", () => {
  it("defaults to the default scope with no limits", () => {
    expect(formToPolicy(policyToForm())).toEqual({ scopeKind: "default", scopeId: "*", maxBytesPerQuery: null, dailyBytes: null, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null });
  });

  it("converts GiB to bytes and round-trips", () => {
    const input = formToPolicy({ scopeKind: "role", scopeId: "analyst", maxGiBPerQuery: "200", dailyGiB: "500", partitionFilterGiB: "1024", incidentMode: "block", alertMultiplier: "10" });
    expect(input).toEqual({ scopeKind: "role", scopeId: "analyst", maxBytesPerQuery: 200 * GIB, dailyBytes: 500 * GIB, partitionFilterBytes: 1024 * GIB, incidentMode: "block", alertMultiplier: 10 });
    if ("error" in input) throw new Error("unexpected");
    expect(policyToForm({ ...input, id: "p", updatedBy: null, updatedAt: 0 })).toMatchObject({ maxGiBPerQuery: "200", dailyGiB: "500", alertMultiplier: "10" });
  });

  it("rejects invalid input", () => {
    expect(formToPolicy({ ...policyToForm(), scopeKind: "pat", scopeId: " " })).toEqual({ error: "Pick a token id" });
    expect(formToPolicy({ ...policyToForm(), dailyGiB: "-1" })).toEqual({ error: "Daily read budget must be a positive number" });
    expect(formToPolicy({ ...policyToForm(), alertMultiplier: "0.5" })).toEqual({ error: "Alert multiplier must be between 1 and 1000" });
  });

  it("computes budget share", () => {
    expect(budgetShare(250, 1000)).toBe(0.25);
    expect(budgetShare(2000, 1000)).toBe(1);
    expect(budgetShare(5, null)).toBeNull();
  });
});
