/**
 * Shared AI error mapping — moved verbatim from aiOptimizer.ts so every
 * capability surfaces provider failures (rate limit / auth / connectivity)
 * with the same user-facing messages.
 */

import { AppError } from "../../types";
import { logger } from "../../utils/logger";

export function handleAiError(error: unknown, context: string): never {
  if (error instanceof AppError) throw error;

  const msg = error instanceof Error ? error.message : String(error);
  logger.error({ module: context }, msg);

  if (msg.includes("rate limit")) {
    throw AppError.badRequest("AI service rate limit exceeded. Please try again later.");
  }
  if (msg.includes("API key") || msg.includes("authentication")) {
    throw AppError.internal(
      "AI service authentication failed. Please contact your administrator.",
    );
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
    throw AppError.internal(
      "AI service endpoint is not accessible. Please contact your administrator.",
    );
  }

  throw AppError.internal(`AI provider error: ${msg}`);
}
