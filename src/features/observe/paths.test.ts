import { describe, expect, it } from "vitest";

import { dataPaths, isDataTab, legacyDataOpsPath } from "./paths";

describe("data paths", () => {
  it("builds encoded deep links", () => {
    expect(dataPaths.incident("observe", "a/b")).toBe("/data/incidents/observe/a%2Fb");
    expect(dataPaths.dataset("my db", "orders")).toBe("/data/datasets/my%20db/orders");
    expect(dataPaths.lineage("table:shop.orders")).toBe("/data/lineage?node=table%3Ashop.orders");
    expect(dataPaths.context("shop", "orders")).toBe("/data/context?table=shop.orders");
    expect(dataPaths.pipelines("failing")).toBe("/data/pipelines?status=failing");
  });

  it("recognizes tabs", () => {
    expect(isDataTab("lineage")).toBe(true);
    expect(isDataTab("data-health")).toBe(false);
    expect(isDataTab(undefined)).toBe(false);
  });

  it("maps every old DataOps URL to its new home", () => {
    expect(legacyDataOpsPath(undefined, undefined)).toBe("/data");
    expect(legacyDataOpsPath("scheduled-queries", "overview")).toBe("/data/scheduled-queries/overview");
    expect(legacyDataOpsPath("scheduled-queries", "jobs")).toBe("/data/scheduled-queries/jobs");
    expect(legacyDataOpsPath("scheduled-queries", "runs")).toBe("/data/scheduled-queries/jobs");
    expect(legacyDataOpsPath("scheduled-queries", "lineage")).toBe("/data/scheduled-queries/jobs");
    expect(legacyDataOpsPath("data-health", "overview")).toBe("/data/datasets?view=health");
    expect(legacyDataOpsPath("data-health", "datasets")).toBe("/data/datasets?view=promises");
    expect(legacyDataOpsPath("data-health", "incidents")).toBe("/data/incidents");
    expect(legacyDataOpsPath("unknown", "x")).toBe("/data");
  });
});
