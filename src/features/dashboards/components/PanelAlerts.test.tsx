import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { useAuthStore } from "@/stores/auth";
import type { DashboardDetail, PanelInput } from "@/api/dashboards";

import { PanelAlertsButton } from "./PanelAlerts";

const perms = vi.hoisted(() => ({ granted: new Set<string>(["alerting:view", "alerting:edit", "alerting:delete"]) }));
vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = { isAuthenticated: true, hasPermission: (p: string) => perms.granted.has(p) };
  return { ...actual, useRbacStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const VIZ = { version: 1 as const, type: "line" as const, x: "t", y: ["lag"], series: null, unit: "count" as const, decimals: 0, thresholds: [], colorScheme: "violet" as const, reduce: null };
const PANEL: PanelInput = { id: "p1", title: "Consumer lag", sql: "SELECT 1", viz: VIZ, width: 6, height: "m", fleet: false };
const DETAIL = {
  dashboard: { id: "d1", title: "Kafka", description: "", ownerId: "u1", timeRange: "6h", refreshSeconds: 0, variables: [], version: 1, createdAt: 0, updatedAt: 0 },
  panels: [], shares: [], pinned: false, lint: {}, alertCounts: { p1: 1 },
  access: { owner: true, view: true, edit: true, delete: true, share: true },
} as unknown as DashboardDetail;
const ALERT = {
  id: "a1", dashboardId: "d1", panelId: "p1", ownerId: "u1", name: "Lag high", severity: "critical", connectionId: "c1", channelIds: ["ch1"], enabled: true,
  config: { column: "lag", reduce: "last", op: ">", value: 1000, forEvaluations: 1, everyMinutes: 5, range: "1h", values: {} },
  createdAt: 0, updatedAt: 0,
  status: { state: "firing", breaches: 1, since: 0, lastEvalAt: 0, lastValue: 1500, lastError: null },
};

function setup(alerts: unknown[] = [ALERT]): void {
  server.use(http.get("/api/dashboards/d1/alerts", () => HttpResponse.json({ success: true, data: alerts })));
  useAuthStore.setState({ activeConnectionId: "c1" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PanelAlertsButton detail={DETAIL} panelId="p1" panel={PANEL} view={{ range: { kind: "relative", value: "6h" }, values: {} }} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  perms.granted = new Set(["alerting:view", "alerting:edit", "alerting:delete"]);
});

describe("PanelAlertsButton", () => {
  it("shows the worst state on the bell and the alert's last value", async () => {
    setup();
    const bell = await screen.findByRole("button", { name: /1 alert on Consumer lag, Firing/ });
    fireEvent.click(bell);
    expect(await screen.findByText("Lag high")).toBeTruthy();
    expect(screen.getByText(/Last value 2K/)).toBeTruthy();
  });

  it("shows an alert's error", async () => {
    setup([{ ...ALERT, status: { ...ALERT.status, state: "error", lastValue: null, lastError: "The alert's owner is deactivated" } }]);
    fireEvent.click(await screen.findByRole("button", { name: /Error/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("deactivated");
  });

  it("is hidden without alerting:view", () => {
    perms.granted = new Set();
    setup();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
