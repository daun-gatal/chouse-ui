import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VizSpec } from "@/lib/viz/spec";
import { PanelVisual } from "./PanelVisual";

const COLS = [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }];

function spec(overrides: Partial<VizSpec>): VizSpec {
  return { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, ...overrides };
}

describe("PanelVisual", () => {
  it("shows a stat in its unit, colored by the crossed threshold", () => {
    render(<PanelVisual spec={spec({ type: "stat", x: null, reduce: "max", unit: "bytes", thresholds: [{ value: 1000, severity: "critical" }] })} data={{ columns: COLS, rows: [{ v: 512 }, { v: 2048 }] }} height={100} />);
    const value = screen.getByTestId("stat-value");
    expect(value.textContent).toBe("2 KiB");
    expect(value.style.color).toBe("rgb(239, 68, 68)");
    expect(screen.getByText(/critical/)).toBeTruthy();
  });

  it("shows every row of a table, with NULLs spelled out", () => {
    render(<PanelVisual spec={spec({ type: "table", x: null, y: [], unit: "none" })} data={{ columns: COLS, rows: [{ t: "a", v: 1 }, { t: "b", v: null }] }} height={100} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("NULL")).toBeTruthy();
  });

  it("explains why a chart cannot be drawn instead of drawing nothing", () => {
    render(<PanelVisual spec={spec({ y: ["missing"] })} data={{ columns: COLS, rows: [{ t: "a", v: 1 }] }} height={100} />);
    expect(screen.getByRole("alert").textContent).toContain("The result has no column missing");
  });

  it("says so when a stat has no rows", () => {
    render(<PanelVisual spec={spec({ type: "stat", x: null, reduce: "last" })} data={{ columns: COLS, rows: [] }} height={100} />);
    expect(screen.getByRole("alert").textContent).toContain("no rows");
  });
});
