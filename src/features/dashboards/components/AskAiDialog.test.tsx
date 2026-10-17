import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardDraft } from "@/api/dashboards";

import { AskAiDialog, mergeVariables } from "./AskAiDialog";

const api = vi.hoisted(() => ({ draftDashboard: vi.fn(), createDashboard: vi.fn(), getDashboard: vi.fn(), updateDashboard: vi.fn() }));
vi.mock("@/api/dashboards", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/dashboards")>()), ...api }));
vi.mock("@/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/client")>()), getConnectionId: () => "c1" }));

const VIZ = { version: 1 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null };
const panel = (title: string, sql: string) => ({ id: null, title, sql, viz: VIZ, width: 6 as const, height: "m" as const, fleet: false });
const DRAFT: DashboardDraft = {
  title: "Orders pipeline",
  description: "Kafka to MergeTree",
  variables: [],
  problems: [],
  panels: [
    { status: "ok", panel: panel("Insert rate", "SELECT 1 AS t, 2 AS v"), title: "Insert rate", sql: "SELECT 1 AS t, 2 AS v", rationale: "Rows per second", reasons: [], lint: [] },
    { status: "attention", panel: panel("By database", "SELECT d AS t, b AS v FROM x"), title: "By database", sql: "SELECT d AS t, b AS v FROM x", rationale: "Where bytes go", reasons: [], lint: [{ code: "pie_without_limit", message: "Keep the top 12.", fixedSql: "SELECT d AS t, b AS v FROM x\nLIMIT 12" }] },
    { status: "blocked", panel: null, title: "Bad", sql: "SELECT 1", rationale: "x", reasons: ["Chart settings: type: invalid"], lint: [] },
  ],
};

function setup(): void {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AskAiDialog open onOpenChange={() => undefined} existing={null} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AskAiDialog", () => {
  it("drafts, lets the user apply a fix, and creates the dashboard with only the panels they keep", async () => {
    api.draftDashboard.mockResolvedValue(DRAFT);
    api.createDashboard.mockResolvedValue({ dashboard: { id: "d9" } });
    setup();
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch the orders pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
    expect(await screen.findByTestId("draft-review")).toBeTruthy();
    expect(api.draftDashboard.mock.calls[0][0]).toEqual({ goal: "Watch the orders pipeline", connectionId: "c1", existing: null });

    const blocked = screen.getByRole("checkbox", { name: "Include Bad" });
    expect(blocked.getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Chart settings: type: invalid")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply fix" }));
    expect(screen.queryByText("Keep the top 12.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Insert rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Create with 1 panel" }));

    await waitFor(() => expect(api.createDashboard).toHaveBeenCalledTimes(1));
    const input = api.createDashboard.mock.calls[0][0];
    expect(input.title).toBe("Orders pipeline");
    expect(input.connectionId).toBe("c1");
    expect(input.panels.map((p: { title: string; sql: string }) => [p.title, p.sql])).toEqual([["By database", "SELECT d AS t, b AS v FROM x\nLIMIT 12"]]);
  });

  it("shows why drafting failed", async () => {
    api.draftDashboard.mockRejectedValue(new Error("No AI model is configured"));
    setup();
    fireEvent.change(screen.getByLabelText("What should the dashboard show?"), { target: { value: "Watch replication lag" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("No AI model is configured");
  });
});

describe("mergeVariables", () => {
  it("adds new variables and keeps the dashboard's own definition of a name it has", () => {
    const own = { name: "db", label: "DB", kind: "identifier" as const, options: { source: "static" as const, values: ["a"] }, default: "a" };
    const drafted = [{ ...own, label: "Other" }, { ...own, name: "table", label: "Table" }];
    expect(mergeVariables([own], drafted)).toEqual({ variables: [own, drafted[1]], skipped: ["db"] });
  });
});
