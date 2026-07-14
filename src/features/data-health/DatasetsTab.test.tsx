import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetsTab } from "./DatasetsTab";

const guideActiveMock = vi.fn<() => boolean>(() => false);

vi.mock("@/features/onboarding", () => ({
  useOnboardingGuideActive: () => guideActiveMock(),
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: {
    DATA_HEALTH_DELETE: "health:delete",
    DATA_HEALTH_EDIT: "health:edit",
    DATA_HEALTH_RUN: "health:run",
  },
  useRbacStore: (selector: (state: { hasPermission: () => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

vi.mock("@/features/data-health/hooks", () => ({
  useDataHealthPromises: () => ({
    data: [{
      checks: [],
      criticality: "high",
      databaseName: "analytics",
      id: "promise-1",
      lastHealthyAt: null,
      name: "Orders are fresh",
      status: "healthy",
      tableName: "orders",
    }],
    isLoading: false,
  }),
  useDeleteDataHealthPromise: () => ({ mutateAsync: vi.fn() }),
  useRunDataHealthPromise: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/features/data-health/PromiseDetail", () => ({
  PromiseDetail: () => <div>Selected promise detail</div>,
}));

vi.mock("@/features/data-health/PromiseWizard", () => ({
  PromiseWizard: ({ open }: { open: boolean }) => open ? <div>New promise wizard</div> : null,
}));

describe("DatasetsTab onboarding targets", () => {
  beforeEach(() => {
    guideActiveMock.mockReturnValue(false);
  });

  it("keeps the create target available while a promise detail is selected during a guide", () => {
    guideActiveMock.mockReturnValue(true);
    render(<DatasetsTab selectedPromiseId="promise-1" onSelectedPromiseChange={vi.fn()} />);

    const target = document.querySelector('[data-onboarding-id="dataops-health-create"]');
    expect(target).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New promise" }));
    expect(screen.getByText("New promise wizard")).toBeTruthy();
  });

  it("hides the detail-view create button when no guide is running", () => {
    render(<DatasetsTab selectedPromiseId="promise-1" onSelectedPromiseChange={vi.fn()} />);

    expect(screen.getByText("Selected promise detail")).toBeTruthy();
    expect(document.querySelector('[data-onboarding-id="dataops-health-create"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "New promise" })).toBeNull();
  });

  it("still offers the create button on the list view without a guide", () => {
    render(<DatasetsTab onSelectedPromiseChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New promise" }));
    expect(screen.getByText("New promise wizard")).toBeTruthy();
  });
});
