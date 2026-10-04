import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import { useSchemaPreflightStore } from "@/stores/schemaPreflight";
import { withSchemaOverride } from "./schemaPreflight";

const details = { impact: { breaking: true, items: [], notes: [], saferPlan: null, hiddenDependents: 0 }, canOverride: true };
const refused = (): ApiError => new ApiError("breaks dependents", 409, "SCHEMA_PREFLIGHT_BREAKS", "conflict", details);

describe("withSchemaOverride", () => {
  beforeEach(() => useSchemaPreflightStore.setState({ prompt: null, resolver: null }));

  it("returns the first result when nothing breaks", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withSchemaOverride("DROP TABLE a.b", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledWith(false);
  });

  it("retries once with the override after confirmation", async () => {
    const run = vi.fn().mockRejectedValueOnce(refused()).mockResolvedValueOnce("done");
    const pending = withSchemaOverride("DROP TABLE a.b", run);
    await vi.waitFor(() => expect(useSchemaPreflightStore.getState().prompt).not.toBeNull());
    useSchemaPreflightStore.getState().answer(true);
    await expect(pending).resolves.toBe("done");
    expect(run.mock.calls).toEqual([[false], [true]]);
  });

  it("rethrows when the user cancels or for other errors", async () => {
    const run = vi.fn().mockRejectedValue(refused());
    const pending = withSchemaOverride("DROP TABLE a.b", run);
    await vi.waitFor(() => expect(useSchemaPreflightStore.getState().prompt).not.toBeNull());
    useSchemaPreflightStore.getState().answer(false);
    await expect(pending).rejects.toMatchObject({ code: "SCHEMA_PREFLIGHT_BREAKS" });
    expect(run).toHaveBeenCalledTimes(1);

    await expect(withSchemaOverride("x", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
