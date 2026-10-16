/**
 * LangChain callback handler that turns every model call into an `llm` step of
 * the active usage run (ADR 0020 §1). It is attached to each model instance a
 * run creates (`resolveDeepAgentModel`), so it sees the root agent, subagents
 * on their own model, deepagents' summarization calls and the structured
 * output fallback, which runs outside the agent graph.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";

import { usageFromResult } from "./pricing";
import type { ModelRef, UsageRun, UsageStep } from "./run";

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
    this.run.endLlm(step, usageFromResult(output));
  }

  override handleLLMError(error: unknown, runId: string): void {
    const step = this.open.get(runId);
    if (!step) return;
    this.open.delete(runId);
    this.run.failLlm(step, error);
  }
}

/** Attach a recorder for `run` to a freshly created model instance. */
export function attachUsageRecorder(model: BaseChatModel, run: UsageRun, ref: ModelRef): void {
  const handler = new UsageCallbackHandler(run, ref);
  const existing = model.callbacks;
  if (existing === undefined) model.callbacks = [handler];
  else if (Array.isArray(existing)) model.callbacks = [...existing, handler];
  else existing.addHandler(handler, false);
}
