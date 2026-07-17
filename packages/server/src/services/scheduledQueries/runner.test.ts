import { describe, expect, it } from "bun:test";

import { chainActionFor } from "./runner";

const materializing = { kind: "sql_query", outputMode: "replace" } as const;
const readOnly = { kind: "sql_query", outputMode: "none" } as const;
const healthJob = { kind: "data_health_check", outputMode: "none" } as const;

describe("chainActionFor", () => {
  it("chains live after a successful unsuppressed materialize run (ADR 0006)", () => {
    expect(chainActionFor(materializing, "success", {})).toBe("live");
  });

  it("propagates upstream failure only on unsuppressed runs", () => {
    expect(chainActionFor(materializing, "error", {})).toBe("upstream-failure");
    expect(chainActionFor(materializing, "error", { suppressNotifications: true })).toBe("none");
    expect(chainActionFor(materializing, "error", { suppressNotifications: true, chainReplay: true })).toBe("none");
  });

  it("keeps recovery silent unless the replay chain is explicitly requested (ADR 0007)", () => {
    expect(chainActionFor(materializing, "success", { suppressNotifications: true })).toBe("none");
    expect(chainActionFor(materializing, "success", { suppressNotifications: true, chainReplay: true })).toBe("replay");
  });

  it("never chains read-only or health jobs", () => {
    expect(chainActionFor(readOnly, "success", {})).toBe("none");
    expect(chainActionFor(readOnly, "success", { suppressNotifications: true, chainReplay: true })).toBe("none");
    expect(chainActionFor(healthJob, "success", {})).toBe("none");
    expect(chainActionFor(healthJob, "success", { suppressNotifications: true, chainReplay: true })).toBe("none");
  });
});
