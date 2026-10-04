import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RemediationAction } from "@/api/remediation";
import { RemediationPanel } from "./RemediationPanel";

const state = vi.hoisted(() => ({ granted: new Set<string>(), actions: [] as unknown[] }));

vi.mock("@/stores", async () => {
  const actual = await vi.importActual<typeof import("@/stores/rbac")>("@/stores/rbac");
  return {
    RBAC_PERMISSIONS: actual.RBAC_PERMISSIONS,
    useAuthStore: (select: (s: { activeConnectionId: string }) => unknown) => select({ activeConnectionId: "c1" }),
    useRbacStore: () => ({
      hasPermission: (p: string) => state.granted.has(p),
      hasAnyPermission: (ps: string[]) => ps.some((p) => state.granted.has(p)),
    }),
  };
});

const idle = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/features/observe/hooks", () => ({
  useRemediationActions: () => ({ data: state.actions, isLoading: false }),
  useRemediationCatalog: () => ({ data: undefined }),
  useProposeAction: () => idle,
  useDecideAction: () => idle,
  useRunAction: () => idle,
  useRollbackAction: () => idle,
}));

function render(ui: ReactElement): void {
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

function action(patch: Partial<RemediationAction>): RemediationAction {
  return {
    id: "a1", connectionId: "c1", type: "kill_query", params: { type: "kill_query", queryId: "q1" }, resumeAt: null, approvalClass: 1, status: "proposed",
    title: "Kill query", rationale: "runaway", proposedBy: "u2", proposedSource: "mcp", incidentSource: "observe", incidentId: "o1", notebookId: null,
    previewSql: "KILL QUERY WHERE query_id = 'q1'", rollbackSql: null, verification: { description: "memory < 80%", sql: null, comparator: "lt", threshold: 0.8, withinSeconds: 180 },
    windowOnly: false, createdAt: 0, updatedAt: 0, ...patch,
  };
}

describe("RemediationPanel gating", () => {
  beforeEach(() => {
    state.granted.clear();
    state.actions = [];
  });

  it("explains what is needed without any remediation permission", () => {
    render(<RemediationPanel context={{ incidentId: "o1" }} />);
    expect(screen.getByText("Fixes need a remediation permission")).toBeTruthy();
  });

  it("lets a proposer propose and reject, but not approve", () => {
    state.granted = new Set(["remediation:propose"]);
    state.actions = [action({})];
    render(<RemediationPanel context={{ incidentId: "o1" }} />);
    expect(screen.getByRole("button", { name: /Propose fix/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByText(/Waiting for an approver/)).toBeTruthy();
  });

  it("needs approve_high for a high-impact action", () => {
    state.granted = new Set(["remediation:approve"]);
    state.actions = [action({ approvalClass: 2, title: "Restart engine table" })];
    render(<RemediationPanel context={{ incidentId: "o1" }} />);
    expect(screen.queryByRole("button", { name: /^Approve$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Propose fix/ })).toBeNull();
  });

  it("offers approve and run to an approver", () => {
    state.granted = new Set(["remediation:approve_high"]);
    state.actions = [action({ approvalClass: 2 })];
    render(<RemediationPanel context={{ incidentId: "o1" }} />);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy();
  });
});
