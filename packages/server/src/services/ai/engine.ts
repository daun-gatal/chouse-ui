/**
 * AI Engine — the single DeepAgents runtime for every CHouse AI feature
 * (ADR 0019).
 *
 * A run always resolves `feature → bound agent → agent tree` from the registry.
 * There is no code-defined fallback: a feature without a valid agent fails
 * closed with an actionable error (or soft-fails, for check-optimize).
 */

import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { ZodType, ZodTypeDef } from "zod";
import { isStructuredOutputPolicy } from "../../rbac/constants/aiModelParams";
import { AppError } from "../../types";
import { resolveDeepAgentModel, type ResolvedModel } from "./model";
import { structuredOutput } from "./structuredOutput";
import { handleAiError } from "./errors";
import { checkBudgets } from "./budgets";
import { logger } from "../../utils/logger";
import { getCapability } from "./capabilities";
import { getRegistrySnapshot } from "./registry/cache";
import {
  buildAgentTree,
  featureRuntime,
  recursionLimitFor,
  renderAgentPrompts,
  renderTaskMessage,
  type BuildContext,
  type InvokedToolCall,
  type ToolEvent,
} from "./registry/builder";
import { checkpointSaver } from "./runtime/checkpointer";
import { Command } from "@langchain/langgraph";
import { registerHarnessBaseline } from "./registry/harness";
import { runnerForRun } from "./guardrails/runtime";
import { guardrailErrorIn, type GuardrailRunner } from "./guardrails/runner";
import { currentCaller, persistUsageRun, withUsageRun, type UsageRun, type UsageRunMeta } from "./usage";
import { userMayUseAgent, chatAgentCandidates } from "./registry/chatAgents";
import type { AgentDef, RegistrySnapshot } from "./registry/types";
import type { TemplateValue } from "./registry/template";
import type {
  AgentMessage,
  AgentRunContext,
  AnyStructuredCapability,
  StructuredCapability,
} from "./types";
import type { AiConfigWithKey } from "../../rbac/services/aiModels";
import type { DeepAgent } from "deepagents";
import { lazyRunMemory } from "./memory/runtime";

export type { InvokedToolCall } from "./registry/builder";

interface RuntimeOverrides {
  recursionLimit?: number;
  runTimeoutMs?: number;
}

// Admin-set per-model runtime params (rbac_ai_models.params) win over the
// agent's tuning and the built-in run timeouts.
function runtimeOverrides(config: AiConfigWithKey): RuntimeOverrides {
  const params = config.model.params ?? {};
  return { recursionLimit: params.recursionLimit, runTimeoutMs: params.runTimeoutMs };
}

// Neither the model provider call nor a tool (e.g. a slow ClickHouse query) has
// a client-side timeout of its own, so a stalled network call would otherwise
// hang the run — and the UI — forever. These bound every run to a hard wall
// clock so a stall surfaces as a retryable error instead of an infinite spinner.
const STRUCTURED_RUN_TIMEOUT_MS = 4 * 60_000;
const CHAT_RUN_TIMEOUT_MS = 2 * 60_000;
const INITIAL_SCHEMA_PROMPT_MAX_CHARS = 2_000;
const INITIAL_SCHEMA_PROMPT_MAX_KEYS = 20;

function runSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

/**
 * Attachments become LangChain data content blocks (`source_type: "base64"`),
 * the shape every provider adapter converts (OpenAI image_url/file, Anthropic
 * image/document, Gemini inline data).
 */
export function providerContent(content: AgentMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return part;
    if (part.type === "image") return { type: "image", source_type: "base64", mime_type: part.mimeType, data: part.data };
    return { type: "file", source_type: "base64", mime_type: part.mimeType, data: part.data, ...(part.filename ? { metadata: { filename: part.filename } } : {}) };
  });
}

function normalizeMessages(messages: AgentMessage[]): Array<{ role: AgentMessage["role"]; content: unknown }> {
  return messages.map((message) => ({
    role: message.role,
    content: providerContent(message.content),
  }));
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text);
        return "";
      })
      .join("");
  }
  return "";
}

function finalTextFromState(state: unknown): string {
  const messages = (state as { messages?: unknown[] } | undefined)?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = messageText(messages[i]);
    if (text.trim()) return text;
  }
  return "";
}

function structuredInstructions<T>(
  instructions: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): string {
  const jsonSchema = toJsonSchema(schema);
  const serialized = JSON.stringify(jsonSchema);
  if (serialized.length <= INITIAL_SCHEMA_PROMPT_MAX_CHARS) {
    return `${instructions}\nThe final answer must match this JSON Schema exactly:\n${serialized}`;
  }

  let properties: string[] = [];
  if (typeof jsonSchema === "object" && jsonSchema !== null && "properties" in jsonSchema) {
    const schemaProperties = jsonSchema.properties;
    if (schemaProperties && typeof schemaProperties === "object" && !Array.isArray(schemaProperties)) {
      properties = Object.keys(schemaProperties);
    }
  }
  const shape = properties.length > 0
    ? ` with these top-level keys: ${properties.slice(0, INITIAL_SCHEMA_PROMPT_MAX_KEYS).join(", ")}${properties.length > INITIAL_SCHEMA_PROMPT_MAX_KEYS ? ", …" : ""}`
    : "";
  return `${instructions}\nThe final answer must be one JSON object${shape}. The dedicated formatter will enforce the complete schema.`;
}

function structuredOutputCacheKey(config: AiConfigWithKey): string {
  return [
    config.provider.id,
    String(config.provider.updatedAt),
    config.model.id,
    config.model.modelId,
    String(config.model.updatedAt),
  ].join(":");
}

/** The agent bound to a feature. Fails closed when the binding is missing or broken. */
export function boundAgent(snapshot: RegistrySnapshot, featureId: string): AgentDef {
  const binding = snapshot.bindings.get(featureId);
  const agent = binding ? snapshot.agents.get(binding.agentId) : undefined;
  if (!agent) {
    throw AppError.badRequest(`AI feature '${featureId}' has no valid agent — bind one in AI Governance › Assistant.`);
  }
  if (!agent.enabled) {
    throw AppError.badRequest(`AI feature '${featureId}' is bound to the disabled agent '${agent.name}' — enable it or rebind the feature in AI Governance › Assistant.`);
  }
  return agent;
}

function modelLabel(resolved: ResolvedModel): { model: ResolvedModel["model"]; label: string; usage: ResolvedModel["usage"] } {
  return { model: resolved.model, label: resolved.label, usage: resolved.usage };
}

/** Who and what a usage run is attributed to (ADR 0020). */
function usageMeta(featureId: string, ctx: AgentRunContext, source: UsageRunMeta["source"]): UsageRunMeta {
  return {
    featureId,
    source,
    userId: ctx.userId ?? null,
    connectionId: ctx.connectionId ?? null,
    caller: source === "background" ? null : currentCaller(),
  };
}

async function buildContext(
  snapshot: RegistrySnapshot,
  root: ResolvedModel,
  base: Omit<BuildContext, "snapshot" | "rootModel" | "resolveModel">,
): Promise<BuildContext> {
  registerHarnessBaseline(root.config.model.modelId);
  return {
    memory: lazyRunMemory(base.runtime.ctx),
    ...base,
    snapshot,
    rootModel: modelLabel(root),
    resolveModel: async (modelConfigId) => {
      const resolved = await resolveDeepAgentModel(modelConfigId);
      registerHarnessBaseline(resolved.config.model.modelId);
      return modelLabel(resolved);
    },
  };
}

async function collectStructuredRun(
  agent: DeepAgent,
  messages: AgentMessage[],
  recursionLimit: number,
  signal: AbortSignal,
): Promise<string> {
  const result = await agent.invoke(
    { messages: normalizeMessages(messages) },
    { recursionLimit, signal },
  ).catch((error: unknown) => {
    throw guardrailErrorIn(error) ?? error;
  });
  return finalTextFromState(result);
}

/**
 * Run a structured (non-streaming) feature end to end.
 *
 * The bound agent's prompt asks for schema-valid JSON. Parse that final
 * response directly, then use the model's bounded structured-output policy
 * only when parsing fails. Avoiding a response-format tool on every agent step
 * keeps provider behavior consistent and prevents schema-retry loops.
 */
export interface RunOptions {
  /** Run against this registry state instead of the stored one (the test console's draft). */
  snapshot?: RegistrySnapshot;
  /** Run this agent instead of the feature's bound agent (test console). */
  agentId?: string;
  /** Receives what the agent was given and did (test console). */
  onTrace?: (trace: RunTrace) => void;
  /** Receives the run's LLM tokens and cost when it ends, failed or not (auto-triage budgets, ADR 0024). */
  onUsage?: (usage: { tokens: number; costUsd: number | null }) => void;
}

/** Tokens and cost of every LLM call a usage run made so far. */
function runUsage(run: UsageRun): { tokens: number; costUsd: number | null } {
  let tokens = 0;
  let costUsd: number | null = null;
  for (const step of run.steps) {
    if (step.kind !== "llm") continue;
    tokens += step.usage.input + step.usage.output;
    if (step.costUsd !== null) costUsd = (costUsd ?? 0) + step.costUsd;
  }
  return { tokens, costUsd };
}

export interface RunTrace {
  agent: { id: string; slug: string; name: string };
  system: string;
  task: string | null;
  raw: string;
  calls: InvokedToolCall[];
}

/** Guard the data a feature gathered (its `json` variables) like a tool result (ADR 0022). */
async function guardGatheredData(
  guardrails: GuardrailRunner,
  cap: { variables: Record<string, { type: string }> },
  variables: Record<string, TemplateValue>,
  agent: AgentDef,
): Promise<Record<string, TemplateValue>> {
  const list = guardrails.at("tool_result", agent.id);
  if (list.length === 0) return variables;
  const guarded: Record<string, TemplateValue> = { ...variables };
  for (const [name, value] of Object.entries(variables)) {
    if (cap.variables[name]?.type === "json" && typeof value === "string") {
      guarded[name] = await guardrails.checkGathered(list, name, value, agent.slug);
    }
  }
  return guarded;
}

/** The fallback's user messages get the input stage, as the agent's task did. */
async function guardFallbackInput(guardrails: GuardrailRunner, agent: AgentDef, messages: AgentMessage[]): Promise<AgentMessage[]> {
  const list = guardrails.at("input", agent.id);
  if (list.length === 0) return messages;
  const out: AgentMessage[] = [];
  const check = (text: string): Promise<string> => guardrails.checkText("input", list, text, { agentPath: agent.slug, tool: null });
  for (const m of messages) {
    if (m.role !== "user") {
      out.push(m);
      continue;
    }
    const content = typeof m.content === "string"
      ? await check(m.content)
      : await Promise.all(m.content.map(async (part) => (part.type === "text" ? { ...part, text: await check(part.text) } : part)));
    out.push({ ...m, content });
  }
  return out;
}

/**
 * The model config a run uses: an exhausted budget's fallback model first
 * (ADR 0024, D5), then the caller's pick, then the agent's own. Throws when an
 * exhausted budget stops runs.
 */
export async function budgetedModel(featureId: string, ctx: AgentRunContext, agent: AgentDef): Promise<string | undefined> {
  const decision = await checkBudgets(featureId, ctx.userId ?? null);
  if (decision.fallbackModelConfigId) {
    logger.info({ module: "AI", featureId, budget: decision.budget?.name }, "AI budget used up; running on its fallback model");
    return decision.fallbackModelConfigId;
  }
  return ctx.modelId ?? agent.modelConfigId ?? undefined;
}

function chosenAgent(snapshot: RegistrySnapshot, featureId: string, agentId: string | undefined): AgentDef {
  if (!agentId) return boundAgent(snapshot, featureId);
  const agent = snapshot.agents.get(agentId);
  if (!agent) throw AppError.notFound("Agent not found");
  return agent;
}

export async function runStructuredCapability<TInput, TPrepared, TParsed, TOutput>(
  cap: StructuredCapability<TInput, TPrepared, TParsed, TOutput>,
  input: TInput,
  ctx: AgentRunContext,
  options: RunOptions = {},
): Promise<TOutput> {
  try {
    return await withUsageRun(usageMeta(cap.id, ctx, ctx.userId ? "feature" : "background"), persistUsageRun, async (run) => {
      try {
        return await structuredRun(run);
      } finally {
        options.onUsage?.(runUsage(run));
      }
    });
  } catch (error) {
    if (cap.softFail) return cap.softFail(error);
    handleAiError(error, `AI:${cap.id}`);
  }

  async function structuredRun(run: UsageRun): Promise<TOutput> {
    const snapshot = options.snapshot ?? await getRegistrySnapshot();
    const agent = chosenAgent(snapshot, cap.id, options.agentId);
    run.setAgent({ id: agent.id, slug: agent.slug, name: agent.name });
    const prepared = await cap.prepare(input, ctx);
    const scope = `${agent.id}@${agent.version}`;
    const cached = await cap.cachedResult?.(prepared, ctx, scope);
    if (cached !== undefined) return cached;

    const guardrails = runnerForRun(snapshot, cap.id, ctx, run);
    const variables = await guardGatheredData(guardrails, cap, cap.templateVariables(prepared, ctx), agent);
    const prompts = renderAgentPrompts(agent, variables, snapshot);
    const task = renderTaskMessage(agent, variables, snapshot);
    const instructions = structuredInstructions(prompts.system, cap.outputSchema);

    const resolved = await resolveDeepAgentModel(await budgetedModel(cap.id, ctx, agent));
    const { model, config, label } = resolved;
    const calls: InvokedToolCall[] = [];
    const build = await buildContext(snapshot, resolved, {
      runtime: featureRuntime(ctx, cap.contexts, cap.fleetNodes?.(prepared)),
      variables,
      calls,
      guardrails,
    });
    const deepAgent = await buildAgentTree(agent, instructions, build);

    const overrides = runtimeOverrides(config);
    const signal = runSignal(overrides.runTimeoutMs ?? agent.tuning.timeoutMs ?? STRUCTURED_RUN_TIMEOUT_MS);
    const raw = await collectStructuredRun(
      deepAgent,
      [{ role: "user", content: task }],
      overrides.recursionLimit ?? agent.tuning.recursionLimit ?? recursionLimitFor(agent.tuning.stepBudget),
      signal,
    );
    options.onTrace?.({ agent: { id: agent.id, slug: agent.slug, name: agent.name }, system: instructions, task, raw, calls });
    const steps = calls.map((call) => ({ tool: call.name, input: call.args, ...(call.agent && call.agent !== agent.slug ? { agent: call.agent } : {}) }));
    const meta = { raw, steps, modelLabel: label };

    const fallbackMessages: AgentMessage[] = cap.fallbackMessages
      ? cap.fallbackMessages(prepared, ctx, raw, prompts, variables)
      : [
          { role: "system", content: instructions },
          {
            role: "user",
            content: `Investigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the JSON result now.`,
          },
        ];

    const parsed = await structuredOutput({
      model,
      schema: cap.outputSchema,
      raw,
      fallbackMessages,
      maxOutputTokens: agent.tuning.maxOutputTokens ?? undefined,
      policy: isStructuredOutputPolicy(config.model.params?.structuredOutputPolicy)
        ? config.model.params.structuredOutputPolicy
        : "auto",
      strategyCacheKey: structuredOutputCacheKey(config),
      signal,
      module: `AI:${cap.id}`,
      // The fallback call runs outside the agent, so its guardrails are applied here.
      guardFallbackMessages: (messages) => guardFallbackInput(guardrails, agent, messages),
      guardFallbackOutput: (output) => guardrails.checkStructured(guardrails.at("output", agent.id), output, { agentPath: agent.slug, tool: null }),
    });

    if (parsed === null) {
      if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
      throw AppError.internal(`Chouse AI could not complete '${cap.id}' — please try again.`);
    }

    const output = await cap.finalize(parsed, prepared, ctx, meta);
    await cap.cacheResult?.(output, prepared, ctx, scope);
    return output;
  }
}

/** Run a structured feature by id (used by feature-call tools such as optimize_query). */
export async function runFeature(featureId: string, input: unknown, ctx: AgentRunContext): Promise<unknown> {
  const cap = getCapability(featureId);
  if (!cap || !isStructured(cap)) throw AppError.badRequest(`Unknown AI feature: ${featureId}`);
  return runStructuredCapability(cap, cap.inputSchema.parse(input), ctx);
}

export interface ChatRunResult {
  content: string;
  toolCalls: InvokedToolCall[];
  agent: { id: string; slug: string; name: string };
  /** Approvals the run is waiting for (ADR 0024); empty once it has finished. */
  interrupts: ChatInterrupt[];
}

/** One paused tool call, as LangChain's per-call approval reports it. */
export interface ChatInterrupt {
  id: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  description: string;
}

function interruptsOf(state: unknown): ChatInterrupt[] {
  const raw = (state as { __interrupt__?: unknown } | undefined)?.__interrupt__;
  if (!Array.isArray(raw)) return [];
  const out: ChatInterrupt[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, value } = entry as { id?: unknown; value?: unknown };
    if (typeof id !== "string" || !value || typeof value !== "object") continue;
    const v = value as { type?: unknown; tool_call_id?: unknown; name?: unknown; args?: unknown; description?: unknown };
    if (v.type !== "tool_approval" || typeof v.name !== "string") continue;
    out.push({
      id,
      toolCallId: typeof v.tool_call_id === "string" ? v.tool_call_id : "",
      name: v.name,
      args: v.args && typeof v.args === "object" ? (v.args as Record<string, unknown>) : {},
      description: typeof v.description === "string" ? v.description : "",
    });
  }
  return out;
}

/** How a durable chat run (ADR 0024) starts or continues. */
export interface ChatRunOptions {
  /** The run id: the checkpoint thread, so a paused run resumes on any replica. */
  id: string;
  /** Decisions for the paused tool calls, keyed by interrupt id; absent = a new turn. */
  resume?: Record<string, unknown>;
  /** Skills the user named with /skill: — their instructions go to the model before it answers. */
  pinnedSkills?: string[];
  /** Files sent with the new message; each is recorded as data sent to the provider (ADR 0020). */
  attachments?: ChatAttachment[];
  onToolEvent?: (event: ToolEvent) => void;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  /** Base64 content. */
  data: string;
}

/**
 * Run the chat over a conversation with the thread's chosen agent, or the chat
 * feature's bound agent. The agent must be one the user may use.
 */
export async function invokeChat(
  ctx: AgentRunContext,
  messages: AgentMessage[],
  options: {
    agentId?: string | null;
    /** The chat thread, so AI activity can link a request back to it. */
    threadId?: string;
    signal?: AbortSignal;
    /** Test console: run against a draft registry, and any chat agent (manager-only route). */
    snapshot?: RegistrySnapshot;
    /** A durable, checkpointed run (ADR 0024). */
    run?: ChatRunOptions;
  } = {},
): Promise<ChatRunResult> {
  const cap = getCapability("chat");
  if (!cap) throw AppError.internal("The chat feature is not registered");
  const snapshot = options.snapshot ?? await getRegistrySnapshot();
  let agent: AgentDef;
  if (options.snapshot && options.agentId) {
    const draft = snapshot.agents.get(options.agentId);
    if (!draft) throw AppError.notFound("Agent not found");
    if (draft.taskTemplate !== null) throw AppError.badRequest(`'${draft.name}' is a feature agent; test it through its feature`);
    agent = draft;
  } else if (options.agentId) {
    const chosen = chatAgentCandidates(snapshot, ctx).find((candidate) => candidate.id === options.agentId);
    if (!chosen) throw AppError.badRequest("That chat agent is not available to you. Pick another agent.");
    agent = chosen;
  } else {
    agent = boundAgent(snapshot, "chat");
    if (!userMayUseAgent(agent, ctx)) throw AppError.forbidden(`You do not have access to the chat agent '${agent.name}'.`);
  }

  return withUsageRun({ ...usageMeta("chat", ctx, "chat"), threadId: options.threadId ?? null }, persistUsageRun, async (run) => {
    run.setAgent({ id: agent.id, slug: agent.slug, name: agent.name });
    const resolved = await resolveDeepAgentModel(await budgetedModel("chat", ctx, agent));
    const calls: InvokedToolCall[] = [];
    const prompts = renderAgentPrompts(agent, {}, snapshot);
    const durable = options.run;
    if (durable?.attachments?.length) {
      const step = run.beginTool("chat_attachments", agent.slug, { model: resolved.usage, connectionId: ctx.connectionId ?? null, defaultDatabase: ctx.defaultDatabase ?? null });
      for (const file of durable.attachments) step.addChouseSource(`Attachment: ${file.name}`, file.data);
      step.end({ result: { files: durable.attachments.length } });
    }
    const build = await buildContext(snapshot, resolved, {
      runtime: featureRuntime(ctx, cap.contexts),
      variables: {},
      calls,
      includeChild: (child) => userMayUseAgent(child, ctx),
      guardrails: runnerForRun(snapshot, "chat", ctx, run),
      ...(durable ? {
        checkpointer: checkpointSaver(),
        // Only calls made below the answering agent carry a path, as in the stored answer.
        onToolEvent: durable.onToolEvent && ((event: ToolEvent) => durable.onToolEvent?.(event.type === "tool_start" && event.agent === agent.slug ? { ...event, agent: undefined } : event)),
      } : {}),
    });
    const deepAgent = await buildAgentTree(agent, prompts.system, build);
    const overrides = runtimeOverrides(resolved.config);
    const config = {
      recursionLimit: overrides.recursionLimit ?? agent.tuning.recursionLimit ?? recursionLimitFor(agent.tuning.stepBudget),
      signal: runSignal(overrides.runTimeoutMs ?? agent.tuning.timeoutMs ?? CHAT_RUN_TIMEOUT_MS, options.signal),
      ...(durable ? { configurable: { thread_id: durable.id } } : {}),
    };
    const pinned = durable?.pinnedSkills?.length ? { pinnedSkills: durable.pinnedSkills } : {};
    const input = durable?.resume
      ? new Command({ resume: durable.resume })
      : { messages: normalizeMessages(messages), ...pinned };
    const result = await deepAgent.invoke(input as never, config).catch((error: unknown) => {
      throw guardrailErrorIn(error) ?? error;
    });
    const interrupts = interruptsOf(result);
    return {
      content: interrupts.length > 0 ? "" : finalTextFromState(result),
      toolCalls: calls,
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
      interrupts,
    };
  });
}

/** Type guard: is this feature structured (vs invoked)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
