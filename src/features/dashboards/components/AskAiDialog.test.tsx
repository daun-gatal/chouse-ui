import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardDetail, DashboardDraft, DraftPanel } from "@/api/dashboards";

import { AskAiDialog, mergeVariables, sectionsOf } from "./AskAiDialog";

const api = vi.hoisted(() => ({ draftDashboard: vi.fn(), createDashboard: vi.fn(), getDashboard: vi.fn(), updateDashboard: vi.fn(), arrangePanels: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));
vi.mock("@/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/client")>()), getConnectionId: () => "c1" }));

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const PIE = { ...VIZ, type: "pie" as const };
const chart = (title: string, sql: string, viz: typeof VIZ | typeof PIE = VIZ): DraftPanel["panel"] => ({ id: null, kind: "chart", title, sql, viz, fleet: false });
const DRAFT: DashboardDraft = {
  title: "Orders pipeline",
  description: "Kafka to MergeTree",
  variables: [],
  problems: [],
  panels: [
    { status: "ok", panel: chart("Insert rate", "SELECT 1 AS t, 2 AS v"), title: "Insert rate", sql: "SELECT 1 AS t, 2 AS v", rationale: "Rows per second", role: "trend", importance: "primary", section: "Throughput", reasons: [], lint: [] },
    {
      status: "attention", panel: chart("By database", "SELECT d AS t, b AS v FROM x", PIE), title: "By database", sql: "SELECT d AS t, b AS v FROM x", rationale: "Where bytes go", role: "breakdown", importance: "secondary", section: "Where", reasons: [],
      lint: [
        { code: "pie_without_limit", message: "Keep the top 12.", fixedSql: "SELECT d AS t, b AS v FROM x\nLIMIT 12" },
        { code: "too_many_slices", message: "Too many slices.", fixedViz: { ...PIE, type: "horizontal_bar" } },
      ],
    },
    { status: "blocked", panel: null, title: "Bad", sql: "SELECT 1", rationale: "x", role: null, importance: null, section: null, reasons: ["Chart settings: type: invalid"], lint: [] },
  ],
};

function setup(existing: DashboardDetail | null = null): void {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AskAiDialog open onOpenChange={() => undefined} existing={existing} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function draftIt(): Promise<void> {
  fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch the orders pipeline" } });
  fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
  expect(await screen.findByTestId("draft-review")).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AskAiDialog", () => {
  it("drafts, shows roles, lets the user apply fixes, and creates the dashboard laid out by the server", async () => {
    api.draftDashboard.mockResolvedValue(DRAFT);
    api.arrangePanels.mockResolvedValue({ placed: [
      { key: null, heading: { title: "Where", description: "" }, layout: { x: 0, y: 0, w: 24, h: 2 } },
      { key: "1", layout: { x: 0, y: 2, w: 24, h: 9 } },
    ] });
    api.createDashboard.mockResolvedValue({ dashboard: { id: "d9" } });
    setup();
    await draftIt();
    expect(api.draftDashboard.mock.calls[0][0]).toEqual({ goal: "Watch the orders pipeline", connectionId: "c1", existing: null });
    expect(screen.getAllByTestId("draft-role").map((e) => e.textContent)).toEqual(["trend · primary", "breakdown"]);

    const blocked = screen.getByRole("checkbox", { name: "Include Bad" });
    expect(blocked.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Chart settings: type: invalid")).toBeTruthy();

    for (const button of screen.getAllByRole("button", { name: "Apply fix" })) fireEvent.click(button);
    expect(screen.queryByText("Keep the top 12.")).toBeNull();
    expect(screen.queryByText("Too many slices.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Insert rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Create with 1 panel" }));

    await waitFor(() => expect(api.createDashboard).toHaveBeenCalledTimes(1));
    expect(api.arrangePanels.mock.calls[0][0]).toEqual([
      { heading: { title: "Where", description: "" }, panels: [{ key: "1", kind: "chart", chartType: "horizontal_bar", role: "breakdown", importance: "secondary", size: null }] },
    ]);
    const input = api.createDashboard.mock.calls[0][0];
    expect(input.title).toBe("Orders pipeline");
    expect(input.connectionScope).toEqual({ kind: "only", connectionIds: ["c1"] });
    expect(input.annotations).toEqual(["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"]);
    expect(input.panels).toEqual([
      { id: null, kind: "heading", title: "Where", description: "", layout: { x: 0, y: 0, w: 24, h: 2 } },
      { id: null, kind: "chart", title: "By database", sql: "SELECT d AS t, b AS v FROM x\nLIMIT 12", viz: { ...PIE, type: "horizontal_bar" }, fleet: false, layout: { x: 0, y: 2, w: 24, h: 9 } },
    ]);
  });

  it("adds the panels below an existing dashboard's, at the version it has now", async () => {
    api.draftDashboard.mockResolvedValue(DRAFT);
    api.arrangePanels.mockResolvedValue({ placed: [{ key: "0", layout: { x: 0, y: 0, w: 24, h: 9 } }] });
    const existingPanel = { id: "p1", dashboardId: "d1", position: 0, createdAt: 0, updatedAt: 0, kind: "chart" as const, title: "Old", sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 } };
    const detail = {
      dashboard: { id: "d1", title: "Orders", description: "", ownerId: "u", timeRange: "6h" as const, refreshSeconds: 0 as const, connectionScope: { kind: "any" as const }, variables: [], annotations: [], version: 4, createdAt: 0, updatedAt: 0 },
      panels: [existingPanel, { ...existingPanel, id: "p2", kind: "text" as const, title: "", markdown: "x", layout: { x: 12, y: 0, w: 6, h: 12 } }],
    } as unknown as DashboardDetail;
    api.getDashboard.mockResolvedValue(detail);
    api.updateDashboard.mockResolvedValue(detail);
    setup(detail);
    await draftIt();
    expect(api.draftDashboard.mock.calls[0][0].existing).toEqual({ title: "Orders", variables: [], panels: [{ title: "Old", sql: "SELECT 1" }] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include By database" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 panel" }));
    await waitFor(() => expect(api.updateDashboard).toHaveBeenCalledTimes(1));
    const [id, version, input] = api.updateDashboard.mock.calls[0];
    expect([id, version]).toEqual(["d1", 4]);
    expect(input.panels.map((p: { id: string | null; layout: unknown }) => [p.id, p.layout])).toEqual([
      ["p1", { x: 0, y: 0, w: 12, h: 9 }],
      ["p2", { x: 12, y: 0, w: 6, h: 12 }],
      [null, { x: 0, y: 12, w: 24, h: 9 }],
    ]);
  });

  it("shows why drafting failed", async () => {
    api.draftDashboard.mockRejectedValue(new Error("No AI model is configured"));
    setup();
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch replication lag" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("No AI model is configured");
  });
});

describe("sectionsOf", () => {
  it("groups accepted panels by section in the order the model gave them, and skips unreadable ones", () => {
    const [a, b, c] = DRAFT.panels;
    expect(sectionsOf([{ index: 0, draft: a }, { index: 1, draft: b }, { index: 2, draft: c }, { index: 5, draft: { ...a, section: "Where" } }])).toEqual([
      { heading: { title: "Throughput", description: "" }, panels: [{ key: "0", kind: "chart", chartType: "line", role: "trend", importance: "primary", size: null }] },
      { heading: { title: "Where", description: "" }, panels: [
        { key: "1", kind: "chart", chartType: "pie", role: "breakdown", importance: "secondary", size: null },
        { key: "5", kind: "chart", chartType: "line", role: "trend", importance: "primary", size: null },
      ] },
    ]);
    expect(sectionsOf([{ index: 0, draft: { ...a, section: null } }])[0].heading).toBeNull();
  });
});

describe("mergeVariables", () => {
  it("adds new variables and keeps the dashboard's own definition of a name it has", () => {
    const own = { name: "db", label: "DB", kind: "identifier" as const, options: { source: "static" as const, values: ["a"] }, default: "a" };
    const drafted = [{ ...own, label: "Other" }, { ...own, name: "table", label: "Table" }];
    expect(mergeVariables([own], drafted)).toEqual({ variables: [own, drafted[1]], skipped: ["db"] });
  });
});
