/**
 * Explain this spike (ADR 0023 §9): the request and the shape the model fills.
 * Dependency-free on purpose (zod only): the capability list imports this at
 * load time.
 */

import { z } from "zod";

import { variableValuesSchema } from "./spec";

/** The longest range Explain looks at. */
export const MAX_EXPLAIN_RANGE_MS = 7 * 86_400_000;

export const explainRequestSchema = z.object({
  dashboardId: z.string().min(1),
  panelId: z.string().min(1),
  /** The selected range, UTC milliseconds. */
  fromMs: z.number().int().positive(),
  toMs: z.number().int().positive(),
  values: variableValuesSchema,
  connectionId: z.string().min(1),
}).strict().superRefine((r, ctx) => {
  if (r.toMs <= r.fromMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The range must end after it starts" });
  if (r.toMs - r.fromMs > MAX_EXPLAIN_RANGE_MS) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select at most 7 days to explain" });
});
export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const EVIDENCE_KINDS = ["panel", "change", "query", "mutation", "merge", "alert", "incident", "other"] as const;

export const SpikeExplanationSchema = z.object({
  summary: z.string().min(1).max(1_000),
  likelyCause: z.string().min(1).max(2_000),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: z.array(z.object({ kind: z.enum(EVIDENCE_KINDS), text: z.string().min(1).max(500) })).max(8),
  nextSteps: z.array(z.string().min(1).max(300)).max(5),
});
export type SpikeExplanationOutput = z.infer<typeof SpikeExplanationSchema>;

export interface SpikeExplanation extends SpikeExplanationOutput {
  /** Evidence that could not be gathered, and why: shown with the answer, never hidden. */
  unavailable: Array<{ part: string; reason: string }>;
}
