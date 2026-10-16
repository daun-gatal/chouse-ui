/**
 * Per-model token prices (ADR 0020 §4), entered by an admin on the AI model
 * form and stored in rbac_ai_models.pricing. All prices are USD per 1M tokens.
 * A model without a price is valid: its requests show tokens with no cost.
 */

import { z } from "zod";

export interface AiModelPricing {
  /** Uncached input tokens. */
  input: number;
  output: number;
  /** Cached input read; falls back to `input`. */
  cacheRead?: number;
  /** Cache creation; falls back to `input`. */
  cacheWrite?: number;
}

/** Largest accepted price, well above any real model, to catch unit mistakes (per-token vs per-1M is still the user's call). */
export const MAX_PRICE_PER_MILLION = 10_000;

const price = z.number().finite().min(0).max(MAX_PRICE_PER_MILLION);

export const aiModelPricingSchema = z.object({
  input: price,
  output: price,
  cacheRead: price.optional(),
  cacheWrite: price.optional(),
}).strict();
