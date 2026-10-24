/**
 * Eval scoring (ADR 0024 §Phase 6, D6): our own tool-call matcher, the draft
 * hash that ties a run to the exact agent it scored, and how a case and a
 * run are scored.
 */

import { createHash } from "crypto";

/**
 * Expected tools must be called in this order; other calls may come between.
 * `missing` lists the expected tools from the first one not found onward.
 */
export function matchToolSequence(expected: readonly string[], actual: readonly string[]): { ok: boolean; missing: string[] } {
  let at = 0;
  for (let i = 0; i < expected.length; i++) {
    const found = actual.indexOf(expected[i], at);
    if (found < 0) return { ok: false, missing: expected.slice(i) };
    at = found + 1;
  }
  return { ok: true, missing: [] };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stable(v)]));
  }
  return value;
}

/** Fields that change what the agent does; the eval threshold itself is left out, so raising it never invalidates a run. */
const BEHAVIOUR_FIELDS = ["slug", "kind", "systemPrompt", "taskTemplate", "modelConfigId", "harnessId", "tuning", "requiredPermissions", "tools", "skills", "subagents", "enabled"] as const;

/** Identifies one draft of an agent: the same behaviour gives the same hash. */
export function agentDraftHash(agent: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {};
  for (const field of BEHAVIOUR_FIELDS) picked[field] = agent[field];
  if (picked.tuning && typeof picked.tuning === "object") {
    const { evalThreshold: _threshold, ...tuning } = picked.tuning as Record<string, unknown>;
    picked.tuning = tuning;
  }
  return createHash("sha256").update(JSON.stringify(stable(picked))).digest("hex").slice(0, 32);
}

export interface CaseOutcome {
  /** null when the case expects no tools. */
  toolsOk: boolean | null;
  /** null when the case has no rubric. */
  judgePass: boolean | null;
  error: string | null;
}

/** A case passes when it ran, called the expected tools in order, and met its rubric. */
export function casePassed(outcome: CaseOutcome): boolean {
  return outcome.error === null && outcome.toolsOk !== false && outcome.judgePass !== false;
}

/** Share of cases that passed, 0–1; null without cases. */
export function runScore(passed: number, total: number): number | null {
  return total === 0 ? null : passed / total;
}
