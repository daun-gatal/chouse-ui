/**
 * Remediation API (ADR 0016 §8): the closed action catalog, proposals,
 * approvals, execution, verification and rollback, plus the per-connection
 * remediation credential.
 */

import { api } from "./client";

export const ACTION_TYPES = [
  "kill_query",
  "pause_scheduled_job",
  "resume_scheduled_job",
  "delay_scheduled_job",
  "set_profile_setting",
  "optimize_partition",
  "restart_replica",
  "add_skip_index",
  "modify_ttl",
  "modify_column_codec",
  "restart_engine_table",
  "reload_dictionary",
  "refresh_view",
  "flush_distributed",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "executed"
  | "verified"
  | "failed_verification"
  | "failed"
  | "rolled_back"
  | "rejected";

export type ActionParams = { type: ActionType } & Record<string, unknown>;

export interface VerificationSpec {
  description: string;
  sql: string | null;
  comparator: "eq" | "lt" | "lte" | "gt" | "gte";
  threshold: number;
  withinSeconds: number;
}

export interface RemediationAction {
  id: string;
  connectionId: string;
  type: ActionType;
  params: ActionParams;
  resumeAt: number | null;
  approvalClass: 1 | 2;
  status: ActionStatus;
  title: string;
  rationale: string | null;
  proposedBy: string | null;
  proposedSource: "user" | "ai" | "mcp" | "doctor";
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
  channel: "ui" | "slack" | "cli";
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

export interface BuiltAction {
  statements: string[];
  preview: string;
  rollback: string[] | null;
  approvalClass: 1 | 2;
  windowOnly: boolean;
  verification: VerificationSpec;
}

export interface Catalog {
  types: Array<{ type: ActionType; requiredGrants: string[] }>;
  window: string;
}

export interface ProposeInput {
  connectionId: string;
  params: ActionParams;
  title?: string;
  rationale?: string | null;
  incidentSource?: "data_health" | "observe" | null;
  incidentId?: string | null;
  notebookId?: string | null;
}

export function getCatalog(): Promise<Catalog> {
  return api.get<Catalog>("/remediation/catalog");
}

export async function listActions(filter: { connectionId: string; status?: ActionStatus[]; incidentId?: string; notebookId?: string }): Promise<RemediationAction[]> {
  const res = await api.get<{ actions: RemediationAction[] }>("/remediation/actions", {
    params: { connectionId: filter.connectionId, status: filter.status?.join(",") || undefined, incidentId: filter.incidentId, notebookId: filter.notebookId },
  });
  return res.actions;
}

export function getAction(id: string): Promise<{ action: RemediationAction; approvals: Approval[]; executions: Execution[] }> {
  return api.get(`/remediation/actions/${encodeURIComponent(id)}`);
}

export function previewAction(params: ActionParams): Promise<BuiltAction> {
  return api.post<BuiltAction>("/remediation/actions/preview", { params });
}

export function proposeAction(input: ProposeInput): Promise<RemediationAction> {
  return api.post<RemediationAction>("/remediation/actions", input);
}

export function approveAction(id: string, comment?: string | null): Promise<RemediationAction> {
  return api.post<RemediationAction>(`/remediation/actions/${encodeURIComponent(id)}/approve`, { comment: comment ?? null });
}

export function rejectAction(id: string, comment?: string | null): Promise<RemediationAction> {
  return api.post<RemediationAction>(`/remediation/actions/${encodeURIComponent(id)}/reject`, { comment: comment ?? null });
}

export function runAction(id: string): Promise<RemediationAction> {
  return api.post<RemediationAction>(`/remediation/actions/${encodeURIComponent(id)}/run`);
}

export function rollbackAction(id: string): Promise<RemediationAction> {
  return api.post<RemediationAction>(`/remediation/actions/${encodeURIComponent(id)}/rollback`);
}

export function getCredential(connectionId: string): Promise<{ configured: boolean; username: string | null; updatedAt: number | null }> {
  return api.get(`/remediation/credentials/${encodeURIComponent(connectionId)}`);
}

export function setCredential(connectionId: string, username: string, password: string): Promise<{ configured: boolean }> {
  return api.put(`/remediation/credentials/${encodeURIComponent(connectionId)}`, { username, password });
}

export function deleteCredential(connectionId: string): Promise<{ configured: boolean }> {
  return api.delete(`/remediation/credentials/${encodeURIComponent(connectionId)}`);
}

/** Terminal states: nothing else will happen to the action. */
export function isTerminal(status: ActionStatus): boolean {
  return ["verified", "failed_verification", "failed", "rolled_back", "rejected"].includes(status);
}
