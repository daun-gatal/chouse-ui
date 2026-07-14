import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FleetPage from "./Fleet";

const mocks = vi.hoisted(() => {
  const connectionsQuery: {
    data: Array<{ id: string; name: string; host: string; port: number }> | undefined;
    error: Error | null;
    isError: boolean;
    isLoading: boolean;
  } = {
    data: undefined,
    error: null,
    isError: false,
    isLoading: true,
  };
  return { connectionsQuery };
});

vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
}));

vi.mock("@/hooks/useFleetMetrics", () => ({
  FLEET_STATUS_RANK: { loading: 0, down: 1, degraded: 2, healthy: 3 },
  computeFleetStatus: () => "loading",
  fetchFleetSummary: async () => undefined,
  fleetSummaryQueryKey: (connectionId: string) => ["fleet", connectionId],
  isSnapshotFresh: () => false,
  nodeSeries: () => [],
  nodeStatusFromSnapshot: () => "loading",
  summaryFromSnapshot: () => undefined,
  useFleetConnections: () => mocks.connectionsQuery,
  useFleetHistory: () => ({ byNode: new Map() }),
  useFleetSnapshots: () => ({ data: undefined }),
}));

vi.mock("@/components/common/InfoDialog", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/FleetCard", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/FleetRow", () => ({
  default: () => null,
  FleetListHeader: () => null,
}));
vi.mock("@/features/fleet/components/FleetTrendPanel", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/FleetExceptionsFeed", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/FleetInventoryStrip", () => ({ default: () => null }));

const FLEET_SECTION_TARGETS = ["fleet-inventory", "fleet-trends", "fleet-exceptions"] as const;

function expectSectionTargetCount(count: number): void {
  expect(document.querySelectorAll('[data-onboarding-id="fleet-controls"]')).toHaveLength(1);
  for (const target of FLEET_SECTION_TARGETS) {
    const targets = document.querySelectorAll(`[data-onboarding-id="${target}"]`);
    expect(targets).toHaveLength(count);
    if (count === 1) {
      expect(targets[0]?.classList.contains("h-16")).toBe(true);
      expect(targets[0]?.classList.contains("max-w-[16rem]")).toBe(true);
    }
  }
}

describe("Fleet onboarding section targets", () => {
  beforeEach(() => {
    mocks.connectionsQuery.data = undefined;
    mocks.connectionsQuery.error = null;
    mocks.connectionsQuery.isError = false;
    mocks.connectionsQuery.isLoading = true;
  });

  it("does not expose section targets while the initial connection request is loading", () => {
    render(<MemoryRouter><FleetPage /></MemoryRouter>);

    expectSectionTargetCount(0);
  });

  it("exposes one stable section target when connections fail to load", () => {
    mocks.connectionsQuery.error = new Error("Unavailable");
    mocks.connectionsQuery.isError = true;
    mocks.connectionsQuery.isLoading = false;

    render(<MemoryRouter><FleetPage /></MemoryRouter>);

    expectSectionTargetCount(1);
  });

  it("exposes one stable section target for an empty successful response", () => {
    mocks.connectionsQuery.data = [];
    mocks.connectionsQuery.isLoading = false;

    render(<MemoryRouter><FleetPage /></MemoryRouter>);

    expectSectionTargetCount(1);
  });

  it("keeps exactly one controls and section target after fleet panels mount", () => {
    mocks.connectionsQuery.data = [
      { id: "node-1", name: "Node 1", host: "node-1.local", port: 8123 },
      { id: "node-2", name: "Node 2", host: "node-2.local", port: 8123 },
    ];
    mocks.connectionsQuery.isLoading = false;

    render(<MemoryRouter><FleetPage /></MemoryRouter>);

    expectSectionTargetCount(1);
  });
});
