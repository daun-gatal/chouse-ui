import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DatasetsTab } from "./DatasetsTab";

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
      databaseName: "analytics",
      id: "promise-1",
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
  it("keeps the create target available while a promise detail is selected", () => {
    render(<DatasetsTab selectedPromiseId="promise-1" onSelectedPromiseChange={vi.fn()} />);

    const target = document.querySelector('[data-onboarding-id="dataops-health-create"]');
    expect(target).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New promise" }));
    expect(screen.getByText("New promise wizard")).toBeTruthy();
  });
});
