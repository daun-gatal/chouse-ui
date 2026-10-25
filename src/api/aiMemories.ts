/**
 * AI memory API (ADR 0024 §Phase 3): notes agents keep about a user (yours,
 * private) or about a ClickHouse connection (team memories, reviewed by
 * someone with `ai_memories:manage` before agents use them).
 */

import { api } from "./client";

export type MemoryScope = "user" | "connection";
export type MemoryStatus = "active" | "proposed" | "rejected";

/** Longest note the server keeps. */
export const MEMORY_MAX_CHARS = 500;

export interface AiMemory {
  id: string;
  scope: MemoryScope;
  ownerId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  content: string;
  status: MemoryStatus;
  source: "agent" | "person";
  agentSlug: string | null;
  threadId: string | null;
  /** Why a guardrail flagged a team proposal. */
  flag: string | null;
  proposedBy: string | null;
  proposedByName: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Whether the viewer may edit or delete it. */
  canEdit: boolean;
}

export interface MyMemories {
  /** Whether agents read and keep the viewer's memories. */
  enabled: boolean;
  memories: AiMemory[];
}

export interface TeamMemories {
  canManage: boolean;
  memories: AiMemory[];
}

export interface MemoryExport {
  exportedAt: string;
  memories: Array<{ content: string; source: string; createdAt: string }>;
}

export async function getMyMemories(): Promise<MyMemories> {
  return api.get<MyMemories>("/ai-memories/mine");
}

export async function setMemoryEnabled(enabled: boolean): Promise<boolean> {
  return (await api.put<{ enabled: boolean }>("/ai-memories/settings", { enabled })).enabled;
}

export async function exportMyMemories(): Promise<MemoryExport> {
  return api.get<MemoryExport>("/ai-memories/export");
}

export async function getTeamMemories(filter: { connectionId?: string | null; status?: MemoryStatus } = {}): Promise<TeamMemories> {
  const params: Record<string, string> = {};
  if (filter.connectionId) params.connectionId = filter.connectionId;
  if (filter.status) params.status = filter.status;
  return api.get<TeamMemories>("/ai-memories/team", { params: Object.keys(params).length > 0 ? params : undefined });
}

/** Team memories that name one table: shown next to its context. */
export async function getTableMemories(connectionId: string, database: string, table: string): Promise<TeamMemories> {
  return api.get<TeamMemories>("/ai-memories/for-table", { params: { connectionId, database, table } });
}

export async function getPendingMemoryCount(): Promise<number> {
  return (await api.get<{ count: number }>("/ai-memories/pending-count")).count;
}

export async function createMemory(input: { scope: MemoryScope; content: string; connectionId?: string }): Promise<AiMemory & { duplicate: boolean }> {
  return api.post<AiMemory & { duplicate: boolean }>("/ai-memories", input);
}

export async function updateMemory(id: string, content: string): Promise<AiMemory> {
  return api.put<AiMemory>(`/ai-memories/${id}`, { content });
}

export async function deleteMemory(id: string): Promise<void> {
  await api.delete(`/ai-memories/${id}`);
}

export async function reviewMemory(id: string, approve: boolean): Promise<AiMemory> {
  return api.post<AiMemory>(`/ai-memories/${id}/${approve ? "approve" : "reject"}`);
}

export interface MemorySuggestion {
  note: string;
  scope: MemoryScope;
}

/** Notes worth keeping from one of your conversations (ADR 0026); nothing is saved until you choose. */
export async function suggestMemories(threadId: string): Promise<{ suggestions: MemorySuggestion[]; connectionId?: string | null; off?: boolean }> {
  return api.post<{ suggestions: MemorySuggestion[]; connectionId?: string | null; off?: boolean }>("/ai-memories/suggest", { threadId });
}
