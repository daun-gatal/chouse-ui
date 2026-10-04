import { beforeEach, describe, expect, it } from "vitest";

const impact = { breaking: true, items: [{ severity: "breaks", kind: "materialized_view", ref: "shop.mv", label: "shop.mv reads c", reason: "column removed" }], notes: [], saferPlan: null, hiddenDependents: 0 };

describe("schema preflight store", () => {
  beforeEach(async () => {
    const { useSchemaPreflightStore } = await import("./schemaPreflight");
    useSchemaPreflightStore.setState({ prompt: null, resolver: null });
  });

  it("resolves true only for a confirmed prompt that may override", async () => {
    const { useSchemaPreflightStore } = await import("./schemaPreflight");
    const allowed = useSchemaPreflightStore.getState().ask({ statement: "ALTER", message: "m", impact, canOverride: true });
    useSchemaPreflightStore.getState().answer(true);
    await expect(allowed).resolves.toBe(true);

    const denied = useSchemaPreflightStore.getState().ask({ statement: "ALTER", message: "m", impact, canOverride: false });
    useSchemaPreflightStore.getState().answer(true);
    await expect(denied).resolves.toBe(false);
    expect(useSchemaPreflightStore.getState().prompt).toBeNull();
  });

  it("declines an unanswered prompt when a newer one arrives", async () => {
    const { useSchemaPreflightStore } = await import("./schemaPreflight");
    const first = useSchemaPreflightStore.getState().ask({ statement: "A", message: "m", impact, canOverride: true });
    const second = useSchemaPreflightStore.getState().ask({ statement: "B", message: "m", impact, canOverride: true });
    await expect(first).resolves.toBe(false);
    expect(useSchemaPreflightStore.getState().prompt?.statement).toBe("B");
    useSchemaPreflightStore.getState().answer(false);
    await expect(second).resolves.toBe(false);
  });

  it("parses 409 details defensively", async () => {
    const { parsePreflightDetails } = await import("./schemaPreflight");
    expect(parsePreflightDetails({ impact: { ...impact, items: [...impact.items, { bad: true }] }, canOverride: true })).toEqual({ canOverride: true, impact });
    expect(parsePreflightDetails(null)).toBeNull();
    expect(parsePreflightDetails({ impact: "x" })).toBeNull();
  });
});
