import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiMemory } from "@/api/aiMemories";
import { server } from "@/test/mocks/server";
import { useAuthStore } from "@/stores";
import { MemoriesPanel } from "./MemoriesPanel";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function memory(extra: Partial<AiMemory>): AiMemory {
  return {
    id: "m1", scope: "user", ownerId: "u1", connectionId: null, connectionName: null, content: "Prefers UTC", status: "active",
    source: "agent", agentSlug: "clickhouse-data", threadId: null, flag: null, proposedBy: "u1", proposedByName: "Ann",
    decidedBy: null, decidedByName: null, decidedAt: null, createdAt: Date.now() - 60_000, updatedAt: 0, canEdit: true, ...extra,
  };
}

const ok = (data: unknown): Response => HttpResponse.json({ success: true, data });

describe("MemoriesPanel", () => {
  let mine: AiMemory[];
  let team: AiMemory[];
  let enabled: boolean;
  let calls: string[];

  beforeEach(() => {
    useAuthStore.setState({ activeConnectionId: "c1" });
    calls = [];
    enabled = true;
    mine = [memory({})];
    team = [
      memory({ id: "t1", scope: "connection", ownerId: null, connectionId: "c1", connectionName: "Lab", content: "events.ts is UTC", status: "proposed", flag: "Matched PII redaction" }),
    ];
    server.use(
      http.get("/api/ai-memories/mine", () => ok({ enabled, memories: mine })),
      http.put("/api/ai-memories/settings", async ({ request }) => {
        enabled = ((await request.json()) as { enabled: boolean }).enabled;
        calls.push(`settings ${enabled}`);
        return ok({ enabled });
      }),
      http.get("/api/ai-memories/team", ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        return ok({ canManage: true, memories: team.filter((m) => !status || m.status === status) });
      }),
      http.get("/api/ai-memories/pending-count", () => ok({ count: team.filter((m) => m.status === "proposed").length })),
      http.post("/api/ai-memories", async ({ request }) => {
        const body = (await request.json()) as { scope: string; content: string; connectionId?: string };
        calls.push(`create ${body.scope} ${body.content}${body.connectionId ? ` ${body.connectionId}` : ""}`);
        const created = memory({ id: `n${calls.length}`, scope: body.scope === "user" ? "user" : "connection", content: body.content, source: "person" });
        if (body.scope === "user") mine = [created, ...mine];
        return ok({ ...created, duplicate: false });
      }),
      http.delete("/api/ai-memories/:id", ({ params }) => {
        calls.push(`delete ${String(params.id)}`);
        mine = mine.filter((m) => m.id !== params.id);
        return ok({ deleted: true });
      }),
      http.post("/api/ai-memories/:id/approve", ({ params }) => {
        calls.push(`approve ${String(params.id)}`);
        team = team.map((m) => (m.id === params.id ? { ...m, status: "active" } : m));
        return ok(team[0]);
      }),
    );
  });

  it("adds, lists and deletes your memories, and turns memory off", async () => {
    render(<MemoriesPanel />, { wrapper });
    const table = await screen.findByRole("table", { name: "Your memories" });
    expect(within(table).getByText("Prefers UTC")).not.toBeNull();
    expect(within(table).getByText("Kept by clickhouse-data")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    const editor = screen.getByLabelText("Memory note");
    fireEvent.change(editor, { target: { value: "ok" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editor, { target: { value: "Counts with thousands separators" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Counts with thousands separators")).not.toBeNull();

    fireEvent.click(within(screen.getByRole("table", { name: "Your memories" })).getAllByRole("button", { name: "Delete memory" })[0]);
    await waitFor(() => expect(calls).toContain("delete n1"));

    fireEvent.click(screen.getByRole("switch", { name: "Memory on" }));
    await waitFor(() => expect(calls).toContain("settings false"));
    expect(await screen.findByText(/Memory is off\. Agents don't read these notes/)).not.toBeNull();
  });

  it("points a reviewer at waiting team notes and approves one", async () => {
    render(<MemoriesPanel />, { wrapper });
    expect(await screen.findByText("1 team note waits for your review.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const table = await screen.findByRole("table", { name: "Team memories" });
    expect(within(table).getByText("events.ts is UTC")).not.toBeNull();
    expect(within(table).getByText(/Matched PII redaction/)).not.toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "Approve memory" }));
    await waitFor(() => expect(calls).toContain("approve t1"));
  });

  it("adds a team note for the open connection", async () => {
    render(<MemoriesPanel />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Add team memory" }));
    fireEvent.change(screen.getByLabelText("Memory note"), { target: { value: "orders_v1 is deprecated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toContain("create connection orders_v1 is deprecated c1"));
  });

  it("can't add a team note without an open connection", async () => {
    useAuthStore.setState({ activeConnectionId: null });
    render(<MemoriesPanel />, { wrapper });
    expect(((await screen.findByRole("button", { name: "Add team memory" })) as HTMLButtonElement).disabled).toBe(true);
  });
});
