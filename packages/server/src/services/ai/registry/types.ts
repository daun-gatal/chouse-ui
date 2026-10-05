/**
 * AI agent registry types (ADR 0019).
 *
 * Every DeepAgents agent in CHouse is a registry row: its prompt, model, tools,
 * skills, subagents, harness and tuning. Features (the code contracts in
 * ../capabilities) bind to an agent; the engine never builds an agent from
 * anything but these rows.
 */

/** Run contexts a tool can require and a feature can provide. */
export type ToolContextKind = "session" | "fleet" | "userApi";

export const TOOL_CONTEXT_KINDS: readonly ToolContextKind[] = ["session", "fleet", "userApi"];

export type AgentKind = "router" | "agent";

export type SkillLinkMode = "progressive" | "pinned";

export interface GeneralPurposeConfig {
  enabled: boolean;
  description?: string | null;
  systemPrompt?: string | null;
}

export interface HarnessDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Built-in DeepAgents tools hidden from the model. */
  excludedTools: string[];
  generalPurpose: GeneralPurposeConfig;
  /** Appended to the agent's rendered system prompt (profile `systemPromptSuffix`). */
  promptSuffix: string | null;
  toolDescriptionOverrides: Record<string, string>;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTuning {
  /** Visible tool/subagent steps; the recursion limit defaults to max(24, steps × 4). */
  stepBudget: number;
  recursionLimit?: number | null;
  timeoutMs?: number | null;
  maxOutputTokens?: number | null;
}

export interface AgentSkillLink {
  skillId: string;
  mode: SkillLinkMode;
  /** For pinned links: which file of the skill is inlined (e.g. "reference.md"). */
  pinnedFile: string | null;
}

export interface AgentDef {
  id: string;
  slug: string;
  name: string;
  /** Routing hint a parent model reads when choosing a subagent. */
  description: string;
  kind: AgentKind;
  /** Template (see template.ts). */
  systemPrompt: string;
  /** First user message template for structured features; null for chat agents. */
  taskTemplate: string | null;
  modelConfigId: string | null;
  harnessId: string;
  tuning: AgentTuning;
  /** A chat user needs at least one of these to see/use the agent (empty: anyone with ai:chat). */
  requiredPermissions: string[];
  /** Catalog tool names granted to this agent. */
  tools: string[];
  skills: AgentSkillLink[];
  /** Ordered child agent ids. */
  subagents: string[];
  enabled: boolean;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillDef {
  id: string;
  /** Kebab-case skill name; matches the SKILL.md front-matter `name`. */
  name: string;
  /**
   * Directory under /skills/ as `<group>/<dir>` (e.g. "ai-chat/data-exploration").
   * The group is the skills source an agent lists; the directory need not equal
   * `name` (the built-in optimizer skills live in `ai-optimizer/optimizer`).
   */
  path: string;
  description: string;
  /** The full SKILL.md, front-matter included. */
  skillMd: string;
  /** Extra files next to SKILL.md, keyed by relative path (e.g. "reference.md"). */
  files: Record<string, string>;
  enabled: boolean;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeatureBinding {
  featureId: string;
  agentId: string;
  updatedBy: string | null;
  updatedAt: number;
}

export type RegistryEntity = "agent" | "harness" | "skill" | "binding";

export interface RegistryRevision {
  id: string;
  entity: RegistryEntity;
  entityId: string;
  version: number;
  action: string;
  snapshot: unknown;
  actor: string | null;
  createdAt: number;
}

/** One consistent read of the whole registry, keyed by id. */
export interface RegistrySnapshot {
  version: number;
  harnesses: Map<string, HarnessDef>;
  agents: Map<string, AgentDef>;
  skills: Map<string, SkillDef>;
  bindings: Map<string, FeatureBinding>;
}
