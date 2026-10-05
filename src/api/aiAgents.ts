/**
 * AI agent registry API (ADR 0019): every DeepAgents agent, harness, skill and
 * feature binding behind AI Governance › Assistant.
 */

import { api } from "./client";

export type ToolContextKind = "session" | "fleet" | "userApi";
export type FeatureSurface = "sql-editor" | "doctor" | "diagnostics" | "dataops" | "observe" | "chat";
export type AgentKind = "router" | "agent";
export type SkillLinkMode = "progressive" | "pinned";

export interface VariableSpec {
  type: "string" | "number" | "boolean" | "json";
  description: string;
}

export interface AiFeature {
  id: string;
  title: string;
  description: string;
  surface: FeatureSurface;
  delivery: "structured" | "invoke";
  permission: string;
  contexts: ToolContextKind[];
  variables: Record<string, VariableSpec>;
  background: boolean;
  agentId: string | null;
}

export interface AgentTuning {
  stepBudget: number;
  recursionLimit?: number | null;
  timeoutMs?: number | null;
  maxOutputTokens?: number | null;
}

export interface AgentSkillLink {
  skillId: string;
  mode: SkillLinkMode;
  pinnedFile: string | null;
}

/** The editable part of an agent. */
export interface AgentInput {
  slug: string;
  name: string;
  description: string;
  kind: AgentKind;
  systemPrompt: string;
  taskTemplate: string | null;
  modelConfigId: string | null;
  harnessId: string;
  tuning: AgentTuning;
  requiredPermissions: string[];
  tools: string[];
  skills: AgentSkillLink[];
  subagents: string[];
  enabled: boolean;
}

interface RowMeta {
  id: string;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** A customized built-in whose shipped definition changed since. */
  updateAvailable: boolean;
  /** Features and agents that use this row (blocks deletes). */
  usedBy: string[];
}

export type AiAgent = AgentInput & RowMeta;

export interface GeneralPurposeConfig {
  enabled: boolean;
  description?: string | null;
  systemPrompt?: string | null;
}

export interface HarnessInput {
  slug: string;
  name: string;
  description: string;
  excludedTools: string[];
  generalPurpose: GeneralPurposeConfig;
  promptSuffix: string | null;
  toolDescriptionOverrides: Record<string, string>;
}

export type AiHarness = HarnessInput & RowMeta;

export interface SkillInput {
  /** `<group>/<directory>` under /skills/. */
  path: string;
  /** Full SKILL.md including front matter (name + description). */
  skillMd: string;
  files: Record<string, string>;
  enabled: boolean;
}

export type AiSkill = SkillInput & RowMeta & { name: string; description: string };

export interface CatalogTool {
  name: string;
  title: string;
  domain: "clickhouse" | "chouse";
  category: string;
  access: "read" | "write" | "destructive";
  requires: ToolContextKind | null;
  permissions: string[];
  description: string;
}

export interface RegistryProblem {
  entity: "agent" | "harness" | "skill" | "binding";
  id: string;
  message: string;
}

export interface TuningLimits {
  stepBudget: { min: number; max: number };
  recursionLimit: { min: number; max: number };
  timeoutMs: { min: number; max: number };
  maxOutputTokens: { min: number; max: number };
}

export interface AiRegistry {
  version: number;
  features: AiFeature[];
  agents: AiAgent[];
  harnesses: AiHarness[];
  skills: AiSkill[];
  tools: CatalogTool[];
  builtinTools: Array<{ name: string; description: string }>;
  contexts: ToolContextKind[];
  limits: TuningLimits;
  problems: RegistryProblem[];
}

export interface RegistryRevision {
  id: string;
  entity: "agent" | "harness" | "skill" | "binding";
  entityId: string;
  version: number;
  action: string;
  snapshot: unknown;
  actor: string | null;
  createdAt: number;
}

export interface PromptPreview {
  system: string | null;
  task: string | null;
  problems: string[];
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  agent?: string;
}

export type TestResult =
  | {
    kind: "structured";
    output: unknown;
    trace: { agent: { id: string; slug: string; name: string }; system: string; task: string | null; raw: string; calls: ToolCallTrace[] } | null;
    durationMs: number;
  }
  | {
    kind: "chat";
    content: string;
    agent: { id: string; slug: string; name: string };
    toolCalls: ToolCallTrace[];
    durationMs: number;
  };

export interface TestRequest {
  featureId: string;
  input?: unknown;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  agentId?: string | null;
  agent?: AgentInput;
  modelId?: string;
}

const BASE = "/ai-agents";

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function getAiRegistry(): Promise<AiRegistry> {
  return api.get<AiRegistry>(`${BASE}/registry`);
}

export async function listRevisions(entity: RegistryRevision["entity"], id: string): Promise<RegistryRevision[]> {
  const res = await api.get<{ revisions: RegistryRevision[] }>(`${BASE}/revisions/${entity}/${seg(id)}`);
  return res.revisions;
}

export function rollbackRevision(revisionId: string): Promise<{ restored: string }> {
  return api.post(`${BASE}/revisions/${seg(revisionId)}/rollback`);
}

export function previewAgent(featureId: string | null, agentId: string | null, agent: AgentInput): Promise<PromptPreview> {
  return api.post<PromptPreview>(`${BASE}/preview`, { featureId, agentId, agent });
}

export function createAgent(input: AgentInput): Promise<AiAgent> {
  return api.post<AiAgent>(`${BASE}/agents`, input);
}

export function updateAgent(id: string, input: AgentInput, version: number): Promise<AiAgent> {
  return api.put<AiAgent>(`${BASE}/agents/${seg(id)}`, { ...input, version });
}

export function deleteAgent(id: string, version: number): Promise<{ deleted: boolean }> {
  return api.delete(`${BASE}/agents/${seg(id)}`, { params: { version } });
}

export function resetAgent(id: string): Promise<AiAgent> {
  return api.post<AiAgent>(`${BASE}/agents/${seg(id)}/reset`);
}

export function createHarness(input: HarnessInput): Promise<AiHarness> {
  return api.post<AiHarness>(`${BASE}/harnesses`, input);
}

export function updateHarness(id: string, input: HarnessInput, version: number): Promise<AiHarness> {
  return api.put<AiHarness>(`${BASE}/harnesses/${seg(id)}`, { ...input, version });
}

export function deleteHarness(id: string, version: number): Promise<{ deleted: boolean }> {
  return api.delete(`${BASE}/harnesses/${seg(id)}`, { params: { version } });
}

export function resetHarness(id: string): Promise<AiHarness> {
  return api.post<AiHarness>(`${BASE}/harnesses/${seg(id)}/reset`);
}

export function createSkill(input: SkillInput): Promise<AiSkill> {
  return api.post<AiSkill>(`${BASE}/skills`, input);
}

export function updateSkill(id: string, input: SkillInput, version: number): Promise<AiSkill> {
  return api.put<AiSkill>(`${BASE}/skills/${seg(id)}`, { ...input, version });
}

export function deleteSkill(id: string, version: number): Promise<{ deleted: boolean }> {
  return api.delete(`${BASE}/skills/${seg(id)}`, { params: { version } });
}

export function resetSkill(id: string): Promise<AiSkill> {
  return api.post<AiSkill>(`${BASE}/skills/${seg(id)}/reset`);
}

export function bindFeature(featureId: string, agentId: string): Promise<{ featureId: string; agentId: string }> {
  return api.put(`${BASE}/bindings/${seg(featureId)}`, { agentId });
}

export function runAgentTest(request: TestRequest): Promise<TestResult> {
  return api.post<TestResult>(`${BASE}/test`, request);
}

/** The editable fields of a stored agent, for the editor. */
export function agentInputOf(agent: AiAgent): AgentInput {
  return {
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    kind: agent.kind,
    systemPrompt: agent.systemPrompt,
    taskTemplate: agent.taskTemplate,
    modelConfigId: agent.modelConfigId,
    harnessId: agent.harnessId,
    tuning: { ...agent.tuning },
    requiredPermissions: [...agent.requiredPermissions],
    tools: [...agent.tools],
    skills: agent.skills.map((s) => ({ ...s })),
    subagents: [...agent.subagents],
    enabled: agent.enabled,
  };
}

export function harnessInputOf(harness: AiHarness): HarnessInput {
  return {
    slug: harness.slug,
    name: harness.name,
    description: harness.description,
    excludedTools: [...harness.excludedTools],
    generalPurpose: { ...harness.generalPurpose },
    promptSuffix: harness.promptSuffix,
    toolDescriptionOverrides: { ...harness.toolDescriptionOverrides },
  };
}

export function skillInputOf(skill: AiSkill): SkillInput {
  return { path: skill.path, skillMd: skill.skillMd, files: { ...skill.files }, enabled: skill.enabled };
}
