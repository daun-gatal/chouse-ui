import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingApproval } from "@/api/ai-chat";

import { ApprovalCard } from "./ApprovalCard";

function item(n: number, extra: Partial<PendingApproval> = {}): PendingApproval {
  return { id: `int-${n}`, toolCallId: `c${n}`, actionId: `act-${n}`, name: "kill_query", title: `Kill query ${n}`, args: { queryId: `q${n}` }, description: `KILL q${n}`, expiresAt: Date.now() + 60_000, ...extra };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalCard", () => {
  it("collects an answer for every action before continuing", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard pending={[item(1), item(2)]} canAct busy={false} onSubmit={onSubmit} />);
    expect(screen.getByText("2 approvals needed")).not.toBeNull();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    expect(screen.getByText("Approved")).not.toBeNull();
    expect(screen.getByText("1 of 2 answered")).not.toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect((continueButton as HTMLButtonElement).disabled).toBe(false);

    // Changing an answer reopens it.
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(continueButton);
    expect(onSubmit).toHaveBeenCalledWith([{ actionId: "act-1", type: "approve" }, { actionId: "act-2", type: "reject" }]);
  });

  it("only lets a user without ai:act reject", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard pending={[item(1)]} canAct={false} busy={false} onSubmit={onSubmit} />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You need the ai:act permission/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onSubmit).toHaveBeenCalledWith([{ actionId: "act-1", type: "reject" }]);
  });

  it("counts down and stops accepting answers once expired", () => {
    vi.useFakeTimers();
    render(<ApprovalCard pending={[item(1, { expiresAt: Date.now() + 2_000 })]} canAct busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByText("Expires in 0:02")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(screen.getByText("Expired")).not.toBeNull();
    expect(screen.getByText(/This approval expired/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
