import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RbacUser } from "@/api/rbac";

function user(id: string): RbacUser {
  return {
    id, email: `${id}@test.local`, username: id, displayName: null, avatarUrl: null, isActive: true,
    hasSsoIdentity: false, bootstrapOnboardingPending: false, requiresPasswordChange: false,
    roles: [], permissions: [], lastLoginAt: null, createdAt: "2026-10-24T00:00:00.000Z",
  };
}

describe("chobi store", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("opens on a tab and size, and toggles", async () => {
    const { useChobiStore } = await import("./chobi");
    const store = useChobiStore.getState();
    expect(useChobiStore.getState()).toMatchObject({ open: false, tab: "now", size: "bubble" });

    store.openPanel({ tab: "activity", size: "focus" });
    expect(useChobiStore.getState()).toMatchObject({ open: true, tab: "activity", size: "focus" });
    store.toggle();
    expect(useChobiStore.getState().open).toBe(false);
    store.openPanel();
    expect(useChobiStore.getState()).toMatchObject({ open: true, tab: "activity", size: "focus" });
  });

  it("keeps the launcher on screen", async () => {
    const { useChobiStore, LAUNCHER_Y_MAX, LAUNCHER_Y_MIN } = await import("./chobi");
    useChobiStore.getState().moveLauncher("left", 2);
    expect(useChobiStore.getState()).toMatchObject({ side: "left", y: LAUNCHER_Y_MAX });
    useChobiStore.getState().moveLauncher("right", -1);
    expect(useChobiStore.getState()).toMatchObject({ side: "right", y: LAUNCHER_Y_MIN });
    useChobiStore.getState().moveLauncher("right", Number.NaN);
    expect(useChobiStore.getState().y).toBe(0.5);
  });

  it("queues a question for the chat, which takes it once", async () => {
    const { useChobiStore } = await import("./chobi");
    useChobiStore.getState().askChobi("Why is this slow?", { context: { name: "query.sql", content: "SELECT 1" }, send: true });
    const ask = useChobiStore.getState().ask;
    expect(useChobiStore.getState()).toMatchObject({ open: true, tab: "chat" });
    expect(ask).toMatchObject({ text: "Why is this slow?", send: true, context: { name: "query.sql", content: "SELECT 1" } });

    useChobiStore.getState().takeAsk((ask?.id ?? 0) + 1);
    expect(useChobiStore.getState().ask).not.toBeNull();
    useChobiStore.getState().takeAsk(ask?.id ?? 0);
    expect(useChobiStore.getState().ask).toBeNull();
  });

  it("counts approvals as whole, non-negative numbers", async () => {
    const { useChobiStore } = await import("./chobi");
    useChobiStore.getState().setPendingApprovals(2.7);
    expect(useChobiStore.getState().pendingApprovals).toBe(2);
    useChobiStore.getState().setPendingApprovals(-3);
    expect(useChobiStore.getState().pendingApprovals).toBe(0);
  });

  it("remembers size, tab and place but not what is transient", async () => {
    const { useChobiStore, savedChobiState, restoreChobiState } = await import("./chobi");
    const store = useChobiStore.getState();
    store.openPanel({ tab: "activity", size: "docked" });
    store.moveLauncher("left", 0.3);
    store.setBusy(true);
    store.setQuietHours({ start: 22, end: 7 });
    store.muteNudges(Infinity);

    const saved: unknown = JSON.parse(JSON.stringify(savedChobiState(useChobiStore.getState())));
    expect(saved).toEqual({ size: "docked", tab: "activity", side: "left", y: 0.3, mutedUntil: Number.MAX_SAFE_INTEGER, quietHours: { start: 22, end: 7 } });

    vi.resetModules();
    const fresh = (await import("./chobi")).useChobiStore.getState();
    expect(restoreChobiState(saved, fresh)).toMatchObject({ open: false, busy: false, tab: "activity", size: "docked", side: "left", y: 0.3, quietHours: { start: 22, end: 7 } });
  });

  it("ignores saved values it does not understand", async () => {
    const { useChobiStore, restoreChobiState } = await import("./chobi");
    const restored = restoreChobiState({ size: "huge", tab: "secrets", side: "up", y: "x", quietHours: { start: 25, end: 3 }, mutedUntil: "soon" }, useChobiStore.getState());
    expect(restored).toMatchObject({ size: "bubble", tab: "now", side: "right", y: 0.72, quietHours: null, mutedUntil: null });
    expect(restoreChobiState(null, useChobiStore.getState())).toMatchObject({ size: "bubble", tab: "now" });
  });
});

describe("askContext", () => {
  it("names the attachment safely and keeps it short", async () => {
    const { askContext, ASK_CONTEXT_MAX_CHARS } = await import("./chobi");
    expect(askContext("query.sql", "SELECT 1")).toEqual({ name: "query.sql", content: "SELECT 1" });
    expect(askContext("Incident: orders late!", "x").name).toBe("Incident-orders-late.txt");
    expect(askContext("../../etc/passwd", "x").name).toBe("..-..-etc-passwd.txt");
    expect(askContext("", "x").name).toBe("context.txt");
    const long = askContext("big.txt", "a".repeat(ASK_CONTEXT_MAX_CHARS + 10));
    expect(long.content.startsWith("a".repeat(ASK_CONTEXT_MAX_CHARS))).toBe(true);
    expect(long.content).toContain("cut at");
  });
});

describe("chobi storage", () => {
  it("keeps each user's Chobi under its own key, never another store's", async () => {
    const { useRbacStore } = await import("./rbac");
    const { userScopedStorage } = await import("./chobi");
    localStorage.clear();
    localStorage.setItem("ai-model-storage-u1", "model choice");
    useRbacStore.setState({ user: user("u1") });
    const storage = userScopedStorage();
    storage.setItem("chobi-storage", "{\"side\":\"left\"}");
    expect(localStorage.getItem("chobi-storage-u1")).toBe("{\"side\":\"left\"}");
    expect(localStorage.getItem("ai-model-storage-u1")).toBe("model choice");

    useRbacStore.setState({ user: user("u2") });
    expect(storage.getItem("chobi-storage")).toBeNull();
    useRbacStore.setState({ user: null });
  });
});

describe("nudge quiet hours", () => {
  it("covers ranges that wrap midnight", async () => {
    const { inQuietHours } = await import("./chobi");
    expect(inQuietHours({ start: 22, end: 7 }, 23)).toBe(true);
    expect(inQuietHours({ start: 22, end: 7 }, 3)).toBe(true);
    expect(inQuietHours({ start: 22, end: 7 }, 7)).toBe(false);
    expect(inQuietHours({ start: 9, end: 17 }, 12)).toBe(true);
    expect(inQuietHours({ start: 9, end: 17 }, 17)).toBe(false);
    expect(inQuietHours({ start: 9, end: 9 }, 9)).toBe(false);
    expect(inQuietHours(null, 9)).toBe(false);
  });

  it("mutes until a time, or during quiet hours", async () => {
    const { nudgesMuted } = await import("./chobi");
    const noon = new Date(2026, 9, 24, 12, 0, 0);
    expect(nudgesMuted({ mutedUntil: noon.getTime() + 1000, quietHours: null }, noon)).toBe(true);
    expect(nudgesMuted({ mutedUntil: noon.getTime() - 1000, quietHours: null }, noon)).toBe(false);
    expect(nudgesMuted({ mutedUntil: null, quietHours: { start: 11, end: 13 } }, noon)).toBe(true);
  });
});
