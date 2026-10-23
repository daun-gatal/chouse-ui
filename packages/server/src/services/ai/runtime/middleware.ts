/**
 * Per-agent runtime middleware (ADR 0024 §Phase 1): fallback model, retries,
 * call caps, context editing and provider prompt caching, built from the
 * agent's tuning. Order matters — the first middleware is the outermost:
 * the fallback wraps the retries, so the primary model is retried before the
 * fallback is tried.
 */

import {
  ClearToolUsesEdit,
  contextEditingMiddleware,
  createMiddleware,
  modelCallLimitMiddleware,
  modelFallbackMiddleware,
  modelRetryMiddleware,
  toolCallLimitMiddleware,
  toolRetryMiddleware,
  type AgentMiddleware,
} from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { AppError } from "../../../types";
import type { AgentTuning } from "../registry/types";

/** Errors worth retrying: the network, timeouts, overload and rate limits — never a validation or guardrail error. */
const TRANSIENT = /timeout|timed out|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed|overloaded|rate limit|too many requests|\b(429|500|502|503|504|529)\b|TOO_MANY_SIMULTANEOUS_QUERIES|temporarily unavailable/i;

export function isTransientError(error: unknown): boolean {
  // Our own errors (guardrails, permissions, validation) are decisions, not glitches.
  if (error instanceof AppError) return false;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return TRANSIENT.test(`${error.name} ${error.message}`);
}

/**
 * DeepAgents caches prompts for Anthropic and Bedrock models on its own, and a
 * custom middleware with the same name replaces a default one. Turning caching
 * off therefore swaps its caching middleware for ones that do nothing.
 */
const CACHING_OFF: AgentMiddleware[] = ["PromptCachingMiddleware", "CacheBreakpointMiddleware", "BedrockPromptCachingMiddleware"]
  .map((name) => createMiddleware({ name }) as AgentMiddleware);

export interface RuntimeMiddlewareOptions {
  tuning: AgentTuning;
  /** The fallback model, already resolved (null when the agent has none). */
  fallback: BaseChatModel | null;
}

export function runtimeMiddleware({ tuning, fallback }: RuntimeMiddlewareOptions): AgentMiddleware[] {
  const middleware: AgentMiddleware[] = [];
  if (fallback) middleware.push(modelFallbackMiddleware(fallback) as AgentMiddleware);
  if (tuning.modelRetries && tuning.modelRetries > 0) {
    middleware.push(modelRetryMiddleware({ maxRetries: tuning.modelRetries, retryOn: isTransientError, onFailure: "error" }) as AgentMiddleware);
  }
  if (tuning.maxModelCalls) {
    // "end" finishes the run with what it has rather than failing it.
    middleware.push(modelCallLimitMiddleware({ runLimit: tuning.maxModelCalls, exitBehavior: "end" }) as AgentMiddleware);
  }
  if (tuning.maxToolCalls) {
    // "continue" tells the model the cap is reached so it answers with what it gathered.
    middleware.push(toolCallLimitMiddleware({ runLimit: tuning.maxToolCalls, exitBehavior: "continue" }) as AgentMiddleware);
  }
  if (tuning.toolRetries && tuning.toolRetries > 0) {
    middleware.push(toolRetryMiddleware({ maxRetries: tuning.toolRetries, retryOn: isTransientError, onFailure: "continue" }) as AgentMiddleware);
  }
  if (tuning.clearOldToolResults) {
    middleware.push(contextEditingMiddleware({ edits: [new ClearToolUsesEdit({ trigger: { fraction: 0.6 }, keep: { messages: 4 } })] }) as AgentMiddleware);
  }
  if (tuning.promptCaching === false) middleware.push(...CACHING_OFF);
  return middleware;
}
