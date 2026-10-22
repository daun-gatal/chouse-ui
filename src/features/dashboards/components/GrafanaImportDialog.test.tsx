import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GrafanaPreview } from "@/api/dashboards";
import { useAuthStore } from "@/stores/auth";

import { GrafanaImportDialog, isGrafanaDashboard } from "./GrafanaImportDialog";

const api = vi.hoisted(() => ({ previewGrafana: vi.fn(), importDashboard: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const PREVIEW: GrafanaPreview = {
  dashboard: { title: "From Grafana", description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], panels: [{ id: null, kind: "chart", title: "Orders", sql: "SELECT 1 AS t, 2 AS v", viz: VIZ, fleet: false, layout: { x: 0, y: 0, w: 12, h: 8 } }] },
  panels: [
    { title: "Orders", grafanaType: "timeseries", status: "changed", changes: ["$__timeFilter(col) became col >= {{from}} AND col < {{to}}"], reason: null },
    { title: "Up", grafanaType: "stat", status: "skipped", changes: [], reason: "it reads another data source (only ClickHouse panels convert)" },
  ],
  variables: [{ name: "step", status: "skipped", changes: [], reason: "a interval variable has no equivalent" }],
  notes: ["Panels that overlapped (from collapsed rows) were moved down"],
};

function setup(): void {
  useAuthStore.setState({ activeConnectionId: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><GrafanaImportDialog file="ops.json" json={{ panels: [] }} onClose={() => undefined} /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GrafanaImportDialog", () => {
  it("previews what converts and why the rest does not, then imports the converted part", async () => {
    api.previewGrafana.mockResolvedValue(PREVIEW);
    api.importDashboard.mockResolvedValue({ dashboard: { id: "d9", title: "From Grafana" } });
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "All connections" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview the conversion/ }));
    expect((await screen.findByTestId("grafana-preview")).textContent).toContain("1 of 2 panels convert");
    expect(api.previewGrafana).toHaveBeenCalledWith({ panels: [] }, { kind: "any" });
    expect(screen.getAllByTestId("grafana-panel").map((p) => p.textContent)).toEqual([
      "changedOrders timeseries$__timeFilter(col) became col >= {{from}} AND col < {{to}}",
      "skippedUp statit reads another data source (only ClickHouse panels convert)",
    ]);
    expect(screen.getByText("Panels that overlapped (from collapsed rows) were moved down")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 panel" }));
    await waitFor(() => expect(api.importDashboard).toHaveBeenCalledWith({ format: "chouse.dashboard/v2", id: null, dashboard: PREVIEW.dashboard }));
  });

  it("shows why a file cannot be converted", async () => {
    api.previewGrafana.mockRejectedValue(new Error("Grafana dashboards of schema 30 or later (Grafana 8+) can be imported; this one is schema 16."));
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "All connections" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview the conversion/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("schema 16");
  });

  it("recognises Grafana dashboards", () => {
    expect(isGrafanaDashboard({ schemaVersion: 39, panels: [] })).toBe(true);
    expect(isGrafanaDashboard({ dashboard: { schemaVersion: 39, panels: [] } })).toBe(true);
    expect(isGrafanaDashboard({ format: "chouse.dashboard/v2" })).toBe(false);
    expect(isGrafanaDashboard([])).toBe(false);
  });
});
