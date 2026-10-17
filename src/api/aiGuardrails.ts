/**
 * AI guardrails API (ADR 0022): what every CHouse AI run, and MCP tool results
 * where enabled, passes through. Behind AI Governance › Guardrails.
 */

import { api } from "./client";

export const GUARDRAIL_KINDS = ["pattern", "keywords", "columns", "injection", "sql", "tool", "limits", "judge"] as const;
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number];
export const GUARDRAIL_STAGES = ["input", "tool_call", "tool_result", "output"] as const;
export type GuardrailStage = (typeof GUARDRAIL_STAGES)[number];
export const GUARDRAIL_ACTIONS = ["log", "warn", "redact", "block"] as const;
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number];
export type GuardrailMode = "shadow" | "enforce";
export type RedactStrategy = "placeholder" | "mask" | "hash";

export interface GuardrailScope {
  agents: "all" | string[];
  features: "all" | string[];
  mcp: boolean;
}

/** The editable fields of a guardrail; `config` follows the kind (see the editor). */
export interface GuardrailInput {
  slug: string;
  name: string;
  description: string;
  kind: GuardrailKind;
  config: Record<string, unknown>;
  stages: GuardrailStage[];
  action: GuardrailAction;
  mode: GuardrailMode;
  scope: GuardrailScope;
  position: number;
  enabled: boolean;
}

export interface Guardrail extends GuardrailInput {
  id: string;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  updateAvailable: boolean;
  triggers24h: { total: number; applied: number; blocked: number };
}

export interface GuardrailKindInfo {
  label: string;
  description: string;
  /** Actions allowed at each stage the kind supports. */
  stages: Partial<Record<GuardrailStage, GuardrailAction[]>>;
}

export interface GuardrailCatalog {
  version: number;
  guardrails: Guardrail[];
  kinds: Record<GuardrailKind, GuardrailKindInfo>;
  detectors: Array<{ id: string; label: string; group: "pii" | "secret"; token: string }>;
  strategies: RedactStrategy[];
  agents: Array<{ id: string; slug: string; name: string }>;
  features: Array<{ id: string; title: string }>;
  drafting: boolean;
}

export interface GuardrailEvent {
  id: string;
  createdAt: number;
  guardrailId: string;
  guardrailName: string;
  kind: string;
  stage: GuardrailStage;
  action: GuardrailAction;
  mode: GuardrailMode;
  matchCount: number;
  source: "agent" | "mcp";
  userId: string | null;
  requestId: string | null;
  agentPath: string | null;
  tool: string | null;
  reason: string | null;
}

export interface GuardrailRevision {
  id: string;
  version: number;
  action: string;
  actor: string | null;
  createdAt: number;
}

export interface GuardrailTestRequest {
  guardrail: GuardrailInput;
  stage: GuardrailStage;
  text: string;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface GuardrailTestResult {
  outcome: "matched" | "no-match" | "blocked";
  output: string;
  events: Array<Pick<GuardrailEvent, "stage" | "action" | "matchCount" | "reason">>;
}

export interface GuardrailDraft {
  input: GuardrailInput;
  rationale: string;
  problems: string[];
}

const BASE = "/ai-guardrails";

export function getGuardrails(): Promise<GuardrailCatalog> {
  return api.get<GuardrailCatalog>(BASE);
}

export async function getGuardrailEvents(params: { days?: number; guardrailId?: string; limit?: number } = {}): Promise<GuardrailEvent[]> {
  const data = await api.get<{ events: GuardrailEvent[] }>(`${BASE}/events`, { params });
  return data.events;
}

export function createGuardrail(input: GuardrailInput): Promise<Guardrail> {
  return api.post<Guardrail>(BASE, input);
}

export function updateGuardrail(id: string, input: GuardrailInput, version: number): Promise<Guardrail> {
  return api.put<Guardrail>(`${BASE}/${encodeURIComponent(id)}`, { ...input, version });
}

export function setGuardrailState(id: string, state: { mode?: GuardrailMode; enabled?: boolean }, version: number): Promise<Guardrail> {
  return api.patch<Guardrail>(`${BASE}/${encodeURIComponent(id)}/state`, { ...state, version });
}

export function reorderGuardrails(ids: string[]): Promise<{ guardrails: Guardrail[] }> {
  return api.post<{ guardrails: Guardrail[] }>(`${BASE}/reorder`, { ids });
}

export function deleteGuardrail(id: string, version: number): Promise<unknown> {
  return api.delete(`${BASE}/${encodeURIComponent(id)}`, { params: { version } });
}

export function resetGuardrail(id: string): Promise<Guardrail> {
  return api.post<Guardrail>(`${BASE}/${encodeURIComponent(id)}/reset`);
}

export async function listGuardrailRevisions(id: string): Promise<GuardrailRevision[]> {
  const data = await api.get<{ revisions: GuardrailRevision[] }>(`${BASE}/${encodeURIComponent(id)}/revisions`);
  return data.revisions;
}

export function rollbackGuardrail(revisionId: string): Promise<Guardrail> {
  return api.post<Guardrail>(`${BASE}/revisions/${encodeURIComponent(revisionId)}/rollback`);
}

export function testGuardrail(request: GuardrailTestRequest): Promise<GuardrailTestResult> {
  return api.post<GuardrailTestResult>(`${BASE}/test`, request);
}

/** Draft a guardrail with AI. Nothing is saved; the draft opens in the dialog. */
export function draftGuardrail(goal: string, modelId?: string): Promise<GuardrailDraft> {
  return api.post<GuardrailDraft>(`${BASE}/draft`, { goal }, modelId ? { params: { modelId } } : undefined);
}

/** The editable fields of a stored guardrail. */
export function guardrailInputOf(g: Guardrail): GuardrailInput {
  return {
    slug: g.slug, name: g.name, description: g.description, kind: g.kind, config: g.config, stages: g.stages,
    action: g.action, mode: g.mode, scope: g.scope, position: g.position, enabled: g.enabled,
  };
}
