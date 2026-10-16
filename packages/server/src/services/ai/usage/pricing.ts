/**
 * Token usage normalization and cost (ADR 0020 §1, §4).
 *
 * LangChain's `usage_metadata` convention: `input_tokens` includes cached
 * tokens (`input_token_details.cache_read` / `cache_creation`), and
 * `output_tokens` includes reasoning for OpenAI and Anthropic. Google reports
 * thinking tokens only in `total_tokens`, so billable output is the larger of
 * `output_tokens` and `total_tokens - input_tokens`.
 */

import type { AiModelPricing } from "../../../rbac/constants/aiModelPricing";

export interface TokenUsage {
  /** All input tokens, cached ones included. */
  input: number;
  /** Billable output, reasoning included. */
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_USAGE: TokenUsage = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** A LangChain `usage_metadata` object, or null when the provider reported none. */
export function normalizeUsageMetadata(raw: unknown): TokenUsage | null {
  if (!isRecord(raw)) return null;
  const input = count(raw.input_tokens);
  const output = count(raw.output_tokens);
  if (input === null || output === null) return null;
  const total = count(raw.total_tokens);
  const details = isRecord(raw.input_token_details) ? raw.input_token_details : {};
  const cacheRead = Math.min(input, count(details.cache_read) ?? 0);
  const cacheWrite = Math.min(input - cacheRead, count(details.cache_creation) ?? 0);
  return {
    input,
    output: total === null ? output : Math.max(output, total - input),
    cacheRead,
    cacheWrite,
  };
}

/** The legacy `llmOutput.tokenUsage` shape some OpenAI-compatible paths still fill. */
export function normalizeTokenUsage(raw: unknown): TokenUsage | null {
  if (!isRecord(raw)) return null;
  const input = count(raw.promptTokens);
  const output = count(raw.completionTokens);
  if (input === null || output === null) return null;
  return { input, output, cacheRead: 0, cacheWrite: 0 };
}

/** Usage from a chat model result: the first generation's message, else `llmOutput`. */
export function usageFromResult(result: unknown): TokenUsage | null {
  if (!isRecord(result)) return null;
  const generations = Array.isArray(result.generations) ? result.generations : [];
  const first = Array.isArray(generations[0]) ? generations[0][0] : undefined;
  const message = isRecord(first) && isRecord(first.message) ? first.message : undefined;
  const fromMessage = message ? normalizeUsageMetadata(message.usage_metadata) : null;
  if (fromMessage) return fromMessage;
  const llmOutput = isRecord(result.llmOutput) ? result.llmOutput : undefined;
  return llmOutput ? normalizeTokenUsage(llmOutput.tokenUsage) : null;
}

/** USD cost of one call, or null when the model has no price. */
export function costOf(usage: TokenUsage, pricing: AiModelPricing | null): number | null {
  if (!pricing) return null;
  const uncached = Math.max(0, usage.input - usage.cacheRead - usage.cacheWrite);
  const micro =
    uncached * pricing.input +
    usage.cacheRead * (pricing.cacheRead ?? pricing.input) +
    usage.cacheWrite * (pricing.cacheWrite ?? pricing.input) +
    usage.output * pricing.output;
  return micro / 1_000_000;
}
