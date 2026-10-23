import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArrangeSection, DashboardDetail, DashboardDraft, DraftPanel, Placed } from "@/api/dashboards";
import { useAuthStore } from "@/stores/auth";

import { AskAiDialog, layoutFor } from "./AskAiDialog";

const api = vi.hoisted(() => ({
  draftDashboard: vi.fn(), createDashboard: vi.fn(), getDashboard: vi.fn(), updateDashboard: vi.fn(), arrangePanels: vi.fn(), previewPanel: vi.fn(),
}));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));
const perms = vi.hoisted(() => ({ granted: new Set<string>(["query:execute"]) }));
vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  const state = { hasPermission: (p: string) => perms.granted.has(p) };
  return { ...actual, useRbacStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<typeof import("sonner")>()), toast: toasts }));
// Requests go to the dock's active connection: the same one the auth store holds in the app.
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  getConnectionId: () => useAuthStore.getState().activeConnectionId,
}));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useNavigate: () => nav.navigate }));

const STAT = { version: 2 as const, type: "stat" as const, x: null, y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: "last" as const, links: [], baseline: null };
const TABLE = { ...STAT, type: "table" as const, y: [], reduce: null };

function chart(title: string, sql: string, viz: typeof STAT | typeof TABLE = STAT): DraftPanel["panel"] {
  return { id: null, kind: "chart", title, sql, viz, fleet: false };
}

const RATE: DraftPanel = { status: "ok", panel: chart("Insert rate", "SELECT 1 AS v"), title: "Insert rate", sql: "SELECT 1 AS v", rationale: "Rows per second", role: "kpi", importance: "primary", section: "Throughput", reasons: [], lint: [] };
const BY_DB: DraftPanel = {
  status: "attention", panel: chart("By database", "SELECT d, b FROM x", TABLE), title: "By database", sql: "SELECT d, b FROM x", rationale: "Where bytes go", role: "detail", importance: "secondary", section: "Where", reasons: [],
  lint: [{ code: "pie_without_limit", message: "Keep the top 12.", fixedSql: "SELECT d, b FROM x\nLIMIT 12" }],
};
const BAD: DraftPanel = { status: "blocked", panel: null, title: "Bad", sql: "SELECT 1", rationale: "x", role: null, importance: null, section: null, reasons: ["Chart settings: type: invalid"], lint: [] };
const DRAFT: DashboardDraft = { title: "Orders pipeline", description: "Kafka to MergeTree", variables: [], problems: [], panels: [RATE, BY_DB, BAD] };

/** The layout engine, simplified: each section's heading, then its panels one under another. */
function arrange(sections: ArrangeSection[]): { placed: Placed[] } {
  const placed: Placed[] = [];
  let y = 0;
  for (const s of sections) {
    if (s.heading) {
      placed.push({ key: null, heading: s.heading, layout: { x: 0, y, w: 24, h: 2 } });
      y += 2;
    }
    for (const p of s.panels) {
      placed.push({ key: p.key, layout: { x: 0, y, w: 24, h: 6 } });
      y += 6;
    }
  }
  return { placed };
}

const RESULT = { result: { kind: "single", connectionId: "c1", window: { from: 0, to: 1, intervalSeconds: 60 }, data: { columns: [{ name: "v", type: "UInt64" }], rows: [{ v: 7 }], elapsedMs: 1, readRows: 1, readBytes: 1, ranAt: 0, timezone: null }, cached: false }, lint: [] };

function existingDashboard(overrides: Partial<DashboardDetail["dashboard"]> = {}, panels = 1): DashboardDetail {
  const panel = (i: number) => ({ id: `e${i}`, dashboardId: "d1", position: i, createdAt: 0, updatedAt: 0, kind: "chart" as const, title: `Old ${i}`, sql: "SELECT 1", viz: STAT, fleet: false, layout: { x: 0, y: i * 4, w: 12, h: 4 } });
  return {
    dashboard: { id: "d1", title: "Orders", description: "", ownerId: "u", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], version: 4, createdAt: 0, updatedAt: 0, ...overrides },
    panels: Array.from({ length: panels }, (_, i) => panel(i)),
    shares: [], access: { owner: true, view: true, edit: true, share: true, delete: true }, pinned: false, lint: {}, alertCounts: {}, scope: { kind: "any" },
  };
}

function setWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function setup(existing: DashboardDetail | null = null, onOpenChange = vi.fn()): { onOpenChange: ReturnType<typeof vi.fn> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AskAiDialog open onOpenChange={onOpenChange} existing={existing} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

async function draftIt(goal = "Watch the orders pipeline"): Promise<void> {
  fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: goal } });
  fireEvent.click(screen.getByRole("button", { name: "Draft" }));
  expect(await screen.findByTestId("review-header")).toBeTruthy();
}

function primary(): HTMLButtonElement {
  return screen.getByTestId("primary-action") as HTMLButtonElement;
}

beforeEach(() => {
  setWidth(1440);
  perms.granted = new Set(["query:execute"]);
  useAuthStore.setState({ activeConnectionId: "c1", activeConnectionName: "Prod" });
  api.draftDashboard.mockResolvedValue(DRAFT);
  api.arrangePanels.mockImplementation(async (sections: ArrangeSection[]) => arrange(sections));
  api.previewPanel.mockResolvedValue(RESULT);
  api.createDashboard.mockResolvedValue({ dashboard: { id: "d9" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("layoutFor", () => {
  it("puts the list beside the preview on wide screens, tabs on tablets and phones", () => {
    expect([layoutFor(1440), layoutFor(1100), layoutFor(1099), layoutFor(768), layoutFor(767), layoutFor(390)]).toEqual(["wide", "wide", "tablet", "tablet", "phone", "phone"]);
  });
});

describe("AskAiDialog on a wide screen", () => {
  it("drafts, shows the panels by section beside a live preview laid out by the server, and creates the dashboard", async () => {
    setup();
    await draftIt();
    expect(api.draftDashboard.mock.calls[0][0]).toEqual({ goal: "Watch the orders pipeline", connectionId: "c1", existing: null });
    expect((screen.getByLabelText("Dashboard title") as HTMLInputElement).value).toBe("Orders pipeline");
    // Above the app's dock (z-70/80), so its rail does not cover the review's left edge.
    expect(screen.getByTestId("ask-ai").className).toContain("z-[90]");

    const list = screen.getByTestId("draft-panel-list");
    expect(within(list).getAllByRole("region").map((s) => s.getAttribute("aria-label"))).toEqual(["Throughput", "Where", "Top of the dashboard"]);
    expect(within(list).getByText("Chart settings: type: invalid")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Include Bad" }).getAttribute("data-disabled")).not.toBeNull();

    await waitFor(() => expect(screen.getAllByTestId("draft-preview-card")).toHaveLength(2));
    expect(api.arrangePanels.mock.calls.at(-1)?.[0]).toEqual([
      { heading: { title: "Throughput", description: "" }, panels: [{ key: "p1", kind: "chart", chartType: "stat", role: "kpi", importance: "primary", size: null }] },
      { heading: { title: "Where", description: "" }, panels: [{ key: "p2", kind: "chart", chartType: "table", role: "detail", importance: "secondary", size: null }] },
    ]);
    await waitFor(() => expect(api.previewPanel).toHaveBeenCalledTimes(2));
    expect(api.previewPanel.mock.calls[0][0]).toEqual({ sql: "SELECT 1 AS v", viz: STAT, fleet: false, variables: [], values: {}, range: { kind: "relative", value: "6h" }, connectionScope: { kind: "only", connectionIds: ["c1"] } });
    expect(await screen.findByTestId("stat-value")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply 1 fix" }));
    expect(primary().textContent).toContain("Create dashboard · 2");
    fireEvent.change(screen.getByLabelText("Dashboard title"), { target: { value: "My orders" } });
    // The fix changed one panel's SQL, so that panel ran again.
    await waitFor(() => expect(api.previewPanel).toHaveBeenCalledTimes(3));
    fireEvent.click(primary());

    await waitFor(() => expect(api.createDashboard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Dashboard created"));
    // The save invalidates the dashboards cache; the review's previews are not part of it and do not run again.
    expect(api.previewPanel).toHaveBeenCalledTimes(3);
    const input = api.createDashboard.mock.calls[0][0];
    expect(input).toMatchObject({ title: "My orders", description: "Kafka to MergeTree", timeRange: "6h", connectionScope: { kind: "only", connectionIds: ["c1"] } });
    expect(input.panels.map((p: { kind: string; title: string; sql?: string }) => [p.kind, p.title, p.sql ?? null])).toEqual([
      ["heading", "Throughput", null], ["chart", "Insert rate", "SELECT 1 AS v"], ["heading", "Where", null], ["chart", "By database", "SELECT d, b FROM x\nLIMIT 12"],
    ]);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith("/dashboards/d9", undefined));
  });

  it("asks before creating with panels that need a look, and can show them instead", async () => {
    setup();
    await draftIt();
    fireEvent.click(primary());
    expect(await screen.findByText("1 included panel has warnings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review them" }));
    const list = screen.getByTestId("draft-panel-list");
    await waitFor(() => expect(within(list).getAllByTestId("draft-panel").map((r) => r.textContent)).toEqual([expect.stringContaining("By database")]));
    expect(api.createDashboard).not.toHaveBeenCalled();

    fireEvent.click(primary());
    fireEvent.click(await screen.findByRole("button", { name: "Create anyway" }));
    await waitFor(() => expect(api.createDashboard).toHaveBeenCalledTimes(1));
  });

  it("says why it cannot create: nothing selected, or no title", async () => {
    setup();
    await draftIt();
    fireEvent.change(screen.getByLabelText("Dashboard title"), { target: { value: "  " } });
    expect(primary().disabled).toBe(true);
    expect(screen.getByText("Give the dashboard a title")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Dashboard title"), { target: { value: "Orders" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include all of Throughput" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include By database" }));
    expect(primary().disabled).toBe(true);
    expect(screen.getByText("Select at least one panel")).toBeTruthy();
    expect(await screen.findByText(/No panels are selected/)).toBeTruthy();
  });

  it("opens a panel's details in place of the list, with its fix, SQL and a way back", async () => {
    setup();
    await draftIt();
    fireEvent.click(screen.getByRole("button", { name: "Show details of By database" }));
    const detail = screen.getByTestId("draft-panel-detail");
    expect(within(detail).getByText("Where bytes go")).toBeTruthy();
    expect(within(detail).queryByTestId("draft-sql")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Show SQL" }));
    expect(within(detail).getByTestId("draft-sql").textContent).toBe("SELECT d, b FROM x");
    fireEvent.click(within(detail).getByRole("button", { name: "Apply fix" }));
    expect(within(detail).getByTestId("draft-sql").textContent).toBe("SELECT d, b FROM x\nLIMIT 12");
    expect(within(detail).getByText("Checked")).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "All panels" }));
    expect(screen.getByTestId("draft-panel-list")).toBeTruthy();
  });

  it("refines the draft with what the user has now, and undo brings it back", async () => {
    setup();
    await draftIt();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include By database" }));
    api.draftDashboard.mockResolvedValueOnce({ ...DRAFT, title: "Refined", panels: [{ ...RATE, title: "Disk usage", panel: chart("Disk usage", "SELECT 2 AS v") }] });
    fireEvent.click(screen.getByRole("button", { name: /Refine/ }));
    fireEvent.change(await screen.findByLabelText("What should change in the draft?"), { target: { value: "Add disk usage" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Show details of Disk usage" })).toBeTruthy());
    const request = api.draftDashboard.mock.calls[1][0];
    expect(request.goal).toBe("Watch the orders pipeline");
    expect(request.revision.feedback).toBe("Add disk usage");
    expect(request.revision.panelIndex).toBeNull();
    expect(request.revision.previous.panels.map((p: { title: string; included: boolean }) => [p.title, p.included])).toEqual([["Insert rate", true], ["By database", false], ["Bad", false]]);
    expect((screen.getByLabelText("Dashboard title") as HTMLInputElement).value).toBe("Refined");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Show details of By database" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Include By database" }) as HTMLButtonElement).getAttribute("data-state")).toBe("unchecked");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("keeps the draft and says why when a refine fails", async () => {
    setup();
    await draftIt();
    api.draftDashboard.mockRejectedValueOnce(new Error("The model is overloaded."));
    fireEvent.click(screen.getByRole("button", { name: /Refine/ }));
    fireEvent.change(await screen.findByLabelText("What should change in the draft?"), { target: { value: "Add disk usage" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The model is overloaded. The draft is unchanged.");
    expect(screen.getAllByTestId("draft-panel")).toHaveLength(3);
  });

  it("regenerates one panel in place with the user's note", async () => {
    setup();
    await draftIt();
    fireEvent.click(screen.getByRole("button", { name: "Show details of Insert rate" }));
    api.draftDashboard.mockResolvedValueOnce({ ...DRAFT, panels: [{ ...RATE, title: "Insert rate per table", panel: chart("Insert rate per table", "SELECT 3 AS v") }] });
    fireEvent.change(screen.getByLabelText("What should change in Insert rate"), { target: { value: "per table" } });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    // The detail is drawn afresh for the new panel, so it is looked up again.
    await waitFor(() => expect(within(screen.getByTestId("draft-panel-detail")).getByRole("heading", { name: "Insert rate per table" })).toBeTruthy());
    expect((within(screen.getByTestId("draft-panel-detail")).getByLabelText("What should change in Insert rate per table") as HTMLTextAreaElement).value).toBe("");
    const request = api.draftDashboard.mock.calls[1][0];
    expect(request.revision).toMatchObject({ feedback: "per table", panelIndex: 0 });
    fireEvent.click(screen.getByRole("button", { name: "All panels" }));
    expect(screen.getAllByTestId("draft-panel").map((r) => r.textContent?.includes("Insert rate per table"))).toEqual([true, false, false]);
  });

  it("cancels a refine: the late reply is ignored and the draft stays", async () => {
    setup();
    await draftIt();
    let finish: (d: DashboardDraft) => void = () => undefined;
    api.draftDashboard.mockImplementationOnce(() => new Promise<DashboardDraft>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /Refine/ }));
    fireEvent.change(await screen.findByLabelText("What should change in the draft?"), { target: { value: "Add disk usage" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect(await screen.findByText("Refining the draft…")).toBeTruthy();
    expect(primary().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => finish({ ...DRAFT, panels: [{ ...RATE, title: "Late" }] }));
    expect(screen.queryByText("Late")).toBeNull();
    expect(screen.getAllByTestId("draft-panel")).toHaveLength(3);
    expect(primary().disabled).toBe(false);
  });

  it("ties the draft to the connection it was checked on", async () => {
    setup();
    await draftIt();
    await waitFor(() => expect(api.previewPanel).toHaveBeenCalledTimes(2));
    act(() => useAuthStore.setState({ activeConnectionId: "c2", activeConnectionName: "Staging" }));
    expect(screen.getByTestId("connection-changed").textContent).toContain("You switched to Staging. These panels were checked on Prod");
    expect(primary().disabled).toBe(true);
    expect(screen.getByText("Switch back to Prod to add these panels")).toBeTruthy();
    expect(screen.getByTestId("preview-blocked")).toBeTruthy();
    expect(api.previewPanel).toHaveBeenCalledTimes(2);

    act(() => useAuthStore.setState({ activeConnectionId: "c1", activeConnectionName: "Prod" }));
    expect(screen.queryByTestId("connection-changed")).toBeNull();
    expect(primary().disabled).toBe(false);
  });

  it("reviews without previews for a user who cannot run queries", async () => {
    perms.granted = new Set();
    setup();
    await draftIt();
    expect((await screen.findByTestId("preview-blocked")).textContent).toContain("needs permission to run queries");
    expect(api.previewPanel).not.toHaveBeenCalled();
    expect(primary().textContent).toContain("Create dashboard · 2");
  });

  it("asks before throwing a draft away, and starts over without asking when nothing changed", async () => {
    const { onOpenChange } = setup();
    await draftIt();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(await screen.findByText("Discard this draft?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect((screen.getByLabelText("What should the dashboard show?") as HTMLTextAreaElement).value).toBe("Watch the orders pipeline");

    await draftIt();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Insert rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(await screen.findByText("Start over?")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start over" }));
    expect(await screen.findByTestId("ask-step")).toBeTruthy();

    await draftIt();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows why drafting failed, and cancels a draft in progress", async () => {
    api.draftDashboard.mockRejectedValueOnce(new Error("No AI model is configured"));
    setup();
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch replication lag" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No AI model is configured");

    let finish: (d: DashboardDraft) => void = () => undefined;
    api.draftDashboard.mockImplementationOnce(() => new Promise<DashboardDraft>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect(await screen.findByTestId("drafting")).toBeTruthy();
    expect(api.draftDashboard.mock.calls[1][1].signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.draftDashboard.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => finish(DRAFT));
    expect(screen.getByTestId("ask-step")).toBeTruthy();
  });

  it("drafts with Ctrl+Enter, and only when there is a connection", async () => {
    useAuthStore.setState({ activeConnectionId: null, activeConnectionName: null });
    setup();
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch replication lag" } });
    expect(screen.getByTestId("draft-blocked").textContent).toContain("Pick a connection");
    expect((screen.getByRole("button", { name: "Draft" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => useAuthStore.setState({ activeConnectionId: "c1", activeConnectionName: "Prod" }));
    fireEvent.keyDown(screen.getByLabelText("What should the dashboard show?"), { key: "Enter", ctrlKey: true });
    expect(await screen.findByTestId("review-header")).toBeTruthy();
  });
});

describe("AskAiDialog adding to an existing dashboard", () => {
  it("drafts with the dashboard as context, previews below its panels, and adds the new ones at its current version", async () => {
    const detail = existingDashboard({ variables: [{ name: "db", label: "DB", kind: "string", options: { source: "static", values: ["a"] }, default: "a" }] });
    api.getDashboard.mockResolvedValue(detail);
    api.updateDashboard.mockImplementation(async (_id: string, _v: number, input: { panels: unknown[] }) => ({ ...detail, panels: [...detail.panels, { ...detail.panels[0], id: "n1", kind: "heading" }, { ...detail.panels[0], id: "n2" }], _input: input }));
    setup(detail);
    expect(screen.getByText("What should Orders also show?")).toBeTruthy();
    await draftIt();
    expect(api.draftDashboard.mock.calls[0][0].existing).toEqual({ title: "Orders", variables: detail.dashboard.variables, panels: [{ title: "Old 0", sql: "SELECT 1" }] });
    expect(screen.getByText("Add panels to Orders")).toBeTruthy();
    expect((await screen.findByTestId("existing-panels-note")).textContent).toContain("1 existing panel above");
    await waitFor(() => expect(api.previewPanel).toHaveBeenCalled());
    expect(api.previewPanel.mock.calls[0][0]).toMatchObject({ range: { kind: "relative", value: "1h" }, connectionScope: { kind: "any" }, variables: detail.dashboard.variables, values: { db: "a" } });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include By database" }));
    fireEvent.click(primary());
    await waitFor(() => expect(api.updateDashboard).toHaveBeenCalledTimes(1));
    const [id, version, input] = api.updateDashboard.mock.calls[0];
    expect([id, version]).toEqual(["d1", 4]);
    expect(input.panels.map((p: { id: string | null; kind: string; layout: { y: number } }) => [p.id, p.kind, p.layout.y])).toEqual([["e0", "chart", 0], [null, "heading", 4], [null, "chart", 6]]);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith("/dashboards/d1", { state: { highlightPanels: ["n1", "n2"] } }));
    // The section heading placed with the chart is not counted, as the button did not count it.
    expect(toasts.success).toHaveBeenCalledWith("Added 1 panel");
  });

  it("does not add more panels than the dashboard can hold, counting section headings", async () => {
    setup(existingDashboard({}, 40));
    await draftIt();
    expect(primary().disabled).toBe(true);
    expect(screen.getByText("This dashboard already has 40 charts, the most it can hold")).toBeTruthy();
  });

  it("re-checks the room at save time against the dashboard as it is now", async () => {
    const detail = existingDashboard();
    api.getDashboard.mockResolvedValue(existingDashboard({}, 40));
    setup(detail);
    await draftIt();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include By database" }));
    fireEvent.click(primary());
    expect((await screen.findByText(/already has 40 charts/, { selector: "[role=alert]" })).textContent).toContain("40 charts");
    expect(api.updateDashboard).not.toHaveBeenCalled();
  });

  it("will not draft on a connection the dashboard is not assigned to", () => {
    const detail = { ...existingDashboard({ connectionScope: { kind: "only", connectionIds: ["c7"] } }), scope: { kind: "only" as const, connections: [{ id: "c7", name: "Other" }], hidden: 0 } };
    setup(detail);
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch replication lag" } });
    expect(screen.getByTestId("draft-blocked").textContent).toContain("not assigned to Prod");
    expect((screen.getByRole("button", { name: "Draft" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AskAiDialog on a phone", () => {
  it("shows tabs, the main action in a bottom bar, and a panel's details sliding up", async () => {
    setWidth(390);
    setup();
    await draftIt();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Preview", "Panels 2/3"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByTestId("bottom-bar")).getByTestId("primary-action").textContent).toContain("Create dashboard · 2");
    expect(within(screen.getByTestId("review-header")).queryByTestId("primary-action")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("draft-preview-card")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Show details of Insert rate" }));
    const sheet = await screen.findByRole("dialog", { name: "Insert rate" });
    expect(within(sheet).getByTestId("draft-panel-detail")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "All panels" })).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Insert rate" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "1 blocked: show them" }));
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("draft-panel")).toHaveLength(1);
  });
});
