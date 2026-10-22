import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardDetail, DashboardInput } from "@/api/dashboards";

import { VersionHistoryDialog } from "./VersionHistoryDialog";

const api = vi.hoisted(() => ({ listVersions: vi.fn(), getVersion: vi.fn(), restorePreview: vi.fn(), restoreVersion: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));

const LAYOUT = { x: 0, y: 0, w: 12, h: 4 };
const DETAIL: DashboardDetail = {
  dashboard: { id: "d1", title: "Orders", description: "", ownerId: "u1", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 3, createdAt: 1, updatedAt: 2 },
  panels: [{ id: "a", dashboardId: "d1", position: 0, layout: LAYOUT, createdAt: 1, updatedAt: 1, kind: "text", title: "Runbook", markdown: "now" }],
  shares: [],
  access: { owner: true, view: true, edit: true, share: true, delete: true },
  pinned: false,
  lint: {},
  alertCounts: {},
  scope: { kind: "any" },
};
const OLD: DashboardInput = { title: "Orders", description: "", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], panels: [{ id: "a", kind: "text", title: "Runbook", markdown: "then", layout: LAYOUT }] };

function setup(canRestore: boolean, onRestored = vi.fn()): typeof onRestored {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><VersionHistoryDialog detail={DETAIL} canRestore={canRestore} onRestored={onRestored} onClose={() => undefined} /></QueryClientProvider>);
  return onRestored;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VersionHistoryDialog", () => {
  it("shows the newest older version's changes, the alerts it would delete, and restores it", async () => {
    api.listVersions.mockResolvedValue([
      { version: 3, savedBy: "u1", savedByName: "Ada", savedAt: 3, source: "ui" },
      { version: 2, savedBy: "u1", savedByName: "Ada", savedAt: 2, source: "ui" },
      { version: 1, savedBy: null, savedByName: null, savedAt: 1, source: "migration" },
    ]);
    api.getVersion.mockResolvedValue({ version: 2, dashboardId: "d1", savedBy: "u1", savedByName: "Ada", savedAt: 2, source: "ui", document: OLD });
    api.restorePreview.mockResolvedValue({ removedPanels: 0, removedAlerts: [{ id: "al1", name: "Slow inserts" }] });
    api.restoreVersion.mockResolvedValue(DETAIL);
    const onRestored = setup(true);
    expect((await screen.findByTestId("version-diff")).textContent).toContain("Runbook (text)");
    expect(api.getVersion).toHaveBeenCalledWith("d1", 2);
    expect((await screen.findByRole("status")).textContent).toContain("Slow inserts");
    expect(screen.getByText(/Converted to v2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Restore v2/ }));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(api.restoreVersion).toHaveBeenCalledWith("d1", 2, 3);
  });

  it("does not offer a restore to a viewer, nor of a version identical to the current one", async () => {
    api.listVersions.mockResolvedValue([{ version: 3, savedBy: null, savedByName: null, savedAt: 3, source: "ui" }, { version: 2, savedBy: null, savedByName: null, savedAt: 2, source: "ui" }]);
    api.getVersion.mockResolvedValue({ version: 2, dashboardId: "d1", savedBy: null, savedByName: null, savedAt: 2, source: "ui", document: { ...OLD, panels: [{ ...OLD.panels[0], markdown: "now" }] } });
    setup(false);
    expect(await screen.findByText("Same as the current dashboard.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
    expect(api.restorePreview).not.toHaveBeenCalled();
  });

  it("says when there is only one version", async () => {
    api.listVersions.mockResolvedValue([{ version: 3, savedBy: null, savedByName: null, savedAt: 3, source: "ui" }]);
    setup(true);
    expect(await screen.findByText("This is the only version so far.")).toBeTruthy();
  });
});
