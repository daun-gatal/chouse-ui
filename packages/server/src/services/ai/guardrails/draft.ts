/**
 * Draft a guardrail with AI (ADR 0022 §7). The drafter turns a plain-language
 * goal into the editor's input; it never saves. The draft is checked with the
 * same rules as a save, and starts in shadow mode so its effect is visible
 * before it changes anything.
 */

import { z } from "zod";

import { DETECTORS } from "./detectors";
import { guardrailProblems, KIND_SPECS } from "./kinds";
import type { GuardrailInput } from "./service";
import { GUARDRAIL_ACTIONS, GUARDRAIL_KINDS, GUARDRAIL_STAGES, type GuardrailDef } from "./types";

export const guardrailDraftRequestSchema = z.object({
  goal: z.string().trim().min(3).max(2_000),
});

export type GuardrailDraftRequest = z.infer<typeof guardrailDraftRequestSchema>;

export const GuardrailDraftSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  kind: z.enum(GUARDRAIL_KINDS),
  config: z.record(z.string(), z.unknown()),
  stages: z.array(z.enum(GUARDRAIL_STAGES)).min(1),
  action: z.enum(GUARDRAIL_ACTIONS),
  rationale: z.string().max(1_000),
});

export interface GuardrailDraft {
  input: GuardrailInput;
  rationale: string;
  /** Rule violations the user must fix in the editor before saving; empty when the draft is valid. */
  problems: string[];
}

const CONFIG_SHAPES: Record<string, string> = {
  pattern: `{"detectors": string[] (ids below), "patterns": [{"label": string, "regex": string (JavaScript, no nested repeats like (a+)+), "caseInsensitive": boolean}], "strategy": "placeholder"|"mask"|"hash"}`,
  keywords: `{"terms": string[], "strategy": "placeholder"|"mask"|"hash"}`,
  columns: `{"columns": string[] (column names or globs, e.g. "email", "*_ssn"), "strategy": "placeholder"|"mask"|"hash"}`,
  injection: `{"extraPhrases": string[]}`,
  sql: `{"readOnly": boolean, "requireLimit": boolean, "denyDatabases": string[], "denyTables": string[] ("db.table"), "maxEstimatedRows": number|null}`,
  tool: `{"tool": string (a tool name), "rule": "deny"|"max_calls"|"permission", "maxCalls": number|null, "permission": string|null}`,
  limits: `{"maxToolCalls": number|null, "maxModelCalls": number|null, "maxResultRows": number|null, "maxResultBytes": number|null}`,
  judge: `{"rule": string (one plain sentence describing what violates), "modelConfigId": null}`,
};

/** What the drafter may use: the goal and the rules every guardrail must follow. */
export function guardrailDraftEvidence(request: GuardrailDraftRequest): Record<string, unknown> {
  return {
    goal: request.goal,
    kinds: Object.fromEntries(Object.entries(KIND_SPECS).map(([kind, spec]) => [kind, {
      purpose: spec.description,
      stagesAndActions: spec.stages,
      config: CONFIG_SHAPES[kind],
    }])),
    detectors: DETECTORS.map((d) => ({ id: d.id, label: d.label, group: d.group })),
    rules: [
      "Pick the single kind that fits the goal best; prefer built-in detectors over a custom regex.",
      "The action must be allowed at every chosen stage (stagesAndActions).",
      "Use redact to hide values, block to stop the run, warn to flag without stopping.",
      "Leave modelConfigId null for an AI judge: the user picks the judging model.",
    ],
  };
}

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "guardrail";
}

/** Turn the model's answer into the editor's input, checked like a save. */
export function finalizeGuardrailDraft(parsed: z.infer<typeof GuardrailDraftSchema>, existing: Iterable<GuardrailDef>): GuardrailDraft {
  const rows = [...existing];
  const taken = new Set(rows.map((g) => g.slug));
  let slug = slugFor(parsed.name);
  for (let n = 2; taken.has(slug); n++) slug = `${slugFor(parsed.name).slice(0, 56)}-${n}`;
  const input: GuardrailInput = {
    slug,
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    kind: parsed.kind,
    config: parsed.config,
    stages: [...new Set(parsed.stages)],
    action: parsed.action,
    mode: "shadow",
    scope: { agents: "all", features: "all", mcp: false },
    position: rows.reduce((max, g) => Math.max(max, g.position), 0) + 10,
    enabled: true,
  };
  return { input, rationale: parsed.rationale, problems: guardrailProblems(input) };
}
