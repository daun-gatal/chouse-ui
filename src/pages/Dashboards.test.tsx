import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { useAuthStore } from "@/stores/auth";

import DashboardsPage from "./Dashboards";

// TanStack's AbortSignal comes from jsdom, which Node's fetch rejects; run calls are mocked instead.
const runPanel = vi.hoisted(() => vi.fn());
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), runPanel }));

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = { isAuthenticated: true, hasPermission: () => true, hasAnyPermission: () => true };
  return { ...actual, useRbacStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const STAT = { version: 2, type: "stat", x: null, y: ["lag"], series: null, unit: "count", decimals: 0, thresholds: [], colorScheme: "violet", reduce: "last", links: [], baseline: null };

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dashboard: { id: "d1", title: "Kafka", description: "Ingestion", ownerId: "u1", timeRange: "6h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 4, createdAt: 0, updatedAt: 0 },
    panels: [{ id: "p1", dashboardId: "d1", position: 0, kind: "chart", title: "Consumer lag", sql: "SELECT 1 AS lag", viz: STAT, fleet: false, layout: { x: 0, y: 0, w: 12, h: 6 }, createdAt: 0, updatedAt: 0 }],
    shares: [],
    access: { owner: true, view: true, edit: true, delete: true, share: true },
    pinned: false,
    lint: { p1: [] },
    alertCounts: {},
    scope: { kind: "any" },
    ...overrides,
  };
}

const ok = (data: unknown) => HttpResponse.json({ success: true, data });
const RUN = { kind: "single", connectionId: "c1", window: { from: 1, to: 2, intervalSeconds: 60 }, data: { columns: [{ name: "lag", type: "UInt64" }], rows: [{ lag: 1234 }], elapsedMs: 3, readRows: 1, readBytes: 10, ranAt: 0 }, cached: false };

function setup(initial = "/dashboards/d1", overrides: Record<string, unknown> = {}): void {
  server.use(
    http.get("/api/dashboards/d1", () => ok(detail(overrides))),
    http.get("/api/rbac/connections/my", () => HttpResponse.json({ success: true, data: [{ id: "c1", name: "alpha", isActive: true }, { id: "c2", name: "beta", isActive: true }] })),
  );
  runPanel.mockReset();
  runPanel.mockResolvedValue(RUN);
  useAuthStore.setState({ activeConnectionId: "c1" });
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
    expect(runPanel.mock.calls[0].slice(0, 3)).toEqual(["d1", "p1", { range: { kind: "relative", value: "6h" }, values: {} }]);
    expect(screen.queryByRole("combobox", { name: "Connection" })).toBeNull();
  });

  it("follows the dock's connection and asks for one when there is none", async () => {
    setup();
    await waitFor(() => expect(runPanel).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.setState({ activeConnectionId: "c2" }));
    await waitFor(() => expect(runPanel).toHaveBeenCalledTimes(2));
    act(() => useAuthStore.setState({ activeConnectionId: null }));
    expect(await screen.findByText("Pick a connection in the dock to run this panel")).toBeTruthy();
    expect(runPanel).toHaveBeenCalledTimes(2);
  });

  it("titles a fleet panel's footer by time and bytes, and counts failures with the list", async () => {
    const LINE = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };
    server.use(http.get("/api/dashboards/d1", () => ok(detail({ panels: [{ id: "p1", dashboardId: "d1", position: 0, title: "Per node", sql: "SELECT 1", viz: LINE, width: 6, height: "s", fleet: true, createdAt: 0, updatedAt: 0 }] }))));
    const data = (elapsedMs: number, readBytes: number) => ({ columns: [{ name: "t", type: "String" }, { name: "v", type: "UInt64" }], rows: [{ t: "a", v: 1 }], elapsedMs, readRows: 1, readBytes, ranAt: 0 });
    setup();
    runPanel.mockResolvedValue({ kind: "fleet", window: RUN.window, omitted: 0, connections: [
      { connectionId: "c1", connectionName: "alpha", ok: true, data: data(4, 1024), cached: false },
      { connectionId: "c2", connectionName: "beta", ok: true, data: data(9, 1024), cached: false },
      { connectionId: "c3", connectionName: "gamma", ok: false, error: "ClickHouse did not answer within 40 s" },
    ] });
    expect(await screen.findByText("1 of 3 connections failed")).toBeTruthy();
    expect(screen.getByTestId("panel-meta").textContent).toBe("9 ms · 2 KiB read");
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

  it("assigns connections from the chip next to the title, saved at the loaded version", async () => {
    const bodies: Array<{ version: number; dashboard: { connectionScope: unknown } }> = [];
    setup("/dashboards/d1", {
      dashboard: { ...(detail().dashboard as object), connectionScope: { kind: "only", connectionIds: ["c1"] } },
      scope: { kind: "only", connections: [{ id: "c1", name: "alpha" }], hidden: 0 },
    });
    server.use(http.put("/api/dashboards/d1", async ({ request }) => {
      bodies.push((await request.json()) as (typeof bodies)[number]);
      return ok(detail());
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Connections: alpha. Change" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Assign to beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].version).toBe(4);
    expect(bodies[0].dashboard.connectionScope).toEqual({ kind: "only", connectionIds: ["c1", "c2"] });
  });

  it("picks connections when making a dashboard, starting with the active one", async () => {
    const created: Array<{ connectionScope: unknown }> = [];
    server.use(
      http.get("/api/dashboards", () => ok([])),
      http.get("/api/dashboards/templates", () => ok([])),
      http.post("/api/dashboards", async ({ request }) => {
        created.push((await request.json()) as (typeof created)[number]);
        return ok(detail());
      }),
    );
    setup("/dashboards");
    fireEvent.click(await screen.findByRole("button", { name: /New dashboard/ }));
    expect((await screen.findByRole("checkbox", { name: "Assign to alpha" })).getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("checkbox", { name: "Assign to alpha" }));
    expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "All connections" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].connectionScope).toEqual({ kind: "any" });
  });

  it("says when a link's time range is not usable", async () => {
    setup("/dashboards/d1?range=5h");
    expect(await screen.findByText(/The link's time range "5h"/)).toBeTruthy();
  });

  it("shows where a dashboard is assigned instead of running it on another connection", async () => {
    setup("/dashboards/d1", { scope: { kind: "only", connections: [{ id: "c2", name: "beta" }], hidden: 1 } });
    expect(await screen.findByTestId("not-assigned")).toBeTruthy();
    expect(screen.getByText(/It is made for beta, 1 connection you cannot use/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to beta" })).toBeTruthy();
    expect(screen.getByTestId("dashboard-scope").textContent?.trim()).toBe("beta, 1 other");
    expect(runPanel).not.toHaveBeenCalled();
  });

  it("lists only the active connection's dashboards and counts the rest", async () => {
    const summary = (id: string, title: string, scope: unknown) => ({ ...(detail().dashboard as object), id, title, panelCount: 1, ownerName: "u1", shares: [], access: detail().access, pinned: false, scope });
    server.use(
      http.get("/api/dashboards", () => ok([
        summary("d1", "Kafka", { kind: "only", connections: [{ id: "c1", name: "alpha" }], hidden: 0 }),
        summary("d2", "Fleet overview", { kind: "any" }),
        summary("d3", "Billing", { kind: "only", connections: [{ id: "c2", name: "beta" }], hidden: 0 }),
      ])),
      http.get("/api/dashboards/templates", () => ok([])),
    );
    setup("/dashboards");
    expect(await screen.findByText("Kafka")).toBeTruthy();
    expect(screen.getByText("Fleet overview")).toBeTruthy();
    expect(screen.queryByText("Billing")).toBeNull();
    expect(screen.getByTestId("dashboards-elsewhere").textContent).toContain("1 more dashboard is assigned to other connections");
    // Same update time, so by name.
    expect(screen.getAllByTestId("dashboard-card-scope").map((e) => e.textContent)).toEqual(["All connections", "alpha"]);
  });

  it("lists dashboards in one table and templates in their own tab", async () => {
    server.use(
      http.get("/api/dashboards", () => ok([{ ...(detail().dashboard as object), panelCount: 1, ownerName: "u1", shares: [], access: detail().access, pinned: true, scope: { kind: "any" } }])),
      http.get("/api/dashboards/templates", () => ok([{ id: "replication", title: "Replication", description: "Replica delay", openFrom: null, dashboard: { panels: [{}, {}] } }])),
    );
    setup("/dashboards");
    expect(await screen.findByRole("link", { name: "Kafka" })).toBeTruthy();
    expect(screen.queryByText("Replication")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Templates/ }));
    expect(await screen.findByText("Replication")).toBeTruthy();
  });

  it("filters by tab and search, and pins from the row", async () => {
    const others = { ...detail().access, owner: false, edit: false, delete: false, share: false };
    const summary = (id: string, title: string, over: Record<string, unknown> = {}) => ({ ...(detail().dashboard as object), id, title, panelCount: 1, ownerName: "Ada", shares: [], access: detail().access, pinned: false, scope: { kind: "any" }, ...over });
    const pins: string[] = [];
    server.use(
      http.get("/api/dashboards", () => ok([summary("d1", "Kafka lag"), summary("d2", "Merges", { access: others }), summary("d3", "Disk usage", { access: others, description: "Kafka brokers" })])),
      http.get("/api/dashboards/templates", () => ok([])),
      http.post("/api/dashboards/:id/pin", ({ params }) => {
        pins.push(String(params.id));
        return ok({ pinned: true });
      }),
    );
    setup("/dashboards");
    expect(await screen.findAllByTestId("dashboard-row")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Shared with me/ }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("tab", { name: /Shared with me/ }));
    expect(screen.getAllByTestId("dashboard-row").map((r) => r.querySelector("a")?.textContent)).toEqual(["Disk usage", "Merges"]);
    fireEvent.change(screen.getByLabelText("Search dashboards"), { target: { value: "kafka" } });
    expect(screen.getAllByTestId("dashboard-row").map((r) => r.querySelector("a")?.textContent)).toEqual(["Disk usage"]);
    fireEvent.change(screen.getByLabelText("Search dashboards"), { target: { value: "nothing here" } });
    expect(screen.getByText('No dashboards match "nothing here".')).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    fireEvent.change(screen.getByLabelText("Search dashboards"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin Merges" }));
    await waitFor(() => expect(pins).toEqual(["d2"]));
  });

  it("pages a long list", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...(detail().dashboard as object), id: `d${i}`, title: `Dash ${String(i).padStart(2, "0")}`, panelCount: 1, ownerName: null, shares: [], access: detail().access, pinned: false, scope: { kind: "any" } }));
    server.use(http.get("/api/dashboards", () => ok(many)), http.get("/api/dashboards/templates", () => ok([])));
    setup("/dashboards?sort=title");
    expect(await screen.findAllByTestId("dashboard-row")).toHaveLength(25);
    expect(screen.getByText("1–25 of 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByTestId("dashboard-row")).toHaveLength(5);
    expect(screen.getAllByTestId("dashboard-row")[0].querySelector("a")?.textContent).toBe("Dash 25");
  });
});
