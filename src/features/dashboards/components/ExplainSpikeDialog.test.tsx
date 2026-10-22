import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartPanelInput, SpikeExplanation } from "@/api/dashboards";

import { ExplainSpikeDialog } from "./ExplainSpikeDialog";

const api = vi.hoisted(() => ({ explainSpike: vi.fn(), addNote: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));

const PANEL: ChartPanelInput = {
  id: "p1", kind: "chart", title: "Latency", sql: "SELECT t, v FROM x", fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 },
  viz: { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "ms", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null },
};
const SPAN = { fromMs: 1_800_000_000_000, toMs: 1_800_000_600_000 };
const ANSWER: SpikeExplanation = {
  summary: "Latency tripled for ten minutes.",
  likelyCause: "A mutation on shop.orders rewrote parts.",
  confidence: "medium",
  evidence: [{ kind: "mutation", text: "ALTER UPDATE on shop.orders at 08:01" }],
  nextSteps: ["Check system.mutations"],
  unavailable: [{ part: "alerts annotations", reason: "Needs alerting:view" }],
};

function setup(canNote: boolean, onNoted = vi.fn()): typeof onNoted {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExplainSpikeDialog dashboardId="d1" panelId="p1" panel={PANEL} span={SPAN} values={{ db: "shop" }} connectionId="c1" canNote={canNote} onNoted={onNoted} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return onNoted;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExplainSpikeDialog", () => {
  it("asks once for the range and shows the cause, evidence, next steps and what was unavailable", async () => {
    api.explainSpike.mockResolvedValue(ANSWER);
    setup(false);
    expect(await screen.findByTestId("spike-explanation")).toBeTruthy();
    expect(api.explainSpike).toHaveBeenCalledTimes(1);
    expect(api.explainSpike.mock.calls[0][0]).toEqual({ dashboardId: "d1", panelId: "p1", fromMs: SPAN.fromMs, toMs: SPAN.toMs, values: { db: "shop" }, connectionId: "c1" });
    expect(screen.getByText(ANSWER.likelyCause)).toBeTruthy();
    expect(screen.getByText("ALTER UPDATE on shop.orders at 08:01")).toBeTruthy();
    expect(screen.getByText("Check system.mutations")).toBeTruthy();
    expect(screen.getByText(/alerts annotations: Needs alerting:view/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add as note/ })).toBeNull();
  });

  it("adds the cause as a note at the start of the range", async () => {
    api.explainSpike.mockResolvedValue(ANSWER);
    api.addNote.mockResolvedValue({ id: "n1" });
    const onNoted = setup(true);
    fireEvent.click(await screen.findByRole("button", { name: /Add as note/ }));
    await waitFor(() => expect(onNoted).toHaveBeenCalled());
    expect(api.addNote).toHaveBeenCalledWith("d1", SPAN.fromMs, `Explain: ${ANSWER.likelyCause}`);
  });

  it("shows the refusal when the question fails", async () => {
    api.explainSpike.mockRejectedValue(new Error("Select at most 7 days to explain"));
    setup(true);
    expect((await screen.findByRole("alert")).textContent).toContain("Select at most 7 days");
    expect(screen.queryByRole("button", { name: /Add as note/ })).toBeNull();
  });
});
