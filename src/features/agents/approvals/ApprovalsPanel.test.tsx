import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiAction } from "@/api/aiActions";
import { server } from "@/test/mocks/server";
import { OPEN_CHAT_THREAD_EVENT } from "@/features/agents/usage/lib";
import { ApprovalsPanel } from "./ApprovalsPanel";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function action(extra: Partial<AiAction>): AiAction {
  return {
    id: "a1", source: "background", runId: null, threadId: null, userId: "u1", connectionId: "c1", agentPath: null,
    tool: "kill_query", title: "Kill a query", risk: "low", args: { queryId: "q1" }, description: 'KILL QUERY WHERE query_id = "q1"',
    status: "pending", result: null, error: null, decidedBy: null, decidedAt: null, expiresAt: Date.now() + 3 * 3_600_000 + 60_000, createdAt: Date.now() - 60_000,
    canDecide: true, userName: "Alice", decidedByName: null, ...extra,
  };
}

describe("ApprovalsPanel", () => {
  let actions: AiAction[];
  let approved: Array<{ id: string; body: unknown }>;

  beforeEach(() => {
    approved = [];
    actions = [
      action({}),
      action({ id: "a2", source: "chat", runId: "r1", threadId: "t1", canDecide: false, title: "Save a query", tool: "create_saved_query", description: 'Save "Daily orders"' }),
    ];
    server.use(
      http.get("/api/ai-actions", ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({ success: true, data: { canAct: true, actions: status ? actions.filter((a) => a.status === status) : actions } });
      }),
      http.post("/api/ai-actions/:id/approve", async ({ params, request }) => {
        approved.push({ id: String(params.id), body: await request.json() });
        const done = { ...actions[0], status: "executed" as const, result: { killed: true }, canDecide: false };
        actions = [done, ...actions.slice(1)];
        return HttpResponse.json({ success: true, data: done });
      }),
    );
  });

  it("shows what waits, who asked, and runs an approval from the row", async () => {
    render(<ApprovalsPanel />, { wrapper });
    const table = await screen.findByRole("table", { name: "AI actions" });
    expect(within(table).getByText("Kill a query")).not.toBeNull();
    expect(within(table).getByText("Background run as Alice")).not.toBeNull();
    expect(within(table).getAllByText("Expires in 3h")).toHaveLength(2);
    // A chat action is answered in its chat.
    const listener = vi.fn();
    window.addEventListener(OPEN_CHAT_THREAD_EVENT, listener);
    fireEvent.click(within(table).getByRole("button", { name: /Answered in its chat/ }));
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ threadId: "t1" });
    window.removeEventListener(OPEN_CHAT_THREAD_EVENT, listener);

    fireEvent.click(within(table).getByRole("button", { name: "Approve Kill a query" }));
    await waitFor(() => expect(approved).toEqual([{ id: "a1", body: {} }]));
    // Done actions leave the "Waiting" list.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve Kill a query" })).toBeNull());
  });

  it("approves with edited arguments from the review sheet, and refuses broken JSON", async () => {
    render(<ApprovalsPanel />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    const editor = await screen.findByLabelText("Arguments");
    fireEvent.change(editor, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with changes" }));
    expect(screen.getByRole("alert").textContent).toBe("Not valid JSON.");
    fireEvent.change(editor, { target: { value: '{ "queryId": "q2" }' } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with changes" }));
    await waitFor(() => expect(approved).toEqual([{ id: "a1", body: { args: { queryId: "q2" } } }]));
  });

  it("says when nothing waits", async () => {
    actions = [];
    render(<ApprovalsPanel />, { wrapper });
    expect(await screen.findByText("Nothing waits for approval")).not.toBeNull();
  });
});
