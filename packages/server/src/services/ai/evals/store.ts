/**
 * Agent eval cases and runs (ADR 0024 §Phase 6).
 *
 * A chat case is a conversation; a feature case is one feature input. Each
 * may list the tools the agent should call (in order) and a rubric for the
 * judge. A run scores one draft of the agent, identified by its draft hash.
 */

import { randomUUID } from "crypto";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";

export const EVAL_CASE_KINDS = ["chat", "feature"] as const;
export type EvalCaseKind = (typeof EVAL_CASE_KINDS)[number];
export const EVAL_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];
/** Cases per agent: enough for a regression suite, small enough to run on every save. */
export const MAX_CASES_PER_AGENT = 50;
/** A run still "running" after this long belonged to a server that stopped. */
export const STALE_EVAL_RUN_MS = 30 * 60_000;

export interface EvalCase {
  id: string;
  agentId: string;
  name: string;
  kind: EvalCaseKind;
  /** Feature cases: which feature's input `input` is. */
  featureId: string | null;
  /** Chat: `{ messages: [{ role, content }] }`. Feature: the feature's input object. */
  input: Record<string, unknown>;
  expectedTools: string[];
  rubric: string | null;
  /** Where it came from: written by hand, the test console, an AI request, or shipped with CHouse. */
  source: "manual" | "console" | "request" | "builtin";
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EvalCaseResult {
  caseId: string;
  name: string;
  passed: boolean;
  toolsOk: boolean | null;
  missingTools: string[];
  calledTools: string[];
  judge: { pass: boolean; reason: string } | null;
  /** The start of the answer, for the results table. */
  answer: string;
  error: string | null;
  durationMs: number;
}

export interface EvalRun {
  id: string;
  agentId: string;
  draftHash: string;
  status: EvalRunStatus;
  score: number | null;
  passed: number;
  total: number;
  results: EvalCaseResult[];
  /** Cases that passed in the agent's previous completed run and fail in this one. */
  regressions: Array<{ caseId: string; name: string }>;
  tokens: number;
  costUsd: number | null;
  error: string | null;
  createdBy: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function rowToCase(r: Row): EvalCase {
  const source = str(r.source);
  return {
    id: str(r.id),
    agentId: str(r.agent_id),
    name: str(r.name),
    kind: str(r.kind) === "feature" ? "feature" : "chat",
    featureId: strOrNull(r.feature_id),
    input: json<Record<string, unknown>>(r.input, {}),
    expectedTools: json<string[]>(r.expected_tools, []),
    rubric: strOrNull(r.rubric),
    source: source === "console" || source === "request" || source === "builtin" ? source : "manual",
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function rowToRun(r: Row): EvalRun {
  const status = str(r.status);
  const startedAt = num(r.started_at);
  const running = status === "running";
  const stale = running && Date.now() - startedAt > STALE_EVAL_RUN_MS;
  return {
    id: str(r.id),
    agentId: str(r.agent_id),
    draftHash: str(r.draft_hash),
    status: stale ? "failed" : (EVAL_RUN_STATUSES as readonly string[]).includes(status) ? (status as EvalRunStatus) : "failed",
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    passed: num(r.passed),
    total: num(r.total),
    results: json<EvalCaseResult[]>(r.results, []),
    regressions: json<Array<{ caseId: string; name: string }>>(r.regressions, []),
    tokens: num(r.tokens),
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    error: stale ? "The eval run stopped (the server restarted). Run it again." : strOrNull(r.error),
    createdBy: strOrNull(r.created_by),
    startedAt,
    finishedAt: numOrNull(r.finished_at),
  };
}

export interface EvalCaseInput {
  name: string;
  kind: EvalCaseKind;
  featureId: string | null;
  input: Record<string, unknown>;
  expectedTools: string[];
  rubric: string | null;
}

export async function listCases(agentId: string): Promise<EvalCase[]> {
  return (await all(sql`SELECT * FROM ai_eval_cases WHERE agent_id = ${agentId} ORDER BY created_at, id`)).map(rowToCase);
}

export async function getCase(id: string): Promise<EvalCase | null> {
  const row = await one(sql`SELECT * FROM ai_eval_cases WHERE id = ${id}`);
  return row ? rowToCase(row) : null;
}

export async function caseCount(agentId: string): Promise<number> {
  const row = await one(sql`SELECT COUNT(*) AS n FROM ai_eval_cases WHERE agent_id = ${agentId}`);
  return row ? num(row.n) : 0;
}

export async function createCase(agentId: string, input: EvalCaseInput, source: EvalCase["source"], actor: string | null): Promise<EvalCase> {
  const id = randomUUID();
  const now = Date.now();
  await run(sql`
    INSERT INTO ai_eval_cases (id, agent_id, name, kind, feature_id, input, expected_tools, rubric, source, created_by, created_at, updated_at)
    VALUES (${id}, ${agentId}, ${input.name}, ${input.kind}, ${input.featureId}, ${JSON.stringify(input.input)}, ${JSON.stringify(input.expectedTools)},
            ${input.rubric}, ${source}, ${actor}, ${now}, ${now})`);
  const created = await getCase(id);
  if (!created) throw new Error("The eval case was not saved");
  return created;
}

export async function updateCase(id: string, input: EvalCaseInput): Promise<EvalCase | null> {
  await run(sql`
    UPDATE ai_eval_cases SET name = ${input.name}, kind = ${input.kind}, feature_id = ${input.featureId}, input = ${JSON.stringify(input.input)},
      expected_tools = ${JSON.stringify(input.expectedTools)}, rubric = ${input.rubric}, updated_at = ${Date.now()}
    WHERE id = ${id}`);
  return getCase(id);
}

export async function deleteCase(id: string): Promise<void> {
  await run(sql`DELETE FROM ai_eval_cases WHERE id = ${id}`);
}

export async function createRun(agentId: string, draftHash: string, total: number, actor: string | null): Promise<EvalRun> {
  const id = randomUUID();
  await run(sql`
    INSERT INTO ai_eval_runs (id, agent_id, draft_hash, status, total, created_by, started_at)
    VALUES (${id}, ${agentId}, ${draftHash}, 'running', ${total}, ${actor}, ${Date.now()})`);
  const created = await getRun(id);
  if (!created) throw new Error("The eval run was not saved");
  return created;
}

export async function getRun(id: string): Promise<EvalRun | null> {
  const row = await one(sql`SELECT * FROM ai_eval_runs WHERE id = ${id}`);
  return row ? rowToRun(row) : null;
}

export async function finishRun(id: string, outcome: { status: "completed" | "failed"; results: EvalCaseResult[]; regressions: EvalRun["regressions"]; tokens: number; costUsd: number | null; error?: string | null }): Promise<EvalRun | null> {
  const passed = outcome.results.filter((r) => r.passed).length;
  const total = outcome.results.length;
  const score = total === 0 ? null : passed / total;
  await run(sql`
    UPDATE ai_eval_runs SET status = ${outcome.status}, score = ${score}, passed = ${passed}, total = ${total},
      results = ${JSON.stringify(outcome.results)}, regressions = ${JSON.stringify(outcome.regressions)}, tokens = ${outcome.tokens},
      cost_usd = ${outcome.costUsd}, error = ${outcome.error ?? null}, finished_at = ${Date.now()}
    WHERE id = ${id}`);
  return getRun(id);
}

export async function listRuns(agentId: string, limit = 20): Promise<EvalRun[]> {
  return (await all(sql`SELECT * FROM ai_eval_runs WHERE agent_id = ${agentId} ORDER BY started_at DESC LIMIT ${Math.min(100, Math.max(1, limit))}`)).map(rowToRun);
}

/** The newest completed run of the agent, optionally for one draft. */
export async function latestCompletedRun(agentId: string, draftHash?: string): Promise<EvalRun | null> {
  const row = await one(sql`
    SELECT * FROM ai_eval_runs WHERE agent_id = ${agentId} AND status = 'completed'
      ${draftHash ? sql`AND draft_hash = ${draftHash}` : sql``}
    ORDER BY started_at DESC LIMIT 1`);
  return row ? rowToRun(row) : null;
}
