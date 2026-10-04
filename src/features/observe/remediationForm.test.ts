import { describe, expect, it } from "vitest";

import { ACTION_TYPES } from "@/api/remediation";
import { ACTION_META, buildParams, valuesFromParams } from "./remediationForm";

describe("remediation form", () => {
  it("covers every catalog action", () => {
    expect(Object.keys(ACTION_META).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it("requires mandatory fields", () => {
    expect(buildParams("kill_query", { queryId: " " })).toEqual({ error: "Query id is required" });
    expect(buildParams("kill_query", { queryId: "q1" })).toEqual({ params: { type: "kill_query", queryId: "q1" } });
  });

  it("coerces numbers, booleans, times and setting values", () => {
    expect(buildParams("optimize_partition", { database: "shop", table: "orders", partitionId: "202610", final: true })).toEqual({
      params: { type: "optimize_partition", database: "shop", table: "orders", partitionId: "202610", final: true },
    });
    expect(buildParams("add_skip_index", { database: "a", table: "b", name: "i", expression: "x", indexType: "minmax", granularity: "x" })).toEqual({ error: "Granularity must be a number" });
    const delayed = buildParams("delay_scheduled_job", { jobId: "j", until: "2026-10-04T12:30" });
    expect("params" in delayed && typeof delayed.params.until).toBe("number");
    expect(buildParams("set_profile_setting", { targetKind: "user", targetName: "bi", setting: "max_threads", value: "8" })).toEqual({
      params: { type: "set_profile_setting", targetKind: "user", targetName: "bi", setting: "max_threads", value: 8 },
    });
    expect(buildParams("set_profile_setting", { targetKind: "role", targetName: "bi", setting: "readonly", value: "true" })).toMatchObject({ params: { value: true } });
  });

  it("skips empty optional fields", () => {
    expect(buildParams("add_skip_index", { database: "a", table: "b", name: "i", expression: "x", indexType: "minmax", granularity: "" })).toEqual({
      params: { type: "add_skip_index", database: "a", table: "b", name: "i", expression: "x", indexType: "minmax" },
    });
  });

  it("round-trips params into form values", () => {
    expect(valuesFromParams("optimize_partition", { database: "shop", table: "orders", partitionId: "1", final: true })).toEqual({ database: "shop", table: "orders", partitionId: "1", final: true });
    const values = valuesFromParams("delay_scheduled_job", { jobId: "j", until: new Date(2026, 9, 4, 12, 30).getTime() });
    expect(values.until).toBe("2026-10-04T12:30");
  });
});
