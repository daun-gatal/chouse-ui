import { describe, expect, it } from "vitest";

import { isAssignedTo, scopeForNew, scopeLabel } from "./scope";

const ONLY = { kind: "only" as const, connections: [{ id: "c1", name: "alpha" }], hidden: 2 };

describe("dashboard connection scope", () => {
  it("belongs to every connection, or only to its assigned ones", () => {
    expect(isAssignedTo({ kind: "any" }, "c9")).toBe(true);
    expect(isAssignedTo(ONLY, "c1")).toBe(true);
    expect(isAssignedTo(ONLY, "c2")).toBe(false);
    expect(isAssignedTo(ONLY, null)).toBe(false);
  });

  it("names the connections the viewer may see and counts the rest", () => {
    expect(scopeLabel({ kind: "any" })).toBe("All connections");
    expect(scopeLabel(ONLY)).toBe("alpha, 2 others");
    expect(scopeLabel({ kind: "only", connections: [], hidden: 1 })).toBe("1 other");
  });

  it("makes a new dashboard for the active connection, and needs one", () => {
    expect(scopeForNew("c1")).toEqual({ kind: "only", connectionIds: ["c1"] });
    expect(() => scopeForNew(null)).toThrow("Pick a connection in the dock first");
  });
});
