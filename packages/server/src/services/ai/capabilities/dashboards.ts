/**
 * Dashboards › Ask AI (ADR 0021 §10): drafts a dashboard — or panels to add
 * to one — from a goal, for review. It never saves anything: the user accepts
 * the reviewed draft through the normal dashboards routes, which check it
 * again and check access to the dashboard it goes into.
 */

import type { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { AppError } from "../../../types";
import type { StructuredCapability } from "../types";
import { draftEvidence } from "../../dashboards/draftEvidence";
import { DashboardDraftSchema, draftRequestSchema, revisionProblem, type DashboardDraft, type DraftRequest } from "../../dashboards/draftSchemas";
import { explainRequestSchema, SpikeExplanationSchema, type ExplainRequest, type SpikeExplanation } from "../../dashboards/explainSchemas";

function requirePermission(ctx: { isAdmin?: boolean; permissions?: string[] }, permission: string): void {
  if (!ctx.isAdmin && !ctx.permissions?.includes(permission)) throw AppError.forbidden(`Permission '${permission}' required for this action`);
}

export const draftDashboardCapability: StructuredCapability<DraftRequest, DraftRequest, z.infer<typeof DashboardDraftSchema>, DashboardDraft> = {
  id: "draft-dashboard",
  title: "Draft a dashboard",
  description: "Dashboards › Ask AI: drafts a dashboard, or panels to add to one, from a goal; every panel is checked and dry-run before review.",
  surface: "dashboards",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The goal, the dashboard being added to, and the panel rules (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftRequestSchema,
  outputSchema: DashboardDraftSchema,
  prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.DASHBOARDS_EDIT);
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Draft on the connection you are on: this request names another one");
    const problem = input.revision ? revisionProblem(input.revision) : null;
    if (problem) throw AppError.badRequest(problem);
    return input;
  },
  templateVariables: (prepared) => ({ evidence: JSON.stringify(draftEvidence(prepared)) }),
  finalize: async (parsed, prepared, ctx) => {
    // Imported lazily: the review reaches the runner and ClickHouse clients, which the capability list must not load eagerly.
    const { finalizeDraft } = await import("../../dashboards/draft");
    return finalizeDraft(parsed, prepared, ctx);
  },
};

interface ExplainPrepared {
  request: ExplainRequest;
  /** JSON of the evidence (explain.ts ExplainEvidence). */
  evidence: string;
  unavailable: Array<{ part: string; reason: string }>;
}

/**
 * Dashboards › Explain this spike (ADR 0023 §9): reads a panel's selected
 * range with what changed around it, the slowest queries, mutations and
 * merges — all gathered as the viewer — and says what most likely caused it.
 * Read-only: it never proposes or applies anything itself.
 */
export const explainSpikeCapability: StructuredCapability<ExplainRequest, ExplainPrepared, z.infer<typeof SpikeExplanationSchema>, SpikeExplanation> = {
  id: "explain-spike",
  title: "Explain this spike",
  description: "Dashboards › Explain this spike: reads a panel's selected range, the changes around it, slow queries, mutations and merges, and explains the likely cause.",
  surface: "dashboards",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The panel, the selected range and the evidence gathered around it (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: explainRequestSchema,
  outputSchema: SpikeExplanationSchema,
  async prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.DASHBOARDS_VIEW);
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Explain on the connection you are on: this request names another one");
    // Imported lazily for the same reason as the draft review.
    const { gatherEvidence } = await import("../../dashboards/explain");
    const evidence = await gatherEvidence(input, ctx.userId);
    return { request: input, evidence: JSON.stringify(evidence), unavailable: evidence.unavailable };
  },
  templateVariables: (prepared) => ({ evidence: prepared.evidence }),
  finalize: (parsed, prepared) => ({ ...parsed, unavailable: prepared.unavailable }),
};
