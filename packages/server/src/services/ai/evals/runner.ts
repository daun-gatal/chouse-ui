/**
 * Running an agent's evals (ADR 0024 §Phase 6). Every case runs against one
 * draft of the agent through the same paths as the test console, with write
 * tools simulated. A case passes when it ran, called the expected tools in
 * order and met its rubric; the run's score is the share of cases passed.
 * Runs go on in the background; the caller polls the run.
 */

import { logger } from "../../../utils/logger";
import { AppError } from "../../../types";
import { getCapability } from "../capabilities";
import { invokeChat, isStructured, runStructuredCapability } from "../engine";
import type { RegistrySnapshot } from "../registry/types";
import type { AgentMessage, AgentRunContext } from "../types";
import { currentCaller, persistUsageRun, withUsageRun } from "../usage";
import { judgeAnswer } from "./judge";
import { casePassed, matchToolSequence } from "./scoring";
import { createRun, finishRun, latestCompletedRun, listCases, type EvalCase, type EvalCaseResult, type EvalRun } from "./store";

/** Characters of each answer kept with the results. */
const ANSWER_PREVIEW = 600;

export interface EvalRunRequest {
  /** The stored agent the cases belong to; the snapshot holds the draft under this id. */
  agentId: string;
  draftHash: string;
  snapshot: RegistrySnapshot;
  ctx: AgentRunContext;
  /** Model for the agent's runs and the judge; the default when absent. */
  modelId?: string;
  actor: string;
}

function chatMessages(input: Record<string, unknown>): AgentMessage[] {
  const raw = Array.isArray(input.messages) ? input.messages : [];
  return raw
    .filter((m): m is { role: string; content: string } => Boolean(m) && typeof (m as { content?: unknown }).content === "string")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
}

async function runCase(test: EvalCase, request: EvalRunRequest, spend: (tokens: number, costUsd: number | null) => void): Promise<EvalCaseResult> {
  const startedAt = Date.now();
  const base = { caseId: test.id, name: test.name };
  const ctx: AgentRunContext = { ...request.ctx, actionMode: "simulate", ...(request.modelId ? { modelId: request.modelId } : {}) };
  const onUsage = (u: { tokens: number; costUsd: number | null }): void => spend(u.tokens, u.costUsd);
  try {
    let answer: string;
    let called: string[];
    let asked: string;
    if (test.kind === "chat") {
      const messages = chatMessages(test.input);
      if (messages.length === 0) throw new Error("This case has no message to send");
      const result = await invokeChat(ctx, messages, { agentId: request.agentId, snapshot: request.snapshot, onUsage });
      answer = result.content;
      called = result.toolCalls.map((c) => c.name);
      asked = String(messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
    } else {
      const cap = test.featureId ? getCapability(test.featureId) : undefined;
      if (!cap || !isStructured(cap)) throw new Error(`'${test.featureId ?? "(none)"}' is not a feature this case can run`);
      let traced: string[] = [];
      const output = await runStructuredCapability(cap, cap.inputSchema.parse(test.input), ctx, {
        snapshot: request.snapshot,
        agentId: request.agentId,
        onUsage,
        onTrace: (trace) => { traced = trace.calls.map((c) => c.name); },
      });
      answer = JSON.stringify(output);
      called = traced;
      asked = JSON.stringify(test.input);
    }
    const tools = test.expectedTools.length > 0 ? matchToolSequence(test.expectedTools, called) : null;
    let judge: { pass: boolean; reason: string } | null = null;
    if (test.rubric) {
      // The judge's calls are AI usage too: recorded under the evals feature.
      const verdict = await withUsageRun(
        { featureId: "evals", source: "feature", userId: ctx.userId ?? null, connectionId: ctx.connectionId ?? null, caller: currentCaller() },
        persistUsageRun,
        () => judgeAnswer(request.modelId, test.rubric ?? "", asked, answer),
      );
      spend(verdict.tokens, null);
      judge = { pass: verdict.pass, reason: verdict.reason };
    }
    const outcome = { toolsOk: tools ? tools.ok : null, judgePass: judge ? judge.pass : null, error: null };
    return {
      ...base, passed: casePassed(outcome), toolsOk: outcome.toolsOk, missingTools: tools?.missing ?? [], calledTools: called,
      judge, answer: answer.slice(0, ANSWER_PREVIEW), error: null, durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The case failed to run";
    return { ...base, passed: false, toolsOk: null, missingTools: [], calledTools: [], judge: null, answer: "", error: message, durationMs: Date.now() - startedAt };
  }
}

async function execute(run: EvalRun, cases: EvalCase[], previous: EvalRun | null, request: EvalRunRequest): Promise<void> {
  let tokens = 0;
  let costUsd: number | null = null;
  const spend = (t: number, c: number | null): void => {
    tokens += t;
    if (c !== null) costUsd = (costUsd ?? 0) + c;
  };
  const results: EvalCaseResult[] = [];
  try {
    for (const test of cases) results.push(await runCase(test, request, spend));
    const passedBefore = new Set((previous?.results ?? []).filter((r) => r.passed).map((r) => r.caseId));
    const regressions = results.filter((r) => !r.passed && passedBefore.has(r.caseId)).map((r) => ({ caseId: r.caseId, name: r.name }));
    await finishRun(run.id, { status: "completed", results, regressions, tokens, costUsd });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The eval run failed";
    logger.warn({ module: "AiEvals", runId: run.id, err: message }, "Eval run failed");
    await finishRun(run.id, { status: "failed", results, regressions: [], tokens, costUsd, error: message });
  }
}

/** Start scoring a draft. Resolves once the run is recorded; the cases run in the background. */
export async function startEvalRun(request: EvalRunRequest): Promise<{ run: EvalRun; done: Promise<void> }> {
  const cases = await listCases(request.agentId);
  if (cases.length === 0) throw AppError.badRequest("Add a test case before running evals.");
  const previous = await latestCompletedRun(request.agentId);
  const run = await createRun(request.agentId, request.draftHash, cases.length, request.actor);
  const done = execute(run, cases, previous, request);
  return { run, done };
}

export interface EvalGate {
  /** Whether this save needs a passing run: a threshold is set and the agent has cases. */
  required: boolean;
  threshold: number | null;
  cases: number;
  /** The newest completed run of this exact draft. */
  run: EvalRun | null;
  passing: boolean;
}

/**
 * Whether a draft may be saved. With a threshold and at least one case, the
 * newest completed run of this exact draft must cover every current case and
 * score at least the threshold.
 */
export async function evalGate(agentId: string, draftHash: string, threshold: number | null): Promise<EvalGate> {
  const cases = await listCases(agentId);
  const run = await latestCompletedRun(agentId, draftHash);
  const required = threshold !== null && cases.length > 0;
  const covered = run !== null && cases.every((c) => run.results.some((r) => r.caseId === c.id));
  const passing = !required || (covered && run !== null && run.score !== null && run.score >= (threshold ?? 0));
  return { required, threshold, cases: cases.length, run, passing };
}
