import { api } from "./client";

export type QueryHistoryStatus = "success" | "error" | "cancelled";

export interface QueryHistoryItem {
  id: string;
  query: string;
  connectionId: string | null;
  connectionName: string | null;
  executedAt: number;
  durationMs: number;
  rows: number;
  status: QueryHistoryStatus;
  error?: string;
}

export function getQueryHistory(): Promise<QueryHistoryItem[]> {
  return api.get<QueryHistoryItem[]>("/query-history");
}

export function recordQueryHistory(item: QueryHistoryItem): Promise<QueryHistoryItem> {
  return api.post<QueryHistoryItem>("/query-history", item);
}

export async function deleteQueryHistoryItem(id: string): Promise<void> {
  await api.delete(`/query-history/${encodeURIComponent(id)}`);
}

export async function clearQueryHistory(): Promise<void> {
  await api.delete("/query-history");
}
