/**
 * A compact view of the AI agent registry (ADR 0019) for agents: what each
 * feature runs, and each agent's model, harness, tools, skills and subagents.
 *
 * `GET /api/ai-agents/registry` serves the editor, so it carries full prompt
 * templates, skill files and the tool catalog. MCP and the CHouse Admin agent
 * read it through this projection instead: prompts and skill bodies would
 * flood an agent's context and are edited in the UI anyway.
 */

import type { AgentDef, AgentKind, AgentTuning, HarnessDef, SkillDef } from "./types";

/** The parts of the registry route's payload the summary reads. */
export interface RegistryPayload {
  version: number;
  features: Array<{ id: string; title: string; surface: string; background: boolean; agentId: string | null }>;
  agents: Array<AgentDef & { updateAvailable: boolean; usedBy: string[] }>;
  harnesses: Array<HarnessDef & { updateAvailable: boolean; usedBy: string[] }>;
  skills: Array<SkillDef & { updateAvailable: boolean; usedBy: string[] }>;
  problems: unknown[];
}

export interface RegistrySummary {
  version: number;
  features: Array<{ id: string; title: string; surface: string; background: boolean; agentId: string | null }>;
  agents: Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    kind: AgentKind;
    enabled: boolean;
    builtIn: boolean;
    customized: boolean;
    updateAvailable: boolean;
    /** Null: the agent uses the default AI model. */
    modelConfigId: string | null;
    harnessId: string;
    tools: string[];
    skillIds: string[];
    subagentIds: string[];
    requiredPermissions: string[];
    tuning: AgentTuning;
    version: number;
    updatedAt: number;
    usedBy: string[];
  }>;
  harnesses: Array<{ id: string; slug: string; name: string; builtIn: boolean; customized: boolean; updateAvailable: boolean; excludedTools: string[]; usedBy: string[] }>;
  skills: Array<{ id: string; name: string; path: string; description: string; enabled: boolean; builtIn: boolean; customized: boolean; updateAvailable: boolean; usedBy: string[] }>;
  /** Validation problems of the stored graph (dangling references, cycles, …). */
  problems: unknown[];
}

export function summarizeRegistry(registry: RegistryPayload): RegistrySummary {
  return {
    version: registry.version,
    features: registry.features.map((f) => ({ id: f.id, title: f.title, surface: f.surface, background: f.background, agentId: f.agentId })),
    agents: registry.agents.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      kind: a.kind,
      enabled: a.enabled,
      builtIn: a.isSystem,
      customized: a.customized,
      updateAvailable: a.updateAvailable,
      modelConfigId: a.modelConfigId,
      harnessId: a.harnessId,
      tools: a.tools,
      skillIds: a.skills.map((link) => link.skillId),
      subagentIds: a.subagents,
      requiredPermissions: a.requiredPermissions,
      tuning: a.tuning,
      version: a.version,
      updatedAt: a.updatedAt,
      usedBy: a.usedBy,
    })),
    harnesses: registry.harnesses.map((h) => ({
      id: h.id,
      slug: h.slug,
      name: h.name,
      builtIn: h.isSystem,
      customized: h.customized,
      updateAvailable: h.updateAvailable,
      excludedTools: h.excludedTools,
      usedBy: h.usedBy,
    })),
    skills: registry.skills.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      description: s.description,
      enabled: s.enabled,
      builtIn: s.isSystem,
      customized: s.customized,
      updateAvailable: s.updateAvailable,
      usedBy: s.usedBy,
    })),
    problems: registry.problems,
  };
}
