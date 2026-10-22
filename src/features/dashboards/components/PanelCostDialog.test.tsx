import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartPanelInput, DashboardDetail, PanelCost } from "@/api/dashboards";
import type { RemediationAction } from "@/api/remediation";

import { PanelCostDialog } from "./PanelCostDialog";

const api = vi.hoisted(() => ({ getPanelCost: vi.fn(), proposeRollup: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));
const fixes = vi.hoisted(() => ({ list: [] as RemediationAction[], refetch: vi.fn() }));
vi.mock("@/features/observe/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/observe/hooks")>()),
  useRemediationActions: () => ({ data: fixes.list, refetch: fixes.refetch }),
}));
const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = { hasPermission: (p: string) => perms.granted.has(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.granted.has(p)) };
  return { ...actual, useRbacStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const PANEL: ChartPanelInput = { id: "p1", kind: "chart", title: "Orders", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 } };
const DETAIL: DashboardDetail = {
  dashboard: { id: "d1", title: "Shop", description: "", ownerId: "u1", timeRange: "1h", refreshSeconds: 60, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 1, createdAt: 1, updatedAt: 2 },
  panels: [], shares: [], access: { owner: true, view: true, edit: true, share: true, delete: true }, pinned: false, lint: {}, alertCounts: {}, scope: { kind: "any" },
};
const COST: PanelCost = { readBytes: 2 * 1024 ** 3, readRows: 1_000_000, elapsedMs: 840, cached: false, refreshSeconds: 60, readsPerHour: 60, bytesPerHour: 120 * 1024 ** 3, heavy: true, rollup: { eligible: true, target: "shop.chouse_rollup_0123456789ab", source: "shop.orders" } };

function setup(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><PanelCostDialog detail={DETAIL} panelId="p1" panel={PANEL} view={{ range: { kind: "relative", value: "1h" }, values: {}, compare: null, hidden: [] }} onClose={() => undefined} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixes.list = [];
  perms.granted = new Set();
});

describe("PanelCostDialog", () => {
  it("shows the cost, flags a heavy panel, and proposes a rollup with the chosen backfill", async () => {
    perms.granted = new Set(["remediation:propose"]);
    api.getPanelCost.mockResolvedValue(COST);
    api.proposeRollup.mockResolvedValue({ id: "a1" });
    setup();
    expect((await screen.findByTestId("panel-cost")).textContent).toContain("60 per viewer");
    expect(screen.getByRole("status").textContent).toContain("heavy");
    expect(api.getPanelCost).toHaveBeenCalledWith("d1", "p1", { range: { kind: "relative", value: "1h" }, values: {} });
    fireEvent.change(screen.getByLabelText("Backfill days"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose rollup" }));
    await waitFor(() => expect(api.proposeRollup).toHaveBeenCalledWith("d1", "p1", { backfillDays: 14, cluster: null }));
  });

  it("says why a panel cannot be rolled up, and offers no proposal without the permission", async () => {
    api.getPanelCost.mockResolvedValue({ ...COST, heavy: false, rollup: { eligible: false, reason: "it uses JOIN" } });
    setup();
    expect(await screen.findByText("Not available: it uses JOIN.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Propose rollup" })).toBeNull();
  });

  it("lists this panel's rollup fixes instead of offering another while one is open", async () => {
    perms.granted = new Set(["remediation:propose"]);
    api.getPanelCost.mockResolvedValue(COST);
    const fix: RemediationAction = {
      id: "a1", connectionId: "c1", type: "create_panel_rollup", params: { type: "create_panel_rollup", panelId: "p1" }, resumeAt: null, approvalClass: 2, status: "proposed",
      title: "Roll up \"Orders\" on Shop", rationale: null, proposedBy: "u1", proposedSource: "user", incidentSource: null, incidentId: null, notebookId: null,
      previewSql: "CREATE TABLE …", rollbackSql: null, verification: { description: "exact", sql: null, comparator: "eq", threshold: 0, withinSeconds: 900 }, windowOnly: true, createdAt: 1, updatedAt: 1,
    };
    fixes.list = [fix, { ...fix, id: "a2", title: "Other panel", params: { type: "create_panel_rollup", panelId: "p9" } }];
    setup();
    expect(await screen.findByText("Roll up \"Orders\" on Shop")).toBeTruthy();
    expect(screen.queryByText("Other panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Propose rollup" })).toBeNull();
  });
});
