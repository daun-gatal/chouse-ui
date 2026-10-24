/**
 * Chobi Store (ADR 0025 §6)
 *
 * Where Chobi is and what it shows. Size, tab, the launcher's spot and nudge
 * settings are remembered per user in this browser; whether a reply is
 * running, how many approvals wait and a queued question live only in memory.
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

import { useRbacStore } from "./rbac";

// ============================================
// Types
// ============================================

/** Bubble floats by the launcher, Docked is a side sheet, Focus fills the screen. */
export type ChobiSize = "bubble" | "docked" | "focus";
export type ChobiTab = "now" | "chat" | "activity";
export type ChobiSide = "left" | "right";

export const CHOBI_SIZES: readonly ChobiSize[] = ["bubble", "docked", "focus"];
export const CHOBI_TABS: readonly ChobiTab[] = ["now", "chat", "activity"];

/** A question handed to the chat from elsewhere (drag to ask, quick ask, an item's "Ask Chobi"). */
export interface ChobiAsk {
  id: number;
  text: string;
  /** Context for the question (a selection, a row, an item), sent as an attachment. */
  context?: { label: string; content: string };
  /** Send at once rather than leave it in the composer. */
  send: boolean;
}

/** Quiet hours, local time: no nudges from `start` until `end` (hours 0–23; may wrap midnight). */
export interface QuietHours {
  start: number;
  end: number;
}

export interface ChobiState {
  open: boolean;
  size: ChobiSize;
  tab: ChobiTab;
  side: ChobiSide;
  /** The launcher's vertical centre, as a fraction of the window height. */
  y: number;
  /** A chat reply is running. */
  busy: boolean;
  /** Approvals waiting for this user (their own plans and second-approver requests). */
  pendingApprovals: number;
  ask: ChobiAsk | null;
  /** Nudges are muted until this time (ms), or indefinitely with Infinity. */
  mutedUntil: number | null;
  quietHours: QuietHours | null;

  openPanel: (options?: { tab?: ChobiTab; size?: ChobiSize }) => void;
  close: () => void;
  toggle: () => void;
  setSize: (size: ChobiSize) => void;
  setTab: (tab: ChobiTab) => void;
  moveLauncher: (side: ChobiSide, y: number) => void;
  setBusy: (busy: boolean) => void;
  setPendingApprovals: (count: number) => void;
  askChobi: (text: string, options?: { context?: ChobiAsk["context"]; send?: boolean }) => void;
  /** The chat takes the queued question (once). */
  takeAsk: (id: number) => void;
  muteNudges: (until: number | null) => void;
  setQuietHours: (hours: QuietHours | null) => void;
}

// ============================================
// Helpers
// ============================================

export const LAUNCHER_Y_MIN = 0.12;
export const LAUNCHER_Y_MAX = 0.88;

export function clampLauncherY(y: number): number {
  if (!Number.isFinite(y)) return 0.5;
  return Math.min(LAUNCHER_Y_MAX, Math.max(LAUNCHER_Y_MIN, y));
}

/** Whether `hour` (0–23) falls in quiet hours; a range like 22→7 wraps midnight. */
export function inQuietHours(hours: QuietHours | null, hour: number): boolean {
  if (!hours || hours.start === hours.end) return false;
  return hours.start < hours.end
    ? hour >= hours.start && hour < hours.end
    : hour >= hours.start || hour < hours.end;
}

export function nudgesMuted(state: Pick<ChobiState, "mutedUntil" | "quietHours">, now: Date = new Date()): boolean {
  if (state.mutedUntil !== null && state.mutedUntil > now.getTime()) return true;
  return inQuietHours(state.quietHours, now.getHours());
}

let askSequence = 0;

/** localStorage under `<name>-<user id>`, so two people on one browser keep their own Chobi. */
export function userScopedStorage(): StateStorage {
  const keyFor = (name: string): string => {
    const userId = useRbacStore.getState().user?.id;
    return userId ? `${name}-${userId}` : name;
  };
  return {
    getItem: (name) => {
      try { return localStorage.getItem(keyFor(name)); } catch { return null; }
    },
    setItem: (name, value) => {
      try { localStorage.setItem(keyFor(name), value); } catch { /* storage full or blocked: Chobi still works */ }
    },
    removeItem: (name) => {
      try { localStorage.removeItem(keyFor(name)); } catch { /* ignore */ }
    },
  };
}

/** What Chobi remembers between visits: where it is and how it looks, never what it is doing. */
export function savedChobiState(state: ChobiState): Pick<ChobiState, "size" | "tab" | "side" | "y" | "mutedUntil" | "quietHours"> {
  return {
    size: state.size,
    tab: state.tab,
    side: state.side,
    y: state.y,
    // JSON has no Infinity: "muted until I unmute" is stored as the largest safe time.
    mutedUntil: state.mutedUntil === Infinity ? Number.MAX_SAFE_INTEGER : state.mutedUntil,
    quietHours: state.quietHours,
  };
}

/** Saved state back onto the defaults, dropping anything it does not recognize. */
export function restoreChobiState(persisted: unknown, current: ChobiState): ChobiState {
  const saved: Record<string, unknown> = persisted && typeof persisted === "object" ? { ...persisted } : {};
  return {
    ...current,
    size: isSize(saved.size) ? saved.size : current.size,
    tab: isTab(saved.tab) ? saved.tab : current.tab,
    side: saved.side === "left" ? "left" : "right",
    y: clampLauncherY(typeof saved.y === "number" ? saved.y : current.y),
    mutedUntil: typeof saved.mutedUntil === "number" ? saved.mutedUntil : null,
    quietHours: validQuietHours(saved.quietHours) ? saved.quietHours : null,
  };
}

// ============================================
// Store
// ============================================

export const useChobiStore = create<ChobiState>()(
  persist(
    (set) => ({
      open: false,
      size: "bubble",
      tab: "chat",
      side: "right",
      y: 0.72,
      busy: false,
      pendingApprovals: 0,
      ask: null,
      mutedUntil: null,
      quietHours: null,

      openPanel: (options) => set((state) => ({
        open: true,
        tab: options?.tab ?? state.tab,
        size: options?.size ?? state.size,
      })),
      close: () => set({ open: false }),
      toggle: () => set((state) => ({ open: !state.open })),
      setSize: (size) => set({ size }),
      setTab: (tab) => set({ tab }),
      moveLauncher: (side, y) => set({ side, y: clampLauncherY(y) }),
      setBusy: (busy) => set((state) => (state.busy === busy ? state : { busy })),
      setPendingApprovals: (count) => set((state) => {
        const next = Math.max(0, Math.floor(count));
        return state.pendingApprovals === next ? state : { pendingApprovals: next };
      }),
      askChobi: (text, options) => {
        askSequence += 1;
        set({
          open: true,
          tab: "chat",
          ask: { id: askSequence, text, context: options?.context, send: options?.send ?? false },
        });
      },
      takeAsk: (id) => set((state) => (state.ask?.id === id ? { ask: null } : state)),
      muteNudges: (until) => set({ mutedUntil: until }),
      setQuietHours: (hours) => set({ quietHours: hours }),
    }),
    {
      name: "chobi-storage",
      storage: createJSONStorage(userScopedStorage),
      partialize: savedChobiState,
      merge: (persisted, current) => restoreChobiState(persisted, current),
    }
  )
);

function isSize(value: unknown): value is ChobiSize {
  return CHOBI_SIZES.some((size) => size === value);
}

function isTab(value: unknown): value is ChobiTab {
  return CHOBI_TABS.some((tab) => tab === value);
}

function validQuietHours(value: unknown): value is QuietHours {
  if (!value || typeof value !== "object" || !("start" in value) || !("end" in value)) return false;
  const hour = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
  return hour(value.start) && hour(value.end);
}
