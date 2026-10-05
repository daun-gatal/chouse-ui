/**
 * Runtime assembly (ADR 0019 §7): turn registry rows into a DeepAgents agent
 * tree for one run.
 *
 * Every node gets its own backend (only its own skills), its own harness
 * middleware, its granted catalog tools (wrapped by the duplicate-call
 * recorder with the node's agent path), and its children as compiled
 * subagents. Nothing here reads prompts, tools or skills from code.
 */

import {
  CompositeBackend,
  StateBackend,
  createDeepAgent,
  type CompiledSubAgent,
  type DeepAgent,
  type FilesystemPermission,
  type SubAgent,
} from "deepagents";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { AppError } from "../../../types";
import type { AgentTool } from "../langchainTools";
import type { AgentRunContext, RenderedPrompts } from "../types";
import { buildGrantedTools, type ToolRuntime } from "./catalog";
import { applyDescriptionOverrides, applyPromptSuffix, generalPurposeSubagent, harnessToolMiddleware } from "./harness";
import { RegistrySkillsBackend, skillFiles } from "./skillsBackend";
import { renderTemplate, TemplateError, type TemplateValue } from "./template";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef } from "./types";

/** Maximum agent-tree depth: root → agent → subagent. */
export const MAX_AGENT_DEPTH = 3;

const SKILLS_MOUNT = "/skills/";

const FILESYSTEM_PERMISSIONS: FilesystemPermission[] = [
  { operations: ["read"], paths: ["/skills/**"], mode: "allow" },
  { operations: ["write"], paths: ["/skills/**"], mode: "deny" },
];

// ============================================
// Prompt rendering
// ============================================

function skillByName(snapshot: RegistrySnapshot, name: string): SkillDef | undefined {
  for (const skill of snapshot.skills.values()) if (skill.name === name) return skill;
  return undefined;
}

/** Inline a skill (or one of its files) into a prompt; trimmed, like the pre-registry reference files. */
export function resolveSkillText(snapshot: RegistrySnapshot, name: string, file: string | null): string {
  const skill = skillByName(snapshot, name);
  if (!skill) throw new TemplateError(`Unknown skill ${name}`);
  if (!skill.enabled) throw new TemplateError(`Skill ${name} is disabled`);
  const text = file === null || file === "SKILL.md" ? skill.skillMd : skill.files[file];
  if (text === undefined) throw new TemplateError(`Skill ${name} has no file ${file}`);
  return text.trim();
}

/** The agent's system prompt: its template, then each pinned skill. */
export function renderAgentPrompts(agent: AgentDef, variables: Record<string, TemplateValue>, snapshot: RegistrySnapshot): RenderedPrompts {
  const resolve = (name: string, file: string | null): string => resolveSkillText(snapshot, name, file);
  const core = renderTemplate(agent.systemPrompt, variables, resolve);
  let system = core;
  for (const link of agent.skills) {
    if (link.mode !== "pinned") continue;
    const skill = snapshot.skills.get(link.skillId);
    if (!skill) throw new TemplateError(`Agent ${agent.slug} pins a skill that no longer exists`);
    system += `\n\n${resolve(skill.name, link.pinnedFile)}`;
  }
  return { core, system };
}

/** The first user message of a structured feature run. */
export function renderTaskMessage(agent: AgentDef, variables: Record<string, TemplateValue>, snapshot: RegistrySnapshot): string {
  if (agent.taskTemplate === null) throw AppError.badRequest(`Agent '${agent.name}' has no task template, so it cannot run an AI feature`);
  return renderTemplate(agent.taskTemplate, variables, (name, file) => resolveSkillText(snapshot, name, file));
}

// ============================================
// Tool recording
// ============================================

export interface InvokedToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  /** Agent path that made the call, e.g. "chouse-assistant › chouse-admin › access-auditor". */
  agent?: string;
}

function stableToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return JSON.stringify(input);
  const sorted = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

function recordableInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input));
}

/**
 * Record every call (with the agent path) and short-circuit exact repeats so a
 * model cannot loop on the same call.
 */
export function guardDuplicateTools(tools: AgentTool[], calls: InvokedToolCall[], agentPath?: string): AgentTool[] {
  const seen = new Set<string>();
  return tools.map((original) => tool(
    // Preserve LangGraph's call context so tracing, cancellation, and
    // provider callbacks remain attached to the original tool invocation.
    async (input: unknown, config: unknown) => {
      const recorded: InvokedToolCall = { name: original.name, args: recordableInput(input), ...(agentPath ? { agent: agentPath } : {}) };
      calls.push(recorded);
      const signature = `${original.name}:${stableToolInput(input)}`;
      if (seen.has(signature)) {
        const duplicateResult = {
          repeated: true,
          message:
            "This exact action was already completed with the same inputs. Use the previous result, choose a different next action if needed, or provide the final answer now. Do not call this tool again unless the inputs change.",
        };
        recorded.result = duplicateResult;
        return duplicateResult;
      }
      seen.add(signature);
      const result = await original.invoke(input as never, config as never);
      recorded.result = result;
      return result;
    },
    {
      name: original.name,
      description: `${original.description}\n\nDo not call this tool with the same arguments more than once in a row. Reuse the previous result instead.`,
      schema: original.schema,
    },
  ) as AgentTool);
}

// ============================================
// Tree building
// ============================================

export function recursionLimitFor(stepBudget: number): number {
  // DeepAgents/LangGraph executes several internal graph nodes for one visible
  // tool/subagent action. Keep the public "step" tuning readable while giving
  // the graph enough room to finish normal skill-heavy workflows.
  return Math.max(24, stepBudget * 4);
}

/** Skill sources for an agent: one per group of its progressive skills, in first-use order. */
export function skillSources(agent: AgentDef, snapshot: RegistrySnapshot): { sources: string[]; skills: SkillDef[] } {
  const skills: SkillDef[] = [];
  const sources: string[] = [];
  for (const link of agent.skills) {
    if (link.mode !== "progressive") continue;
    const skill = snapshot.skills.get(link.skillId);
    if (!skill || !skill.enabled || skills.includes(skill)) continue;
    skills.push(skill);
    const source = `/skills/${skill.path.split("/")[0]}`;
    if (!sources.includes(source)) sources.push(source);
  }
  return { sources, skills };
}

export interface ResolvedModelRef {
  model: BaseChatModel;
  label: string;
}

export interface BuildContext {
  snapshot: RegistrySnapshot;
  runtime: ToolRuntime;
  variables: Record<string, TemplateValue>;
  calls: InvokedToolCall[];
  /** The run's model; subagents without their own model use it. */
  rootModel: ResolvedModelRef;
  /** Resolve a subagent's own model config. */
  resolveModel: (modelConfigId: string) => Promise<ResolvedModelRef>;
  /** Whether a child may join the tree (chat prunes by the user's permissions). */
  includeChild?: (child: AgentDef) => boolean;
}

function harnessFor(agent: AgentDef, snapshot: RegistrySnapshot): HarnessDef {
  const harness = snapshot.harnesses.get(agent.harnessId);
  if (!harness) throw AppError.badRequest(`Agent '${agent.name}' uses a harness that no longer exists`);
  return harness;
}

interface NodeOptions {
  /** Final system prompt for this node (root: already carries the output contract). */
  systemPrompt: string;
  model: ResolvedModelRef;
  path: string;
  depth: number;
  visiting: Set<string>;
}

async function buildNode(agent: AgentDef, build: BuildContext, node: NodeOptions): Promise<DeepAgent> {
  const { snapshot } = build;
  const harness = harnessFor(agent, snapshot);
  const tools = guardDuplicateTools(applyDescriptionOverrides(buildGrantedTools(agent.tools, build.runtime), harness), build.calls, node.path);
  const { sources, skills } = skillSources(agent, snapshot);

  const subagents: Array<SubAgent | CompiledSubAgent> = [];
  for (const childId of agent.subagents) {
    const child = snapshot.agents.get(childId);
    if (!child || !child.enabled) continue;
    if (build.includeChild && !build.includeChild(child)) continue;
    if (node.visiting.has(child.id)) throw AppError.badRequest(`Agent '${agent.name}' has a subagent cycle through '${child.name}'`);
    if (node.depth + 1 >= MAX_AGENT_DEPTH) throw AppError.badRequest(`Agent '${agent.name}' nests subagents deeper than ${MAX_AGENT_DEPTH} levels`);
    const childPrompts = renderAgentPrompts(child, build.variables, snapshot);
    const childModel = child.modelConfigId ? await build.resolveModel(child.modelConfigId) : node.model;
    const childHarness = harnessFor(child, snapshot);
    const runnable = await buildNode(child, build, {
      systemPrompt: applyPromptSuffix(childPrompts.system, childHarness),
      model: childModel,
      path: `${node.path} › ${child.slug}`,
      depth: node.depth + 1,
      visiting: new Set([...node.visiting, child.id]),
    });
    const limit = child.tuning.recursionLimit ?? recursionLimitFor(child.tuning.stepBudget);
    subagents.push({ name: child.slug, description: child.description, runnable: runnable.withConfig({ recursionLimit: limit }) } as CompiledSubAgent);
  }
  const generalPurpose = generalPurposeSubagent(harness, tools, sources);
  if (generalPurpose) subagents.push(generalPurpose);

  const middleware = harnessToolMiddleware(harness);
  return createDeepAgent({
    model: node.model.model as never,
    tools,
    systemPrompt: node.systemPrompt,
    backend: new CompositeBackend(new StateBackend(), { [SKILLS_MOUNT]: new RegistrySkillsBackend(skillFiles(skills)) }),
    permissions: FILESYSTEM_PERMISSIONS,
    ...(sources.length > 0 ? { skills: sources } : {}),
    subagents,
    ...(middleware ? { middleware: [middleware] } : {}),
    name: agent.slug,
  }) as DeepAgent;
}

/** Build the agent tree rooted at `root` with the given final system prompt (before the harness suffix). */
export async function buildAgentTree(root: AgentDef, rootSystemPrompt: string, build: BuildContext): Promise<DeepAgent> {
  const harness = harnessFor(root, build.snapshot);
  return buildNode(root, build, {
    systemPrompt: applyPromptSuffix(rootSystemPrompt, harness),
    model: build.rootModel,
    path: root.slug,
    depth: 0,
    visiting: new Set([root.id]),
  });
}

/** Strip contexts a feature does not provide from the tool runtime. */
export function featureRuntime(ctx: AgentRunContext, contexts: readonly string[], fleetNodes?: ToolRuntime["fleetNodes"]): ToolRuntime {
  return {
    ctx: {
      ...ctx,
      clickhouseService: contexts.includes("session") ? ctx.clickhouseService : undefined,
      bearerToken: contexts.includes("userApi") ? ctx.bearerToken : undefined,
    },
    fleetNodes: contexts.includes("fleet") ? fleetNodes : undefined,
  };
}
