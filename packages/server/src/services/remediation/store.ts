/**
 * Persistence for remediation actions, approvals, executions and the
 * per-connection remediation credential (ADR 0016 §8).
 */

import { randomUUID } from "crypto";

import { decryptPassword, encryptPassword } from "../../rbac/services/connections";
import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../observe/db";
import type { ActionParams, ActionType, PriorState, VerificationSpec } from "./catalog";

export const ACTION_STATUSES = [
  "proposed",
  "approved",
  "executing",
  "executed",
  "verified",
  "failed_verification",
  "failed",
  "rolled_back",
  "rejected",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ProposedSource = "user" | "ai" | "mcp" | "doctor";
export type ApprovalChannel = "ui" | "slack" | "cli";

export interface StoredActionParams {
  params: ActionParams;
  prior: PriorState;
  /** For delay_scheduled_job: when the worker resumes the job. */
  resumeAt?: number;
}

export interface RemediationAction {
  id: string;
  connectionId: string;
  type: ActionType;
  params: ActionParams;
  prior: PriorState;
  resumeAt: number | null;
  approvalClass: 1 | 2;
  status: ActionStatus;
  title: string;
  rationale: string | null;
  proposedBy: string | null;
  proposedSource: ProposedSource;
  incidentSource: string | null;
  incidentId: string | null;
  notebookId: string | null;
  previewSql: string;
  rollbackSql: string | null;
  verification: VerificationSpec;
  windowOnly: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Approval {
  id: string;
  actionId: string;
  approverId: string;
  channel: ApprovalChannel;
  decision: "approve" | "reject";
  comment: string | null;
  createdAt: number;
}

export interface Execution {
  id: string;
  actionId: string;
  status: "running" | "succeeded" | "failed" | "rolled_back";
  executedSql: string | null;
  error: string | null;
  verificationResult: { ok: boolean; value: number | null; checkedAt: number; message: string } | null;
  startedAt: number;
  finishedAt: number | null;
  verifiedAt: number | null;
  rolledBackAt: number | null;
}

function actionRow(row: Row): RemediationAction {
  const stored = json<StoredActionParams>(row.params, { params: { type: "kill_query", queryId: "" }, prior: {} });
  return {
    id: str(row.id),
    connectionId: str(row.connection_id),
    type: str(row.action_type) as ActionType,
    params: stored.params,
    prior: stored.prior ?? {},
    resumeAt: stored.resumeAt ?? null,
    approvalClass: num(row.approval_class) === 2 ? 2 : 1,
    status: str(row.status) as ActionStatus,
    title: str(row.title),
    rationale: strOrNull(row.rationale),
    proposedBy: strOrNull(row.proposed_by),
    proposedSource: (str(row.proposed_source) || "user") as ProposedSource,
    incidentSource: strOrNull(row.incident_source),
    incidentId: strOrNull(row.incident_id),
    notebookId: strOrNull(row.notebook_id),
    previewSql: str(row.preview_sql),
    rollbackSql: strOrNull(row.rollback_sql),
    verification: json<VerificationSpec>(row.verification, { description: "", sql: null, comparator: "eq", threshold: 0, withinSeconds: 0 }),
    windowOnly: num(row.window_only) === 1,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export interface CreateActionInput {
  connectionId: string;
  params: ActionParams;
  prior: PriorState;
  title: string;
  rationale: string | null;
  proposedBy: string | null;
  proposedSource: ProposedSource;
  incidentSource: string | null;
  incidentId: string | null;
  notebookId: string | null;
  previewSql: string;
  rollbackSql: string | null;
  verification: VerificationSpec;
  approvalClass: 1 | 2;
  windowOnly: boolean;
}

export async function createAction(input: CreateActionInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const stored: StoredActionParams = { params: input.params, prior: input.prior };
  await run(sql`
    INSERT INTO remediation_actions (
      id, connection_id, action_type, params, approval_class, status, title, rationale,
      proposed_by, proposed_source, incident_source, incident_id, notebook_id,
      preview_sql, rollback_sql, verification, window_only, created_at, updated_at
    ) VALUES (
      ${id}, ${input.connectionId}, ${input.params.type}, ${JSON.stringify(stored)}, ${input.approvalClass}, 'proposed',
      ${input.title}, ${input.rationale}, ${input.proposedBy}, ${input.proposedSource}, ${input.incidentSource},
      ${input.incidentId}, ${input.notebookId}, ${input.previewSql}, ${input.rollbackSql},
      ${JSON.stringify(input.verification)}, ${input.windowOnly ? 1 : 0}, ${now}, ${now}
    )
  `);
  return id;
}

export async function getAction(id: string): Promise<RemediationAction | null> {
  const row = await one(sql`SELECT * FROM remediation_actions WHERE id = ${id}`);
  return row ? actionRow(row) : null;
}

export interface ActionFilter {
  status?: ActionStatus[];
  connectionId?: string;
  incidentId?: string;
  notebookId?: string;
  limit?: number;
}

export async function listActions(filter: ActionFilter = {}): Promise<RemediationAction[]> {
  const conditions = [sql`1 = 1`];
  if (filter.connectionId) conditions.push(sql`connection_id = ${filter.connectionId}`);
  if (filter.incidentId) conditions.push(sql`incident_id = ${filter.incidentId}`);
  if (filter.notebookId) conditions.push(sql`notebook_id = ${filter.notebookId}`);
  if (filter.status && filter.status.length > 0) {
    conditions.push(sql`status IN (${sql.join(filter.status.map((s) => sql`${s}`), sql`, `)})`);
  }
  const rows = await all(sql`
    SELECT * FROM remediation_actions WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY updated_at DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}
  `);
  return rows.map(actionRow);
}

/** Compare-and-set the status so concurrent workers or approvers cannot double-transition. */
export async function transitionStatus(id: string, from: ActionStatus[], to: ActionStatus): Promise<boolean> {
  // RETURNING tells us whether *this* call won the transition (SQLite ≥ 3.35, PostgreSQL).
  const rows = await all(sql`
    UPDATE remediation_actions SET status = ${to}, updated_at = ${Date.now()}
    WHERE id = ${id} AND status IN (${sql.join(from.map((s) => sql`${s}`), sql`, `)})
    RETURNING id
  `);
  return rows.length > 0;
}

export async function setStoredParams(id: string, stored: StoredActionParams): Promise<void> {
  await run(sql`UPDATE remediation_actions SET params = ${JSON.stringify(stored)}, updated_at = ${Date.now()} WHERE id = ${id}`);
}

export async function addApproval(actionId: string, approverId: string, channel: ApprovalChannel, decision: "approve" | "reject", comment: string | null): Promise<void> {
  await run(sql`
    INSERT INTO remediation_approvals (id, action_id, approver_id, channel, decision, comment, created_at)
    VALUES (${randomUUID()}, ${actionId}, ${approverId}, ${channel}, ${decision}, ${comment}, ${Date.now()})
    ON CONFLICT (action_id, approver_id) DO NOTHING
  `);
}

export async function listApprovals(actionId: string): Promise<Approval[]> {
  const rows = await all(sql`SELECT * FROM remediation_approvals WHERE action_id = ${actionId} ORDER BY created_at`);
  return rows.map((row) => ({
    id: str(row.id),
    actionId: str(row.action_id),
    approverId: str(row.approver_id),
    channel: str(row.channel) as ApprovalChannel,
    decision: str(row.decision) === "reject" ? "reject" : "approve",
    comment: strOrNull(row.comment),
    createdAt: num(row.created_at),
  }));
}

function executionRow(row: Row): Execution {
  return {
    id: str(row.id),
    actionId: str(row.action_id),
    status: str(row.status) as Execution["status"],
    executedSql: strOrNull(row.executed_sql),
    error: strOrNull(row.error),
    verificationResult: json<Execution["verificationResult"]>(row.verification_result, null),
    startedAt: num(row.started_at),
    finishedAt: numOrNull(row.finished_at),
    verifiedAt: numOrNull(row.verified_at),
    rolledBackAt: numOrNull(row.rolled_back_at),
  };
}

export async function startExecution(actionId: string, executedSql: string): Promise<string> {
  const id = randomUUID();
  await run(sql`
    INSERT INTO remediation_executions (id, action_id, status, executed_sql, started_at)
    VALUES (${id}, ${actionId}, 'running', ${executedSql}, ${Date.now()})
  `);
  return id;
}

export async function finishExecution(id: string, status: Execution["status"], error: string | null): Promise<void> {
  await run(sql`UPDATE remediation_executions SET status = ${status}, error = ${error}, finished_at = ${Date.now()} WHERE id = ${id}`);
}

export async function recordVerification(id: string, result: NonNullable<Execution["verificationResult"]>): Promise<void> {
  await run(sql`
    UPDATE remediation_executions SET verification_result = ${JSON.stringify(result)}, verified_at = ${result.ok ? result.checkedAt : null}
    WHERE id = ${id}
  `);
}

export async function markRolledBack(id: string): Promise<void> {
  await run(sql`UPDATE remediation_executions SET status = 'rolled_back', rolled_back_at = ${Date.now()} WHERE id = ${id}`);
}

export async function listExecutions(actionId: string): Promise<Execution[]> {
  const rows = await all(sql`SELECT * FROM remediation_executions WHERE action_id = ${actionId} ORDER BY started_at`);
  return rows.map(executionRow);
}

export async function latestExecution(actionId: string): Promise<Execution | null> {
  const row = await one(sql`SELECT * FROM remediation_executions WHERE action_id = ${actionId} ORDER BY started_at DESC LIMIT 1`);
  return row ? executionRow(row) : null;
}

// --- remediation credential ---------------------------------------------------

export interface RemediationCredential {
  connectionId: string;
  username: string;
  password: string;
  updatedAt: number;
}

export async function getCredential(connectionId: string): Promise<RemediationCredential | null> {
  const row = await one(sql`SELECT * FROM remediation_credentials WHERE connection_id = ${connectionId}`);
  if (!row) return null;
  const encrypted = strOrNull(row.password_encrypted);
  return {
    connectionId,
    username: str(row.username),
    password: encrypted ? decryptPassword(encrypted) : "",
    updatedAt: num(row.updated_at),
  };
}

/** Public view: never returns the password. */
export async function describeCredential(connectionId: string): Promise<{ configured: boolean; username: string | null; updatedAt: number | null }> {
  const row = await one(sql`SELECT username, updated_at FROM remediation_credentials WHERE connection_id = ${connectionId}`);
  return row ? { configured: true, username: str(row.username), updatedAt: num(row.updated_at) } : { configured: false, username: null, updatedAt: null };
}

export async function setCredential(connectionId: string, username: string, password: string, actorId: string | null): Promise<void> {
  const encrypted = password ? encryptPassword(password) : null;
  const now = Date.now();
  await run(sql`
    INSERT INTO remediation_credentials (connection_id, username, password_encrypted, updated_by, updated_at)
    VALUES (${connectionId}, ${username}, ${encrypted}, ${actorId}, ${now})
    ON CONFLICT (connection_id) DO UPDATE SET username = ${username}, password_encrypted = ${encrypted}, updated_by = ${actorId}, updated_at = ${now}
  `);
}

export async function deleteCredential(connectionId: string): Promise<void> {
  await run(sql`DELETE FROM remediation_credentials WHERE connection_id = ${connectionId}`);
}
