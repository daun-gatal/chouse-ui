/**
 * Helpers for the agent editor's Evals tab (ADR 0024 §Phase 6).
 */

import type { EvalCase, EvalCaseInput, EvalRun } from "@/api/aiEvals";

/** Tool names once each, in the order first called. */
export function uniqueInOrder(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** "list_tables, run_select_query" or one per line → names. */
export function parseToolList(text: string): string[] {
  return uniqueInOrder(text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean));
}

/** The threshold field shows a percentage; empty means no gate. */
export function thresholdFromPercent(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return "invalid";
  return value / 100;
}

export function percent(share: number | null | undefined): string {
  return share === null || share === undefined ? "—" : `${Math.round(share * 100)}%`;
}

/** What the case asks, in one line. */
export function caseSummary(test: Pick<EvalCase, "kind" | "input">): string {
  if (test.kind === "chat") {
    const messages = Array.isArray(test.input.messages) ? test.input.messages as Array<{ role?: string; content?: string }> : [];
    return messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  }
  return JSON.stringify(test.input);
}

/** A case from a test-console run: what was asked, and the tools the run called. */
export function caseFromConsole(run: { kind: "chat"; message: string; tools: string[] } | { kind: "feature"; featureId: string; featureTitle: string; input: Record<string, unknown>; tools: string[] }): EvalCaseInput {
  if (run.kind === "chat") {
    return { name: run.message.slice(0, 80), kind: "chat", input: { messages: [{ role: "user", content: run.message }] }, expectedTools: uniqueInOrder(run.tools), rubric: null };
  }
  return { name: `${run.featureTitle} case`, kind: "feature", featureId: run.featureId, input: run.input, expectedTools: uniqueInOrder(run.tools), rubric: null };
}

/** Problems with a case draft, before the server checks the feature input. */
export function caseProblems(draft: { name: string; kind: "chat" | "feature"; message: string; inputText: string; featureId: string | null }): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("Give the case a name.");
  if (draft.kind === "chat" && !draft.message.trim()) problems.push("Write the message the agent gets.");
  if (draft.kind === "feature") {
    if (!draft.featureId) problems.push("Pick the feature.");
    try {
      const parsed: unknown = JSON.parse(draft.inputText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) problems.push("The feature input is a JSON object.");
    } catch {
      problems.push("The feature input is not valid JSON.");
    }
  }
  return problems;
}

/** Whether a run is still going (the tab polls it). */
export function isRunning(run: Pick<EvalRun, "status"> | null | undefined): boolean {
  return run?.status === "running";
}
