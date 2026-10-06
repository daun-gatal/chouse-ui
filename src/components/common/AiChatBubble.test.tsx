import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AiChatBubble from "./AiChatBubble";

const mocks = vi.hoisted(() => ({
  activeConnectionId: "connection-a" as string | null,
  breakpoint: "desktop" as "mobile" | "tablet" | "desktop",
  createThread: vi.fn(),
  getPreferences: vi.fn(),
  invokeChatMessage: vi.fn(),
  listThreads: vi.fn(),
  viewportWidth: 1440,
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: { AI_CHAT: "ai:chat" },
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
  getThread: vi.fn(),
  invokeChatMessage: mocks.invokeChatMessage,
  listThreads: mocks.listThreads,
  updateThreadTitle: vi.fn(),
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

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
  }),
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
    mocks.invokeChatMessage.mockReset();
    mocks.invokeChatMessage.mockResolvedValue({
      content: "Assistant response",
      toolCalls: [],
      chartSpecs: [],
    });
    mocks.listThreads.mockReset();
    mocks.listThreads.mockResolvedValue([]);
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
    let resolveInvoke: (result: {
      content: string;
      toolCalls: unknown[];
      chartSpecs: unknown[];
    }) => void = () => undefined;
    const invokeRequest = new Promise<{
      content: string;
      toolCalls: unknown[];
      chartSpecs: unknown[];
    }>((resolve) => {
      resolveInvoke = resolve;
    });
    mocks.invokeChatMessage.mockImplementationOnce(() => invokeRequest);
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
    fireEvent.change(await screen.findByPlaceholderText("Ask about your databases, schemas, queries…"), {
      target: { value: "Question for connection A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.invokeChatMessage).toHaveBeenCalledTimes(1));

    mocks.activeConnectionId = "connection-b";
    rerender(<AiChatBubble />);
    expect(await screen.findByRole("button", { name: "Start new chat" })).not.toBeNull();

    await act(async () => {
      resolveInvoke({ content: "Late response from A", toolCalls: [], chartSpecs: [] });
      await invokeRequest;
    });

    const connectionALoads = mocks.listThreads.mock.calls.filter(
      ([connectionId]) => connectionId === "connection-a",
    );
    expect(connectionALoads).toHaveLength(1);
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
    let resolveFirst: (result: { content: string; toolCalls: unknown[]; chartSpecs: unknown[] }) => void = () => undefined;
    mocks.invokeChatMessage.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
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
    const composer = await screen.findByPlaceholderText("Ask about your databases, schemas, queries…");
    fireEvent.change(composer, { target: { value: "Slow question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.invokeChatMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Stop generating" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByText("New conversation");
    const freshComposer = screen.getByPlaceholderText<HTMLTextAreaElement>("Ask about your databases, schemas, queries…");
    expect(freshComposer.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();

    fireEvent.change(freshComposer, { target: { value: "Second question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.invokeChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.invokeChatMessage.mock.calls.map(([threadId]) => threadId)).toEqual(["thread-1", "thread-2"]);

    await act(async () => {
      resolveFirst({ content: "Slow answer", toolCalls: [], chartSpecs: [] });
    });
  });
});
