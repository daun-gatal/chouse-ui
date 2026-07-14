import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobsTab } from "./JobsTab";

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: {
    SCHEDULED_QUERIES_DELETE: "scheduled:delete",
    SCHEDULED_QUERIES_EDIT: "scheduled:edit",
    SCHEDULED_QUERIES_RUN: "scheduled:run",
    SCHEDULED_QUERIES_VIEW_ALL: "scheduled:view-all",
  },
  useRbacStore: () => ({ hasPermission: () => true }),
}));

vi.mock("@/features/scheduled-queries/hooks", () => ({
  useDeleteScheduledQuery: () => ({ mutateAsync: vi.fn() }),
  useJobOwners: () => ({ nameOf: () => "Owner", options: [] }),
  useRunScheduledQuery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useScheduledQueries: () => ({
    data: [{
      createdBy: "owner-1",
      description: null,
      enabled: true,
      id: "job-1",
      name: "Daily rollup",
    }],
    isLoading: false,
  }),
  useUpdateScheduledQuery: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/features/scheduled-queries/JobDetail", () => ({
  JobDetail: () => <div>Selected job detail</div>,
}));

vi.mock("@/features/scheduled-queries/JobWizard", () => ({
  JobWizard: () => <div>New job wizard</div>,
}));

describe("JobsTab onboarding targets", () => {
  it("keeps the create target available while a job detail is selected", () => {
    render(<JobsTab selectedJobId="job-1" onSelectedJobChange={vi.fn()} />);

    const target = document.querySelector('[data-onboarding-id="dataops-scheduled-create"]');
    expect(target).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New job" }));
    expect(screen.getByText("New job wizard")).toBeTruthy();
  });
});
