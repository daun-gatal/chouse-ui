import { describe, expect, it } from "vitest";

import { chatHint, effectiveStatus, sourceLabel, STATUS_FILTERS, STATUS_LABEL } from "./lib";

describe("approvals lib", () => {
  it("treats a pending action past its deadline as expired", () => {
    expect(effectiveStatus({ status: "pending", expiresAt: 10 }, 10)).toBe("expired");
    expect(effectiveStatus({ status: "pending", expiresAt: 11 }, 10)).toBe("pending");
    expect(effectiveStatus({ status: "executed", expiresAt: 1 }, 10)).toBe("executed");
  });

  it("says who asked and where", () => {
    expect(sourceLabel({ source: "chat", userName: "Alice", userId: "u1" })).toBe("Alice, in chat");
    expect(sourceLabel({ source: "background", userName: null, userId: "u1" })).toBe("Background run as a deleted user");
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
