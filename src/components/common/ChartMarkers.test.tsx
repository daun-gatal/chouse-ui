import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { ChartView, type ChartViewOptions } from "./AiChartRenderer";
import type { ChartSpec } from "@/api/ai-chat";

const SPEC: ChartSpec = {
  chartType: "line",
  columns: [{ name: "t", type: "String" }, { name: "v", type: "UInt64" }],
  rows: [{ t: "a", v: 1 }, { t: "b", v: 3 }, { t: "c", v: 2 }],
  xAxis: "t",
  yAxis: "v",
  colorScheme: "violet",
};

function panel(onMarkerClick: (id: string) => void, onPointClick: () => void): ChartViewOptions {
  return {
    variant: "panel",
    height: 240,
    formatValue: String,
    thresholds: [],
    seriesMeasure: null,
    overlays: { markers: [{ id: "m1", x: "b", color: "#60A5FA", label: "Deploy" }], compare: [], band: null, selection: null, onMarkerClick, onPointClick },
  };
}

describe("chart annotation markers", () => {
  // jsdom lays nothing out; the chart only draws once its container has a width.
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
  });

  it("gives the thin marker line a wide hit area that opens the marker", async () => {
    const onMarkerClick = vi.fn();
    const onPointClick = vi.fn();
    const { container } = render(<ChartView spec={SPEC} options={panel(onMarkerClick, onPointClick)} />);

    const hit = await waitFor(() => {
      const el = container.querySelector('[data-testid="chart-marker-hit"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
    expect(hit.getAttribute("pointer-events")).toBe("stroke");

    fireEvent.mouseDown(hit);
    fireEvent.mouseUp(hit);
    fireEvent.click(hit);
    expect(onMarkerClick).toHaveBeenCalledWith("m1");
    expect(onPointClick).not.toHaveBeenCalled();
  });
});
