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
  type SubAgent,
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
  StreamCapability,
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

const CHAT_EXCLUDED_DEEPAGENT_TOOLS = [
  "task",
  "write_todos",
  "ls",
  "read_file",
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

const registeredChatProfiles = new Set<string>();

function recursionLimitFor(stepBudget: number): number {
  // DeepAgents/LangGraph executes several internal graph nodes for one visible
  // tool/subagent action. Keep Chouse's public "step" tuning readable while
  // giving the graph enough room to finish normal skill-heavy workflows.
  return Math.max(50, stepBudget * 4);
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

function registerChatDirectToolProfile(config: AiConfigWithKey): void {
  const modelId = config.model.modelId;
  if (!modelId) return;

  const provider = deepAgentProviderKey(config);
  const keys = modelId.includes(":") ? [modelId] : [`${provider}:${modelId}`];

  for (const key of keys) {
    if (registeredChatProfiles.has(key)) continue;
    registerHarnessProfile(key, {
      excludedTools: CHAT_EXCLUDED_DEEPAGENT_TOOLS,
      generalPurposeSubagent: { enabled: false },
      systemPromptSuffix:
        "For this Chouse chat run, do not use planning, filesystem, or delegation tools. Use only the concrete Chouse tools provided for schema, query, chart, optimization, and export work.",
    });
    registeredChatProfiles.add(key);
  }
}

function createSubagents(model: unknown, tools: AgentToolSet): SubAgent[] {
  const sharedTools = toolsArray(tools);
  return [
    {
      name: "schema-investigator",
      description: "Investigates ClickHouse databases, tables, DDL, schemas, sizes, and column metadata.",
      systemPrompt: "You are a ClickHouse schema investigator. Use tools first, cite concrete schema facts, and return a concise final report.",
      model: model as SubAgent["model"],
      tools: sharedTools as SubAgent["tools"],
      skills: ["/skills/ai-chat"],
    },
    {
      name: "query-optimizer",
      description: "Optimizes ClickHouse SELECT/WITH queries using DDL, EXPLAIN, and table-size evidence.",
      systemPrompt: "You are a ClickHouse query optimizer. Preserve semantics, validate SQL, and return only grounded optimization findings.",
      model: model as SubAgent["model"],
      tools: sharedTools as SubAgent["tools"],
      skills: ["/skills/ai-optimizer", "/skills/references"],
    },
    {
      name: "query-debugger",
      description: "Debugs failed ClickHouse SQL and returns a corrected query with the root cause.",
      systemPrompt: "You are a ClickHouse query debugger. Use schema tools, preserve intent, validate the fix, and keep the report concise.",
      model: model as SubAgent["model"],
      tools: sharedTools as SubAgent["tools"],
      skills: ["/skills/ai-optimizer", "/skills/references"],
    },
    {
      name: "fleet-investigator",
      description: "Investigates ClickHouse fleet/node health through read-only system.* queries.",
      systemPrompt: "You are a ClickHouse fleet SRE. Use only read-only evidence from system tables and summarize the important findings.",
      model: model as SubAgent["model"],
      tools: sharedTools as SubAgent["tools"],
      skills: ["/skills/references"],
    },
    {
      name: "visualization-planner",
      description: "Plans and renders charts from ClickHouse query results using the render_chart tool.",
      systemPrompt: "You are a data visualization planner. Use chart tools instead of markdown tables when the user asks for visual output.",
      model: model as SubAgent["model"],
      tools: sharedTools as SubAgent["tools"],
      skills: ["/skills/ai-chat"],
    },
  ];
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
  options: { subagents?: boolean } = {},
): DeepAgent {
  return createDeepAgent({
    model: model as never,
    tools: toolsArray(tools),
    systemPrompt,
    backend: createBackend(),
    permissions: FILESYSTEM_PERMISSIONS,
    skills: DEEP_AGENT_SKILL_SOURCES,
    subagents: options.subagents === false ? [] : createSubagents(model, tools),
  }) as DeepAgent;
}

function stableToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return JSON.stringify(input);
  const sorted = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

function guardDuplicateChatTools(tools: AgentToolSet): AgentToolSet {
  const seen = new Set<string>();
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => [
      name,
      tool(
        async (input: unknown) => {
          const signature = `${name}:${stableToolInput(input)}`;
          if (seen.has(signature)) {
            return {
              repeated: true,
              message:
                "This exact action was already completed with the same inputs. Use the previous result, choose a different next action if needed, or provide the final answer now. Do not call this tool again unless the inputs change.",
            };
          }
          seen.add(signature);
          return original.invoke(input as never);
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
): Promise<{ raw: string; steps: { tool: string; input: unknown }[] }> {
  const result = await agent.invoke(
    { messages: normalizeMessages(messages) },
    { recursionLimit: recursionLimitFor(stepLimit) },
  );
  return { raw: finalTextFromState(result), steps: [] };
}

/**
 * Run a structured (non-streaming) capability end to end.
 */
export async function runStructuredCapability<TInput, TPrepared, TParsed, TOutput>(
  cap: StructuredCapability<TInput, TPrepared, TParsed, TOutput>,
  input: TInput,
  ctx: AgentRunContext,
): Promise<TOutput> {
  try {
    const { model, label } = await resolveDeepAgentModel(ctx.modelId);

    const prepared = await cap.prepare(input, ctx);
    const tools = await cap.tools(prepared, ctx);
    const instructions = await cap.instructions(prepared, ctx);
    const messages = await cap.messages(prepared, ctx);
    const agent = createAgent(model, tools, instructions);

    const { raw, steps } = await collectStructuredRun(
      agent,
      messages,
      cap.tuning?.stopAtSteps ?? 10,
    );

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

    const meta = { raw, steps, modelLabel: label };

    if (parsed === null) {
      if (cap.onParseFailure) return await cap.onParseFailure(prepared, ctx, meta);
      throw AppError.internal(`Chouse AI could not complete '${cap.id}' — please try again.`);
    }

    return await cap.finalize(parsed, prepared, ctx, meta);
  } catch (error) {
    if (cap.softFail) return cap.softFail(error);
    handleAiError(error, `AI:${cap.id}`);
  }
}

/**
 * Build a streaming DeepAgent for chat. The route owns SSE framing and
 * persistence, preserving the existing frontend contract.
 */
export async function streamCapabilityAgent<TInput>(
  cap: StreamCapability<TInput>,
  _input: TInput,
  ctx: AgentRunContext,
  messages: AgentMessage[],
) {
  const { model, config } = await resolveDeepAgentModel(ctx.modelId);
  registerChatDirectToolProfile(config);
  const tools = guardDuplicateChatTools(await cap.tools(ctx));
  const instructions = await cap.instructions(ctx);
  const agent = createAgent(model, tools, instructions, { subagents: false });
  const run = await agent.streamEvents(
    { messages: normalizeMessages(messages) },
    { version: "v3", recursionLimit: recursionLimitFor(cap.tuning?.stopAtSteps ?? 30) },
  );
  return { run };
}

/** Type guard: is this capability structured (vs stream)? */
export function isStructured(cap: {
  delivery: string;
}): cap is AnyStructuredCapability {
  return cap.delivery === "structured";
}
