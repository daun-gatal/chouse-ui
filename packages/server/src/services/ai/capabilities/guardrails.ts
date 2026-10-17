/**
 * AI Governance › Guardrails › Draft with AI (ADR 0022 §7): drafts a guardrail
 * from a plain-language goal for review. It never saves: the user edits the
 * draft and saves it through /api/ai-guardrails, which checks it again.
 */

import type { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { AppError } from "../../../types";
import type { StructuredCapability } from "../types";
import { getRegistrySnapshot } from "../registry/cache";
import {
  finalizeGuardrailDraft,
  guardrailDraftEvidence,
  GuardrailDraftSchema,
  guardrailDraftRequestSchema,
  type GuardrailDraft,
  type GuardrailDraftRequest,
} from "../guardrails/draft";

export const draftGuardrailCapability: StructuredCapability<GuardrailDraftRequest, GuardrailDraftRequest, z.infer<typeof GuardrailDraftSchema>, GuardrailDraft> = {
  id: "draft-guardrail",
  title: "Draft a guardrail",
  description: "AI Governance › Guardrails › Draft with AI: turns a goal into a guardrail draft (kind, settings, stages, action) for review.",
  surface: "governance",
  contexts: [],
  variables: { evidence: { type: "json", description: "The goal, the guardrail kinds with their settings, and the drafting rules (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: guardrailDraftRequestSchema,
  outputSchema: GuardrailDraftSchema,
  prepare(input, ctx) {
    if (!ctx.isAdmin && !ctx.permissions?.includes(PERMISSIONS.AI_GUARDRAILS_MANAGE)) {
      throw AppError.forbidden("Drafting guardrails needs ai_guardrails:manage");
    }
    return input;
  },
  templateVariables: (prepared) => ({ evidence: JSON.stringify(guardrailDraftEvidence(prepared)) }),
  finalize: async (parsed) => finalizeGuardrailDraft(parsed, (await getRegistrySnapshot()).guardrails.values()),
};
