import { describe, expect, it } from "vitest";

import type { Briefing, BriefingItem } from "@/api/chobi";
import { INITIAL_NUDGE_STATE, NUDGE_MAX_PER_HOUR, NUDGE_MIN_GAP_MS, nextNudge } from "./chobiNudges";

function item(key: string, severity: BriefingItem["severity"] = "warn", connectionId: string | null = "c1", at = 1): BriefingItem {
  return { key, kind: "incident", severity, title: `Item ${key}`, detail: null, at, connectionId, ref: null };
}

function briefing(items: BriefingItem[], general: BriefingItem[] = []): Briefing {
  return {
    generatedAt: 0,
    general,
    connections: [{ id: "c1", name: "prod", production: true, status: items.length ? "attention" : "ok", items }],
    ai: { changedToday: 0, undoable: 0 },
    unavailable: [],
  };
}

const T0 = 1_000_000;

describe("nextNudge", () => {
  it("takes the first briefing as the baseline, without a nudge", () => {
    const { state, nudge } = nextNudge(INITIAL_NUDGE_STATE, briefing([item("a", "bad")]), { allowed: true, now: T0 });
    expect(nudge).toBeNull();
    expect([...(state.seen ?? [])]).toEqual(["a"]);
  });

  it("speaks up about the worst new item, naming its connection", () => {
    const base = nextNudge(INITIAL_NUDGE_STATE, briefing([item("a")]), { allowed: true, now: T0 }).state;
    const { nudge, state } = nextNudge(base, briefing([item("a"), item("b", "warn", "c1", 5), item("c", "bad", "c1", 1)]), { allowed: true, now: T0 + 1 });
    expect(nudge).toMatchObject({ key: "c", severity: "bad", text: "prod: Item c (+1 more)" });
    expect(state.shownAt).toEqual([T0 + 1]);
  });

  it("never nudges about info items or items it has seen", () => {
    const base = nextNudge(INITIAL_NUDGE_STATE, briefing([item("a")]), { allowed: true, now: T0 }).state;
    expect(nextNudge(base, briefing([item("a"), item("i", "info")]), { allowed: true, now: T0 + 1 }).nudge).toBeNull();
  });

  it("names approvals without a connection", () => {
    const base = nextNudge(INITIAL_NUDGE_STATE, briefing([]), { allowed: true, now: T0 }).state;
    const approval = { ...item("approvals:x", "warn", null), kind: "approval" as const, title: "1 change waiting for your answer" };
    expect(nextNudge(base, briefing([], [approval]), { allowed: true, now: T0 + 1 }).nudge?.text).toBe("1 change waiting for your answer");
  });

  it("stays quiet when not allowed, but still marks the news as seen", () => {
    const base = nextNudge(INITIAL_NUDGE_STATE, briefing([]), { allowed: true, now: T0 }).state;
    const muted = nextNudge(base, briefing([item("a", "bad")]), { allowed: false, now: T0 + 1 });
    expect(muted.nudge).toBeNull();
    expect(nextNudge(muted.state, briefing([item("a", "bad")]), { allowed: true, now: T0 + 2 }).nudge).toBeNull();
  });

  it("waits between nudges and caps them per hour", () => {
    let state = nextNudge(INITIAL_NUDGE_STATE, briefing([]), { allowed: true, now: T0 }).state;
    let now = T0;
    const shown: string[] = [];
    for (let i = 0; i < NUDGE_MAX_PER_HOUR + 3; i++) {
      now += i === 1 ? 1000 : NUDGE_MIN_GAP_MS;
      const next = nextNudge(state, briefing([item(`n${i}`, "bad")]), { allowed: true, now });
      state = next.state;
      if (next.nudge) shown.push(next.nudge.key);
    }
    // n1 came too soon after n0; then one per gap until the hourly cap.
    expect(shown[0]).toBe("n0");
    expect(shown).not.toContain("n1");
    expect(shown.length).toBe(NUDGE_MAX_PER_HOUR);

    // An hour later the window has room again.
    const later = nextNudge(state, briefing([item("late", "bad")]), { allowed: true, now: now + 61 * 60 * 1000 });
    expect(later.nudge?.key).toBe("late");
  });
});
