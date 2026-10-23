/**
 * AI budgets (ADR 0024 §Phase 1, D5): token and cost caps per feature and per
 * user, checked before a run starts. Spend is read from ai_usage_requests
 * (ADR 0020), so a budget counts every request already recorded in its period.
 *
 * A run is checked against every enabled budget that applies to it. A budget
 * set to `stop` fails the run with an error naming the budget and when it
 * resets; one set to `fallback` runs it on the budget's fallback model. When
 * several budgets are exhausted, `stop` wins.
 */

import { randomUUID } from "crypto";
import { z } from "zod";

import { AppError } from "../../types";
import { all, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../observe/db";

export const BUDGET_PERIODS = ["day", "month"] as const;
export const BUDGET_SCOPES = ["all", "each_user", "user"] as const;
export const BUDGET_ACTIONS = ["stop", "fallback"] as const;

export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];
export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export type BudgetAction = (typeof BUDGET_ACTIONS)[number];

export interface Budget {
  id: string;
  name: string;
  /** Feature the budget caps; null = every AI feature. */
  featureId: string | null;
  /** `all`: everyone together; `each_user`: every user separately; `user`: one user. */
  appliesTo: BudgetScope;
  userId: string | null;
  period: BudgetPeriod;
  limitTokens: number | null;
  limitCostUsd: number | null;
  onExhaust: BudgetAction;
  fallbackModelConfigId: string | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export const budgetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  featureId: z.string().trim().min(1).max(100).nullable(),
  appliesTo: z.enum(BUDGET_SCOPES),
  userId: z.string().min(1).nullable(),
  period: z.enum(BUDGET_PERIODS),
  limitTokens: z.number().int().positive().max(1e12).nullable(),
  limitCostUsd: z.number().positive().max(1e7).nullable(),
  onExhaust: z.enum(BUDGET_ACTIONS),
  fallbackModelConfigId: z.string().min(1).nullable(),
  enabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.limitTokens === null && value.limitCostUsd === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitTokens"], message: "Set a token limit, a cost limit or both" });
  }
  if (value.appliesTo === "user" && !value.userId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "Pick the user this budget applies to" });
  if (value.appliesTo !== "user" && value.userId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "Only a single-user budget names a user" });
  if (value.onExhaust === "fallback" && !value.fallbackModelConfigId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fallbackModelConfigId"], message: "Pick the model to switch to when the budget runs out" });
  }
});

export type BudgetInput = z.infer<typeof budgetInputSchema>;

function rowToBudget(r: Row): Budget {
  const scope = str(r.applies_to);
  const period = str(r.period);
  return {
    id: str(r.id),
    name: str(r.name),
    featureId: strOrNull(r.feature_id),
    appliesTo: (BUDGET_SCOPES as readonly string[]).includes(scope) ? (scope as BudgetScope) : "all",
    userId: strOrNull(r.user_id),
    period: period === "month" ? "month" : "day",
    limitTokens: numOrNull(r.limit_tokens),
    limitCostUsd: numOrNull(r.limit_cost_usd),
    onExhaust: str(r.on_exhaust) === "fallback" ? "fallback" : "stop",
    fallbackModelConfigId: strOrNull(r.fallback_model_config_id),
    enabled: num(r.enabled) === 1,
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export async function listBudgets(): Promise<Budget[]> {
  return (await all(sql`SELECT * FROM ai_budgets ORDER BY name`)).map(rowToBudget);
}

export async function getBudget(id: string): Promise<Budget | null> {
  const row = await one(sql`SELECT * FROM ai_budgets WHERE id = ${id}`);
  return row ? rowToBudget(row) : null;
}

export async function createBudget(input: BudgetInput, actor: string | null): Promise<Budget> {
  const id = randomUUID();
  const now = Date.now();
  await run(sql`
    INSERT INTO ai_budgets (id, name, feature_id, applies_to, user_id, period, limit_tokens, limit_cost_usd, on_exhaust, fallback_model_config_id, enabled, created_by, created_at, updated_at)
    VALUES (${id}, ${input.name}, ${input.featureId}, ${input.appliesTo}, ${input.userId}, ${input.period}, ${input.limitTokens}, ${input.limitCostUsd},
      ${input.onExhaust}, ${input.onExhaust === "fallback" ? input.fallbackModelConfigId : null}, ${input.enabled ? 1 : 0}, ${actor}, ${now}, ${now})`);
  const created = await getBudget(id);
  if (!created) throw AppError.internal("Budget was not saved");
  return created;
}

export async function updateBudget(id: string, input: BudgetInput): Promise<Budget> {
  if (!(await getBudget(id))) throw AppError.notFound("Budget not found");
  await run(sql`
    UPDATE ai_budgets SET name = ${input.name}, feature_id = ${input.featureId}, applies_to = ${input.appliesTo}, user_id = ${input.userId},
      period = ${input.period}, limit_tokens = ${input.limitTokens}, limit_cost_usd = ${input.limitCostUsd}, on_exhaust = ${input.onExhaust},
      fallback_model_config_id = ${input.onExhaust === "fallback" ? input.fallbackModelConfigId : null}, enabled = ${input.enabled ? 1 : 0}, updated_at = ${Date.now()}
    WHERE id = ${id}`);
  const updated = await getBudget(id);
  if (!updated) throw AppError.notFound("Budget not found");
  return updated;
}

export async function deleteBudget(id: string): Promise<void> {
  if (!(await getBudget(id))) throw AppError.notFound("Budget not found");
  await run(sql`DELETE FROM ai_budgets WHERE id = ${id}`);
}

/** Start of the budget's current period and when it resets (UTC). */
export function periodWindow(period: BudgetPeriod, now: number = Date.now()): { start: number; resetsAt: number } {
  const d = new Date(now);
  if (period === "day") {
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { start, resetsAt: start + 86_400_000 };
  }
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), resetsAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

export interface Spend {
  tokens: number;
  costUsd: number;
}

/** What a budget has spent this period; `each_user` budgets need the user whose share is asked. */
export async function budgetSpend(budget: Budget, userId: string | null, now: number = Date.now()): Promise<Spend> {
  const { start } = periodWindow(budget.period, now);
  const conditions = [sql`started_at >= ${start}`];
  if (budget.featureId) conditions.push(sql`feature_id = ${budget.featureId}`);
  if (budget.appliesTo === "user") conditions.push(sql`user_id = ${budget.userId}`);
  if (budget.appliesTo === "each_user") conditions.push(userId ? sql`user_id = ${userId}` : sql`1 = 0`);
  const row = await one(sql`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost
    FROM ai_usage_requests WHERE ${sql.join(conditions, sql` AND `)}`);
  return { tokens: num(row?.tokens), costUsd: num(row?.cost) };
}

/** How much of the budget a spend uses (1 = all of it), by whichever limit is closer. */
export function usedShare(budget: Budget, spend: Spend): number {
  const tokens = budget.limitTokens ? spend.tokens / budget.limitTokens : 0;
  const cost = budget.limitCostUsd ? spend.costUsd / budget.limitCostUsd : 0;
  return Math.max(tokens, cost);
}

export function isExhausted(budget: Budget, spend: Spend): boolean {
  if (budget.limitTokens !== null && spend.tokens >= budget.limitTokens) return true;
  return budget.limitCostUsd !== null && spend.costUsd >= budget.limitCostUsd;
}

function applies(budget: Budget, featureId: string, userId: string | null): boolean {
  if (!budget.enabled) return false;
  if (budget.featureId && budget.featureId !== featureId) return false;
  if (budget.appliesTo === "user") return userId !== null && budget.userId === userId;
  if (budget.appliesTo === "each_user") return userId !== null;
  return true;
}

export interface BudgetDecision {
  /** Model the run must use instead of its own; null = no budget is exhausted. */
  fallbackModelConfigId: string | null;
  /** The exhausted budget that switched the model, for the run's record. */
  budget: Budget | null;
}

function resetLabel(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/**
 * Check every budget that applies to this run. Throws (429) when an exhausted
 * budget stops runs; returns the fallback model when one switches them.
 */
export async function checkBudgets(featureId: string, userId: string | null, now: number = Date.now()): Promise<BudgetDecision> {
  const budgets = (await listBudgets()).filter((b) => applies(b, featureId, userId));
  let fallback: Budget | null = null;
  for (const budget of budgets) {
    if (!isExhausted(budget, await budgetSpend(budget, userId, now))) continue;
    if (budget.onExhaust === "stop" || !budget.fallbackModelConfigId) {
      const { resetsAt } = periodWindow(budget.period, now);
      throw new AppError(`The AI budget '${budget.name}' is used up for this ${budget.period}. It resets at ${resetLabel(resetsAt)}.`, "AI_BUDGET_EXHAUSTED", "validation", 429);
    }
    fallback ??= budget;
  }
  return { fallbackModelConfigId: fallback?.fallbackModelConfigId ?? null, budget: fallback };
}

export interface BudgetStatus extends Budget {
  spend: Spend;
  /** For `each_user` budgets: how many users have used theirs up this period. */
  exhaustedUsers: number;
  exhausted: boolean;
  resetsAt: number;
}

/** Budgets with this period's spend, for AI Usage › Budgets. `each_user` spend is the highest single user's. */
export async function budgetStatuses(now: number = Date.now()): Promise<BudgetStatus[]> {
  const out: BudgetStatus[] = [];
  for (const budget of await listBudgets()) {
    const { start, resetsAt } = periodWindow(budget.period, now);
    if (budget.appliesTo !== "each_user") {
      const spend = await budgetSpend(budget, null, now);
      out.push({ ...budget, spend, exhausted: isExhausted(budget, spend), exhaustedUsers: 0, resetsAt });
      continue;
    }
    const rows = await all(sql`
      SELECT user_id, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost
      FROM ai_usage_requests WHERE started_at >= ${start} AND user_id IS NOT NULL
      ${budget.featureId ? sql`AND feature_id = ${budget.featureId}` : sql``}
      GROUP BY user_id`);
    const spends = rows.map((r) => ({ tokens: num(r.tokens), costUsd: num(r.cost) }));
    const top = spends.reduce<Spend>((max, s) => (usedShare(budget, s) > usedShare(budget, max) ? s : max), { tokens: 0, costUsd: 0 });
    const exhaustedUsers = spends.filter((s) => isExhausted(budget, s)).length;
    out.push({ ...budget, spend: top, exhausted: exhaustedUsers > 0, exhaustedUsers, resetsAt });
  }
  return out;
}
