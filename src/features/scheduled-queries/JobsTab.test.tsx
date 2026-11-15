import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobsTab } from "./JobsTab";

const guideActiveMock = vi.fn<() => boolean>(() => false);
const jobsMock = vi.fn<() => Array<Record<string, unknown>>>();
const OWNED_JOB = { createdBy: "owner-1", ownerId: "owner-1", description: null, enabled: true, id: "job-1", name: "Daily rollup" };

vi.mock("@/features/onboarding", () => ({
  useOnboardingGuideActive: () => guideActiveMock(),
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: {
    DATA_HEALTH_EDIT: "data_health:edit",
    SCHEDULED_QUERIES_DELETE: "scheduled:delete",
    SCHEDULED_QUERIES_EDIT: "scheduled:edit",
    SCHEDULED_QUERIES_RUN: "scheduled:run",
    SCHEDULED_QUERIES_VIEW_ALL: "scheduled:view-all",
  },
  useRbacStore: () => ({ hasPermission: () => true }),
}));

vi.mock("@/features/data-health", () => ({
  PromiseWizard: ({ open }: { open: boolean }) => (open ? <div>Protect output table wizard</div> : null),
}));

vi.mock("@/features/scheduled-queries/hooks", () => ({
  useDeleteScheduledQuery: () => ({ mutateAsync: vi.fn() }),
  useJobOwners: () => ({ nameOf: () => "Owner", options: [] }),
  useRunScheduledQuery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useScheduledQueries: () => ({
    data: jobsMock(),
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
  beforeEach(() => {
    guideActiveMock.mockReturnValue(false);
    jobsMock.mockReturnValue([OWNED_JOB]);
  });

  it("keeps the create target available while a job detail is selected during a guide", () => {
    guideActiveMock.mockReturnValue(true);
    render(<JobsTab selectedJobId="job-1" onSelectedJobChange={vi.fn()} />);

    const target = document.querySelector('[data-onboarding-id="data-scheduled-create"]');
    expect(target).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New job" }));
    expect(screen.getByText("New job wizard")).toBeTruthy();
  });

  it("hides the detail-view create button when no guide is running", () => {
    render(<JobsTab selectedJobId="job-1" onSelectedJobChange={vi.fn()} />);

    expect(screen.getByText("Selected job detail")).toBeTruthy();
    expect(document.querySelector('[data-onboarding-id="data-scheduled-create"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "New job" })).toBeNull();
  });

  it("still offers the create button on the list view without a guide", () => {
    render(<JobsTab onSelectedJobChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "New job" }));
    expect(screen.getByText("New job wizard")).toBeTruthy();
  });
});

describe("JobsTab owner", () => {
  beforeEach(() => {
    guideActiveMock.mockReturnValue(false);
  });

  it("shows the run owner's name on a job that has one", () => {
    jobsMock.mockReturnValue([OWNED_JOB]);
    render(<JobsTab onSelectedJobChange={vi.fn()} />);

    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.queryByText("No owner")).toBeNull();
  });

  it("marks a job with no owner in the list, whoever created it", () => {
    jobsMock.mockReturnValue([OWNED_JOB, { ...OWNED_JOB, id: "job-2", name: "Orphaned rollup", ownerId: null }]);
    render(<JobsTab onSelectedJobChange={vi.fn()} />);

    const badge = screen.getByText("No owner");
    expect(badge.getAttribute("title")).toBe("This job cannot run until it has an owner.");
    expect(badge.closest("button")?.textContent).toContain("Orphaned rollup");
    expect(screen.getAllByText("Owner")).toHaveLength(1);
  });
});
