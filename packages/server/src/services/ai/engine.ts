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
} from "./registry/builder";
import { registerHarnessBaseline } from "./registry/harness";
import { userMayUseAgent, chatAgentCandidates } from "./registry/chatAgents";
import type { AgentDef, RegistrySnapshot } from "./registry/types";
import type {
  AgentMessage,
  AgentRunContext,
  AnyStructuredCapability,
  StructuredCapability,
} from "./types";
import type { AiConfigWithKey } from "../../rbac/services/aiModels";
import type { DeepAgent } from "deepagents";

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

function normalizeMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
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

export function structuredInstructions<T>(
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
    throw AppError.badRequest(`AI feature '${featureId}' has no valid agent — bind one in Agents › Assistant.`);
  }
  if (!agent.enabled) {
    throw AppError.badRequest(`AI feature '${featureId}' is bound to the disabled agent '${agent.name}' — enable it or rebind the feature in Agents › Assistant.`);
  }
  return agent;
}

function modelLabel(resolved: ResolvedModel): { model: ResolvedModel["model"]; label: string } {
  return { model: resolved.model, label: resolved.label };
}

async function buildContext(
  snapshot: RegistrySnapshot,
  root: ResolvedModel,
  base: Omit<BuildContext, "snapshot" | "rootModel" | "resolveModel">,
): Promise<BuildContext> {
  registerHarnessBaseline(root.config.model.modelId);
  return {
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
  );
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
export async function runStructuredCapability<TInput, TPrepared, TParsed, TOutput>(
  cap: StructuredCapability<TInput, TPrepared, TParsed, TOutput>,
  input: TInput,
  ctx: AgentRunContext,
): Promise<TOutput> {
  try {
    const snapshot = await getRegistrySnapshot();
    const agent = boundAgent(snapshot, cap.id);
    const prepared = await cap.prepare(input, ctx);
    const scope = `${agent.id}@${agent.version}`;
    const cached = await cap.cachedResult?.(prepared, ctx, scope);
    if (cached !== undefined) return cached;

    const variables = cap.templateVariables(prepared, ctx);
    const prompts = renderAgentPrompts(agent, variables, snapshot);
    const task = renderTaskMessage(agent, variables, snapshot);
    const instructions = structuredInstructions(prompts.system, cap.outputSchema);

    const resolved = await resolveDeepAgentModel(ctx.modelId ?? agent.modelConfigId ?? undefined);
    const { model, config, label } = resolved;
    const calls: InvokedToolCall[] = [];
    const build = await buildContext(snapshot, resolved, {
      runtime: featureRuntime(ctx, cap.contexts, cap.fleetNodes?.(prepared)),
      variables,
      calls,
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
    const steps = calls.map((call) => ({ tool: call.name, input: call.args, ...(call.agent && call.agent !== agent.slug ? { agent: call.agent } : {}) }));
    const meta = { raw, steps, modelLabel: label };

    const fallbackMessages: AgentMessage[] = cap.fallbackMessages
      ? cap.fallbackMessages(prepared, ctx, raw, prompts)
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
    });

    if (parsed === null) {
      if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
      throw AppError.internal(`Chouse AI could not complete '${cap.id}' — please try again.`);
    }

    const output = await cap.finalize(parsed, prepared, ctx, meta);
    await cap.cacheResult?.(output, prepared, ctx, scope);
    return output;
  } catch (error) {
    if (cap.softFail) return cap.softFail(error);
    handleAiError(error, `AI:${cap.id}`);
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
}

/**
 * Run the chat over a conversation with the thread's chosen agent, or the chat
 * feature's bound agent. The agent must be one the user may use.
 */
export async function invokeChat(
  ctx: AgentRunContext,
  messages: AgentMessage[],
  options: { agentId?: string | null; signal?: AbortSignal } = {},
): Promise<ChatRunResult> {
  const cap = getCapability("chat");
  if (!cap) throw AppError.internal("The chat feature is not registered");
  const snapshot = await getRegistrySnapshot();
  let agent: AgentDef;
  if (options.agentId) {
    const chosen = chatAgentCandidates(snapshot, ctx).find((candidate) => candidate.id === options.agentId);
    if (!chosen) throw AppError.badRequest("That chat agent is not available to you. Pick another agent.");
    agent = chosen;
  } else {
    agent = boundAgent(snapshot, "chat");
    if (!userMayUseAgent(agent, ctx)) throw AppError.forbidden(`You do not have access to the chat agent '${agent.name}'.`);
  }

  const resolved = await resolveDeepAgentModel(ctx.modelId ?? agent.modelConfigId ?? undefined);
  const calls: InvokedToolCall[] = [];
  const prompts = renderAgentPrompts(agent, {}, snapshot);
  const build = await buildContext(snapshot, resolved, {
    runtime: featureRuntime(ctx, cap.contexts),
    variables: {},
    calls,
    includeChild: (child) => userMayUseAgent(child, ctx),
  });
  const deepAgent = await buildAgentTree(agent, prompts.system, build);
  const overrides = runtimeOverrides(resolved.config);
  const result = await deepAgent.invoke(
    { messages: normalizeMessages(messages) },
    {
      recursionLimit: overrides.recursionLimit ?? agent.tuning.recursionLimit ?? recursionLimitFor(agent.tuning.stepBudget),
      signal: runSignal(overrides.runTimeoutMs ?? agent.tuning.timeoutMs ?? CHAT_RUN_TIMEOUT_MS, options.signal),
    },
  );
  return { content: finalTextFromState(result), toolCalls: calls, agent: { id: agent.id, slug: agent.slug, name: agent.name } };
}

/** Type guard: is this feature structured (vs invoked)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
