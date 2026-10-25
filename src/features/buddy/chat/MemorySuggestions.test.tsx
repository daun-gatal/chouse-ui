import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { MemorySuggestions, QUIET_MS } from "./MemorySuggestions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe("MemorySuggestions", () => {
  let asks: number;
  let saved: unknown[];
  beforeEach(() => {
    asks = 0;
    saved = [];
    server.use(
      http.post("/api/ai-memories/suggest", () => {
        asks++;
        return HttpResponse.json({ success: true, data: { suggestions: [{ note: "Uses UTC.", scope: "user" }, { note: "orders_v1 is deprecated.", scope: "connection" }], connectionId: "c1" } });
      }),
      http.post("/api/ai-memories", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json({ success: true, data: { id: "m1", status: "proposed", duplicate: false } });
      }),
    );
  });
  afterEach(() => vi.useRealTimers());

  it("asks once after the conversation is quiet, and not while a reply is written", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<MemorySuggestions threadId="t1" messageCount={2} generating enabled />);
    await act(async () => { vi.advanceTimersByTime(QUIET_MS + 1000); });
    expect(asks).toBe(0);
    rerender(<MemorySuggestions threadId="t1" messageCount={2} generating={false} enabled />);
    await act(async () => { vi.advanceTimersByTime(QUIET_MS - 1000); });
    expect(asks).toBe(0);
    await act(async () => { vi.advanceTimersByTime(2000); });
    await waitFor(() => expect(asks).toBe(1));
    expect(await screen.findByText("Uses UTC.")).toBeTruthy();
    // The same thread length is not asked about again.
    rerender(<MemorySuggestions threadId="t1" messageCount={2} generating={false} enabled />);
    await act(async () => { vi.advanceTimersByTime(QUIET_MS * 2); });
    expect(asks).toBe(1);
  });

  it("saves to the person, proposes to the team with the connection, and dismisses", async () => {
    render(<MemorySuggestions threadId="t1" messageCount={2} generating={false} enabled />);
    fireEvent.click(screen.getByText("Anything worth remembering?"));
    expect(await screen.findByText("orders_v1 is deprecated.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Save to me" })[0]);
    await waitFor(() => expect(saved).toEqual([{ scope: "user", content: "Uses UTC." }]));
    await waitFor(() => expect(screen.queryByText("Uses UTC.")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Propose to team" }));
    await waitFor(() => expect(saved[1]).toEqual({ scope: "connection", content: "orders_v1 is deprecated.", connectionId: "c1" }));
    await waitFor(() => expect(screen.queryByTestId("memory-suggestions")).toBeNull());
  });

  it("shows nothing when turned off, or before there is a conversation", () => {
    const { container, rerender } = render(<MemorySuggestions threadId="t1" messageCount={2} generating={false} enabled={false} />);
    expect(container.textContent).toBe("");
    rerender(<MemorySuggestions threadId="t1" messageCount={1} generating={false} enabled />);
    expect(container.textContent).toBe("");
  });
});
