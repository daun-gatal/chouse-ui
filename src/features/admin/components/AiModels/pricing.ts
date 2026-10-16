/**
 * The price fields of the AI model form (ADR 0020): USD per 1M tokens, held as
 * raw input strings until submit. All empty means no price.
 */

import type { AiModelPricing } from "@/api/rbac";

/** Mirrors the server's upper bound; anything above is almost certainly a unit mistake. */
export const MAX_PRICE_PER_MILLION = 10_000;

export interface PricingDraft {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export const EMPTY_PRICING_DRAFT: PricingDraft = { input: "", output: "", cacheRead: "", cacheWrite: "" };

export const PRICING_FIELDS: Array<{ key: keyof PricingDraft; label: string; placeholder: string; hint: string }> = [
  { key: "input", label: "Input", placeholder: "3.00", hint: "Uncached input tokens" },
  { key: "output", label: "Output", placeholder: "15.00", hint: "Includes reasoning tokens" },
  { key: "cacheRead", label: "Cached input", placeholder: "Same as input", hint: "Input served from cache" },
  { key: "cacheWrite", label: "Cache write", placeholder: "Same as input", hint: "Input written to cache" },
];

export function pricingDraftFrom(pricing: AiModelPricing | null | undefined): PricingDraft {
  if (!pricing) return { ...EMPTY_PRICING_DRAFT };
  return {
    input: String(pricing.input),
    output: String(pricing.output),
    cacheRead: pricing.cacheRead === undefined ? "" : String(pricing.cacheRead),
    cacheWrite: pricing.cacheWrite === undefined ? "" : String(pricing.cacheWrite),
  };
}

/** The price to save, null for no price, or an error to show. */
export function buildPricing(draft: PricingDraft): { pricing: AiModelPricing | null } | { error: string } {
  const values = Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, draft[f.key].trim()])) as Record<keyof PricingDraft, string>;
  if (Object.values(values).every((v) => v === "")) return { pricing: null };
  if (values.input === "" || values.output === "") return { error: "Enter both an input and an output price, or leave every price empty" };
  const parsed: Partial<Record<keyof PricingDraft, number>> = {};
  for (const field of PRICING_FIELDS) {
    const raw = values[field.key];
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { error: `${field.label} price must be a number of 0 or more` };
    if (n > MAX_PRICE_PER_MILLION) return { error: `${field.label} price is per 1M tokens; ${n} looks too high` };
    parsed[field.key] = n;
  }
  return {
    pricing: {
      input: parsed.input ?? 0,
      output: parsed.output ?? 0,
      ...(parsed.cacheRead !== undefined ? { cacheRead: parsed.cacheRead } : {}),
      ...(parsed.cacheWrite !== undefined ? { cacheWrite: parsed.cacheWrite } : {}),
    },
  };
}

/** "$3 / $15" for the models table, or null without a price. */
export function pricingSummary(pricing: AiModelPricing | null | undefined): string | null {
  if (!pricing) return null;
  const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, "")}`;
  return `${usd(pricing.input)} / ${usd(pricing.output)}`;
}
