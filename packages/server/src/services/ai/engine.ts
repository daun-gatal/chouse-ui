/**
 * AI Engine — shared DeepAgents runtime for every Chouse AI capability.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
  createDeepAgent,
  registerHarnessProfile,
  type DeepAgent,
  type FilesystemPermission,
} from "deepagents";
import { tool } from "@langchain/core/tools";
import { AppError } from "../../types";
import { resolveDeepAgentModel } from "./model";
import { structuredOutput } from "./structuredOutput";
import { handleAiError } from "./errors";
import { toolsArray, type AgentToolSet } from "./langchainTools";
import type {
  AgentMessage,
  AgentRunContext,
  AnyStructuredCapability,
  InvokeCapability,
  StructuredCapability,
} from "./types";
import type { AiConfigWithKey } from "../../rbac/services/aiModels";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC_ROOT = path.resolve(__dirname, "../..");

export const DEEP_AGENT_SKILL_SOURCES = [
  "/skills/ai-chat",
  "/skills/ai-optimizer",
  "/skills/references",
];

const FILESYSTEM_PERMISSIONS: FilesystemPermission[] = [
  { operations: ["read"], paths: ["/skills/**"], mode: "allow" },
  { operations: ["write"], paths: ["/skills/**"], mode: "deny" },
];

const FAST_EXCLUDED_TOOLS = [
  "task",
  "write_todos",
  "ls",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "start_async_task",
  "check_async_task",
  "update_async_task",
  "cancel_async_task",
  "list_async_tasks",
];

const registeredFastProfiles = new Set<string>();

function recursionLimitFor(stepBudget: number): number {
  // DeepAgents/LangGraph executes several internal graph nodes for one visible
  // tool/subagent action. Keep Chouse's public "step" tuning readable while
  // giving the graph enough room to finish normal skill-heavy workflows.
  return Math.max(24, stepBudget * 4);
}

// Neither the model provider call nor a tool (e.g. a slow ClickHouse query) has
// a client-side timeout of its own, so a stalled network call would otherwise
// hang the run — and the UI — forever. These bound every run to a hard wall
// clock so a stall surfaces as a retryable error instead of an infinite spinner.
const STRUCTURED_RUN_TIMEOUT_MS = 4 * 60_000;
const CHAT_RUN_TIMEOUT_MS = 2 * 60_000;

function runSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

function createBackend() {
  return new CompositeBackend(new StateBackend(), {
    "/skills": new FilesystemBackend({
      rootDir: path.join(SERVER_SRC_ROOT, "skills"),
      virtualMode: true,
      maxFileSizeMb: 2,
    }),
  });
}

function deepAgentProviderKey(config: AiConfigWithKey): string {
  switch (config.provider.providerType) {
    case "anthropic":
      return "anthropic";
    case "google":
      return "google";
    case "openai":
    case "openai-compatible":
    default:
      return "openai";
  }
}

function registerFastHarnessProfile(config: AiConfigWithKey): void {
  const modelId = config.model.modelId;
  if (!modelId) return;

  const provider = deepAgentProviderKey(config);
  const keys = modelId.includes(":") ? [modelId] : [`${provider}:${modelId}`];

  for (const key of keys) {
    if (registeredFastProfiles.has(key)) continue;
    registerHarnessProfile(key, {
      excludedTools: FAST_EXCLUDED_TOOLS,
      generalPurposeSubagent: { enabled: false },
      systemPromptSuffix:
        "For Chouse AI runs, use the concrete tools directly. Do not plan or delegate work to subagents; each capability already has focused instructions and a bounded tool set.",
    });
    registeredFastProfiles.add(key);
  }
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

function createAgent(
  model: unknown,
  tools: AgentToolSet,
  systemPrompt: string,
): DeepAgent {
  return createDeepAgent({
    model: model as never,
    tools: toolsArray(tools),
    systemPrompt,
    backend: createBackend(),
    permissions: FILESYSTEM_PERMISSIONS,
    skills: DEEP_AGENT_SKILL_SOURCES,
    subagents: [],
  }) as DeepAgent;
}

function stableToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return JSON.stringify(input);
  const sorted = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

export interface InvokedToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

function recordableInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input));
}

function guardDuplicateTools(tools: AgentToolSet, calls: InvokedToolCall[]): AgentToolSet {
  const seen = new Set<string>();
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => [
      name,
      tool(
        // Preserve LangGraph's call context so tracing, cancellation, and
        // provider callbacks remain attached to the original tool invocation.
        async (input: unknown, config: unknown) => {
          const recorded: InvokedToolCall = { name, args: recordableInput(input) };
          calls.push(recorded);
          const signature = `${name}:${stableToolInput(input)}`;
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
      ),
    ]),
  ) as AgentToolSet;
}

async function collectStructuredRun(
  agent: DeepAgent,
  messages: AgentMessage[],
  stepLimit: number,
): Promise<string> {
  const result = await agent.invoke(
    { messages: normalizeMessages(messages) },
    {
      recursionLimit: recursionLimitFor(stepLimit),
      signal: runSignal(STRUCTURED_RUN_TIMEOUT_MS),
    },
  );
  return finalTextFromState(result);
}

/**
 * Run a structured (non-streaming) capability end to end.
 *
 * The capability prompt asks for schema-valid JSON. Parse that final response
 * directly, with one forced structured-output call only when parsing fails.
 * Avoiding a response-format tool on every agent step keeps provider behavior
 * consistent and prevents schema-retry loops on compatible endpoints.
 */
export async function runStructuredCapability<TInput, TPrepared, TParsed, TOutput>(
  cap: StructuredCapability<TInput, TPrepared, TParsed, TOutput>,
  input: TInput,
  ctx: AgentRunContext,
): Promise<TOutput> {
  try {
    const prepared = await cap.prepare(input, ctx);
    const cached = await cap.cachedResult?.(prepared, ctx);
    if (cached !== undefined) return cached;

    const { model, config, label } = await resolveDeepAgentModel(ctx.modelId);
    const invokedToolCalls: InvokedToolCall[] = [];
    const tools = guardDuplicateTools(await cap.tools(prepared, ctx), invokedToolCalls);
    const instructions = await cap.instructions(prepared, ctx);
    const messages = await cap.messages(prepared, ctx);
    registerFastHarnessProfile(config);
    const agent = createAgent(model, tools, instructions);

    const raw = await collectStructuredRun(
      agent,
      messages,
      cap.tuning?.stopAtSteps ?? 10,
    );
    const steps = invokedToolCalls.map((call) => ({ tool: call.name, input: call.args }));

    const meta = { raw, steps, modelLabel: label };

    const fallbackMessages: AgentMessage[] = cap.fallbackMessages
      ? cap.fallbackMessages(prepared, ctx, raw)
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
      maxOutputTokens: cap.tuning?.maxOutputTokens,
      module: `AI:${cap.id}`,
    });

    if (parsed === null) {
      if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
      throw AppError.internal(`Chouse AI could not complete '${cap.id}' — please try again.`);
    }

    const output = await cap.finalize(parsed, prepared, ctx, meta);
    await cap.cacheResult?.(output, prepared, ctx);
    return output;
  } catch (error) {
    if (cap.softFail) return cap.softFail(error);
    handleAiError(error, `AI:${cap.id}`);
  }
}

/**
 * Invoke chat to completion. The client keeps the interaction responsive with
 * an optimistic assistant placeholder, elapsed status, and cancellation.
 */
export async function invokeCapabilityAgent<TInput>(
  cap: InvokeCapability<TInput>,
  _input: TInput,
  ctx: AgentRunContext,
  messages: AgentMessage[],
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: InvokedToolCall[] }> {
  const { model, config } = await resolveDeepAgentModel(ctx.modelId);
  registerFastHarnessProfile(config);
  const toolCalls: InvokedToolCall[] = [];
  const tools = guardDuplicateTools(await cap.tools(ctx), toolCalls);
  const instructions = await cap.instructions(ctx);
  const agent = createAgent(model, tools, instructions);
  const result = await agent.invoke(
    { messages: normalizeMessages(messages) },
    {
      recursionLimit: recursionLimitFor(cap.tuning?.stopAtSteps ?? 12),
      signal: runSignal(CHAT_RUN_TIMEOUT_MS, signal),
    },
  );
  return { content: finalTextFromState(result), toolCalls };
}

/** Type guard: is this capability structured (vs invoked)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
