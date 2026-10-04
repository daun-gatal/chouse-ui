/**
 * Investigation notebooks API (ADR 0016 §7), shared by incidents and Doctor
 * reports.
 */

import { api, getRbacAccessToken, connectionIdentityHeaders } from "./client";

export type NotebookAttachment = "incident_data_health" | "incident_observe" | "doctor_report";
export type CellKind = "ai_finding" | "query" | "note" | "chart" | "action";

export interface Notebook {
  id: string;
  title: string;
  ownerId: string | null;
  attachedKind: NotebookAttachment | "none";
  attachedRef: string | null;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QuerySnapshot {
  columns: string[];
  rows: unknown[][];
  ranAt: number;
}

export interface NotebookCell {
  id: string;
  notebookId: string;
  position: number;
  kind: CellKind;
  authorKind: "user" | "ai";
  authorId: string | null;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type NewCell =
  | { kind: "note"; text: string }
  | { kind: "query"; sql: string; title?: string | null }
  | { kind: "action"; actionId: string };

export interface NotebookWithCells {
  notebook: Notebook;
  cells: NotebookCell[];
}

export function ensureNotebook(kind: NotebookAttachment, ref: string, title?: string): Promise<NotebookWithCells> {
  return api.post<NotebookWithCells>("/notebooks/ensure", { kind, ref, title });
}

export function getNotebook(id: string): Promise<NotebookWithCells> {
  return api.get<NotebookWithCells>(`/notebooks/${encodeURIComponent(id)}`);
}

export function addCell(notebookId: string, cell: NewCell): Promise<NotebookCell> {
  return api.post<NotebookCell>(`/notebooks/${encodeURIComponent(notebookId)}/cells`, cell);
}

export function rerunCell(notebookId: string, cellId: string): Promise<NotebookCell> {
  return api.post<NotebookCell>(`/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}/run`);
}

export function deleteCell(notebookId: string, cellId: string): Promise<{ deleted: string }> {
  return api.delete(`/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}`);
}

/** The postmortem as Markdown (the export endpoint answers text, not the JSON envelope). */
export async function exportNotebook(notebookId: string): Promise<string> {
  const base = import.meta.env.VITE_API_URL || "/api";
  const token = getRbacAccessToken();
  const response = await fetch(`${base}/notebooks/${encodeURIComponent(notebookId)}/export`, {
    headers: { "X-Requested-With": "XMLHttpRequest", ...connectionIdentityHeaders(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: "include",
  });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  return response.text();
}

export function querySnapshot(cell: NotebookCell): QuerySnapshot | null {
  const snapshot = cell.content.snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Partial<QuerySnapshot>;
  return Array.isArray(s.columns) && Array.isArray(s.rows) && typeof s.ranAt === "number" ? { columns: s.columns, rows: s.rows, ranAt: s.ranAt } : null;
}
