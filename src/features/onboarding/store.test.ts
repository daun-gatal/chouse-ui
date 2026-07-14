import { beforeEach, describe, expect, it, vi } from "vitest";

import { rbacUserPreferencesApi } from "@/api";

vi.mock("@/api", () => ({
  rbacUserPreferencesApi: {
    getOnboarding: vi.fn(),
    updateOnboarding: vi.fn(),
  },
}));

const response = {
  progress: {
    formatRevision: 1 as const,
    welcomeSeen: false,
    completedChapterIds: [],
    dismissedChapterIds: [],
    lastStepIndex: 0,
  },
  bootstrapOnboardingPending: false,
  requiresPasswordChange: false,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("onboarding store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(rbacUserPreferencesApi.getOnboarding).mockResolvedValue(response);
    vi.mocked(rbacUserPreferencesApi.updateOnboarding).mockImplementation(async (patch) => ({
      ...response,
      progress: {
        ...response.progress,
        welcomeSeen: patch.welcomeSeen ?? response.progress.welcomeSeen,
        completedChapterIds: patch.completedChapterIds ?? response.progress.completedChapterIds,
        dismissedChapterIds: patch.dismissedChapterIds ?? response.progress.dismissedChapterIds,
        lastStepIndex: patch.lastStepIndex ?? response.progress.lastStepIndex,
        ...(patch.lastChapterId ? { lastChapterId: patch.lastChapterId } : {}),
        ...(patch.lastStepId ? { lastStepId: patch.lastStepId } : {}),
      },
    }));
    const { useOnboardingStore } = await import("./store");
    useOnboardingStore.getState().reset();
  });

  it("loads server progress and opens the hub for a new user", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");

    expect(useOnboardingStore.getState().initializedForUserId).toBe("user-1");
    expect(useOnboardingStore.getState().isHubOpen).toBe(true);
  });

  it("retries a transient initial-load failure within one bounded attempt window", async () => {
    vi.useFakeTimers();
    try {
      const { useOnboardingStore } = await import("./store");
      vi.mocked(rbacUserPreferencesApi.getOnboarding)
        .mockRejectedValueOnce(new Error("temporary outage"))
        .mockRejectedValueOnce(new Error("temporary outage"))
        .mockResolvedValueOnce(response);

      const initialization = useOnboardingStore.getState().initialize("user-1");
      await vi.runAllTimersAsync();
      await initialization;

      expect(rbacUserPreferencesApi.getOnboarding).toHaveBeenCalledTimes(3);
      expect(useOnboardingStore.getState().loadError).toBeNull();
      expect(useOnboardingStore.getState().isHubOpen).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows the same user to retry after all initial-load attempts fail", async () => {
    vi.useFakeTimers();
    try {
      const { useOnboardingStore } = await import("./store");
      vi.mocked(rbacUserPreferencesApi.getOnboarding).mockRejectedValue(new Error("offline"));

      const failedInitialization = useOnboardingStore.getState().initialize("user-1");
      await vi.runAllTimersAsync();
      await failedInitialization;

      expect(useOnboardingStore.getState().loadError).toBe("offline");
      expect(useOnboardingStore.getState().isHubOpen).toBe(true);

      vi.mocked(rbacUserPreferencesApi.getOnboarding).mockResolvedValue(response);
      await useOnboardingStore.getState().initialize("user-1");

      expect(rbacUserPreferencesApi.getOnboarding).toHaveBeenCalledTimes(4);
      expect(useOnboardingStore.getState().loadError).toBeNull();
      expect(useOnboardingStore.getState().isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists resumable chapter position", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().startChapter("explorer", 2, "explorer.import");

    expect(useOnboardingStore.getState().activeChapterId).toBe("explorer");
    expect(useOnboardingStore.getState().activeStepIndex).toBe(2);
    expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledWith(
      { lastChapterId: "explorer", lastStepId: "explorer.import", lastStepIndex: 2 },
      expect.any(AbortSignal),
    );
  });

  it("opens the hub by atomically pausing the active guide at its latest step", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    useOnboardingStore.setState({
      activeChapterId: "monitoring",
      activeStepIndex: 7,
      isHubOpen: false,
    });

    useOnboardingStore.getState().setHubOpen(true);

    const paused = useOnboardingStore.getState();
    expect(paused.isHubOpen).toBe(true);
    expect(paused.activeChapterId).toBeNull();
    expect(paused.activeStepIndex).toBe(0);
    expect(paused.progress.lastChapterId).toBe("monitoring");
    expect(paused.progress.lastStepIndex).toBe(7);
    await vi.waitFor(() => {
      expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledWith(
        { lastChapterId: "monitoring", lastStepId: null, lastStepIndex: 7 },
        expect.any(AbortSignal),
      );
    });
  });

  it("deduplicates completion and removes a prior dismissal", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    useOnboardingStore.setState((state) => ({
      progress: {
        ...state.progress,
        completedChapterIds: ["shell"],
        dismissedChapterIds: ["shell"],
      },
    }));
    await useOnboardingStore.getState().completeChapter("shell");

    const patch = vi.mocked(rbacUserPreferencesApi.updateOnboarding).mock.calls.at(-1)?.[0];
    expect(patch?.completedChapterIds).toEqual(["shell"]);
    expect(patch?.dismissedChapterIds).toEqual([]);
  });

  it("serializes rapid step and completion writes without applying the stale step response", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().startChapter("explorer", 0, "explorer.navigation");
    vi.mocked(rbacUserPreferencesApi.updateOnboarding).mockClear();

    const stepRequest = deferred<typeof response>();
    const completionRequest = deferred<typeof response>();
    vi.mocked(rbacUserPreferencesApi.updateOnboarding)
      .mockImplementationOnce(() => stepRequest.promise)
      .mockImplementationOnce(() => completionRequest.promise);

    const stepPromise = useOnboardingStore.getState().setActiveStep(2, "explorer.import");
    const completionPromise = useOnboardingStore.getState().completeChapter("explorer");

    await vi.waitFor(() => expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledTimes(1));
    expect(useOnboardingStore.getState().progress.completedChapterIds).toContain("explorer");
    expect(useOnboardingStore.getState().isTerminalActionPending).toBe(true);
    expect(useOnboardingStore.getState().activeChapterId).toBe("explorer");

    stepRequest.resolve({
      ...response,
      progress: {
        ...response.progress,
        lastChapterId: "explorer",
        lastStepIndex: 2,
      },
    });
    await vi.waitFor(() => expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledTimes(2));

    expect(useOnboardingStore.getState().progress.completedChapterIds).toContain("explorer");
    completionRequest.resolve({
      ...response,
      progress: {
        ...response.progress,
        completedChapterIds: ["explorer"],
      },
    });
    await Promise.all([stepPromise, completionPromise]);

    expect(useOnboardingStore.getState().progress.completedChapterIds).toEqual(["explorer"]);
    expect(useOnboardingStore.getState().progress.lastChapterId).toBeUndefined();
    expect(useOnboardingStore.getState().activeChapterId).toBeNull();
    expect(useOnboardingStore.getState().isTerminalActionPending).toBe(false);
    expect(vi.mocked(rbacUserPreferencesApi.updateOnboarding).mock.calls.map(([patch]) => patch)).toEqual([
      { lastChapterId: "explorer", lastStepId: "explorer.import", lastStepIndex: 2 },
      {
        completedChapterIds: ["explorer"],
        dismissedChapterIds: [],
        lastChapterId: null,
        lastStepId: null,
        lastStepIndex: 0,
      },
    ]);
  });

  it("keeps the current guide open and rolls back completion when saving fails", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().startChapter("explorer", 2, "explorer.import");
    vi.mocked(rbacUserPreferencesApi.updateOnboarding).mockRejectedValueOnce(new Error("save failed"));

    await useOnboardingStore.getState().completeChapter("explorer");

    const state = useOnboardingStore.getState();
    expect(state.activeChapterId).toBe("explorer");
    expect(state.activeStepIndex).toBe(2);
    expect(state.progress.completedChapterIds).not.toContain("explorer");
    expect(state.progress.lastStepId).toBe("explorer.import");
    expect(state.isTerminalActionPending).toBe(false);
    expect(state.persistenceError).toBe("save failed");
  });

  it("keeps the current guide open and rolls back dismissal when saving fails", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().startChapter("monitoring", 4, "monitoring.logs");
    vi.mocked(rbacUserPreferencesApi.updateOnboarding).mockRejectedValueOnce(new Error("skip failed"));

    await useOnboardingStore.getState().dismissChapter("monitoring");

    const state = useOnboardingStore.getState();
    expect(state.activeChapterId).toBe("monitoring");
    expect(state.activeStepIndex).toBe(4);
    expect(state.progress.dismissedChapterIds).not.toContain("monitoring");
    expect(state.progress.lastStepId).toBe("monitoring.logs");
    expect(state.persistenceError).toBe("skip failed");
  });

  it("ignores an older response after the authenticated user changes", async () => {
    const { useOnboardingStore } = await import("./store");
    let resolveFirst: ((value: typeof response) => void) | undefined;
    vi.mocked(rbacUserPreferencesApi.getOnboarding)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        ...response,
        progress: { ...response.progress, welcomeSeen: true },
      });

    const firstInitialization = useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().initialize("user-2");
    resolveFirst?.(response);
    await firstInitialization;

    expect(useOnboardingStore.getState().initializedForUserId).toBe("user-2");
    expect(useOnboardingStore.getState().progress.welcomeSeen).toBe(true);
    expect(useOnboardingStore.getState().isLoading).toBe(false);
  });

  it("aborts an in-flight write from the previous user and advances the queue", async () => {
    const { useOnboardingStore } = await import("./store");
    await useOnboardingStore.getState().initialize("user-1");
    await useOnboardingStore.getState().startChapter("explorer", 0);
    vi.mocked(rbacUserPreferencesApi.updateOnboarding).mockClear();

    vi.mocked(rbacUserPreferencesApi.updateOnboarding)
      .mockImplementationOnce((_patch, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }))
      .mockResolvedValueOnce(response);

    const staleWrite = useOnboardingStore.getState().setActiveStep(1);
    await vi.waitFor(() => expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledTimes(1));

    useOnboardingStore.getState().reset();
    await useOnboardingStore.getState().initialize("user-2");
    await useOnboardingStore.getState().startChapter("shell", 0);
    await staleWrite;

    expect(rbacUserPreferencesApi.updateOnboarding).toHaveBeenCalledTimes(2);
    expect(useOnboardingStore.getState().initializedForUserId).toBe("user-2");
    expect(useOnboardingStore.getState().activeChapterId).toBe("shell");
  });
});
