import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardDetail, Snapshot } from "@/api/dashboards";

import { SnapshotView } from "./SnapshotView";
import { SnapshotsDialog, absoluteRange } from "./SnapshotsDialog";

const api = vi.hoisted(() => ({ listSnapshots: vi.fn(), createSnapshot: vi.fn(), deleteSnapshot: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));

const VIZ = { version: 2 as const, type: "table" as const, x: null, y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const DETAIL: DashboardDetail = {
  dashboard: { id: "d1", title: "Orders", description: "", ownerId: "u1", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 3, createdAt: 1, updatedAt: 2 },
  panels: [],
  shares: [{ roleId: "role-b", roleName: "team-b", roleDisplayName: "Team B", canEdit: false }],
  access: { owner: true, view: true, edit: true, share: true, delete: true },
  pinned: false,
  lint: {},
  alertCounts: {},
  scope: { kind: "any" },
};
const SUMMARY = { id: "s1", dashboardId: "d1", name: "Incident 42", createdBy: "u1", createdByName: "ada", createdAt: 1, expiresAt: 4_102_444_800_000, connectionId: "c1", range: { from: 1_800_000_000, to: 1_800_003_600 }, sizeBytes: 2048, roleIds: [], incidentId: null };

function wrap(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("absoluteRange", () => {
  it("fixes a relative range at the given moment and keeps an absolute one", () => {
    expect(absoluteRange({ kind: "relative", value: "1h" }, 1_800_000_000_500)).toEqual({ from: 1_799_996_400, to: 1_800_000_000 });
    expect(absoluteRange({ kind: "absolute", from: 5, to: 9 }, 0)).toEqual({ from: 5, to: 9 });
  });
});

describe("SnapshotsDialog", () => {
  it("takes a snapshot of the view's range with the chosen roles and expiry, and lists the saved ones", async () => {
    api.listSnapshots.mockResolvedValue([SUMMARY]);
    api.createSnapshot.mockResolvedValue(SUMMARY);
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    wrap(<SnapshotsDialog detail={DETAIL} range={{ kind: "relative", value: "1h" }} values={{ db: "shop" }} canTake userId="u1" onClose={() => undefined} />);
    expect((await screen.findByRole("link", { name: "Incident 42" })).getAttribute("href")).toBe("/dashboards/d1/snapshots/s1");
    fireEvent.change(screen.getByDisplayValue(/^Orders · /), { target: { value: "Spike" } });
    fireEvent.change(screen.getByLabelText("Expires after"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Let Team B open it" }));
    fireEvent.click(screen.getByRole("button", { name: /Take snapshot/ }));
    await waitFor(() => expect(api.createSnapshot).toHaveBeenCalled());
    expect(api.createSnapshot).toHaveBeenCalledWith("d1", { name: "Spike", from: 1_799_996_400, to: 1_800_000_000, values: { db: "shop" }, roleIds: ["role-b"], expiresInDays: 7, incidentId: null });
    fireEvent.click(screen.getByRole("button", { name: "Delete Incident 42" }));
    await waitFor(() => expect(api.deleteSnapshot).toHaveBeenCalledWith("d1", "s1"));
    vi.restoreAllMocks();
  });

  it("shows the refusal, and offers no taking without query access", async () => {
    api.listSnapshots.mockResolvedValue([]);
    api.createSnapshot.mockRejectedValue(new Error("The snapshot's results are 12.0 MiB; the limit is 10.0 MiB."));
    wrap(<SnapshotsDialog detail={DETAIL} range={{ kind: "relative", value: "1h" }} values={{}} canTake userId="u2" onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Take snapshot/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("12.0 MiB");
    cleanup();
    wrap(<SnapshotsDialog detail={DETAIL} range={{ kind: "relative", value: "1h" }} values={{}} canTake={false} userId="u2" onClose={() => undefined} />);
    expect(await screen.findByText("No snapshots you can open.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take snapshot/ })).toBeNull();
  });
});

describe("SnapshotView", () => {
  it("draws stored results without running anything, and a withheld panel as Access denied", async () => {
    const snapshot: Snapshot = {
      ...SUMMARY,
      values: {},
      document: {
        title: "Orders", description: "", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [],
        panels: [
          { id: "p1", kind: "chart", title: "Top tables", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 } },
          { id: "p2", kind: "chart", title: "Secret", sql: "SELECT 2", viz: VIZ, fleet: false, layout: { x: 12, y: 0, w: 12, h: 9 } },
          { id: "h1", kind: "heading", title: "Writes", description: "", layout: { x: 0, y: 9, w: 24, h: 2 } },
        ],
      },
      results: {
        p1: { ok: true, kind: "single", connectionId: "c1", window: { from: 1, to: 2, intervalSeconds: 60 }, cached: false, data: { columns: [{ name: "v", type: "UInt64" }], rows: [{ v: 41 }], elapsedMs: 3, readRows: 1, readBytes: 10, ranAt: 0, timezone: "UTC" } },
        p2: { ok: false, error: "Access denied" },
      },
    };
    api.getSnapshot.mockResolvedValue(snapshot);
    wrap(<SnapshotView dashboardId="d1" snapshotId="s1" />);
    expect(await screen.findByRole("heading", { name: /Incident 42/ })).toBeTruthy();
    expect(screen.getByText("41")).toBeTruthy();
    expect(screen.getByText("Access denied")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Writes" })).toBeTruthy();
    expect(screen.getByTestId("snapshot-meta").textContent).toContain("by ada");
  });

  it("says when a snapshot cannot be opened", async () => {
    api.getSnapshot.mockRejectedValue(new Error("This snapshot has expired"));
    wrap(<SnapshotView dashboardId="d1" snapshotId="s1" />);
    expect((await screen.findByRole("alert")).textContent).toBe("This snapshot has expired");
    expect(screen.getByRole("link", { name: "Open the live dashboard" })).toBeTruthy();
  });
});
