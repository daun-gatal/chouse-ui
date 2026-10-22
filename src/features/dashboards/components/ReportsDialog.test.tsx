import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardDetail, Report } from "@/api/dashboards";

import { ReportsDialog, scheduleLabel } from "./ReportsDialog";

const api = vi.hoisted(() => ({ listReports: vi.fn(), createReport: vi.fn(), updateReport: vi.fn(), deleteReport: vi.fn(), sendReport: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));
const alerting = vi.hoisted(() => ({ listChannels: vi.fn() }));
vi.mock("@/api/alerting", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/alerting")>()), ...alerting }));

const DETAIL: DashboardDetail = {
  dashboard: { id: "d1", title: "Shop", description: "", ownerId: "u1", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 1, createdAt: 1, updatedAt: 2 },
  panels: [],
  shares: [],
  access: { owner: true, view: true, edit: true, share: true, delete: true },
  pinned: false,
  lint: {},
  alertCounts: {},
  scope: { kind: "any" },
};
const REPORT: Report = {
  id: "r1", dashboardId: "d1", ownerId: "u1", ownerName: "ada", name: "Weekly shop", connectionId: "c1",
  schedule: { kind: "weekly", dayOfWeek: 1, hour: 8, minute: 5, timezone: "UTC" }, range: "7d", onlyIfAlert: true, enabled: true, channelIds: ["ch1"],
  nextRunAt: 2, lastRunAt: 1, lastStatus: "failed", lastError: "PUBLIC_BASE_URL is not set", createdAt: 1, updatedAt: 1,
};

function setup(canManage = true): void {
  alerting.listChannels.mockResolvedValue([{ id: "ch1", name: "ops-slack", type: "slack", enabled: true }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ReportsDialog detail={DETAIL} connectionId="c1" canManage={canManage} onClose={() => undefined} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsDialog", () => {
  it("lists reports with their schedule and last run, and sends one now", async () => {
    api.listReports.mockResolvedValue({ reports: [REPORT], publicBaseUrl: true });
    api.sendReport.mockResolvedValue({ status: "sent", error: null, title: "t", text: "x", deliveredTo: ["ops-slack"], failed: [] });
    setup();
    const row = await screen.findByTestId("report-row");
    expect(row.textContent).toContain("Mondays at 08:05 UTC · last 7d · only when an alert fired · as ada");
    expect(row.textContent).toContain("failed");
    expect(row.textContent).toContain("PUBLIC_BASE_URL is not set");
    fireEvent.click(screen.getByRole("button", { name: "Send Weekly shop now" }));
    await waitFor(() => expect(api.sendReport).toHaveBeenCalledWith("d1", "r1"));
  });

  it("creates a weekly report on the active connection", async () => {
    api.listReports.mockResolvedValue({ reports: [], publicBaseUrl: true });
    api.createReport.mockResolvedValue(REPORT);
    setup();
    const create = await screen.findByRole("button", { name: /New report/ });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText("Every"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Day of the week"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "07:45" } });
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Asia/Jakarta" } });
    fireEvent.change(screen.getByLabelText("Covering the last"), { target: { value: "7d" } });
    const save = screen.getByRole("button", { name: "Save report" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Send to ops-slack" }));
    fireEvent.click(save);
    await waitFor(() => expect(api.createReport).toHaveBeenCalled());
    expect(api.createReport).toHaveBeenCalledWith("d1", {
      name: "Shop daily", connectionId: "c1", schedule: { kind: "weekly", dayOfWeek: 5, hour: 7, minute: 45, timezone: "Asia/Jakarta" },
      range: "7d", onlyIfAlert: false, enabled: true, channelIds: ["ch1"],
    });
  });

  it("says PUBLIC_BASE_URL is needed and offers no new report, and hides management from viewers", async () => {
    api.listReports.mockResolvedValue({ reports: [REPORT], publicBaseUrl: false });
    setup();
    expect((await screen.findByRole("status")).textContent).toContain("PUBLIC_BASE_URL");
    expect(screen.getByRole("button", { name: /New report/ }).hasAttribute("disabled")).toBe(true);
    cleanup();
    setup(false);
    await screen.findByTestId("report-row");
    expect(screen.queryByRole("button", { name: /New report/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Weekly shop" })).toBeNull();
  });

  it("labels schedules", () => {
    expect(scheduleLabel({ kind: "daily", dayOfWeek: null, hour: 9, minute: 0, timezone: "Europe/Berlin" })).toBe("Daily at 09:00 Europe/Berlin");
  });
});
