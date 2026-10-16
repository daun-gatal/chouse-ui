/**
 * LangChain callback handler that turns every model call into an `llm` step of
 * the active usage run (ADR 0020 §1). `resolveDeepAgentModel` passes it to the
 * constructor of each model a run creates, so it sees the root agent,
 * subagents on their own model, deepagents' summarization calls and the
 * structured output fallback, which runs outside the agent graph. It must be a
 * constructor field: ChatOpenAI rebuilds itself from those fields in
 * `bindTools`, dropping callbacks set on the instance afterwards.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";

import { usageFromResult } from "./pricing";
import type { ModelRef, StepToolCall, UsageRun, UsageStep } from "./run";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tools the first generation asked for; a deepagents `task` call names the subagent it hands to. */
export function toolCallsFromResult(result: unknown): StepToolCall[] {
  if (!isRecord(result) || !Array.isArray(result.generations) || !Array.isArray(result.generations[0])) return [];
  const first: unknown = result.generations[0][0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : undefined;
  const calls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return calls.flatMap((call: unknown): StepToolCall[] => {
    if (!isRecord(call) || typeof call.name !== "string") return [];
    const args = isRecord(call.args) ? call.args : {};
    return [call.name === "task" && typeof args.subagent_type === "string" ? { tool: "task", agent: args.subagent_type } : { tool: call.name }];
  });
}

export class UsageCallbackHandler extends BaseCallbackHandler {
  name = "chouse_ai_usage";
  private readonly open = new Map<string, UsageStep>();

  constructor(private readonly run: UsageRun, private readonly model: ModelRef) {
    // Handlers run in the background by default; awaiting keeps every step
    // recorded before the engine call returns and the run is written.
    super({ _awaitHandler: true });
  }

  // The callback manager copies handlers for child runs; one shared instance
  // keeps a single map of open calls.
  override copy(): BaseCallbackHandler {
    return this;
  }

  private begin(runId: string, metadata: Record<string, unknown> | undefined): void {
    const agent = typeof metadata?.lc_agent_name === "string" ? metadata.lc_agent_name : null;
    this.open.set(runId, this.run.beginLlm(this.model, agent));
  }

  override handleChatModelStart(
    _llm: Serialized,
    _messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    this.begin(runId, metadata);
  }

  override handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    this.begin(runId, metadata);
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const step = this.open.get(runId);
    if (!step) return;
    this.open.delete(runId);
    this.run.endLlm(step, usageFromResult(output), toolCallsFromResult(output));
  }

  override handleLLMError(error: unknown, runId: string): void {
    const step = this.open.get(runId);
    if (!step) return;
    this.open.delete(runId);
    this.run.failLlm(step, error);
  }
}
