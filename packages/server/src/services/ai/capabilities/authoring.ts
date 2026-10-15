/**
 * Draft with AI for the agent registry (issue #381): AI Governance ›
 * Assistant can draft, redraft and refine custom agents, harnesses and skills.
 *
 * Each capability returns a reviewed draft of the input the editor already
 * takes; it never writes to the registry. The route that runs them
 * (POST /api/ai-agents/draft/:kind) re-asks for failing sections.
 */

import type { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { AppError } from "../../../types";
import { logger } from "../../../utils/logger";
import type { AgentRunContext, StructuredCapability } from "../types";
import { getRegistrySnapshot } from "../registry/cache";
import {
  AGENT_SECTIONS,
  AgentDraftSchema,
  draftRequestSchema,
  HARNESS_SECTIONS,
  HarnessDraftSchema,
  SKILL_SECTIONS,
  SkillDraftSchema,
  type DraftKind,
  type DraftRequest,
  type DraftResult,
} from "../registry/draftSchemas";
import type { DraftContext, ModelOption } from "../registry/drafting";
import { agentSchema, harnessSchema, normalizedAgent, normalizedHarness, normalizedSkill, skillSchema } from "../registry/schemas";
import type { AgentInput, HarnessInput, SkillInput } from "../registry/service";
import type { RegistrySnapshot } from "../registry/types";

function can(ctx: AgentRunContext, permission: string): boolean {
  return Boolean(ctx.isAdmin) || (ctx.permissions ?? []).includes(permission);
}

interface Prepared<T> {
  request: DraftRequest<T>;
  context: DraftContext;
  evidence: Record<string, unknown>;
}

async function configuredModels(): Promise<ModelOption[]> {
  try {
    const { listAiConfigs } = await import("../../../rbac/services/aiModels");
    const { configs } = await listAiConfigs({ activeOnly: true });
    return configs.map((config) => ({ id: config.id, label: config.name }));
  } catch (error) {
    // Without the list the drafter just leaves the model to inherit the default.
    logger.warn({ module: "AiDraft", err: error instanceof Error ? error.message : String(error) }, "Could not list AI models");
    return [];
  }
}

function storedRow(kind: DraftKind, snapshot: RegistrySnapshot, id: string): { isSystem: boolean } | undefined {
  if (kind === "agent") return snapshot.agents.get(id);
  if (kind === "harness") return snapshot.harnesses.get(id);
  return snapshot.skills.get(id);
}

/** Shared access checks and context for the three drafters. */
export async function draftContext<T>(kind: DraftKind, request: DraftRequest<T>, ctx: AgentRunContext): Promise<DraftContext> {
  if (!can(ctx, PERMISSIONS.AI_AGENTS_MANAGE)) throw AppError.forbidden("Drafting agents, harnesses and skills needs ai_agents:manage");
  const snapshot = await getRegistrySnapshot();
  const entityId = request.entityId ?? null;
  if (entityId) {
    const row = storedRow(kind, snapshot, entityId);
    if (!row) throw AppError.notFound(`That ${kind} no longer exists`);
    if (row.isSystem) throw AppError.badRequest(`Built-in ${kind}s cannot be refined with AI — duplicate it and refine the copy`);
  }
  let feature: DraftContext["feature"] = null;
  if (kind === "agent") {
    const featureId = request.agentHints?.featureId ?? null;
    if (featureId) {
      // Imported lazily: the capability list includes this module.
      const { getCapability } = await import("./index");
      const found = getCapability(featureId);
      if (!found || found.delivery !== "structured") throw AppError.badRequest(`'${featureId}' is not an AI feature an agent can serve`);
      feature = found;
    }
  }
  return {
    snapshot,
    entityId,
    feature,
    models: kind === "agent" ? await configuredModels() : [],
    referenceLength: request.reference?.length ?? 0,
  };
}

/**
 * drafting.ts reaches the capability list back through registry validation,
 * so it is loaded when a draft runs, never while this module loads.
 */
function drafting(): Promise<typeof import("../registry/drafting")> {
  return import("../registry/drafting");
}

function evidenceVariables(value: unknown): Record<string, string> {
  return { evidence: JSON.stringify(value) };
}

export const draftAiSkillCapability: StructuredCapability<DraftRequest<SkillInput>, Prepared<SkillInput>, z.infer<typeof SkillDraftSchema>, DraftResult<SkillInput>> = {
  id: "draft-ai-skill",
  title: "Draft a skill",
  description: "AI Governance › Assistant › Skills › Draft with AI: drafts or refines a custom skill (SKILL.md and reference files) for review.",
  surface: "governance",
  contexts: [],
  variables: { evidence: { type: "json", description: "The request and the live registry facts the draft may use (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftRequestSchema(skillSchema.transform(normalizedSkill), SKILL_SECTIONS),
  outputSchema: SkillDraftSchema,
  async prepare(request, ctx) {
    const context = await draftContext("skill", request, ctx);
    return { request, context, evidence: (await drafting()).skillEvidenceFor(request, context) };
  },
  templateVariables: (prepared) => evidenceVariables(prepared.evidence),
  finalize: async (parsed, prepared) => (await drafting()).finalizeDraft("skill", parsed, prepared.request, prepared.context),
};

export const draftAiAgentCapability: StructuredCapability<DraftRequest<AgentInput>, Prepared<AgentInput>, z.infer<typeof AgentDraftSchema>, DraftResult<AgentInput>> = {
  id: "draft-ai-agent",
  title: "Draft an agent",
  description: "AI Governance › Assistant › Agents › Draft with AI: drafts or refines a custom agent — prompt, tools, skills, subagents and settings — for review.",
  surface: "governance",
  contexts: [],
  variables: { evidence: { type: "json", description: "The request and the live registry facts the draft may use (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftRequestSchema(agentSchema.transform(normalizedAgent), AGENT_SECTIONS),
  outputSchema: AgentDraftSchema,
  async prepare(request, ctx) {
    const context = await draftContext("agent", request, ctx);
    return { request, context, evidence: (await drafting()).agentEvidence(request, context) };
  },
  templateVariables: (prepared) => evidenceVariables(prepared.evidence),
  finalize: async (parsed, prepared) => (await drafting()).finalizeDraft("agent", parsed, prepared.request, prepared.context),
};

export const draftAiHarnessCapability: StructuredCapability<DraftRequest<HarnessInput>, Prepared<HarnessInput>, z.infer<typeof HarnessDraftSchema>, DraftResult<HarnessInput>> = {
  id: "draft-ai-harness",
  title: "Draft a harness",
  description: "AI Governance › Assistant › Harnesses › Draft with AI: drafts or refines a custom harness — a decision for every built-in tool — for review.",
  surface: "governance",
  contexts: [],
  variables: { evidence: { type: "json", description: "The request and the live registry facts the draft may use (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftRequestSchema(harnessSchema.transform(normalizedHarness), HARNESS_SECTIONS),
  outputSchema: HarnessDraftSchema,
  async prepare(request, ctx) {
    const context = await draftContext("harness", request, ctx);
    return { request, context, evidence: (await drafting()).harnessEvidenceFor(request, context) };
  },
  templateVariables: (prepared) => evidenceVariables(prepared.evidence),
  finalize: async (parsed, prepared) => (await drafting()).finalizeDraft("harness", parsed, prepared.request, prepared.context),
};
