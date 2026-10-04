/**
 * Schema preflight prompt (ADR 0016 §11). When the server refuses a DDL
 * statement that breaks dependents (409 SCHEMA_PREFLIGHT_BREAKS), the caller
 * asks here; the dialog shows the impact and resolves with the user's choice.
 * Not persisted: a prompt only lives while its request waits.
 */

import { create } from "zustand";

import type { ImpactItem } from "@/api/observe";

export interface PreflightImpact {
  breaking: boolean;
  items: ImpactItem[];
  notes: string[];
  saferPlan: string | null;
  hiddenDependents: number;
}

export interface PreflightPrompt {
  statement: string;
  impact: PreflightImpact;
  canOverride: boolean;
  message: string;
}

interface SchemaPreflightState {
  prompt: PreflightPrompt | null;
  resolver: ((confirmed: boolean) => void) | null;
  /** Shows the impact and resolves true only when an allowed user confirms. */
  ask: (prompt: PreflightPrompt) => Promise<boolean>;
  answer: (confirmed: boolean) => void;
}

export const useSchemaPreflightStore = create<SchemaPreflightState>((set, get) => ({
  prompt: null,
  resolver: null,
  ask: (prompt) => {
    // A newer prompt replaces an unanswered one; the older request is declined.
    get().resolver?.(false);
    return new Promise<boolean>((resolve) => set({ prompt, resolver: resolve }));
  },
  answer: (confirmed) => {
    const { resolver, prompt } = get();
    set({ prompt: null, resolver: null });
    resolver?.(confirmed && Boolean(prompt?.canOverride));
  },
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the 409 error `details` ({ impact, canOverride }) defensively. */
export function parsePreflightDetails(details: unknown): { impact: PreflightImpact; canOverride: boolean } | null {
  if (!isRecord(details) || !isRecord(details.impact)) return null;
  const impact = details.impact;
  const items = Array.isArray(impact.items) ? impact.items.filter((i): i is ImpactItem => isRecord(i) && typeof i.label === "string" && typeof i.severity === "string") : [];
  return {
    canOverride: details.canOverride === true,
    impact: {
      breaking: impact.breaking === true,
      items,
      notes: Array.isArray(impact.notes) ? impact.notes.filter((n): n is string => typeof n === "string") : [],
      saferPlan: typeof impact.saferPlan === "string" ? impact.saferPlan : null,
      hiddenDependents: typeof impact.hiddenDependents === "number" ? impact.hiddenDependents : 0,
    },
  };
}
