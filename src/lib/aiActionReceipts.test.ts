import { describe, expect, it } from "vitest";

import { actionReceipts } from "./aiActionReceipts";

describe("actionReceipts", () => {
  it("collects the actions a reply ran, filed or proposed, once each", () => {
    expect(actionReceipts([
      { result: { done: true, actionId: "a1", tier: "t1" } },
      { result: JSON.stringify({ submitted: true, actionId: "a2", tier: "t3" }) },
      { result: { proposed: true, actionId: "a3" } },
      { result: { done: true, actionId: "a1" } },
    ])).toEqual(["a1", "a2", "a3"]);
  });

  it("ignores reads, failures and anything without an action id", () => {
    expect(actionReceipts([
      { result: { rows: [] } },
      { result: { error: "Permission denied" } },
      { result: { done: true } },
      { result: "not json" },
      {},
    ])).toEqual([]);
    expect(actionReceipts(null)).toEqual([]);
  });
});
