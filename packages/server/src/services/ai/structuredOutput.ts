/**
 * Structured output extraction — the single copy of the JSON-extraction logic
 * that used to live (identically) in both aiOptimizer.ts and chouseDoctor.ts.
 *
 * Strategy:
 *   1. Try to parse the agent's free text as the schema (whole text → fenced
 *      block → first {...} span).
 *   2. If that fails, fall back to a dedicated `generateObject` call that forces
 *      the model to emit schema-valid JSON from its own investigation notes.
 */

import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { AppError } from "../../types";
import { logger } from "../../utils/logger";

/** 3-tier JSON extraction (whole text → fenced ```json block → first {...} span). */
export function extractJson<T>(text: string, schema: z.ZodType<T>): T {
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
  model: LanguageModel;
  schema: z.ZodType<T>;
  /** The agent's raw final text (parsed first). */
  raw: string;
  /** Messages for the generateObject fallback (system + user). */
  fallbackMessages: ModelMessage[];
  maxOutputTokens?: number;
  /** Logging module tag. */
  module?: string;
}

/**
 * Parse the agent's text into `schema`, falling back to a forced
 * `generateObject` call when the free text doesn't parse. Returns null only if
 * both paths fail (callers decide whether that's fatal).
 */
export async function structuredOutput<T>(
  opts: StructuredOutputOptions<T>,
): Promise<T | null> {
  try {
    return extractJson(opts.raw, opts.schema);
  } catch {
    /* free-text didn't parse — force structured output */
  }

  try {
    const { object } = await generateObject({
      model: opts.model,
      schema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens,
      messages: opts.fallbackMessages,
    });
    return object;
  } catch (e) {
    logger.warn(
      { module: opts.module ?? "AIEngine", err: e instanceof Error ? e.message : String(e) },
      "Structured output fallback failed",
    );
    return null;
  }
}
