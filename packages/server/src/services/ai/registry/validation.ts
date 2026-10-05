/**
 * Registry validation (ADR 0019 §10).
 *
 * `validateGraph` checks a whole snapshot — every agent, harness, skill and
 * feature binding — and returns each problem tagged with the entity it is
 * about. A save is validated by applying it to a copy of the current snapshot
 * and rejecting the problems the change introduces, so one pre-existing issue
 * never blocks an unrelated edit.
 */

import { CAPABILITIES } from "../capabilities";
import type { AnyCapability } from "../types";
import { catalogTool } from "./catalog";
import { BUILTIN_TOOL_NAMES } from "./harness";
import { MAX_AGENT_DEPTH } from "./builder";
import { templateReferences, validateTemplate, type VariableSpec } from "./template";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef } from "./types";

export interface RegistryProblem {
  entity: "agent" | "harness" | "skill" | "binding";
  id: string;
  message: string;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_PATH_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const SKILL_FILE_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_PROMPT_CHARS = 100_000;
const RESERVED_SLUGS = new Set(["general-purpose"]);

export const TUNING_LIMITS = {
  stepBudget: { min: 1, max: 100 },
  recursionLimit: { min: 8, max: 1000 },
  timeoutMs: { min: 5_000, max: 30 * 60_000 },
  maxOutputTokens: { min: 256, max: 200_000 },
} as const;

const FEATURES = CAPABILITIES as Record<string, AnyCapability>;

function features(): AnyCapability[] {
  return Object.values(FEATURES);
}

function skillByName(snapshot: RegistrySnapshot, name: string): SkillDef | undefined {
  for (const skill of snapshot.skills.values()) if (skill.name === name) return skill;
  return undefined;
}

function skillFileExists(snapshot: RegistrySnapshot): (name: string, file: string | null) => boolean {
  return (name, file) => {
    const skill = skillByName(snapshot, name);
    if (!skill || !skill.enabled) return false;
    return file === null || file === "SKILL.md" || file in skill.files;
  };
}

/** Front-matter `name` / `description` of a SKILL.md. */
export function parseSkillFrontMatter(skillMd: string): { name: string; description: string } | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(skillMd);
  if (!match) return null;
  const field = (key: string): string => {
    const line = match[1].split("\n").find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  return { name: field("name"), description: field("description") };
}

// ============================================
// Per-entity checks
// ============================================

function harnessProblems(harness: HarnessDef, snapshot: RegistrySnapshot): string[] {
  const problems: string[] = [];
  if (!SLUG_RE.test(harness.slug)) problems.push("Slug must be 2–63 lowercase letters, digits or dashes");
  for (const other of snapshot.harnesses.values()) {
    if (other.id !== harness.id && other.slug === harness.slug) problems.push(`Slug '${harness.slug}' is already used by harness '${other.name}'`);
  }
  if (!harness.name.trim()) problems.push("Name is required");
  for (const tool of harness.excludedTools) {
    if (!BUILTIN_TOOL_NAMES.has(tool)) problems.push(`Excluded tool '${tool}' is not a built-in DeepAgents tool`);
  }
  for (const tool of Object.keys(harness.toolDescriptionOverrides)) {
    if (!BUILTIN_TOOL_NAMES.has(tool) && !catalogTool(tool)) problems.push(`Description override for unknown tool '${tool}'`);
  }
  if ((harness.promptSuffix ?? "").length > 4_000) problems.push("Prompt suffix is longer than 4000 characters");
  if ((harness.generalPurpose.systemPrompt ?? "").length > MAX_PROMPT_CHARS) problems.push("General-purpose prompt is too long");
  return problems;
}

function skillProblems(skill: SkillDef, snapshot: RegistrySnapshot): string[] {
  const problems: string[] = [];
  if (!SKILL_NAME_RE.test(skill.name) || skill.name.length > 64) problems.push("Name must be kebab-case, at most 64 characters");
  if (!SKILL_PATH_RE.test(skill.path)) problems.push("Path must be '<group>/<directory>' in lowercase kebab-case");
  for (const other of snapshot.skills.values()) {
    if (other.id === skill.id) continue;
    if (other.name === skill.name) problems.push(`Name '${skill.name}' is already used`);
    if (other.path === skill.path) problems.push(`Path '${skill.path}' is already used by skill '${other.name}'`);
  }
  const front = parseSkillFrontMatter(skill.skillMd);
  if (!front) problems.push("SKILL.md must start with YAML front matter (--- name / description ---)");
  else {
    if (front.name !== skill.name) problems.push(`SKILL.md front matter name '${front.name}' must equal the skill name '${skill.name}'`);
    if (!front.description) problems.push("SKILL.md front matter needs a description");
    if (front.description.length > 1024) problems.push("SKILL.md description is longer than 1024 characters");
  }
  if (skill.skillMd.length > MAX_SKILL_FILE_BYTES) problems.push("SKILL.md is larger than 1 MB");
  for (const [file, content] of Object.entries(skill.files)) {
    if (file === "SKILL.md" || !SKILL_FILE_RE.test(file) || file.includes("..")) problems.push(`Invalid file name '${file}'`);
    if (content.length > MAX_SKILL_FILE_BYTES) problems.push(`File '${file}' is larger than 1 MB`);
  }
  return problems;
}

function tuningProblems(agent: AgentDef): string[] {
  const problems: string[] = [];
  const check = (key: keyof typeof TUNING_LIMITS, value: number | null | undefined, optional: boolean): void => {
    if (value === null || value === undefined) {
      if (!optional) problems.push(`Tuning ${key} is required`);
      return;
    }
    const { min, max } = TUNING_LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) problems.push(`Tuning ${key} must be an integer between ${min} and ${max}`);
  };
  check("stepBudget", agent.tuning.stepBudget, false);
  check("recursionLimit", agent.tuning.recursionLimit, true);
  check("timeoutMs", agent.tuning.timeoutMs, true);
  check("maxOutputTokens", agent.tuning.maxOutputTokens, true);
  return problems;
}

function agentProblems(agent: AgentDef, snapshot: RegistrySnapshot): string[] {
  const problems: string[] = [];
  if (!SLUG_RE.test(agent.slug) || RESERVED_SLUGS.has(agent.slug) || BUILTIN_TOOL_NAMES.has(agent.slug)) {
    problems.push("Slug must be 2–63 lowercase letters, digits or dashes and not a reserved name");
  }
  for (const other of snapshot.agents.values()) {
    if (other.id !== agent.id && other.slug === agent.slug) problems.push(`Slug '${agent.slug}' is already used by agent '${other.name}'`);
  }
  if (!agent.name.trim()) problems.push("Name is required");
  if (!agent.description.trim()) problems.push("Description is required — parent agents route on it");
  if (agent.description.length > 1024) problems.push("Description is longer than 1024 characters");
  if (agent.systemPrompt.length > MAX_PROMPT_CHARS) problems.push("System prompt is too long");
  const harness = snapshot.harnesses.get(agent.harnessId);
  if (!harness) problems.push("Harness does not exist");

  const seenTools = new Set<string>();
  for (const name of agent.tools) {
    const entry = catalogTool(name);
    if (!entry) problems.push(`Tool '${name}' is not in the catalog`);
    else if (entry.access !== "read") problems.push(`Tool '${name}' is not read-only; only read tools can be granted`);
    if (seenTools.has(name)) problems.push(`Tool '${name}' is granted twice`);
    seenTools.add(name);
  }

  for (const link of agent.skills) {
    const skill = snapshot.skills.get(link.skillId);
    if (!skill) {
      problems.push("A linked skill no longer exists");
      continue;
    }
    if (link.mode === "pinned" && link.pinnedFile && link.pinnedFile !== "SKILL.md" && !(link.pinnedFile in skill.files)) {
      problems.push(`Pinned file '${link.pinnedFile}' does not exist in skill '${skill.name}'`);
    }
    if (link.mode === "pinned" && !skill.enabled) problems.push(`Pinned skill '${skill.name}' is disabled`);
  }

  for (const childId of agent.subagents) {
    if (childId === agent.id) problems.push("An agent cannot be its own subagent");
    else if (!snapshot.agents.has(childId)) problems.push("A subagent no longer exists");
  }
  if (new Set(agent.subagents).size !== agent.subagents.length) problems.push("A subagent is listed twice");
  if (agent.subagents.length > 0 && harness?.excludedTools.includes("task")) {
    problems.push(`Harness '${harness.name}' hides the task tool, so this agent cannot delegate to its subagents`);
  }
  if (agent.kind === "router" && agent.subagents.length === 0) problems.push("A router needs at least one subagent");
  problems.push(...tuningProblems(agent));

  // Skill tokens in both templates must resolve.
  const exists = skillFileExists(snapshot);
  for (const [label, template] of [["System prompt", agent.systemPrompt], ["Task template", agent.taskTemplate ?? ""]] as const) {
    let refs;
    try {
      refs = templateReferences(template);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const ref of refs.skills) {
      if (!exists(ref.name, ref.file)) problems.push(`${label}: unknown or disabled skill reference {{skill:${ref.name}${ref.file ? `/${ref.file}` : ""}}}`);
    }
    // Only feature agents (with a task template) receive feature variables;
    // chat agents and subagents render with none.
    if (agent.taskTemplate === null && refs.variables.size > 0) {
      problems.push(`${label}: only agents with a task template can use {{ctx.…}} variables`);
    }
  }
  return problems;
}

// ============================================
// Graph checks
// ============================================

/** Agents reachable from `rootId` (including it), or a cycle/depth problem. */
function walk(rootId: string, snapshot: RegistrySnapshot): { agents: AgentDef[]; problem: string | null } {
  const agents: AgentDef[] = [];
  let problem: string | null = null;
  const visit = (id: string, depth: number, path: string[]): void => {
    const agent = snapshot.agents.get(id);
    if (!agent || problem) return;
    if (path.includes(id)) {
      problem = `Subagent cycle: ${[...path, id].map((p) => snapshot.agents.get(p)?.slug ?? p).join(" → ")}`;
      return;
    }
    if (depth >= MAX_AGENT_DEPTH) {
      problem = `Subagents nest deeper than ${MAX_AGENT_DEPTH} levels under '${snapshot.agents.get(rootId)?.slug}'`;
      return;
    }
    if (!agents.includes(agent)) agents.push(agent);
    for (const child of agent.subagents) visit(child, depth + 1, [...path, id]);
  };
  visit(rootId, 0, []);
  return { agents, problem };
}

function bindingProblems(featureId: string, agentId: string, snapshot: RegistrySnapshot): string[] {
  const feature = FEATURES[featureId];
  if (!feature) return [`Unknown feature '${featureId}'`];
  const agent = snapshot.agents.get(agentId);
  if (!agent) return [`'${feature.title}' is bound to an agent that no longer exists`];
  const problems: string[] = [];
  if (!agent.enabled) problems.push(`'${feature.title}' is bound to the disabled agent '${agent.name}'`);
  if (feature.delivery === "structured" && agent.taskTemplate === null) {
    problems.push(`'${feature.title}' needs an agent with a task template; '${agent.name}' has none`);
  }
  if (feature.delivery === "invoke" && agent.taskTemplate !== null) {
    problems.push(`The chat needs a chat agent (no task template); '${agent.name}' is a feature agent`);
  }
  const declared: Record<string, VariableSpec> = { ...feature.variables };
  const exists = skillFileExists(snapshot);
  const tree = walk(agentId, snapshot);
  if (tree.problem) problems.push(tree.problem);
  for (const member of tree.agents) {
    for (const problem of validateTemplate(member.systemPrompt, declared, exists)) problems.push(`'${member.slug}' system prompt: ${problem}`);
    for (const name of member.tools) {
      const entry = catalogTool(name);
      if (entry?.requires && !feature.contexts.includes(entry.requires)) {
        problems.push(`'${member.slug}' uses '${name}', which needs the ${entry.requires} context that '${feature.title}' does not provide`);
      }
    }
  }
  if (agent.taskTemplate !== null) {
    for (const problem of validateTemplate(agent.taskTemplate, declared, exists)) problems.push(`'${agent.slug}' task template: ${problem}`);
  }
  return problems;
}

/** Every problem in a snapshot. */
export function validateGraph(snapshot: RegistrySnapshot): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  for (const harness of snapshot.harnesses.values()) {
    for (const message of harnessProblems(harness, snapshot)) problems.push({ entity: "harness", id: harness.id, message });
  }
  for (const skill of snapshot.skills.values()) {
    for (const message of skillProblems(skill, snapshot)) problems.push({ entity: "skill", id: skill.id, message });
  }
  for (const agent of snapshot.agents.values()) {
    for (const message of agentProblems(agent, snapshot)) problems.push({ entity: "agent", id: agent.id, message });
    const tree = walk(agent.id, snapshot);
    if (tree.problem) problems.push({ entity: "agent", id: agent.id, message: tree.problem });
  }
  for (const feature of features()) {
    const binding = snapshot.bindings.get(feature.id);
    if (!binding) {
      problems.push({ entity: "binding", id: feature.id, message: `'${feature.title}' has no agent` });
      continue;
    }
    for (const message of bindingProblems(feature.id, binding.agentId, snapshot)) problems.push({ entity: "binding", id: feature.id, message });
  }
  return problems;
}

/** Problems present in `after` but not in `before` — what a change would introduce. */
export function introducedProblems(before: RegistrySnapshot, after: RegistrySnapshot): RegistryProblem[] {
  const key = (p: RegistryProblem): string => `${p.entity}:${p.id}:${p.message}`;
  const existing = new Set(validateGraph(before).map(key));
  return validateGraph(after).filter((p) => !existing.has(key(p)));
}

/** A copy of the snapshot with entries replaced or removed. */
export function withChanges(
  snapshot: RegistrySnapshot,
  change: {
    agent?: AgentDef;
    harness?: HarnessDef;
    skill?: SkillDef;
    binding?: { featureId: string; agentId: string };
    removeAgent?: string;
    removeHarness?: string;
    removeSkill?: string;
  },
): RegistrySnapshot {
  const next: RegistrySnapshot = {
    version: snapshot.version,
    agents: new Map(snapshot.agents),
    harnesses: new Map(snapshot.harnesses),
    skills: new Map(snapshot.skills),
    bindings: new Map(snapshot.bindings),
  };
  if (change.agent) next.agents.set(change.agent.id, change.agent);
  if (change.harness) next.harnesses.set(change.harness.id, change.harness);
  if (change.skill) next.skills.set(change.skill.id, change.skill);
  if (change.binding) next.bindings.set(change.binding.featureId, { featureId: change.binding.featureId, agentId: change.binding.agentId, updatedBy: null, updatedAt: 0 });
  if (change.removeAgent) next.agents.delete(change.removeAgent);
  if (change.removeHarness) next.harnesses.delete(change.removeHarness);
  if (change.removeSkill) next.skills.delete(change.removeSkill);
  return next;
}

/** Who still uses an entity — blocks deletes. */
export function usagesOf(snapshot: RegistrySnapshot, entity: "agent" | "harness" | "skill", id: string): string[] {
  const uses: string[] = [];
  if (entity === "agent") {
    for (const binding of snapshot.bindings.values()) {
      if (binding.agentId === id) uses.push(`feature '${FEATURES[binding.featureId]?.title ?? binding.featureId}'`);
    }
    for (const agent of snapshot.agents.values()) if (agent.subagents.includes(id)) uses.push(`agent '${agent.name}' (subagent)`);
  }
  if (entity === "harness") {
    for (const agent of snapshot.agents.values()) if (agent.harnessId === id) uses.push(`agent '${agent.name}'`);
  }
  if (entity === "skill") {
    const skill = snapshot.skills.get(id);
    for (const agent of snapshot.agents.values()) {
      const linked = agent.skills.some((link) => link.skillId === id);
      let inlined = false;
      if (skill) {
        try {
          inlined = [agent.systemPrompt, agent.taskTemplate ?? ""].some((t) => templateReferences(t).skills.some((ref) => ref.name === skill.name));
        } catch {
          inlined = false;
        }
      }
      if (linked || inlined) uses.push(`agent '${agent.name}'`);
    }
  }
  return uses;
}
