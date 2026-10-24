/**
 * Request schemas for the editable part of each registry entity. The registry
 * routes validate saves with them, and the AI drafters validate the draft they
 * are asked to refine, so both accept exactly the same shape.
 */

import { z } from "zod";

import { normalizeTuning } from "./tuning";

import type { AgentInput, HarnessInput, SkillInput } from "./service";

export const tuningSchema = z.object({
  stepBudget: z.number().int(),
  recursionLimit: z.number().int().nullable().optional(),
  timeoutMs: z.number().int().nullable().optional(),
  maxOutputTokens: z.number().int().nullable().optional(),
  fallbackModelConfigId: z.string().min(1).nullable().optional(),
  modelRetries: z.number().int().nullable().optional(),
  toolRetries: z.number().int().nullable().optional(),
  maxModelCalls: z.number().int().nullable().optional(),
  maxToolCalls: z.number().int().nullable().optional(),
  promptCaching: z.boolean().optional(),
  clearOldToolResults: z.boolean().optional(),
  forkedSubagents: z.array(z.string().min(1)).max(20).optional(),
  memory: z.boolean().optional(),
  evalThreshold: z.number().gt(0).max(1).nullable().optional(),
});

export const agentSchema = z.object({
  slug: z.string().trim().min(1).max(63),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1024),
  kind: z.enum(["router", "agent"]),
  systemPrompt: z.string().max(100_000),
  taskTemplate: z.string().max(100_000).nullable(),
  modelConfigId: z.string().min(1).nullable(),
  harnessId: z.string().min(1),
  tuning: tuningSchema,
  requiredPermissions: z.array(z.string()).max(50),
  tools: z.array(z.string()).max(200),
  skills: z.array(z.object({
    skillId: z.string().min(1),
    mode: z.enum(["progressive", "pinned"]),
    pinnedFile: z.string().nullable(),
  })).max(100),
  subagents: z.array(z.string()).max(20),
  enabled: z.boolean(),
});

export const harnessSchema = z.object({
  slug: z.string().trim().min(1).max(63),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1024),
  excludedTools: z.array(z.string()).max(50),
  generalPurpose: z.object({
    enabled: z.boolean(),
    description: z.string().max(1024).nullable().optional(),
    systemPrompt: z.string().max(100_000).nullable().optional(),
  }),
  promptSuffix: z.string().max(4_000).nullable(),
  toolDescriptionOverrides: z.record(z.string(), z.string().max(4_000)),
  analysis: z.boolean().optional(),
});

export const skillSchema = z.object({
  path: z.string().trim().min(3).max(130),
  skillMd: z.string().min(1).max(1024 * 1024),
  files: z.record(z.string(), z.string().max(1024 * 1024)),
  enabled: z.boolean(),
});

export function normalizedAgent(body: z.infer<typeof agentSchema>): AgentInput {
  return {
    ...body,
    tuning: normalizeTuning(body.tuning),
  };
}

export function normalizedHarness(body: z.infer<typeof harnessSchema>): HarnessInput {
  return {
    ...body,
    generalPurpose: {
      enabled: body.generalPurpose.enabled,
      description: body.generalPurpose.description ?? null,
      systemPrompt: body.generalPurpose.systemPrompt ?? null,
    },
  };
}

export function normalizedSkill(body: z.infer<typeof skillSchema>): SkillInput {
  return { ...body };
}
