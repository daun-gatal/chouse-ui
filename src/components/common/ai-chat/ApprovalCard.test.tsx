import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingApproval } from "@/api/ai-chat";

import { ApprovalCard } from "./ApprovalCard";

function item(n: number, extra: Partial<PendingApproval> = {}): PendingApproval {
  return { id: `int-${n}`, toolCallId: `c${n}`, actionId: `act-${n}`, name: "kill_query", title: `Kill query ${n}`, args: { queryId: `q${n}` }, description: `KILL q${n}`, expiresAt: Date.now() + 60_000, tier: "t2", production: false, ...extra };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalCard", () => {
  it("confirms a plan once, approving every step not left out or edited (ADR 0025)", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard pending={[item(1, { tier: "t1" }), item(2), item(3)]} canAct busy={false} onSubmit={onSubmit} />);
    expect(screen.getByText("Plan · 3 steps · confirm once")).not.toBeNull();
    expect(screen.getByText("3 of 3 steps will run")).not.toBeNull();
    expect(screen.getByText("Undoable")).not.toBeNull();

    // Leave step 2 out.
    fireEvent.click(screen.getAllByRole("button", { name: "Leave out" })[1]);
    fireEvent.change(screen.getByLabelText(/Why not/), { target: { value: "not now" } });
    fireEvent.click(screen.getByRole("button", { name: "Leave it out" }));
    expect(screen.getByText("2 of 3 steps will run")).not.toBeNull();

    // Edit step 3.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    fireEvent.change(screen.getByLabelText("Arguments (JSON)"), { target: { value: '{"queryId":"q9"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Use these changes" }));

    fireEvent.click(screen.getByRole("button", { name: "Run plan" }));
    expect(onSubmit).toHaveBeenCalledWith([
      { actionId: "act-1", type: "approve" },
      { actionId: "act-2", type: "reject", message: "not now" },
      { actionId: "act-3", type: "edit", args: { queryId: "q9" } },
    ]);
  });

  it("cancels a whole plan", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard pending={[item(1), item(2)]} canAct busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));
    expect(onSubmit).toHaveBeenCalledWith([
      { actionId: "act-1", type: "reject", message: "The user cancelled the plan." },
      { actionId: "act-2", type: "reject", message: "The user cancelled the plan." },
    ]);
  });

  it("lets a single T2 call be allowed for this chat or for an hour", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<ApprovalCard pending={[item(1)]} canAct busy={false} onSubmit={onSubmit} />);
    expect(screen.getByText("Confirm this change")).not.toBeNull();
    expect(screen.getByText("Asks once")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "In this chat" }));
    expect(onSubmit).toHaveBeenLastCalledWith([{ actionId: "act-1", type: "approve", remember: "thread" }]);
    rerender(<ApprovalCard key="b" pending={[item(2)]} canAct busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "For 1 hour" }));
    expect(onSubmit).toHaveBeenLastCalledWith([{ actionId: "act-2", type: "approve", remember: "hour" }]);
  });

  it("flags a call raised by production, and offers 'don't ask again' only for T2", () => {
    const { unmount } = render(<ApprovalCard pending={[item(1, { tier: "t2", production: true })]} canAct busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByText("Production")).not.toBeNull();
    expect(screen.getByText("Don't ask again for “Kill query 1”:")).not.toBeNull();
    unmount();
    // A T1 save on a production connection asks as T2 (the server sends t2); a plain T1 or T3 never offers it.
    render(<ApprovalCard pending={[item(3, { tier: "t3" })]} canAct busy={false} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/Don't ask again/)).toBeNull();
  });

  it("only lets a user without ai:act reject", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard pending={[item(1)]} canAct={false} busy={false} onSubmit={onSubmit} />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "In this chat" })).toBeNull();
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
