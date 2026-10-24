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
  createSkillsMiddleware,
  type CompiledSubAgent,
  type DeepAgent,
  type FilesystemPermission,
  type SubAgent,
} from "deepagents";
import { randomUUID } from "crypto";
import { parseToolResult } from "../runtime/chatOutput";
import { tool } from "@langchain/core/tools";
import { humanInTheLoopMiddleware, todoListMiddleware, type AgentMiddleware } from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { AppError } from "../../../types";
import type { AgentTool } from "../langchainTools";
import type { AgentRunContext, RenderedPrompts } from "../types";
import { buildGrantedTools, catalogTool, type ToolRuntime } from "./catalog";
import { actionDefinition } from "../actions/definitions";
import { applyDescriptionOverrides, applyPromptSuffix, generalPurposeSubagent, harnessToolMiddleware } from "./harness";
import { RegistrySkillsBackend, skillFiles } from "./skillsBackend";
import { renderTemplate, TemplateError, type TemplateValue } from "./template";
import { observeQueries } from "../../queryObserver";
import { currentUsageRun, runInToolStep, type ModelRef, type ToolContext } from "../usage";
import type { AgentDef, HarnessDef, RegistrySnapshot, SkillDef } from "./types";
import { guardrailMiddleware } from "../guardrails/middleware";
import { runtimeMiddleware } from "../runtime/middleware";
import { skillIncludeTools } from "./skillTools";
import { logger } from "../../../utils/logger";
import type { GuardrailRunner } from "../guardrails/runner";
import { buildRememberTool, memoryPrompt, type RunMemory } from "../memory/runtime";
import { analysisPrompt, bridgedTool, buildAnalysisTool } from "../runtime/analysis";

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

/** A tool call starting or finishing, for live run steps (ADR 0024). */
export type ToolEvent =
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown>; agent?: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string | null };

/** A one-line summary of a tool result for the live step list; never the data itself. */
export function summarizeToolResult(result: unknown): string | null {
  // Tools return ToolMessages and JSON strings; summarize what is inside.
  const value = parseToolResult(result);
  if (typeof value === "string") return value.length > 0 ? `${value.length.toLocaleString("en-US")} characters` : null;
  if (Array.isArray(value)) return `${value.length.toLocaleString("en-US")} item${value.length === 1 ? "" : "s"}`;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string") return "Failed";
  if (record.repeated === true) return "Reused the previous result";
  if (typeof record.rowCount === "number") return `${record.rowCount.toLocaleString("en-US")} row${record.rowCount === 1 ? "" : "s"}`;
  if (Array.isArray(record.rows)) return `${record.rows.length.toLocaleString("en-US")} row${record.rows.length === 1 ? "" : "s"}`;
  for (const [key, entry] of Object.entries(record)) {
    if (Array.isArray(entry)) return `${entry.length.toLocaleString("en-US")} ${key}`;
  }
  return null;
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
 * model cannot loop on the same call. Inside a usage run (ADR 0020) each call
 * is also a tool step, and its ClickHouse queries and returned data are
 * attributed to it.
 */
export function guardDuplicateTools(
  tools: AgentTool[],
  calls: InvokedToolCall[],
  agentPath?: string,
  usage: ToolContext = { model: null, connectionId: null, defaultDatabase: null },
  onEvent?: (event: ToolEvent) => void,
): AgentTool[] {
  const seen = new Set<string>();
  return tools.map((original) => tool(
    // Preserve LangGraph's call context so tracing, cancellation, and
    // provider callbacks remain attached to the original tool invocation.
    async (input: unknown, config: unknown) => {
      const recorded: InvokedToolCall = { name: original.name, args: recordableInput(input), ...(agentPath ? { agent: agentPath } : {}) };
      calls.push(recorded);
      const eventId = randomUUID();
      onEvent?.({ type: "tool_start", id: eventId, name: original.name, args: recorded.args, ...(agentPath ? { agent: agentPath } : {}) });
      const step = currentUsageRun()?.beginTool(original.name, agentPath ?? null, usage);
      const signature = `${original.name}:${stableToolInput(input)}`;
      if (seen.has(signature)) {
        const duplicateResult = {
          repeated: true,
          message:
            "This exact action was already completed with the same inputs. Use the previous result, choose a different next action if needed, or provide the final answer now. Do not call this tool again unless the inputs change.",
        };
        recorded.result = duplicateResult;
        step?.end({ result: duplicateResult, duplicate: true });
        onEvent?.({ type: "tool_end", id: eventId, name: original.name, ok: true, summary: summarizeToolResult(duplicateResult) });
        return duplicateResult;
      }
      seen.add(signature);
      const invoke = (): Promise<unknown> => original.invoke(input as never, config as never);
      try {
        const result = step ? await runInToolStep(step, () => observeQueries(step.observer, invoke)) : await invoke();
        recorded.result = result;
        step?.end({ result });
        onEvent?.({ type: "tool_end", id: eventId, name: original.name, ok: true, summary: summarizeToolResult(result) });
        return result;
      } catch (error) {
        step?.end({ error });
        onEvent?.({ type: "tool_end", id: eventId, name: original.name, ok: false, summary: "Failed" });
        throw error;
      }
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
  /** Attribution and price for usage tracking; absent in tests that build trees by hand. */
  usage?: ModelRef;
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
  /** The run's guardrails (ADR 0022); null only where a tree is built without a run (tests). */
  guardrails: GuardrailRunner | null;
  /** Durable runs (ADR 0024): the root agent checkpoints through it so a run can pause and resume. */
  checkpointer?: BaseCheckpointSaver;
  /** Live run steps (ADR 0024): every tool call of the tree, as it starts and ends. */
  onToolEvent?: (event: ToolEvent) => void;
  /** Memory (ADR 0024 phase 3), loaded on first use by an agent with memory turned on. */
  memory?: () => Promise<RunMemory>;
  /** Receives cleanups (analysis sandboxes, ADR 0024 phase 5) the engine runs when the run ends. */
  onDispose?: (dispose: () => void) => void;
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

interface NodeParts {
  tools: AgentTool[];
  middleware: AgentMiddleware[];
  sources: string[];
  skills: SkillDef[];
  subagents: Array<SubAgent | CompiledSubAgent>;
  /** Sections appended to this node's system prompt (memory, analysis). */
  promptSections: string[];
}

/** Resolve the agent's fallback model; a fallback that no longer resolves is skipped, never fatal. */
async function fallbackModel(agent: AgentDef, build: BuildContext): Promise<BaseChatModel | null> {
  const id = agent.tuning.fallbackModelConfigId;
  if (!id) return null;
  try {
    return (await build.resolveModel(id)).model;
  } catch (error) {
    logger.warn({ module: "AI", agent: agent.slug, err: error instanceof Error ? error.message : String(error) }, "Fallback model unavailable; running without it");
    return null;
  }
}

/** Tools, middleware, skills and children of one tree node — shared by compiled and forked nodes. */
async function nodeParts(agent: AgentDef, build: BuildContext, node: NodeOptions): Promise<NodeParts> {
  const { snapshot } = build;
  const harness = harnessFor(agent, snapshot);
  // LLM calls only carry the agent's slug; the run maps it to its place in the tree.
  currentUsageRun()?.registerAgentPath(agent.slug, node.path);
  const usage: ToolContext = {
    model: node.model.usage ?? null,
    connectionId: build.runtime.ctx.connectionId ?? null,
    defaultDatabase: build.runtime.ctx.defaultDatabase ?? null,
  };
  const { sources, skills } = skillSources(agent, snapshot);
  // Tools a skill lists stay hidden until that skill is read (ADR 0024).
  const skillToolNames = new Set(skills.flatMap((skill) => skillIncludeTools(skill.skillMd)));
  const baseGrants = agent.tools.filter((name) => !skillToolNames.has(name));
  const tools = guardDuplicateTools(applyDescriptionOverrides(buildGrantedTools(baseGrants, build.runtime), harness), build.calls, node.path, usage, build.onToolEvent);
  const skillTools = guardDuplicateTools(applyDescriptionOverrides(buildGrantedTools([...skillToolNames], build.runtime), harness), build.calls, node.path, usage, build.onToolEvent);

  const subagents: Array<SubAgent | CompiledSubAgent> = [];
  const forked = new Set(agent.tuning.forkedSubagents ?? []);
  for (const childId of agent.subagents) {
    const child = snapshot.agents.get(childId);
    if (!child || !child.enabled) continue;
    if (build.includeChild && !build.includeChild(child)) continue;
    if (node.visiting.has(child.id)) throw AppError.badRequest(`Agent '${agent.name}' has a subagent cycle through '${child.name}'`);
    if (node.depth + 1 >= MAX_AGENT_DEPTH) throw AppError.badRequest(`Agent '${agent.name}' nests subagents deeper than ${MAX_AGENT_DEPTH} levels`);
    const childPrompts = renderAgentPrompts(child, build.variables, snapshot);
    const childModel = child.modelConfigId ? await build.resolveModel(child.modelConfigId) : node.model;
    const childHarness = harnessFor(child, snapshot);
    const childNode: NodeOptions = {
      systemPrompt: applyPromptSuffix(childPrompts.system, childHarness),
      model: childModel,
      path: `${node.path} › ${child.slug}`,
      depth: node.depth + 1,
      visiting: new Set([...node.visiting, child.id]),
    };
    if (forked.has(child.id) && child.subagents.length === 0) {
      // A forked child sees the parent's conversation. It is built from a spec, so its skills live on the parent's backend.
      const parts = await nodeParts(child, build, childNode);
      for (const skill of parts.skills) if (!skills.includes(skill)) skills.push(skill);
      subagents.push({
        name: child.slug,
        description: child.description,
        systemPrompt: withSections(childNode.systemPrompt, parts.promptSections),
        mode: "fork",
        model: childNode.model.model as never,
        tools: parts.tools,
        middleware: parts.middleware,
        ...(parts.sources.length > 0 ? { skills: parts.sources } : {}),
      } as SubAgent);
      continue;
    }
    const runnable = await buildNode(child, build, childNode);
    const limit = child.tuning.recursionLimit ?? recursionLimitFor(child.tuning.stepBudget);
    subagents.push({ name: child.slug, description: child.description, runnable: runnable.withConfig({ recursionLimit: limit }) } as CompiledSubAgent);
  }
  // Memory: notes in the prompt; `remember` only where a person sees what was kept (chat).
  let memorySection = "";
  if (agent.tuning.memory && build.memory) {
    const memory = await build.memory();
    const { ctx } = build.runtime;
    const canRemember = ctx.actionMode === "approve" && Boolean(ctx.userId);
    if (canRemember) tools.push(...guardDuplicateTools([buildRememberTool(ctx, agent.slug, memory)], build.calls, node.path, usage, build.onToolEvent));
    memorySection = memoryPrompt(memory, canRemember);
  }

  // Analysis sandbox: read-only tools are bridged into it, write tools never.
  let analysisSection = "";
  if (harness.analysis && build.onDispose) {
    const readTools = tools.filter((t) => catalogTool(t.name)?.access === "read");
    const guard = build.guardrails ? { runner: build.guardrails, agentId: agent.id, path: node.path } : null;
    tools.push(...guardDuplicateTools([buildAnalysisTool(readTools.map((t) => bridgedTool(t, guard)), build.onDispose)], build.calls, node.path, usage, build.onToolEvent));
    analysisSection = analysisPrompt(readTools.map((t) => t.name));
  }

  const generalPurpose = generalPurposeSubagent(harness, tools, sources);
  if (generalPurpose) subagents.push(generalPurpose);

  const middleware = [
    // First, so it wraps everything after it: an approved (or edited) call then passes the guardrails like any other.
    approvalMiddleware([...baseGrants, ...skillToolNames], build.runtime),
    // DeepAgents made the todo list opt-in (1.12); keep it for harnesses that expose write_todos.
    harness.excludedTools.includes("write_todos") ? null : todoListMiddleware(),
    harnessToolMiddleware(harness),
    build.guardrails ? guardrailMiddleware(build.guardrails, { agentId: agent.id, agentSlug: agent.slug, path: node.path, isRoot: node.depth === 0 }) : null,
    sources.length > 0 ? createSkillsMiddleware({ backend: () => skillsBackend(skills), sources, tools: skillTools }) : null,
    ...runtimeMiddleware({ tuning: agent.tuning, fallback: await fallbackModel(agent, build) }),
  ].filter((m): m is AgentMiddleware => m !== null);
  return { tools, middleware, sources, skills, subagents, promptSections: [memorySection, analysisSection].filter(Boolean) };
}

function withSections(systemPrompt: string, sections: readonly string[]): string {
  return [systemPrompt, ...sections].join("\n\n");
}

/**
 * Per-call approval for the low-risk write tools of a chat run (ADR 0024
 * §Phase 2). It is always added for them: no harness or setting can skip it.
 * Runs without a person in the loop never get it; their write tools only
 * record pending actions.
 */
function approvalMiddleware(toolNames: Iterable<string>, runtime: ToolRuntime): AgentMiddleware | null {
  if (runtime.ctx.actionMode !== "approve") return null;
  const interruptOn: Record<string, { allowedDecisions: Array<"approve" | "edit" | "reject">; description: (call: { args: Record<string, unknown> }) => string }> = {};
  for (const name of toolNames) {
    const entry = catalogTool(name);
    const definition = actionDefinition(name);
    if (entry?.access !== "write" || entry.risk !== "low" || !definition) continue;
    interruptOn[name] = { allowedDecisions: ["approve", "edit", "reject"], description: (call) => definition.describe(call.args ?? {}) };
  }
  if (Object.keys(interruptOn).length === 0) return null;
  return humanInTheLoopMiddleware({ interruptOn, interruptMode: "per_call" }) as AgentMiddleware;
}

function skillsBackend(skills: SkillDef[]): CompositeBackend {
  return new CompositeBackend(new StateBackend(), { [SKILLS_MOUNT]: new RegistrySkillsBackend(skillFiles(skills)) });
}

async function buildNode(agent: AgentDef, build: BuildContext, node: NodeOptions): Promise<DeepAgent> {
  const parts = await nodeParts(agent, build, node);
  return createDeepAgent({
    model: node.model.model as never,
    tools: parts.tools,
    systemPrompt: withSections(node.systemPrompt, parts.promptSections),
    backend: skillsBackend(parts.skills),
    permissions: FILESYSTEM_PERMISSIONS,
    subagents: parts.subagents,
    ...(parts.middleware.length > 0 ? { middleware: parts.middleware } : {}),
    // Only the root holds the checkpointer; subgraphs checkpoint through it.
    ...(node.depth === 0 && build.checkpointer ? { checkpointer: build.checkpointer } : {}),
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
