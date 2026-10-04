import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DataPage, { LegacyDataOpsRedirect } from "./Data";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));

vi.mock("@/stores", async () => {
  const actual = await vi.importActual<typeof import("@/stores/rbac")>("@/stores/rbac");
  return {
    RBAC_PERMISSIONS: actual.RBAC_PERMISSIONS,
    useRbacStore: () => ({
      hasPermission: (p: string) => perms.granted.has(p),
      hasAnyPermission: (ps: string[]) => ps.some((p) => perms.granted.has(p)),
    }),
  };
});

vi.mock("@/features/observe/hooks", () => ({ useIncidents: () => ({ data: [{ id: "i1" }, { id: "i2" }] }) }));
vi.mock("@/features/observe/CollectorStatusChip", () => ({ CollectorStatusChip: () => <span>collector</span> }));
vi.mock("@/features/dataops-ai", () => ({ DataOpsModelButton: () => null }));
vi.mock("@/features/observe/OverviewTab", () => ({ OverviewTab: () => <p>overview-body</p> }));
vi.mock("@/features/observe/IncidentsTab", () => ({ IncidentsTab: ({ source, id }: { source?: string; id?: string }) => <p>incidents-body {source} {id}</p> }));
vi.mock("@/features/observe/LineageTab", () => ({ LineageTab: () => <p>lineage-body</p> }));
vi.mock("@/features/observe/PipelinesTab", () => ({ PipelinesTab: () => <p>pipelines-body</p> }));
vi.mock("@/features/observe/DatasetsTab", () => ({ DatasetsTab: ({ database, table }: { database?: string; table?: string }) => <p>datasets-body {database} {table}</p> }));
vi.mock("@/features/observe/CoverageTab", () => ({ CoverageTab: () => <p>coverage-body</p> }));
vi.mock("@/features/observe/ContextTab", () => ({ ContextTab: () => <p>context-body</p> }));
vi.mock("@/features/scheduled-queries", () => ({ SUB_TABS: ["overview", "jobs"], ScheduledQueries: ({ sub }: { sub: string }) => <p>scheduled-body {sub}</p> }));

function Where(): JSX.Element {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}{location.search}</output>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/data/:tab?/:a?/:b?" element={<><DataPage /><Where /></>} />
        <Route path="/dataops/:feature?/:sub?" element={<LegacyDataOpsRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Data page RBAC gating", () => {
  beforeEach(() => perms.granted.clear());

  it("shows every tab to an observe + scheduled-queries user, with the incident count", () => {
    perms.granted = new Set(["observe:view", "scheduled_queries:view"]);
    renderAt("/data/overview");
    const pills = screen.getByRole("navigation", { name: "Data sections" });
    expect(pills.textContent).toContain("Overview");
    expect(pills.textContent).toContain("Lineage");
    expect(pills.textContent).toContain("Scheduled queries");
    expect(pills.textContent).toContain("2");
    expect(screen.getByText("overview-body")).toBeTruthy();
    expect(screen.getByText("collector")).toBeTruthy();
  });

  it("keeps a former DataOps user on exactly their features", () => {
    perms.granted = new Set(["data_health:view"]);
    renderAt("/data/datasets");
    const pills = screen.getByRole("navigation", { name: "Data sections" });
    expect(pills.textContent).toContain("Incidents");
    expect(pills.textContent).toContain("Datasets");
    expect(pills.textContent).not.toContain("Lineage");
    expect(pills.textContent).not.toContain("Scheduled queries");
    expect(screen.queryByText("collector")).toBeNull();
  });

  it("shows a no-permission state for a known tab the user may not open", () => {
    perms.granted = new Set(["data_health:view"]);
    renderAt("/data/lineage");
    expect(screen.queryByText("lineage-body")).toBeNull();
    expect(screen.getByText(/permission/i)).toBeTruthy();
  });

  it("passes deep-link segments to incidents and datasets", () => {
    perms.granted = new Set(["observe:view"]);
    renderAt("/data/incidents/observe/o%2F1");
    expect(screen.getByText("incidents-body observe o/1")).toBeTruthy();
  });

  it("lands an empty URL on the first allowed tab", () => {
    perms.granted = new Set(["scheduled_queries:view"]);
    renderAt("/data");
    expect(screen.getByTestId("where").textContent).toBe("/data/scheduled-queries/overview");
    expect(screen.getByText("scheduled-body overview")).toBeTruthy();
  });

  it("redirects old DataOps bookmarks", () => {
    perms.granted = new Set(["data_health:view", "scheduled_queries:view"]);
    renderAt("/dataops/scheduled-queries/runs");
    expect(screen.getByTestId("where").textContent).toBe("/data/scheduled-queries/jobs");
  });
});
