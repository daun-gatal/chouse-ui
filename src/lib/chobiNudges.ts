/**
 * When Chobi speaks up (ADR 0025 §6). Nudges come from data — a briefing item
 * Chobi has not seen before — never from a model call, and they are rate
 * limited: at most one every few minutes, a handful an hour, none while muted
 * or in quiet hours, none when the organization turned them off.
 */

import type { Briefing, BriefingItem, BriefingSeverity } from "@/api/chobi";

/** Shortest gap between two nudges. */
export const NUDGE_MIN_GAP_MS = 2 * 60 * 1000;
/** Most nudges in any hour. */
export const NUDGE_MAX_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;

const RANK: Record<BriefingSeverity, number> = { bad: 0, warn: 1, info: 2 };

export interface NudgeState {
  /** Item keys already seen; null until the first briefing sets the baseline. */
  seen: ReadonlySet<string> | null;
  /** When recent nudges were shown (ms), newest last. */
  shownAt: readonly number[];
}

export interface Nudge {
  key: string;
  text: string;
  severity: BriefingSeverity;
  item: BriefingItem;
}

export const INITIAL_NUDGE_STATE: NudgeState = { seen: null, shownAt: [] };

export function briefingItems(briefing: Briefing): BriefingItem[] {
  return [...briefing.general, ...briefing.connections.flatMap((c) => c.items)];
}

function nudgeText(item: BriefingItem, briefing: Briefing): string {
  const connection = item.connectionId ? briefing.connections.find((c) => c.id === item.connectionId) : null;
  return connection ? `${connection.name}: ${item.title}` : item.title;
}

/**
 * The next state after a briefing arrives, and the nudge to show (if any).
 * Info items and items already seen never nudge; a quiet period still marks
 * new items as seen, so they do not all pour out when it ends.
 */
export function nextNudge(state: NudgeState, briefing: Briefing, options: { allowed: boolean; now: number }): { state: NudgeState; nudge: Nudge | null } {
  const items = briefingItems(briefing);
  const seen = new Set(items.map((item) => item.key));
  const shownAt = state.shownAt.filter((at) => options.now - at < HOUR_MS);
  if (state.seen === null) return { state: { seen, shownAt }, nudge: null };

  const previous = state.seen;
  const fresh = items
    .filter((item) => !previous.has(item.key) && item.severity !== "info")
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.at ?? 0) - (a.at ?? 0));
  const last = shownAt[shownAt.length - 1];
  const limited = shownAt.length >= NUDGE_MAX_PER_HOUR || (last !== undefined && options.now - last < NUDGE_MIN_GAP_MS);
  const pick = fresh[0];
  if (!pick || !options.allowed || limited) return { state: { seen, shownAt }, nudge: null };

  const others = fresh.length - 1;
  const text = others > 0 ? `${nudgeText(pick, briefing)} (+${others} more)` : nudgeText(pick, briefing);
  return { state: { seen, shownAt: [...shownAt, options.now] }, nudge: { key: pick.key, text, severity: pick.severity, item: pick } };
}
