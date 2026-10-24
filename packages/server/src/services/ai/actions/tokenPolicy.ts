/**
 * Write policy for MCP and CLI tokens (ADR 0025 §4): which toolkits a
 * personal access token gets as write tools and how each tier is handled.
 * An administrator's ceiling (AI Governance › MCP) bounds every token.
 */

import { z } from "zod";

import { json, one, run, sql, str } from "../../observe/db";
import { isToolkit, TOOLKITS, type Tier, type Toolkit } from "./types";

export const LOW_TIER_HANDLING = ["auto", "confirm", "off"] as const;
export const T3_HANDLING = ["approver", "off"] as const;
export type LowTierHandling = (typeof LOW_TIER_HANDLING)[number];
export type T3Handling = (typeof T3_HANDLING)[number];
export type Handling = LowTierHandling | T3Handling;

export const tokenPolicySchema = z.object({
  toolkits: z.array(z.enum(TOOLKITS)).max(TOOLKITS.length),
  t1: z.enum(LOW_TIER_HANDLING),
  t2: z.enum(LOW_TIER_HANDLING),
  t3: z.enum(T3_HANDLING),
});
export type TokenPolicy = z.infer<typeof tokenPolicySchema>;

/** A token nobody configured: Data & Query; T1 runs, T2 asks, T3 needs a second approver. */
export const DEFAULT_TOKEN_POLICY: TokenPolicy = { toolkits: ["data"], t1: "auto", t2: "confirm", t3: "approver" };

/** The administrator's bound on every token (AI Governance › MCP). */
export interface WriteCeiling {
  toolkits: Toolkit[];
  maxTier: Tier;
}

const RANK: Record<Tier, number> = { t1: 1, t2: 2, t3: 3 };

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function getTokenPolicy(patId: string | null | undefined): Promise<TokenPolicy> {
  if (!patId) return DEFAULT_TOKEN_POLICY;
  const row = await one(sql`SELECT toolkits, t1, t2, t3 FROM mcp_token_policies WHERE pat_id = ${patId}`);
  if (!row) return DEFAULT_TOKEN_POLICY;
  return {
    toolkits: json<unknown[]>(row.toolkits, []).filter(isToolkit),
    t1: pick(str(row.t1), LOW_TIER_HANDLING, "auto"),
    t2: pick(str(row.t2), LOW_TIER_HANDLING, "confirm"),
    t3: pick(str(row.t3), T3_HANDLING, "approver"),
  };
}

export async function saveTokenPolicy(patId: string, policy: TokenPolicy): Promise<void> {
  const now = Date.now();
  const toolkits = JSON.stringify([...new Set(policy.toolkits)]);
  await run(sql`
    INSERT INTO mcp_token_policies (pat_id, toolkits, t1, t2, t3, updated_at)
    VALUES (${patId}, ${toolkits}, ${policy.t1}, ${policy.t2}, ${policy.t3}, ${now})
    ON CONFLICT (pat_id) DO UPDATE SET toolkits = ${toolkits}, t1 = ${policy.t1}, t2 = ${policy.t2}, t3 = ${policy.t3}, updated_at = ${now}`);
}

/** Whether a toolkit's write tools reach this token at all. */
export function toolkitAllowed(toolkit: Toolkit, policy: TokenPolicy, ceiling: WriteCeiling): boolean {
  return ceiling.toolkits.includes(toolkit) && policy.toolkits.includes(toolkit);
}

/** How a call of this tier is handled for the token: the token's choice, or off above the ceiling. */
export function handlingFor(tier: Tier, policy: TokenPolicy, ceiling: WriteCeiling): Handling {
  if (RANK[tier] > RANK[ceiling.maxTier]) return "off";
  return tier === "t1" ? policy.t1 : tier === "t2" ? policy.t2 : policy.t3;
}
