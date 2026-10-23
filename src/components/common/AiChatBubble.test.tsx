import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";

import AiChatBubble from "./AiChatBubble";

const mocks = vi.hoisted(() => ({
  activeConnectionId: "connection-a" as string | null,
  breakpoint: "desktop" as "mobile" | "tablet" | "desktop",
  createThread: vi.fn(),
  getPreferences: vi.fn(),
  getThread: vi.fn(),
  streamChatRun: vi.fn(),
  followChatRun: vi.fn(),
  getChatRun: vi.fn(),
  cancelChatRun: vi.fn(),
  getActiveChatRun: vi.fn(),
  getChatSkills: vi.fn(),
  resumeChatRun: vi.fn(),
  listThreads: vi.fn(),
  viewportWidth: 1440,
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: { AI_CHAT: "ai:chat", AI_ACT: "ai:act" },
  useAuthStore: Object.assign(
    (selector: (state: { activeConnectionId: string | null }) => unknown) =>
      selector({ activeConnectionId: mocks.activeConnectionId }),
    { getState: () => ({ activeConnectionId: mocks.activeConnectionId }) },
  ),
  useRbacStore: (selector: (state: { hasPermission: () => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

vi.mock("@/api/ai-chat", () => ({
  createThread: mocks.createThread,
  deleteThread: vi.fn(),
  getAiModels: vi.fn().mockResolvedValue([]),
  getChatAgents: vi.fn().mockResolvedValue([]),
  getChatStatus: vi.fn().mockResolvedValue({ enabled: true }),
  getThread: mocks.getThread,
  streamChatRun: mocks.streamChatRun,
  followChatRun: mocks.followChatRun,
  getChatRun: mocks.getChatRun,
  cancelChatRun: mocks.cancelChatRun,
  getActiveChatRun: mocks.getActiveChatRun,
  getChatSkills: mocks.getChatSkills,
  resumeChatRun: mocks.resumeChatRun,
  listThreads: mocks.listThreads,
  updateThreadTitle: vi.fn(),
}));

function run(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, threadId: "thread", status: "running", steps: [], pending: [], result: null, error: null, createdAt: Date.now(), ...extra };
}

function answer(content: string): Record<string, unknown> {
  return { messageId: null, content, toolCalls: [], chartSpecs: [], agent: { id: "a", slug: "a", name: "A" } };
}

/** A run that stays open until `finish` is called. */
function deferredRun(): { implementation: (request: unknown, onEvent: (event: unknown) => void) => Promise<void>; finish: (content: string) => void } {
  let emit: (event: unknown) => void = () => undefined;
  let done: () => void = () => undefined;
  return {
    implementation: (_request, onEvent) => new Promise<void>((resolve) => {
      emit = onEvent;
      done = resolve;
      onEvent({ type: "run", run: run("run-deferred") });
    }),
    finish: (content) => {
      emit({ type: "final", result: answer(content) });
      done();
    },
  };
}

const COMPOSER = "Ask about your databases, schemas, queries…";

/**
 * Type into the composer and send. The sheet re-renders its composer once the
 * thread list loads, so re-query until the text has landed in the live one.
 */
async function send(value: string, placeholder: string | RegExp = COMPOSER): Promise<void> {
  await waitFor(() => {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(placeholder).value).toBe(value);
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

// jsdom has no layout, so the virtualized message list would render nothing: render every row.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 100, key: index })),
    measureElement: () => undefined,
  }),
}));

vi.mock("@/api/rbac", () => ({
  rbacUserPreferencesApi: {
    getPreferences: mocks.getPreferences,
    updatePreferences: vi.fn(),
  },
}));

vi.mock("@/hooks/useDeviceType", () => ({
  useDeviceType: () => "laptop",
}));

vi.mock("@/hooks/useWindowSize", () => ({
  useWindowSize: () => ({
    width: mocks.viewportWidth,
    height: 900,
    breakpoint: mocks.breakpoint,
  }),
}));

vi.mock("@/features/onboarding", () => ({
  useOnboardingGuideActive: () => false,
}));

vi.mock("@/lib/onboardingSurfaces", () => ({
  useOnboardingSurfaceDismissAction: vi.fn(),
}));

describe("AiChatBubble", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    mocks.activeConnectionId = "connection-a";
    mocks.breakpoint = "desktop";
    mocks.createThread.mockReset();
    mocks.createThread.mockResolvedValue({
      id: "thread-b",
      userId: "user-1",
      title: null,
      connectionId: "connection-b",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    mocks.getPreferences.mockReset();
    mocks.getPreferences.mockResolvedValue({});
    mocks.getThread.mockReset();
    mocks.streamChatRun.mockReset();
    mocks.streamChatRun.mockImplementation(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({ type: "run", run: run("run-1") });
      onEvent({ type: "final", result: answer("Assistant response") });
    });
    mocks.followChatRun.mockReset();
    mocks.getChatRun.mockReset();
    mocks.cancelChatRun.mockReset();
    mocks.cancelChatRun.mockResolvedValue(run("run-1"));
    mocks.getActiveChatRun.mockReset();
    mocks.getActiveChatRun.mockResolvedValue(null);
    mocks.getChatSkills.mockReset();
    mocks.getChatSkills.mockResolvedValue([]);
    mocks.listThreads.mockReset();
    mocks.listThreads.mockResolvedValue([]);
    mocks.resumeChatRun.mockReset();
    mocks.viewportWidth = 1440;
  });

  it("creates a new thread for the connection selected after mount", async () => {
    const { rerender } = render(<AiChatBubble />);

    await screen.findByRole("button", { name: /open ai chat/i });

    mocks.activeConnectionId = "connection-b";
    rerender(<AiChatBubble />);

    fireEvent.click(screen.getByRole("button", { name: /open ai chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }));

    await waitFor(() => {
      expect(mocks.createThread).toHaveBeenCalledWith(undefined, "connection-b", null);
    });
  });

  it("opens a thread when AI activity asks for it", async () => {
    mocks.getThread.mockResolvedValue({ id: "thread-9", title: "Orders", agentId: null, messages: [{ id: "m1", role: "user", content: "How many orders?", createdAt: new Date().toISOString() }] });
    render(<AiChatBubble />);
    await screen.findByRole("button", { name: /open ai chat/i });

    act(() => {
      window.dispatchEvent(new CustomEvent("chouse:open-chat-thread", { detail: { threadId: "thread-9" } }));
      window.dispatchEvent(new CustomEvent("chouse:open-chat-thread", { detail: { nope: 1 } }));
    });

    await waitFor(() => expect(mocks.getThread).toHaveBeenCalledWith("thread-9"));
    expect(mocks.getThread).toHaveBeenCalledTimes(1);
    // The bubble opened on its own: its close control is showing.
    expect(await screen.findByRole("button", { name: "Close chat" })).toBeTruthy();
  });

  it("clears the active chat when the connection changes while closed", async () => {
    mocks.createThread.mockResolvedValueOnce({
      id: "thread-a",
      userId: "user-1",
      title: null,
      connectionId: "connection-a",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    const { rerender } = render(<AiChatBubble />);

    fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }));
    await screen.findByText("New conversation");

    fireEvent.click(screen.getByTitle("Close (Esc)"));
    mocks.activeConnectionId = "connection-b";
    rerender(<AiChatBubble />);
    fireEvent.click(screen.getByRole("button", { name: /open ai chat/i }));

    expect(await screen.findByRole("button", { name: "Start new chat" })).not.toBeNull();
    expect(screen.queryByText("New conversation")).toBeNull();
  });

  it("ignores a thread-list response from the previously active connection", async () => {
    mocks.breakpoint = "mobile";
    mocks.viewportWidth = 390;
    type ThreadFixture = {
      id: string;
      userId: string;
      title: string;
      connectionId: string;
      createdAt: string;
      updatedAt: string;
    };
    let resolveConnectionA: (threads: ThreadFixture[]) => void = () => undefined;
    let resolveConnectionB: (threads: ThreadFixture[]) => void = () => undefined;
    const connectionARequest = new Promise<ThreadFixture[]>((resolve) => {
      resolveConnectionA = resolve;
    });
    const connectionBRequest = new Promise<ThreadFixture[]>((resolve) => {
      resolveConnectionB = resolve;
    });
    mocks.listThreads.mockImplementation((connectionId: string | null) =>
      connectionId === "connection-a" ? connectionARequest : connectionBRequest,
    );
    const timestamp = new Date().toISOString();
    const { rerender } = render(<AiChatBubble />);

    fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
    fireEvent.click(screen.getByRole("button", { name: "Thread history" }));
    await waitFor(() => expect(mocks.listThreads).toHaveBeenCalledWith("connection-a"));

    mocks.activeConnectionId = "connection-b";
    rerender(<AiChatBubble />);
    await waitFor(() => expect(mocks.listThreads).toHaveBeenCalledWith("connection-b"));

    await act(async () => {
      resolveConnectionB([{
        id: "thread-b",
        userId: "user-1",
        title: "Connection B chat",
        connectionId: "connection-b",
        createdAt: timestamp,
        updatedAt: timestamp,
      }]);
      await connectionBRequest;
    });
    expect(await screen.findByText("Connection B chat")).not.toBeNull();

    await act(async () => {
      resolveConnectionA([{
        id: "thread-a",
        userId: "user-1",
        title: "Connection A chat",
        connectionId: "connection-a",
        createdAt: timestamp,
        updatedAt: timestamp,
      }]);
      await connectionARequest;
    });

    expect(screen.queryByText("Connection A chat")).toBeNull();
    expect(screen.getByText("Connection B chat")).not.toBeNull();
  });

  it("cancels an in-flight chat before refreshing history for a new connection", async () => {
    const pending = deferredRun();
    mocks.streamChatRun.mockImplementationOnce(pending.implementation);
    mocks.createThread.mockResolvedValueOnce({
      id: "thread-a",
      userId: "user-1",
      title: null,
      connectionId: "connection-a",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    const { rerender } = render(<AiChatBubble />);

    fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }));
    await screen.findByPlaceholderText(COMPOSER);
    await send("Question for connection A");
    await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(1));
    const loadsOfA = (): number => mocks.listThreads.mock.calls.filter(([connectionId]) => connectionId === "connection-a").length;
    const loadsBeforeSwitch = loadsOfA();

    mocks.activeConnectionId = "connection-b";
    rerender(<AiChatBubble />);
    expect(await screen.findByRole("button", { name: "Start new chat" })).not.toBeNull();

    await act(async () => {
      pending.finish("Late response from A");
    });
    // Switching connection closes the stream but never stops the run.
    expect(mocks.cancelChatRun).not.toHaveBeenCalled();

    // The late reply from connection A never reloads A's history into B.
    expect(loadsOfA()).toBe(loadsBeforeSwitch);
    expect(screen.getByRole("button", { name: "Start new chat" })).not.toBeNull();
  });

  it("opens the sheet at the device default width, ignoring legacy floating-window sizes", async () => {
    mocks.getPreferences.mockResolvedValue({
      workspacePreferences: { byDevice: { laptop: { chatPreferences: { size: { width: 420, height: 0 } } } } },
    });
    render(<AiChatBubble />);

    fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
    await waitFor(() => expect(mocks.getPreferences).toHaveBeenCalled());

    const sheet = (await screen.findByRole("dialog", { name: "AI chat assistant" })).parentElement;
    expect(sheet?.style.width).toBe("760px");
    expect(screen.queryByRole("button", { name: "Cycle sheet width" })).toBeNull();
  });

  it("lets a new chat run while another thread is still answering", async () => {
    const first = deferredRun();
    mocks.streamChatRun.mockImplementationOnce(first.implementation);
    const thread = (id: string): Record<string, string | null> => ({
      id,
      userId: "user-1",
      title: null,
      connectionId: "connection-a",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    mocks.createThread.mockResolvedValueOnce(thread("thread-1")).mockResolvedValueOnce(thread("thread-2"));
    render(<AiChatBubble />);

    fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }));
    await screen.findByPlaceholderText(COMPOSER);
    await send("Slow question");
    await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Stop generating" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByText("New conversation");
    const freshComposer = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask about your databases, schemas, queries…");
    expect(freshComposer.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();

    await send("Second question");
    await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(2));
    expect(mocks.streamChatRun.mock.calls.map(([request]) => (request as { threadId: string }).threadId)).toEqual(["thread-1", "thread-2"]);

    await act(async () => {
      first.finish("Slow answer");
    });
  });

  describe("thread history", () => {
    const savedThread = {
      id: "thread-saved",
      userId: "user-1",
      title: "Saved chat",
      connectionId: "connection-a",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mocks.listThreads.mockResolvedValue([savedThread]);
      mocks.getThread.mockResolvedValue({ ...savedThread, messages: [] });
    });

    const openHistory = async (): Promise<void> => {
      fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
      fireEvent.click(screen.getByRole("button", { name: "Thread history" }));
      await screen.findByText("Saved chat");
    };

    it("closes the full-screen history on a phone once a thread is picked", async () => {
      mocks.breakpoint = "mobile";
      mocks.viewportWidth = 390;
      render(<AiChatBubble />);
      await openHistory();
      expect(screen.getByTestId("ai-chat-thread-sidebar").dataset.overlay).toBe("true");

      fireEvent.click(screen.getByText("Saved chat"));

      await waitFor(() => expect(mocks.getThread).toHaveBeenCalledWith("thread-saved"));
      await waitFor(() => expect(screen.queryByTestId("ai-chat-thread-sidebar")).toBeNull());
      expect(screen.getByRole("button", { name: "Thread history" })).not.toBeNull();
    });

    it("shows the history over the chat on a tablet-width sheet and closes it on pick", async () => {
      mocks.breakpoint = "tablet";
      mocks.viewportWidth = 844;
      render(<AiChatBubble />);
      await openHistory();
      expect(screen.getByTestId("ai-chat-thread-sidebar").dataset.overlay).toBe("true");

      fireEvent.click(screen.getByText("Saved chat"));

      await waitFor(() => expect(mocks.getThread).toHaveBeenCalledWith("thread-saved"));
      await waitFor(() => expect(screen.queryByTestId("ai-chat-thread-sidebar")).toBeNull());
    });

    it("closes the overlaid history when starting a new chat from the header", async () => {
      mocks.breakpoint = "tablet";
      mocks.viewportWidth = 844;
      render(<AiChatBubble />);
      await openHistory();

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));

      await waitFor(() => expect(mocks.createThread).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId("ai-chat-thread-sidebar")).toBeNull());
    });

    it("keeps the history docked on a wide desktop sheet after picking a thread", async () => {
      render(<AiChatBubble />);
      await openHistory();
      expect(screen.getByTestId("ai-chat-thread-sidebar").dataset.overlay).toBe("false");

      fireEvent.click(screen.getByText("Saved chat"));

      await waitFor(() => expect(mocks.getThread).toHaveBeenCalledWith("thread-saved"));
      expect(screen.getByTestId("ai-chat-thread-sidebar")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Close sidebar" })).not.toBeNull();
    });
  });

  describe("durable runs (ADR 0024)", () => {
    const newThread = { id: "thread-run", userId: "user-1", title: null, connectionId: "connection-a", createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z" };

    async function openNewChat(placeholder: RegExp | string = "Ask about your databases, schemas, queries…"): Promise<HTMLTextAreaElement> {
      mocks.createThread.mockResolvedValueOnce(newThread);
      render(<AiChatBubble />);
      fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
      fireEvent.click(await screen.findByRole("button", { name: "Start new chat" }));
      return screen.findByPlaceholderText<HTMLTextAreaElement>(placeholder);
    }

    it("shows each step live and then the answer", async () => {
      let emit: (event: unknown) => void = () => undefined;
      let done: () => void = () => undefined;
      mocks.streamChatRun.mockImplementationOnce((_request: unknown, onEvent: (event: unknown) => void) => new Promise<void>((resolve) => {
        emit = onEvent;
        done = resolve;
      }));
      await openNewChat();
      await send("List databases");
      await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(1));

      await act(async () => {
        emit({ type: "run", run: run("run-live") });
        emit({ type: "step", step: { id: "s1", name: "list_databases", args: {}, status: "running", summary: null, startedAt: 1, endedAt: null } });
      });
      // The activity panel is open while the reply is worked on.
      expect((await screen.findAllByText("Checking available databases")).length).toBeGreaterThan(0);
      expect(screen.getAllByText("Checking available databases…").length).toBeGreaterThan(0);

      await act(async () => {
        emit({ type: "step", step: { id: "s1", name: "list_databases", args: {}, status: "done", summary: "6 databases", startedAt: 1, endedAt: 2 } });
        emit({ type: "final", result: answer("You have 6 databases.") });
        done();
      });
      expect(await screen.findByText("You have 6 databases.")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
    });

    it("stops the run on the server, and says so", async () => {
      let emit: (event: unknown) => void = () => undefined;
      let done: () => void = () => undefined;
      mocks.streamChatRun.mockImplementationOnce((_request: unknown, onEvent: (event: unknown) => void) => new Promise<void>((resolve) => {
        emit = onEvent;
        done = resolve;
        onEvent({ type: "run", run: run("run-stop") });
      }));
      mocks.cancelChatRun.mockImplementationOnce(async () => {
        emit({ type: "error", message: "Stopped.", code: "CANCELLED", status: "cancelled" });
        done();
        return run("run-stop", { status: "cancelled" });
      });
      await openNewChat();
      await send("Slow");
      fireEvent.click(await screen.findByRole("button", { name: "Stop generating" }));
      await waitFor(() => expect(mocks.cancelChatRun).toHaveBeenCalledWith("run-stop"));
      expect(await screen.findByText("Generation stopped.")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("shows a used-up budget without offering Retry", async () => {
      mocks.streamChatRun.mockRejectedValueOnce(new ApiError("The AI budget 'chat cap' is used up for this day. It resets at 2026-10-24 00:00 UTC.", 429, "AI_BUDGET_EXHAUSTED", "validation"));
      await openNewChat();
      await send("hi");
      expect(await screen.findByText(/The AI budget 'chat cap' is used up/)).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("re-attaches to a reply that is still running when a thread opens", async () => {
      const saved = { ...newThread, id: "thread-busy", title: "Busy chat", updatedAt: new Date().toISOString() };
      mocks.listThreads.mockResolvedValue([saved]);
      mocks.getThread.mockResolvedValue({ ...saved, agentId: null, messages: [{ id: "m1", threadId: saved.id, role: "user", content: "question\n\n[attached: orders.csv]", createdAt: new Date().toISOString() }] });
      mocks.getActiveChatRun.mockResolvedValue(run("run-busy", { threadId: saved.id, steps: [{ id: "s1", name: "list_tables", args: {}, status: "running", summary: null, startedAt: 1, endedAt: null }] }));
      mocks.followChatRun.mockImplementationOnce(async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({ type: "final", result: answer("Here are the tables.") });
      });
      render(<AiChatBubble />);
      fireEvent.click(await screen.findByRole("button", { name: /open ai chat/i }));
      fireEvent.click(await screen.findByRole("button", { name: "Thread history" }));
      fireEvent.click(await screen.findByText("Busy chat"));
      await waitFor(() => expect(mocks.followChatRun).toHaveBeenCalledWith("run-busy", expect.any(Function), expect.any(AbortSignal)));
      expect(await screen.findByText("Here are the tables.")).not.toBeNull();
      // The stored attachment line shows as a chip, not as text.
      expect(screen.getByText("question")).not.toBeNull();
      expect(screen.getByText("orders.csv")).not.toBeNull();
    });

    it("offers the agent's skills after / and pins the chosen one", async () => {
      mocks.getChatSkills.mockResolvedValue([{ name: "query-optimization", description: "Tune slow queries" }]);
      await openNewChat(/type \/ for skills/);
      await waitFor(() => {
        fireEvent.change(screen.getByPlaceholderText(/type \/ for skills/), { target: { value: "/", selectionStart: 1 } });
        expect(screen.getByRole("option", { name: /skill:query-optimization/ })).not.toBeNull();
      });
      const composer = screen.getByPlaceholderText<HTMLTextAreaElement>(/type \/ for skills/);
      const option = screen.getByRole("option", { name: /skill:query-optimization/ });
      expect(option.getAttribute("aria-selected")).toBe("true");
      fireEvent.keyDown(composer, { key: "Enter" });
      await waitFor(() => expect(composer.value).toBe("/skill:query-optimization "));
      expect(screen.queryByRole("listbox", { name: "Skills" })).toBeNull();
      fireEvent.change(composer, { target: { value: "/skill:query-optimization why is it slow?" } });
      expect(screen.getAllByText("query-optimization").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(1));
      expect(mocks.streamChatRun.mock.calls[0][0]).toMatchObject({ message: "why is it slow?", skills: ["query-optimization"] });
    });

    it("shows what the reply kept in memory (ADR 0024 phase 3)", async () => {
      mocks.streamChatRun.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ type: "run", run: run("run-mem") });
        onEvent({ type: "final", result: { ...answer("Noted: UTC from now on."), toolCalls: [{ name: "remember", args: { note: "Prefers UTC", scope: "user" }, result: { saved: true, memoryId: "m1", scope: "user", status: "active", note: "Prefers UTC" } }] } });
      });
      await openNewChat();
      await send("Always use UTC");
      expect(await screen.findByText("Noted: UTC from now on.")).not.toBeNull();
      expect(screen.getByText("Saved to your memory")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Undo “Prefers UTC”" })).not.toBeNull();
    });

    describe("approvals (ADR 0024 phase 2)", () => {
      const pending = { id: "int-1", toolCallId: "c1", actionId: "act-1", name: "kill_query", title: "Kill a query", args: { queryId: "q-7" }, description: 'KILL QUERY WHERE query_id = "q-7"', expiresAt: Date.now() + 15 * 60_000 };

      async function pause(): Promise<void> {
        mocks.streamChatRun.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
          onEvent({ type: "run", run: run("run-pause") });
          onEvent({ type: "step", step: { id: "s1", name: "get_running_queries", args: {}, status: "done", summary: "1 query", startedAt: 1, endedAt: 2 } });
          onEvent({ type: "status", status: "awaiting_approval", pending: [pending] });
        });
        await openNewChat();
        await send("Kill the runaway query");
        expect(await screen.findByRole("group", { name: "Approval needed" })).not.toBeNull();
      }

      it("shows what will run, and continues the same reply once approved", async () => {
        mocks.resumeChatRun.mockImplementationOnce(async (_id: string, _decisions: unknown, onEvent: (event: unknown) => void) => {
          onEvent({ type: "status", status: "running", pending: [] });
          onEvent({ type: "final", result: answer("Killed q-7.") });
        });
        await pause();
        expect(screen.getByText("Kill a query")).not.toBeNull();
        expect(screen.getByText('KILL QUERY WHERE query_id = "q-7"')).not.toBeNull();
        expect(screen.getByText(/Expires in 1[45]:/)).not.toBeNull();
        expect(screen.getByText("1 step so far · waiting for your approval")).not.toBeNull();
        // The reply is not generating while it waits, so Stop is not offered.
        expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));
        await waitFor(() => expect(mocks.resumeChatRun).toHaveBeenCalledWith("run-pause", [{ actionId: "act-1", type: "approve" }], expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) })));
        expect(await screen.findByText("Killed q-7.")).not.toBeNull();
        expect(screen.queryByRole("group", { name: "Approval needed" })).toBeNull();
      });

      it("puts the card back when the server refuses an edit", async () => {
        mocks.resumeChatRun.mockRejectedValueOnce(new ApiError('The edited "Kill a query" action is not valid: queryId Required', 400, "BAD_REQUEST", "validation"));
        await pause();
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        const editor = screen.getByLabelText("Arguments (JSON)");
        fireEvent.change(editor, { target: { value: "{" } });
        fireEvent.click(screen.getByRole("button", { name: "Approve with changes" }));
        expect(screen.getByRole("alert").textContent).toBe("Not valid JSON.");
        expect(mocks.resumeChatRun).not.toHaveBeenCalled();
        fireEvent.change(editor, { target: { value: "{}" } });
        fireEvent.click(screen.getByRole("button", { name: "Approve with changes" }));
        await waitFor(() => expect(mocks.resumeChatRun).toHaveBeenCalledWith("run-pause", [{ actionId: "act-1", type: "edit", args: {} }], expect.any(Function), expect.anything()));
        expect(await screen.findByRole("group", { name: "Approval needed" })).not.toBeNull();
        expect(screen.queryByText(/Generation stopped|went wrong/)).toBeNull();
      });

      it("sends a rejection with the reason", async () => {
        mocks.resumeChatRun.mockImplementationOnce(async (_id: string, _decisions: unknown, onEvent: (event: unknown) => void) => {
          onEvent({ type: "final", result: answer("Okay, I left it running.") });
        });
        await pause();
        fireEvent.click(screen.getByRole("button", { name: "Reject" }));
        fireEvent.change(screen.getByLabelText(/Why not\?/), { target: { value: "Not during the backfill" } });
        fireEvent.click(screen.getByRole("button", { name: "Reject" }));
        await waitFor(() => expect(mocks.resumeChatRun).toHaveBeenCalledWith("run-pause", [{ actionId: "act-1", type: "reject", message: "Not during the backfill" }], expect.any(Function), expect.anything()));
        expect(await screen.findByText("Okay, I left it running.")).not.toBeNull();
      });

      it("declines the waiting approval when a new message is sent instead", async () => {
        await pause();
        await send("Actually, show me the tables");
        await waitFor(() => expect(mocks.cancelChatRun).toHaveBeenCalledWith("run-pause"));
        await waitFor(() => expect(mocks.streamChatRun).toHaveBeenCalledTimes(2));
        expect(screen.getByText("Not run: you sent a new message instead of approving it.")).not.toBeNull();
        expect(screen.queryByRole("group", { name: "Approval needed" })).toBeNull();
      });
    });

    it("closes the skill picker with Escape without closing the chat", async () => {
      mocks.getChatSkills.mockResolvedValue([{ name: "query-optimization", description: "Tune slow queries" }]);
      await openNewChat(/type \/ for skills/);
      // Typing "/" opens the picker (re-read the composer: the sheet may re-render once threads load).
      await waitFor(() => {
        fireEvent.change(screen.getByPlaceholderText(/type \/ for skills/), { target: { value: "/", selectionStart: 1 } });
        expect(screen.getByRole("listbox", { name: "Skills" })).not.toBeNull();
      });
      const composer = screen.getByPlaceholderText<HTMLTextAreaElement>(/type \/ for skills/);
      fireEvent.keyDown(composer, { key: "Escape" });
      expect(screen.queryByRole("listbox", { name: "Skills" })).toBeNull();
      expect(screen.getByRole("dialog", { name: "AI chat assistant" })).not.toBeNull();
    });
  });
});
