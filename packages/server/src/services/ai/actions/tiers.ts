/**
 * Effective tier of one call (ADR 0025 §1): the tool's base tier, bumped one
 * step on a production connection. Computed in one place so chat, MCP and the
 * CLI can never disagree on how a call is checked.
 */

import { getConnectionById } from "../../../rbac/services/connections";
import type { ActionContext, ActionDefinition, Tier } from "./types";

export const CONNECTION_ENVIRONMENTS = ["production", "staging", "development"] as const;
export type ConnectionEnvironment = (typeof CONNECTION_ENVIRONMENTS)[number];

/** The environment an admin set on the connection (stored in its metadata), or null when unset. */
export function environmentOf(metadata: Record<string, unknown> | null | undefined): ConnectionEnvironment | null {
  const value = metadata?.environment;
  return typeof value === "string" && (CONNECTION_ENVIRONMENTS as readonly string[]).includes(value) ? (value as ConnectionEnvironment) : null;
}

export async function connectionEnvironment(connectionId: string | null): Promise<ConnectionEnvironment | null> {
  if (!connectionId) return null;
  const connection = await getConnectionById(connectionId);
  return environmentOf(connection?.metadata);
}

export function bumpTier(tier: Tier): Tier {
  return tier === "t1" ? "t2" : "t3";
}

const RANK: Record<Tier, number> = { t1: 1, t2: 2, t3: 3 };

export function highestTier(tiers: Iterable<Tier>): Tier | null {
  let best: Tier | null = null;
  for (const tier of tiers) if (!best || RANK[tier] > RANK[best]) best = tier;
  return best;
}

export async function baseTier(definition: ActionDefinition, args: Record<string, unknown>, ctx: ActionContext): Promise<Tier> {
  return typeof definition.tier === "function" ? definition.tier(args, ctx) : definition.tier;
}

export interface ResolvedTier {
  tier: Tier;
  base: Tier;
  /** True when the production bump raised it. */
  production: boolean;
}

export async function resolveTier(definition: ActionDefinition, args: Record<string, unknown>, ctx: ActionContext): Promise<ResolvedTier> {
  const base = await baseTier(definition, args, ctx);
  const production = definition.connectionScoped && (await connectionEnvironment(ctx.connectionId)) === "production";
  return { tier: production ? bumpTier(base) : base, base, production };
}
