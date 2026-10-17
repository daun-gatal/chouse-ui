import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";

import DashboardsPage from "./Dashboards";

// TanStack's AbortSignal comes from jsdom, which Node's fetch rejects; run calls are mocked instead.
const runPanel = vi.hoisted(() => vi.fn());
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), runPanel }));

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = { isAuthenticated: true, hasPermission: () => true, hasAnyPermission: () => true };
  return { ...actual, useRbacStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const STAT = { version: 1, type: "stat", x: null, y: ["lag"], series: null, unit: "count", decimals: 0, thresholds: [], colorScheme: "violet", reduce: "last" };

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dashboard: { id: "d1", title: "Kafka", description: "Ingestion", ownerId: "u1", connectionId: "c1", timeRange: "6h", refreshSeconds: 0, variables: [], version: 4, createdAt: 0, updatedAt: 0 },
    panels: [{ id: "p1", dashboardId: "d1", position: 0, title: "Consumer lag", sql: "SELECT 1 AS lag", viz: STAT, width: 6, height: "s", fleet: false, createdAt: 0, updatedAt: 0 }],
    shares: [],
    access: { owner: true, view: true, edit: true, delete: true, share: true },
    pinned: false,
    lint: { p1: [] },
    alertCounts: {},
    ...overrides,
  };
}

const ok = (data: unknown) => HttpResponse.json({ success: true, data });
const RUN = { kind: "single", connectionId: "c1", window: { from: 1, to: 2, intervalSeconds: 60 }, data: { columns: [{ name: "lag", type: "UInt64" }], rows: [{ lag: 1234 }], elapsedMs: 3, readRows: 1, readBytes: 10, ranAt: 0 }, cached: false };

function setup(initial = "/dashboards/d1"): void {
  server.use(
    http.get("/api/dashboards/d1", () => ok(detail())),
    http.get("/api/rbac/connections/my", () => HttpResponse.json({ success: true, data: [{ id: "c1", name: "alpha", isActive: true }] })),
  );
  runPanel.mockReset();
  runPanel.mockResolvedValue(RUN);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/dashboards/:id?" element={<DashboardsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("Dashboards page", () => {
  it("shows a dashboard and runs its panels", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Kafka" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("stat-value").textContent).toBe("1K"));
    expect(runPanel.mock.calls[0].slice(0, 3)).toEqual(["d1", "p1", { range: { kind: "relative", value: "6h" }, values: {}, connectionId: "c1" }]);
  });

  it("shows a panel's error instead of an empty panel", async () => {
    setup();
    runPanel.mockRejectedValue(new Error("Access denied to kafka.offsets"));
    expect(await screen.findByText("Access denied to kafka.offsets")).toBeTruthy();
  });

  it("saves with the loaded version and reports a conflicting save", async () => {
    const bodies: unknown[] = [];
    setup();
    server.use(http.put("/api/dashboards/d1", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ success: false, error: { code: "CONFLICT", message: "This dashboard changed since you opened it.", category: "conflict" } }, { status: 409 });
    }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Someone saved this dashboard after you opened it/)).toBeTruthy();
    expect((bodies[0] as { version: number }).version).toBe(4);
  });

  it("says when a link's time range is not usable", async () => {
    setup("/dashboards/d1?range=5h");
    expect(await screen.findByText(/The link's time range "5h"/)).toBeTruthy();
  });

  it("lists dashboards and templates", async () => {
    server.use(
      http.get("/api/dashboards", () => ok([{ ...(detail().dashboard as object), panelCount: 1, ownerName: "u1", shares: [], access: detail().access, pinned: true }])),
      http.get("/api/dashboards/templates", () => ok([{ id: "replication", title: "Replication", description: "Replica delay", openFrom: null, dashboard: { panels: [{}, {}] } }])),
    );
    setup("/dashboards");
    expect(await screen.findAllByText("Kafka")).toHaveLength(2);
    expect(await screen.findByText("Replication")).toBeTruthy();
  });
});
