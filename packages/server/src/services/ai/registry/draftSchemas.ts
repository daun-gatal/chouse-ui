/**
 * Draft with AI (issue #381): the shapes shared by the drafting capabilities
 * and drafting.ts — section names, limits, the schema the model fills and the
 * request schema.
 *
 * Dependency-free on purpose: the capability list imports this at load time,
 * while drafting.ts reaches the capability list through registry validation.
 */

import { z } from "zod";

// ============================================
// Sections
// ============================================

export type DraftKind = "agent" | "harness" | "skill";

export const AGENT_SECTIONS = ["identity", "prompt", "tools", "skills", "subagents", "settings"] as const;
export const HARNESS_SECTIONS = ["identity", "builtinTools", "generalPurpose", "promptSuffix", "overrides"] as const;
export const SKILL_SECTIONS = ["path", "skillMd", "files", "enabled"] as const;

export type AgentSection = (typeof AGENT_SECTIONS)[number];
export type HarnessSection = (typeof HARNESS_SECTIONS)[number];
export type SkillSection = (typeof SKILL_SECTIONS)[number];

export const SECTIONS: Record<DraftKind, readonly string[]> = {
  agent: AGENT_SECTIONS,
  harness: HARNESS_SECTIONS,
  skill: SKILL_SECTIONS,
};

/** How many times the drafter is asked again for the sections that failed. */
export const MAX_REDRAFT_ROUNDS = 2;

export const LIMITS = {
  goal: 4_000,
  instruction: 2_000,
  reference: 60_000,
  rationale: 500,
} as const;

/** Pasted reference material longer than this belongs in reference files, not SKILL.md. */
export const LONG_REFERENCE_CHARS = 8_000;

export type SectionState = "drafted" | "empty" | "attention";

/** Why one item (a tool, a skill, a built-in tool decision…) was chosen. */
export interface RationaleItem {
  subject: string;
  why: string;
}

/** Per-section reasoning that travels with a draft, so a later redraft can keep it. */
export interface DraftMeta {
  /** Why a section is empty on purpose (null when it is filled). */
  reasons: Record<string, string | null>;
  rationale: Record<string, RationaleItem[]>;
}

export interface SectionStatus {
  state: SectionState;
  /** The stated reason when the section is empty on purpose. */
  reason: string | null;
  /** What still needs attention (empty unless state is "attention"). */
  problems: string[];
  rationale: RationaleItem[];
}

export interface DraftResult<T> {
  kind: DraftKind;
  mode: DraftMode;
  input: T;
  sections: Record<string, SectionStatus>;
  meta: DraftMeta;
  /** One or two sentences from the drafter about the draft as a whole. */
  summary: string;
  /** What the server changed so the draft fits the registry (unknown tools dropped, slug made unique…). */
  fixes: string[];
  /** Registry problems the draft would still introduce if saved as is. */
  problems: string[];
  /** New skills the agent drafter suggests drafting next (agents only). */
  suggestedSkills: string[];
  /** Model calls it took (the first draft plus targeted re-asks). */
  rounds: number;
}

export type DraftMode = "draft" | "refine" | "redraft";

// ============================================
// What the drafter must return
// ============================================

const why = z.string().max(LIMITS.rationale);

/** A list section: empty only with a stated reason (checked in assess, so one weak section never fails the whole draft). */
function listOf<T extends z.ZodTypeAny>(item: T): z.ZodObject<{ items: z.ZodArray<T>; emptyReason: z.ZodNullable<z.ZodString> }> {
  return z.object({ items: z.array(item), emptyReason: z.string().max(LIMITS.rationale).nullable() });
}

export const AgentDraftSchema = z.object({
  summary: z.string().max(1_000),
  name: z.string().max(100),
  slug: z.string().max(100),
  description: z.string().max(1_024),
  kind: z.enum(["agent", "router"]),
  systemPrompt: z.string().max(100_000),
  taskTemplate: z.string().max(100_000).nullable(),
  tools: listOf(z.object({ name: z.string(), why })),
  skills: listOf(z.object({ name: z.string(), mode: z.enum(["progressive", "pinned"]), pinnedFile: z.string().nullable(), why })),
  subagents: listOf(z.object({ slug: z.string(), why })),
  harness: z.object({ slug: z.string(), why }),
  model: z.object({ configId: z.string().nullable(), why }),
  tuning: z.object({
    stepBudget: z.number(),
    recursionLimit: z.number().nullable(),
    timeoutMs: z.number().nullable(),
    maxOutputTokens: z.number().nullable(),
    why,
  }),
  suggestedSkills: z.array(z.string().max(300)).max(5).default([]),
});

export const HarnessDraftSchema = z.object({
  summary: z.string().max(1_000),
  name: z.string().max(100),
  slug: z.string().max(100),
  description: z.string().max(1_024),
  builtinTools: z.array(z.object({ name: z.string(), enabled: z.boolean(), why })),
  generalPurpose: z.object({ enabled: z.boolean(), description: z.string().max(1_024).nullable(), systemPrompt: z.string().max(100_000).nullable(), why }),
  promptSuffix: z.object({ text: z.string().max(8_000).nullable(), emptyReason: z.string().max(LIMITS.rationale).nullable() }),
  toolDescriptionOverrides: listOf(z.object({ tool: z.string(), description: z.string().max(8_000), why })),
});

export const SkillDraftSchema = z.object({
  summary: z.string().max(1_000),
  dir: z.string().max(100),
  name: z.string().max(100),
  description: z.string().max(2_000),
  body: z.string().max(200_000),
  files: listOf(z.object({ name: z.string(), content: z.string().max(1024 * 1024), why })),
  enabled: z.boolean(),
  enabledWhy: why,
});

export type AgentDraft = z.infer<typeof AgentDraftSchema>;
export type HarnessDraft = z.infer<typeof HarnessDraftSchema>;
export type SkillDraft = z.infer<typeof SkillDraftSchema>;

// ============================================
// The request
// ============================================

export interface AgentHints {
  /** The structured feature the agent will serve; null for a chat agent or subagent. */
  featureId: string | null;
  /** Whether the agent should delegate to subagents. */
  delegate: "yes" | "no" | "auto";
}

export interface DraftRequest<T> {
  goal?: string;
  /** Skills only: pasted reference material (a runbook, a doc). */
  reference?: string;
  agentHints?: AgentHints;
  /** Refine: what to change about `current`. */
  instruction?: string;
  /** Refine and redraft: the draft (or stored custom entity) to work from. */
  current?: T;
  currentMeta?: DraftMeta;
  /** Refining a stored custom entity: its id. */
  entityId?: string | null;
  /** Redraft: only these sections. */
  sections?: string[];
  /** Redraft: why each section failed last time. */
  feedback?: Record<string, string[]>;
}

export function draftMode(request: DraftRequest<unknown>): DraftMode {
  if (request.sections && request.sections.length > 0) return "redraft";
  if (request.instruction) return "refine";
  return "draft";
}

/** Zod for a request, given the entity's input schema and its section names. */
export function draftRequestSchema<T extends z.ZodTypeAny>(current: T, sections: readonly string[]): z.ZodType<DraftRequest<z.infer<T>>, z.ZodTypeDef, unknown> {
  const sectionEnum = z.enum(sections as [string, ...string[]]);
  return z.object({
    goal: z.string().trim().max(LIMITS.goal).optional(),
    reference: z.string().max(LIMITS.reference).optional(),
    agentHints: z.object({
      featureId: z.string().min(1).nullable(),
      delegate: z.enum(["yes", "no", "auto"]),
    }).optional(),
    instruction: z.string().trim().min(3).max(LIMITS.instruction).optional(),
    current: current.optional(),
    currentMeta: z.object({
      reasons: z.record(z.string().max(LIMITS.rationale).nullable()),
      rationale: z.record(z.array(z.object({ subject: z.string().max(200), why: z.string().max(LIMITS.rationale) })).max(100)),
    }).optional(),
    entityId: z.string().min(1).nullable().optional(),
    sections: z.array(sectionEnum).min(1).max(sections.length).optional(),
    feedback: z.record(z.array(z.string().max(1_000)).max(20)).optional(),
  }).superRefine((value, ctx) => {
    const mode = draftMode(value);
    if (mode !== "draft" && !value.current) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["current"], message: "Refining or redrafting needs the current draft" });
    }
    if (mode === "draft" && (value.goal ?? "").length < 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["goal"], message: "Describe what you want in at least a few words" });
    }
  }) as unknown as z.ZodType<DraftRequest<z.infer<T>>, z.ZodTypeDef, unknown>;
}
