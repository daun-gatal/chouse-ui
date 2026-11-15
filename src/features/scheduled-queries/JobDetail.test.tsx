import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduledQuery } from "@/api/scheduledQueries";
import { JobDetail } from "./JobDetail";

const permissionsMock = vi.fn<(permission: string) => boolean>(() => true);
let signedInAs = "user-9";
const assignMock = vi.fn<(id: string) => Promise<unknown>>();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m), info: vi.fn() },
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: {
    AI_OPTIMIZE: "ai:optimize",
    DATA_HEALTH_EDIT: "data_health:edit",
    OBSERVE_VIEW: "observe:view",
    SCHEDULED_QUERIES_EDIT: "scheduled_queries:edit",
    SCHEDULED_QUERIES_RUN: "scheduled_queries:run",
    SCHEDULED_QUERIES_VIEW_ALL: "scheduled_queries:view_all",
  },
  useRbacStore: () => ({ hasPermission: (permission: string) => permissionsMock(permission), user: { id: signedInAs } }),
}));

vi.mock("@/hooks", () => ({ useAiModelId: () => undefined }));
vi.mock("@/api/dataOpsAi", () => ({ assessScheduledQuery: vi.fn(), planScheduledRecovery: vi.fn() }));
vi.mock("@/features/dataops-ai", () => ({
  AiInsightDialog: () => null,
  AssessmentView: () => null,
  OperationalBriefCard: () => null,
}));
vi.mock("@/features/data-health", () => ({ PromiseWizard: () => null }));
vi.mock("@/features/observe/hooks", () => ({ useConnectionName: () => "Production" }));
vi.mock("@/features/scheduled-queries/JobWizard", () => ({ JobWizard: () => null }));
vi.mock("@/features/scheduled-queries/LineageTab", () => ({ LineageTab: () => null }));
vi.mock("@/features/scheduled-queries/RunsTab", () => ({ RunsTab: () => null }));

vi.mock("@/features/scheduled-queries/hooks", () => ({
  useAssignScheduledQueryToMe: () => ({ isPending: false, mutateAsync: (id: string) => assignMock(id) }),
  useJobOwners: () => ({
    nameOf: (id: string | null) => (id === "user-1" ? "Ada" : id === "user-2" ? "Grace" : "—"),
    options: [],
  }),
  useRunScheduledQuery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useScheduledQueryRuns: () => ({ data: [] }),
  useUpdateScheduledQuery: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

const JOB: ScheduledQuery = {
  id: "job-1",
  name: "Daily orders",
  description: null,
  connectionId: "connection-1",
  query: "SELECT 1",
  enabled: true,
  frequency: "daily",
  hour: 2,
  dayOfWeek: 1,
  dayOfMonth: 1,
  cronExpr: null,
  timezone: "UTC",
  outputMode: "none",
  destDatabase: null,
  destTable: null,
  outputConfig: null,
  maxRows: 1_000,
  timeoutSecs: 60,
  useFinal: false,
  seqConsistency: false,
  lastRunAt: 0,
  maxAttempts: 2,
  retentionDays: 30,
  createdBy: "user-1",
  ownerId: "user-2",
  createdAt: Date.now() - 3_600_000,
  updatedAt: 1,
  channelIds: [],
};

function renderDetail(job: ScheduledQuery): void {
  render(
    <MemoryRouter>
      <JobDetail job={job} jobs={[job]} onBack={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("JobDetail owner card", () => {
  beforeEach(() => {
    permissionsMock.mockReset();
    permissionsMock.mockReturnValue(true);
    signedInAs = "user-9";
    assignMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("shows who the job runs as, and who created it beside that", () => {
    renderDetail(JOB);

    expect(screen.getByText("Grace")).toBeTruthy();
    expect(screen.getByText("Created by Ada · 1h ago")).toBeTruthy();
    expect(screen.queryByText("No owner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("says You when the signed-in person is the owner", () => {
    permissionsMock.mockImplementation((permission) => permission !== "scheduled_queries:view_all");
    signedInAs = "user-2";
    renderDetail(JOB);

    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Created 1h ago")).toBeTruthy();
  });

  it("does not say You to the creator once someone else owns the job", () => {
    permissionsMock.mockImplementation((permission) => permission !== "scheduled_queries:view_all");
    signedInAs = "user-1";
    renderDetail(JOB);

    expect(screen.queryByText("You")).toBeNull();
    expect(screen.getByText("Someone else")).toBeTruthy();
  });

  it("warns that a job with no owner cannot run and offers to take it", () => {
    renderDetail({ ...JOB, ownerId: null });

    expect(screen.getByText("No owner").className).toContain("text-amber-500");
    expect(screen.getByText("This job cannot run until it has an owner.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign to me" })).toBeTruthy();
    expect(screen.getByText("Created by Ada · 1h ago")).toBeTruthy();
  });

  it("hides Assign to me from someone without scheduled_queries:edit", () => {
    permissionsMock.mockImplementation((permission) => permission !== "scheduled_queries:edit");
    renderDetail({ ...JOB, ownerId: null });

    expect(screen.getByText("No owner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("assigns the job to the caller and confirms it", async () => {
    assignMock.mockResolvedValue({ ...JOB, ownerId: "me" });
    renderDetail({ ...JOB, ownerId: null });

    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You now own this job"));
    expect(assignMock).toHaveBeenCalledWith("job-1");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows the server's message when assigning is refused", async () => {
    assignMock.mockRejectedValue(new Error("Your data access rules do not allow this job's query"));
    renderDetail({ ...JOB, ownerId: null });

    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Your data access rules do not allow this job's query"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
