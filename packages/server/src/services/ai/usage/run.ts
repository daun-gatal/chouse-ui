/**
 * One AI usage run (ADR 0020 §1): the LLM and tool steps of a single AI request,
 * the ClickHouse queries those tools ran, and the data each tool sent back to
 * the model. A run lives in an AsyncLocalStorage context for the whole engine
 * call, so model callbacks, the tool wrapper and the query layer all find it
 * without threading it through every signature.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "crypto";

import type { AiModelPricing } from "../../../rbac/constants/aiModelPricing";
import { jsonSize, type ObservedQuery, type QueryObserver } from "../../queryObserver";
import { costOf, ZERO_USAGE, type TokenUsage } from "./pricing";
import { tablesOf } from "./tables";

export type UsageSource = "chat" | "feature" | "background";
export type RunStatus = "ok" | "error" | "timeout";
/** `incomplete`: the call ended without reporting usage (aborted, timed out, or the provider sent none). */
export type StepStatus = "ok" | "error" | "duplicate" | "incomplete";

/** The model a step ran on, with what is needed to price it. */
export interface ModelRef {
  modelConfigId: string | null;
  providerType: string | null;
  modelId: string | null;
  pricing: AiModelPricing | null;
}

export interface StepQuery {
  queryId: string;
  connectionId: string | null;
  sql: string;
  elapsedMs: number;
  readRows: number;
  readBytes: number;
  resultRows: number;
  tables: string[];
  columns: string[];
  error?: string;
}

export interface EgressRecord {
  id: string;
  stepId: string;
  kind: "clickhouse" | "chouse";
  /** `db.table` (several joined with ", "), a CHouse tool title, or "query result" for a table-less query. */
  source: string;
  columns: string[];
  rows: number;
  bytes: number;
  connectionId: string | null;
  providerType: string | null;
  modelId: string | null;
}

/** A tool the model asked for in one LLM call; `agent` is the subagent a `task` hand-off goes to. */
export interface StepToolCall {
  tool: string;
  agent?: string;
}

export interface UsageStep {
  id: string;
  seq: number;
  kind: "llm" | "tool";
  agentPath: string | null;
  /** Model id for an LLM call, tool name for a tool call. */
  name: string;
  model: ModelRef | null;
  startedAt: number;
  durationMs: number;
  status: StepStatus;
  /** Whether the provider reported token usage for this call. */
  usageReported: boolean;
  usage: TokenUsage;
  costUsd: number | null;
  queries: StepQuery[];
  resultBytes: number;
  /** Tools an LLM call asked for; null when not known (a tool step, or a call that failed). */
  calls: StepToolCall[] | null;
  error?: string;
  ended: boolean;
}

export interface UsageRunMeta {
  featureId: string;
  source: UsageSource;
  userId: string | null;
  connectionId: string | null;
  /** The chat thread the request belongs to. */
  threadId?: string | null;
}

export interface UsageAgent {
  id: string;
  slug: string;
  name: string;
}

/** Where a tool's ClickHouse queries run unless the query says otherwise. */
export interface ToolContext {
  model: ModelRef | null;
  connectionId: string | null;
  defaultDatabase: string | null;
}

/** Steps keep at most this many queries in detail; totals still count every query. */
export const MAX_QUERIES_PER_STEP = 50;
const MAX_SQL_CHARS = 2_000;
const MAX_ERROR_CHARS = 300;
const MAX_COLUMNS = 100;

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "Failed";
  return text.slice(0, MAX_ERROR_CHARS);
}

export class UsageRun {
  readonly id = randomUUID();
  readonly startedAt: number;
  readonly meta: UsageRunMeta;
  readonly steps: UsageStep[] = [];
  readonly egress: EgressRecord[] = [];
  agent: UsageAgent | null = null;
  status: RunStatus = "ok";
  error: string | null = null;
  durationMs = 0;
  /** ClickHouse totals across every query, including those past MAX_QUERIES_PER_STEP. */
  chQueries = 0;
  chReadRows = 0;
  chReadBytes = 0;
  private queryCounter = 0;
  private finished = false;
  /** Agent slug → its path in the tree ("root › child"), so LLM steps know their depth. */
  private readonly agentPaths = new Map<string, string>();

  constructor(meta: UsageRunMeta, private readonly clock: () => number = Date.now) {
    this.meta = meta;
    this.startedAt = clock();
  }

  /** The first agent to claim the run is the one it is attributed to (a nested feature run keeps its caller's). */
  setAgent(agent: UsageAgent): void {
    if (!this.agent) this.agent = agent;
  }

  /** Remember where an agent sits in the tree; the first registration of a slug wins. */
  registerAgentPath(slug: string, path: string): void {
    if (!this.agentPaths.has(slug)) this.agentPaths.set(slug, path);
  }

  nextQueryId(): string {
    this.queryCounter += 1;
    return `chouse-ai-${this.id}-${this.queryCounter}`;
  }

  private newStep(kind: UsageStep["kind"], name: string, agentPath: string | null, model: ModelRef | null): UsageStep {
    const step: UsageStep = {
      id: randomUUID(),
      seq: this.steps.length,
      kind,
      agentPath,
      name,
      model,
      startedAt: this.clock(),
      durationMs: 0,
      status: "incomplete",
      usageReported: false,
      usage: { ...ZERO_USAGE },
      costUsd: null,
      queries: [],
      resultBytes: 0,
      calls: null,
      ended: false,
    };
    this.steps.push(step);
    return step;
  }

  private close(step: UsageStep): void {
    step.durationMs = Math.max(0, this.clock() - step.startedAt);
    step.ended = true;
  }

  beginLlm(model: ModelRef, agentName: string | null): UsageStep {
    const slug = agentName ?? this.agent?.slug ?? null;
    return this.newStep("llm", model.modelId ?? "model", slug === null ? null : this.agentPaths.get(slug) ?? slug, model);
  }

  endLlm(step: UsageStep, usage: TokenUsage | null, calls: StepToolCall[] = []): void {
    if (step.ended) return;
    this.close(step);
    step.calls = calls;
    if (!usage) return;
    step.usageReported = true;
    step.status = "ok";
    step.usage = usage;
    step.costUsd = costOf(usage, step.model?.pricing ?? null);
  }

  failLlm(step: UsageStep, error: unknown): void {
    if (step.ended) return;
    this.close(step);
    step.status = "error";
    step.error = errorText(error);
  }

  beginTool(name: string, agentPath: string | null, context: ToolContext): ToolStep {
    return new ToolStep(this, this.newStep("tool", name, agentPath, context.model), context);
  }

  /** @internal Called by ToolStep. */
  recordQuery(step: UsageStep, context: ToolContext, query: ObservedQuery): void {
    this.chQueries += 1;
    this.chReadRows += query.readRows;
    this.chReadBytes += query.readBytes;
    const connectionId = query.connectionId ?? context.connectionId;
    const tables = tablesOf(query.sql, context.defaultDatabase);
    if (step.queries.length < MAX_QUERIES_PER_STEP) {
      step.queries.push({
        queryId: query.queryId,
        connectionId,
        sql: query.sql.slice(0, MAX_SQL_CHARS),
        elapsedMs: query.elapsedMs,
        readRows: query.readRows,
        readBytes: query.readBytes,
        resultRows: query.resultRows,
        tables,
        columns: query.columns.slice(0, MAX_COLUMNS),
        ...(query.error ? { error: query.error.slice(0, MAX_ERROR_CHARS) } : {}),
      });
    }
    if (query.error || query.resultRows === 0) return;
    this.egress.push({
      id: randomUUID(),
      stepId: step.id,
      kind: "clickhouse",
      source: tables.length > 0 ? tables.join(", ") : "query result",
      columns: query.columns.slice(0, MAX_COLUMNS),
      rows: query.resultRows,
      bytes: query.resultBytes,
      connectionId,
      providerType: context.model?.providerType ?? null,
      modelId: context.model?.modelId ?? null,
    });
  }

  /** @internal Called by ToolStep. */
  recordChouseSource(step: UsageStep, context: ToolContext, label: string, data: unknown): void {
    // Management tools return an array, `{ rows, …meta }` (catalog `rowsOf`), or one record.
    const rows = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)
        ? (data as { rows: unknown[] }).rows
        : data === null || data === undefined ? [] : [data];
    if (rows.length === 0) return;
    const first = rows[0];
    const columns = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).slice(0, MAX_COLUMNS) : [];
    this.egress.push({
      id: randomUUID(),
      stepId: step.id,
      kind: "chouse",
      source: label,
      columns,
      rows: rows.length,
      bytes: jsonSize(data),
      connectionId: null,
      providerType: context.model?.providerType ?? null,
      modelId: context.model?.modelId ?? null,
    });
  }

  /** @internal Called by ToolStep. */
  endTool(step: UsageStep, outcome: { result?: unknown; duplicate?: boolean; error?: unknown }): void {
    if (step.ended) return;
    this.close(step);
    if (outcome.error !== undefined) {
      step.status = "error";
      step.error = errorText(outcome.error);
      return;
    }
    step.status = outcome.duplicate ? "duplicate" : "ok";
    step.usageReported = true;
    step.resultBytes = jsonSize(outcome.result);
  }

  /** Close the run. Steps still open (an aborted call) end as incomplete. Idempotent. */
  finish(status: RunStatus, error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.status = status;
    if (status !== "ok" && error !== undefined) this.error = errorText(error);
    for (const step of this.steps) if (!step.ended) this.close(step);
    this.durationMs = Math.max(0, this.clock() - this.startedAt);
  }
}

/** A tool call in progress: the query observer its ClickHouse queries report to. */
export class ToolStep {
  readonly observer: QueryObserver;

  constructor(private readonly run: UsageRun, readonly step: UsageStep, private readonly context: ToolContext) {
    this.observer = {
      nextQueryId: () => run.nextQueryId(),
      logTags: () => ({ ai_request_id: run.id }),
      onQuery: (query) => run.recordQuery(step, context, query),
    };
  }

  addChouseSource(label: string, data: unknown): void {
    this.run.recordChouseSource(this.step, this.context, label, data);
  }

  end(outcome: { result?: unknown; duplicate?: boolean; error?: unknown }): void {
    this.run.endTool(this.step, outcome);
  }
}

const runStorage = new AsyncLocalStorage<UsageRun>();
const toolStorage = new AsyncLocalStorage<ToolStep>();

export function currentUsageRun(): UsageRun | undefined {
  return runStorage.getStore();
}

export function currentToolStep(): ToolStep | undefined {
  return toolStorage.getStore();
}

export function runInToolStep<T>(step: ToolStep, fn: () => Promise<T>): Promise<T> {
  return toolStorage.run(step, fn);
}

/** Record CHouse records a management tool is about to return to the model. */
export function recordChouseSource(label: string, data: unknown): void {
  currentToolStep()?.addChouseSource(label, data);
}

/** A timeout or abort, as opposed to a failure. */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /\b(timed out|timeout|aborted)\b/i.test(error.message);
}

export type RunFinisher = (run: UsageRun) => void;

/**
 * Run `fn` inside a usage run. A call made while a run is already active (a
 * feature tool inside the chat) joins it, so its tokens count once, under the
 * request that caused them. `onFinish` receives the closed run (persistence).
 */
export async function withUsageRun<T>(meta: UsageRunMeta, onFinish: RunFinisher, fn: (run: UsageRun) => Promise<T>): Promise<T> {
  const active = runStorage.getStore();
  if (active) return fn(active);
  const run = new UsageRun(meta);
  try {
    const result = await runStorage.run(run, () => fn(run));
    run.finish("ok");
    return result;
  } catch (error) {
    run.finish(isTimeoutError(error) ? "timeout" : "error", error);
    throw error;
  } finally {
    onFinish(run);
  }
}
