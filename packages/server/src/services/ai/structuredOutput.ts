/**
 * Structured output extraction — the single copy of the JSON-extraction logic
 * that used to live (identically) in both aiOptimizer.ts and chouseDoctor.ts.
 *
 * Strategy:
 *   1. Try to parse the agent's free text as the schema (whole text → fenced
 *      block → first {...} span).
 *   2. Apply the model's configured structured-output policy. Auto mode lets
 *      the adapter choose first, then tries tool calling only when the adapter
 *      explicitly rejects its preferred mechanism.
 *   3. Finish with provider-neutral plain JSON repair when structured formats
 *      are unavailable or the model emitted schema-invalid output.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
import type { StructuredOutputPolicy } from "../../rbac/constants/aiModelParams";
import { AppError } from "../../types";
import { logger } from "../../utils/logger";
import type { AgentMessage } from "./types";

/** 3-tier JSON extraction (whole text → fenced ```json block → first {...} span). */
export function extractJson<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const cleaned = text.trim();

  try {
    return schema.parse(JSON.parse(cleaned));
  } catch {
    /* fall through */
  }

  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return schema.parse(JSON.parse(fence[1].trim()));
    } catch {
      /* fall through */
    }
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return schema.parse(JSON.parse(cleaned.slice(start, end + 1)));
  }

  throw new AppError(
    "AI agent returned an unstructured response. Please retry.",
    "AI_PARSE_ERROR",
    "validation",
    500,
  );
}

export interface StructuredOutputOptions<T> {
  model: BaseChatModel;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** The agent's raw final text (parsed first). */
  raw: string;
  /** Messages for the structured fallback (system + user). */
  fallbackMessages: AgentMessage[];
  maxOutputTokens?: number;
  /** Per-model policy. Missing values preserve the automatic behavior. */
  policy?: StructuredOutputPolicy;
  /** Invalidates the successful-strategy cache when model/provider config changes. */
  strategyCacheKey?: string;
  /** Shared wall-clock signal for the agent run and every fallback attempt. */
  signal?: AbortSignal;
  /** Logging module tag. */
  module?: string;
}

type StructuredOutputStrategy = "adapter" | "native" | "tool" | "json" | "plain";
type FailureClass = "unsupported" | "output" | "transient" | "fatal";

interface AttemptSummary {
  strategy: "raw" | StructuredOutputStrategy;
  classification: FailureClass;
  error: string;
}

const STRATEGY_CACHE_MAX = 256;
const STRATEGY_CACHE_TTL_MS = 15 * 60_000;

interface CachedStrategy {
  strategy: StructuredOutputStrategy;
  expiresAt: number;
}

const successfulStrategyCache = new Map<string, CachedStrategy>();

/** Test/reset hook; production invalidation normally happens through the versioned cache key. */
export function clearStructuredOutputStrategyCache(): void {
  successfulStrategyCache.clear();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizedError(error: unknown): string {
  return errorMessage(error).slice(0, 500);
}

function numericStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const errorRecord = error as Record<string, unknown>;
  for (const key of ["status", "statusCode"] as const) {
    const value = errorRecord[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

function classifyFailure(error: unknown): FailureClass {
  const status = numericStatus(error);
  const message = errorMessage(error).toLowerCase();

  // These are local validation failures, not provider 5xx responses.
  if (error instanceof z.ZodError
      || (error instanceof AppError && error.code === "AI_PARSE_ERROR")) {
    return "output";
  }

  if (status === 401 || status === 403
      || message.includes("authentication")
      || message.includes("unauthorized")
      || message.includes("api key")
      || message.includes("permission denied")) {
    return "fatal";
  }

  if (status === 408 || status === 409 || status === 425 || status === 429
      || (status !== undefined && status >= 500)
      || message.includes("aborterror")
      || message.includes("timed out")
      || message.includes("timeout")
      || message.includes("rate limit")
      || message.includes("overloaded")
      || message.includes("temporarily unavailable")
      || message.includes("econn")) {
    return "transient";
  }

  if (message.includes("unstructured response")
      || message.includes("invalid json")
      || message.includes("could not parse")
      || message.includes("failed to parse")
      || message.includes("no tool calls")
      || message.includes("did not call")) {
    return "output";
  }

  if (message.includes("unsupported")
      || message.includes("not supported")
      || message.includes("only supports")
      || message.includes("unrecognized structured output method")
      || message.includes("does not expose native structured output")
      || message.includes("response_format")
      || message.includes("response format")
      || message.includes("json_schema")
      || message.includes("json schema")
      || message.includes("tool_choice")
      || message.includes("function calling")
      || message.includes("invalid argument")) {
    return "unsupported";
  }

  return "fatal";
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String(part.text);
      return "";
    })
    .join("");
}

function formattingMessages<T>(opts: StructuredOutputOptions<T>): AgentMessage[] {
  const schema = JSON.stringify(toJsonSchema(opts.schema));
  return [
    ...opts.fallbackMessages,
    {
      role: "user",
      content: `Return only one JSON object matching this JSON Schema. Do not use markdown or code fences.\n${schema}`,
    },
  ];
}

function rememberStrategy(cacheKey: string | undefined, strategy: StructuredOutputStrategy): void {
  if (!cacheKey) return;
  successfulStrategyCache.delete(cacheKey);
  successfulStrategyCache.set(cacheKey, {
    strategy,
    expiresAt: Date.now() + STRATEGY_CACHE_TTL_MS,
  });
  if (successfulStrategyCache.size <= STRATEGY_CACHE_MAX) return;
  const oldest = successfulStrategyCache.keys().next().value;
  if (typeof oldest === "string") successfulStrategyCache.delete(oldest);
}

function cachedStrategy(cacheKey: string | undefined): StructuredOutputStrategy | undefined {
  if (!cacheKey) return undefined;
  const cached = successfulStrategyCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    successfulStrategyCache.delete(cacheKey);
    return undefined;
  }
  return cached.strategy;
}

function uniqueStrategies(strategies: StructuredOutputStrategy[]): StructuredOutputStrategy[] {
  return strategies.filter((strategy, index) => strategies.indexOf(strategy) === index);
}

function strategiesFor(
  policy: StructuredOutputPolicy,
  cacheKey: string | undefined,
): StructuredOutputStrategy[] {
  switch (policy) {
    case "native":
      return ["native", "plain"];
    case "tool":
      return ["tool", "plain"];
    case "json":
      return ["json", "plain"];
    case "plain":
      return ["plain"];
    case "auto": {
      const cached = cachedStrategy(cacheKey);
      return uniqueStrategies([...(cached ? [cached] : []), "adapter", "tool", "plain"]);
    }
  }
}

async function invokeStructuredStrategy<T>(
  opts: StructuredOutputOptions<T>,
  strategy: Exclude<StructuredOutputStrategy, "plain">,
  messages: AgentMessage[],
): Promise<T> {
  if (!opts.model.withStructuredOutput) {
    throw new Error("Model adapter does not expose native structured output");
  }

  const structured = strategy === "adapter"
    ? opts.model.withStructuredOutput(opts.schema)
    : opts.model.withStructuredOutput(opts.schema, {
        method: strategy === "native"
          ? "jsonSchema"
          : strategy === "tool"
            ? "functionCalling"
            : "jsonMode",
      });
  const object = await structured.invoke(messages, { signal: opts.signal });
  return opts.schema.parse(object);
}

async function invokePlainStrategy<T>(
  opts: StructuredOutputOptions<T>,
  messages: AgentMessage[],
): Promise<T> {
  const response = await opts.model.invoke(messages, { signal: opts.signal });
  return extractJson(messageText(response), opts.schema);
}

/**
 * Parse the agent's text into `schema`, then negotiate bounded fallback
 * strategies. Provider/transient failures are rethrown so the shared AI error
 * mapper preserves their status instead of hiding them behind a parse error.
 */
export async function structuredOutput<T>(
  opts: StructuredOutputOptions<T>,
): Promise<T | null> {
  const attempts: AttemptSummary[] = [];
  try {
    return extractJson(opts.raw, opts.schema);
  } catch (error) {
    attempts.push({
      strategy: "raw",
      classification: "output",
      error: summarizedError(error),
    });
  }

  const policy = opts.policy ?? "auto";
  const messages = formattingMessages(opts);
  let skipToPlain = false;

  for (const strategy of strategiesFor(policy, opts.strategyCacheKey)) {
    if (skipToPlain && strategy !== "plain") continue;
    try {
      const output = strategy === "plain"
        ? await invokePlainStrategy(opts, messages)
        : await invokeStructuredStrategy(opts, strategy, messages);
      rememberStrategy(policy === "auto" ? opts.strategyCacheKey : undefined, strategy);
      logger.debug(
        {
          module: opts.module ?? "AIEngine",
          policy,
          strategy,
          fallbackAttempts: attempts.length,
        },
        "Structured output fallback succeeded",
      );
      return output;
    } catch (error) {
      const classification = classifyFailure(error);
      attempts.push({ strategy, classification, error: summarizedError(error) });
      if (classification === "fatal" || classification === "transient") throw error;
      if (classification === "output") skipToPlain = true;
    }
  }

  logger.warn(
    { module: opts.module ?? "AIEngine", policy, attempts },
    "Structured output fallback failed",
  );
  return null;
}
