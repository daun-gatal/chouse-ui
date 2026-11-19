import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DataSampleSection from "./DataSampleSection";

const sample = vi.hoisted(() => ({
  meta: [
    { name: "device.name", type: "String" },
    { name: "n.a", type: "Array(UInt8)" },
    { name: "a_b", type: "String" },
    { name: "a.b", type: "String" },
    { name: "events", type: "UInt8" },
  ],
  data: [
    { "device.name": "firewall-01", "n.a": [1, 2], a_b: "underscore", "a.b": "dotted", events: 100 },
    { "device.name": "switch-01", "n.a": [], a_b: "underscore-2", "a.b": "dotted-2", events: 50 },
  ],
  statistics: {},
  rows: 2,
}));

vi.mock("@/hooks", () => ({
  useTableSample: () => ({ data: sample, isLoading: false, error: null }),
}));

describe("DataSampleSection", () => {
  // #444: TanStack read `device.name` as row.device.name and showed NULL.
  it("shows the values of dotted column names", () => {
    render(<DataSampleSection database="logs" tableName="events" />);

    expect(screen.getByText("firewall-01")).toBeTruthy();
    expect(screen.getByText("switch-01")).toBeTruthy();
    expect(screen.getByText("dotted")).toBeTruthy();
    expect(screen.getByText("underscore")).toBeTruthy();
    expect(screen.queryAllByText("NULL")).toHaveLength(0);
  });

  it("renders one header per column even when `a.b` and `a_b` both exist", () => {
    render(<DataSampleSection database="logs" tableName="events" />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(sample.meta.length);
    expect(screen.getByText("a.b")).toBeTruthy();
    expect(screen.getByText("a_b")).toBeTruthy();
  });
});
