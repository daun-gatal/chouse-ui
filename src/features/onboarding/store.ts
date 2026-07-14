import { create } from "zustand";

import {
  rbacUserPreferencesApi,
  type OnboardingProgress,
  type OnboardingProgressPatch,
  type OnboardingResponse,
} from "@/api";
import { log } from "@/lib/log";
import { prepareSurfacesForOnboarding } from "@/lib/onboardingSurfaces";

const DEFAULT_PROGRESS: OnboardingProgress = {
  formatRevision: 1,
  welcomeSeen: false,
  completedChapterIds: [],
  dismissedChapterIds: [],
  lastStepIndex: 0,
};

interface OnboardingState {
  initializedForUserId: string | null;
  isLoading: boolean;
  isHubOpen: boolean;
  activeChapterId: string | null;
  activeStepIndex: number;
  progress: OnboardingProgress;
  bootstrapOnboardingPending: boolean;
  requiresPasswordChange: boolean;
  isTerminalActionPending: boolean;
  loadError: string | null;
  persistenceError: string | null;
  initialize: (userId: string) => Promise<void>;
  reset: () => void;
  setHubOpen: (open: boolean) => void;
  startChapter: (chapterId: string, stepIndex?: number, stepId?: string) => Promise<void>;
  setActiveStep: (stepIndex: number, stepId?: string) => Promise<void>;
  exitChapter: () => void;
  completeChapter: (chapterId: string) => Promise<void>;
  dismissChapter: (chapterId: string) => Promise<void>;
  markWelcomeSeen: () => Promise<void>;
  completeBootstrap: () => Promise<void>;
  clearPersistenceError: () => void;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function progressWithResume(
  progress: OnboardingProgress,
  chapterId: string,
  stepIndex: number,
  stepId?: string,
): OnboardingProgress {
  const next = {
    ...progress,
    lastChapterId: chapterId,
    lastStepIndex: stepIndex,
  };
  if (stepId) next.lastStepId = stepId;
  else delete next.lastStepId;
  return next;
}

function progressWithoutResume(progress: OnboardingProgress): OnboardingProgress {
  const next = { ...progress, lastStepIndex: 0 };
  delete next.lastChapterId;
  delete next.lastStepId;
  return next;
}

function stateFromResponse(response: OnboardingResponse): Pick<
  OnboardingState,
  "progress" | "bootstrapOnboardingPending" | "requiresPasswordChange"
> {
  return {
    progress: response.progress,
    bootstrapOnboardingPending: response.bootstrapOnboardingPending,
    requiresPasswordChange: response.requiresPasswordChange,
  };
}

interface PersistResult {
  response: OnboardingResponse;
  isLatest: boolean;
}

let persistenceEpoch = 0;
let persistenceRevision = 0;
let persistenceQueue: Promise<void> = Promise.resolve();
let terminalActionRevision = 0;
let onboardingRequestController = new AbortController();
const INITIAL_LOAD_ATTEMPTS = 3;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeoutId = globalThis.setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      globalThis.clearTimeout(timeoutId);
      resolve();
    }, { once: true });
  });
}

function beginPersistenceEpoch(): void {
  onboardingRequestController.abort();
  onboardingRequestController = new AbortController();
  persistenceEpoch += 1;
  persistenceRevision = 0;
  terminalActionRevision += 1;
}

function persistPatch(patch: OnboardingProgressPatch): Promise<PersistResult | null> {
  const epoch = persistenceEpoch;
  const revision = ++persistenceRevision;
  const signal = onboardingRequestController.signal;
  const request = persistenceQueue.then(async (): Promise<PersistResult | null> => {
    if (epoch !== persistenceEpoch) return null;
    try {
      const response = await rbacUserPreferencesApi.updateOnboarding(patch, signal);
      return {
        response,
        isLatest: epoch === persistenceEpoch && revision === persistenceRevision,
      };
    } catch (error) {
      if (signal.aborted || epoch !== persistenceEpoch) return null;
      throw error;
    }
  });
  persistenceQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  initializedForUserId: null,
  isLoading: false,
  isHubOpen: false,
  activeChapterId: null,
  activeStepIndex: 0,
  progress: DEFAULT_PROGRESS,
  bootstrapOnboardingPending: false,
  requiresPasswordChange: false,
  isTerminalActionPending: false,
  loadError: null,
  persistenceError: null,

  initialize: async (userId: string): Promise<void> => {
    if (get().initializedForUserId === userId && !get().loadError) return;
    beginPersistenceEpoch();
    set({
      initializedForUserId: userId,
      isLoading: true,
      isHubOpen: false,
      activeChapterId: null,
      activeStepIndex: 0,
      progress: DEFAULT_PROGRESS,
      bootstrapOnboardingPending: false,
      requiresPasswordChange: false,
      isTerminalActionPending: false,
      loadError: null,
      persistenceError: null,
    });
    const epoch = persistenceEpoch;
    const signal = onboardingRequestController.signal;
    let lastError: unknown;
    for (let attempt = 0; attempt < INITIAL_LOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await rbacUserPreferencesApi.getOnboarding(signal);
        if (signal.aborted || epoch !== persistenceEpoch) return;
        if (get().initializedForUserId !== userId) return;
        set({
          ...stateFromResponse(response),
          isLoading: false,
          isHubOpen: !response.progress.welcomeSeen || response.bootstrapOnboardingPending,
          loadError: null,
        });
        return;
      } catch (error) {
        if (signal.aborted || epoch !== persistenceEpoch) return;
        lastError = error;
        if (attempt < INITIAL_LOAD_ATTEMPTS - 1) {
          await waitForRetry(150 * (2 ** attempt), signal);
        }
      }
    }
    const message = errorMessage(lastError, "Could not load onboarding progress");
    log.error("[Onboarding] Failed to load progress after retries", { error: message });
    if (get().initializedForUserId === userId) {
      set({ isLoading: false, isHubOpen: true, loadError: message });
    }
  },

  reset: (): void => {
    beginPersistenceEpoch();
    set({
      initializedForUserId: null,
      isLoading: false,
      isHubOpen: false,
      activeChapterId: null,
      activeStepIndex: 0,
      progress: DEFAULT_PROGRESS,
      bootstrapOnboardingPending: false,
      requiresPasswordChange: false,
      isTerminalActionPending: false,
      loadError: null,
      persistenceError: null,
    });
  },

  setHubOpen: (open: boolean): void => {
    if (!open) {
      set({ isHubOpen: false });
      return;
    }

    const state = get();
    if (state.isHubOpen && !state.activeChapterId) return;
    prepareSurfacesForOnboarding();
    if (!state.activeChapterId) {
      set({ isHubOpen: true, persistenceError: null });
      return;
    }

    const chapterId = state.activeChapterId;
    const stepIndex = state.activeStepIndex;
    const stepId = state.progress.lastStepId;
    set({
      isHubOpen: true,
      activeChapterId: null,
      activeStepIndex: 0,
      progress: progressWithResume(state.progress, chapterId, stepIndex, stepId),
      persistenceError: null,
    });
    void persistPatch({ lastChapterId: chapterId, lastStepId: stepId ?? null, lastStepIndex: stepIndex })
      .then((result) => {
        if (result?.isLatest) set(stateFromResponse(result.response));
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Could not save the paused guide position");
        log.error("[Onboarding] Failed to save paused chapter position", {
          error: message,
        });
        set({ persistenceError: message });
      });
  },

  startChapter: async (chapterId: string, stepIndex = 0, stepId?: string): Promise<void> => {
    if (get().loadError) return;
    const safeStep = Math.max(0, stepIndex);
    prepareSurfacesForOnboarding();
    set({
      isHubOpen: false,
      activeChapterId: chapterId,
      activeStepIndex: safeStep,
      progress: progressWithResume(get().progress, chapterId, safeStep, stepId),
      persistenceError: null,
    });
    try {
      const result = await persistPatch({
        lastChapterId: chapterId,
        lastStepId: stepId ?? null,
        lastStepIndex: safeStep,
      });
      if (result?.isLatest) set(stateFromResponse(result.response));
    } catch (error) {
      const message = errorMessage(error, "Could not save the guide position");
      log.error("[Onboarding] Failed to save chapter position", {
        error: message,
      });
      set({ persistenceError: message });
    }
  },

  setActiveStep: async (stepIndex: number, stepId?: string): Promise<void> => {
    const chapterId = get().activeChapterId;
    if (!chapterId) return;
    const safeStep = Math.max(0, stepIndex);
    set((state) => ({
      activeStepIndex: safeStep,
      progress: progressWithResume(state.progress, chapterId, safeStep, stepId),
      persistenceError: null,
    }));
    try {
      const result = await persistPatch({
        lastChapterId: chapterId,
        lastStepId: stepId ?? null,
        lastStepIndex: safeStep,
      });
      if (result?.isLatest) set(stateFromResponse(result.response));
    } catch (error) {
      const message = errorMessage(error, "Could not save the current guide step");
      log.error("[Onboarding] Failed to save step position", {
        error: message,
      });
      set({ persistenceError: message });
    }
  },

  exitChapter: (): void => {
    const state = get();
    if (!state.activeChapterId) {
      set({ activeStepIndex: 0, persistenceError: null });
      return;
    }
    const chapterId = state.activeChapterId;
    const stepIndex = state.activeStepIndex;
    const stepId = state.progress.lastStepId;
    set({
      activeChapterId: null,
      activeStepIndex: 0,
      progress: progressWithResume(state.progress, chapterId, stepIndex, stepId),
      persistenceError: null,
    });
    void persistPatch({ lastChapterId: chapterId, lastStepId: stepId ?? null, lastStepIndex: stepIndex })
      .then((result) => {
        if (result?.isLatest) set(stateFromResponse(result.response));
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Could not save the exited guide position");
        log.error("[Onboarding] Failed to save exited chapter position", {
          error: message,
        });
        set({ persistenceError: message });
      });
  },

  completeChapter: async (chapterId: string): Promise<void> => {
    if (get().isTerminalActionPending) return;
    const actionRevision = ++terminalActionRevision;
    const stateBeforeAction = get();
    const progress = stateBeforeAction.progress;
    const completedChapterIds = unique([...progress.completedChapterIds, chapterId]);
    const dismissedChapterIds = progress.dismissedChapterIds.filter((id) => id !== chapterId);
    set({
      progress: {
        ...progressWithoutResume(progress),
        completedChapterIds,
        dismissedChapterIds,
      },
      isTerminalActionPending: true,
      persistenceError: null,
    });
    try {
      const result = await persistPatch({
        completedChapterIds,
        dismissedChapterIds,
        lastChapterId: null,
        lastStepId: null,
        lastStepIndex: 0,
      });
      if (result?.isLatest) {
        set({
          ...stateFromResponse(result.response),
          activeChapterId: null,
          activeStepIndex: 0,
        });
      }
    } catch (error) {
      const message = errorMessage(error, "Could not complete this guide");
      log.error("[Onboarding] Failed to complete chapter", {
        error: message,
      });
      if (actionRevision === terminalActionRevision) {
        set({
          activeChapterId: stateBeforeAction.activeChapterId,
          activeStepIndex: stateBeforeAction.activeStepIndex,
          progress,
          persistenceError: message,
        });
      }
    } finally {
      if (actionRevision === terminalActionRevision) set({ isTerminalActionPending: false });
    }
  },

  dismissChapter: async (chapterId: string): Promise<void> => {
    if (get().isTerminalActionPending) return;
    const actionRevision = ++terminalActionRevision;
    const stateBeforeAction = get();
    const progress = stateBeforeAction.progress;
    const dismissedChapterIds = unique([...progress.dismissedChapterIds, chapterId]);
    set({
      progress: { ...progressWithoutResume(progress), dismissedChapterIds },
      isTerminalActionPending: true,
      persistenceError: null,
    });
    try {
      const result = await persistPatch({
        dismissedChapterIds,
        lastChapterId: null,
        lastStepId: null,
        lastStepIndex: 0,
      });
      if (result?.isLatest) {
        set({
          ...stateFromResponse(result.response),
          activeChapterId: null,
          activeStepIndex: 0,
        });
      }
    } catch (error) {
      const message = errorMessage(error, "Could not skip this guide");
      log.error("[Onboarding] Failed to dismiss chapter", {
        error: message,
      });
      if (actionRevision === terminalActionRevision) {
        set({
          activeChapterId: stateBeforeAction.activeChapterId,
          activeStepIndex: stateBeforeAction.activeStepIndex,
          progress,
          persistenceError: message,
        });
      }
    } finally {
      if (actionRevision === terminalActionRevision) set({ isTerminalActionPending: false });
    }
  },

  markWelcomeSeen: async (): Promise<void> => {
    const previousWelcomeSeen = get().progress.welcomeSeen;
    if (previousWelcomeSeen || get().loadError) return;
    set((state) => ({
      progress: { ...state.progress, welcomeSeen: true },
      persistenceError: null,
    }));
    try {
      const result = await persistPatch({ welcomeSeen: true });
      if (result?.isLatest) set(stateFromResponse(result.response));
    } catch (error) {
      const message = errorMessage(error, "Could not save the welcome state");
      log.error("[Onboarding] Failed to save welcome state", {
        error: message,
      });
      set((state) => ({
        progress: { ...state.progress, welcomeSeen: previousWelcomeSeen },
        isHubOpen: true,
        persistenceError: message,
      }));
    }
  },

  completeBootstrap: async (): Promise<void> => {
    if (get().loadError) return;
    set({ persistenceError: null });
    try {
      const result = await persistPatch({ bootstrapComplete: true });
      if (result?.isLatest) set(stateFromResponse(result.response));
    } catch (error) {
      const message = errorMessage(error, "Could not complete workspace setup");
      set({ persistenceError: message });
      throw error;
    }
  },

  clearPersistenceError: (): void => set({ persistenceError: null }),
}));
