import { describe, expect, it } from "vitest";

import { chatHint, effectiveStatus, sourceLabel, STATUS_FILTERS, STATUS_LABEL, tierLabel } from "./lib";

describe("approvals lib", () => {
  it("treats a pending action past its deadline as expired", () => {
    expect(effectiveStatus({ status: "pending", expiresAt: 10 }, 10)).toBe("expired");
    expect(effectiveStatus({ status: "pending", expiresAt: 11 }, 10)).toBe("pending");
    expect(effectiveStatus({ status: "executed", expiresAt: 1 }, 10)).toBe("executed");
  });

  it("says who asked and where", () => {
    expect(sourceLabel({ source: "chat", origin: "chat", userName: "Alice", userId: "u1" })).toBe("Alice, in chat");
    expect(sourceLabel({ source: "background", origin: "background", userName: null, userId: "u1" })).toBe("Background run as a deleted user");
    // ADR 0025: a held MCP call, and a queued T3 call that came from MCP or the CLI.
    expect(sourceLabel({ source: "held", origin: "mcp", userName: "Alice", userId: "u1" })).toBe("Alice, over MCP");
    expect(sourceLabel({ source: "background", origin: "cli", userName: "Bob", userId: "u2" })).toBe("Bob, from CLI");
  });

  it("names each tier, and none for actions recorded before tiers", () => {
    expect(tierLabel("t1")).toBe("Undoable");
    expect(tierLabel("t2")).toBe("Asks once");
    expect(tierLabel("t3")).toBe("Second approver");
    expect(tierLabel(null)).toBe("—");
  });

  it("points chat actions that wait back to their chat", () => {
    expect(chatHint({ source: "chat", status: "pending", threadId: "t1" })).toBe("Answered in its chat");
    expect(chatHint({ source: "chat", status: "executed", threadId: "t1" })).toBeNull();
    expect(chatHint({ source: "background", status: "pending", threadId: null })).toBeNull();
  });

  it("labels every status and offers Waiting first", () => {
    expect(STATUS_FILTERS[0]).toEqual({ value: "pending", label: "Waiting" });
    expect(STATUS_FILTERS.filter((f) => f.value !== "all").every((f) => STATUS_LABEL[f.value as keyof typeof STATUS_LABEL])).toBe(true);
  });
});
