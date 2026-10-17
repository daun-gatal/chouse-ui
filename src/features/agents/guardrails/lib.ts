/**
 * Pure helpers for AI Governance › Guardrails (ADR 0022): labels, the default
 * settings of each kind, which actions the chosen stages allow, and scope
 * checks. The server validates every save; these keep the forms consistent.
 */

import {
  GUARDRAIL_ACTIONS,
  GUARDRAIL_STAGES,
  type Guardrail,
  type GuardrailAction,
  type GuardrailInput,
  type GuardrailKind,
  type GuardrailKindInfo,
  type GuardrailStage,
} from "@/api/aiGuardrails";

export const STAGE_LABELS: Record<GuardrailStage, string> = {
  input: "User input",
  tool_call: "Tool calls",
  tool_result: "Tool results",
  output: "Model output",
};

export const ACTION_HINTS: Record<GuardrailAction, string> = {
  log: "Record it in the trigger log only.",
  warn: "Record it and tell the model the content is untrusted or the call was flagged.",
  redact: "Replace matches before anything reaches the provider (or cut a result to the limit).",
  block: "Stop the run and show the user why.",
};

export const ACTION_TONE: Record<GuardrailAction, "brand" | "warn" | "bad" | "muted"> = {
  redact: "brand",
  warn: "warn",
  block: "bad",
  log: "muted",
};

export function defaultConfig(kind: GuardrailKind): Record<string, unknown> {
  switch (kind) {
    case "pattern": return { detectors: [], patterns: [], strategy: "placeholder" };
    case "keywords": return { terms: [], strategy: "placeholder" };
    case "columns": return { columns: [], strategy: "placeholder" };
    case "injection": return { extraPhrases: [] };
    case "sql": return { readOnly: true, requireLimit: true, denyDatabases: [], denyTables: [], maxEstimatedRows: null };
    case "tool": return { tool: "", rule: "deny", maxCalls: null, permission: null };
    case "limits": return { maxToolCalls: null, maxModelCalls: null, maxResultRows: null, maxResultBytes: null };
    case "judge": return { rule: "", modelConfigId: null };
  }
}

/** Stages a kind supports, in run order. */
export function kindStages(info: GuardrailKindInfo): GuardrailStage[] {
  return GUARDRAIL_STAGES.filter((s) => info.stages[s] !== undefined);
}

/** Actions allowed at every one of the chosen stages. */
export function allowedActions(info: GuardrailKindInfo, stages: GuardrailStage[]): GuardrailAction[] {
  if (stages.length === 0) return [];
  return GUARDRAIL_ACTIONS.filter((a) => stages.every((s) => info.stages[s]?.includes(a)));
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "guardrail";
  let slug = root;
  for (let n = 2; used.has(slug); n++) slug = `${root.slice(0, 56)}-${n}`;
  return slug;
}

/** A new guardrail of a kind: its first stage and action, in shadow mode, after every existing one. */
export function blankGuardrail(kind: GuardrailKind, info: GuardrailKindInfo, existing: Guardrail[]): GuardrailInput {
  const stages = kindStages(info).slice(0, 1);
  const actions = allowedActions(info, stages);
  return {
    slug: "",
    name: "",
    description: "",
    kind,
    config: defaultConfig(kind),
    stages,
    action: actions.includes("redact") ? "redact" : actions[actions.length - 1] ?? "log",
    mode: "shadow",
    scope: { agents: "all", features: "all", mcp: false },
    position: existing.reduce((max, g) => Math.max(max, g.position), 0) + 10,
    enabled: true,
  };
}

/** Keep the action valid when the stages change: the same action if allowed, else the strongest allowed. */
export function withStages(input: GuardrailInput, info: GuardrailKindInfo, stages: GuardrailStage[]): GuardrailInput {
  const ordered = GUARDRAIL_STAGES.filter((s) => stages.includes(s));
  const actions = allowedActions(info, ordered);
  const action = actions.includes(input.action) ? input.action : actions[actions.length - 1] ?? input.action;
  const mcpOk = ordered.includes("tool_result") && input.kind !== "judge";
  return { ...input, stages: ordered, action, scope: { ...input.scope, mcp: input.scope.mcp && mcpOk } };
}

/** Whether a guardrail runs for an agent (any feature it serves). */
export function appliesToAgent(g: Pick<Guardrail, "enabled" | "scope">, agentId: string): boolean {
  return g.enabled && (g.scope.agents === "all" || g.scope.agents.includes(agentId));
}

export function linesOf(value: unknown): string {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").join("\n") : "";
}

export function listOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Move one id to the position of another (drag and drop). */
export function moveId(ids: string[], from: string, to: string): string[] {
  const start = ids.indexOf(from);
  const end = ids.indexOf(to);
  if (start < 0 || end < 0 || start === end) return ids;
  const next = [...ids];
  next.splice(start, 1);
  next.splice(end, 0, from);
  return next;
}
