/**
 * Context engine API (ADR 0016 §11): curated table context, Chouse AI
 * drafts of it, canonical metrics, dbt import and plain-language watchers.
 */

import { api } from "./client";
import type { Criticality, TrustState } from "./observe";

export interface CuratedContext {
  description?: string | null;
  grain?: string | null;
  owner?: string | null;
  insteadOf?: string | null;
  deprecated: boolean;
  tags: string[];
}

export interface Metric {
  id: string;
  database: string;
  table: string;
  name: string;
  expression: string;
  description?: string | null;
  owner?: string | null;
  updatedAt: number;
}

export interface TableContext {
  connectionId: string;
  database: string;
  table: string;
  curated: (CuratedContext & { source: string; verifiedBy: string | null; verifiedAt: number | null; updatedBy: string | null; updatedAt: number | null }) | null;
  derived: {
    engine: string | null;
    sortingKey: string | null;
    partitionKey: string | null;
    totalRows: number | null;
    totalBytes: number | null;
    queryGuidance: string[];
    joins: Array<{ column: string; target: string; share: number }>;
    columns: Array<{ name: string; type: string; comment: string | null }>;
  };
  metrics: Metric[];
  patterns: Array<{ fingerprint: string; sampleQuery: string; runs: number; users: number; p95Ms: number | null; readRatio: number | null }>;
  health: { state: string | null; reason: string | null; criticality: string | null };
}

export interface CompiledWatcher {
  draft: {
    name: string;
    connectionId: string;
    source: { sourceType: "table"; databaseName: string; tableName: string; eventTimeColumn?: string; eventTimeType?: string; eventTimeEncoding?: "native" };
    frequency: "hourly" | "daily";
    criticality: Criticality;
    checks: Array<Record<string, unknown>>;
  };
  compiledSql: string;
  explanation: string;
  model: string;
}

/** A Chouse AI draft of a table's curated context; never saved until a person saves the form. */
export interface TableContextDraft {
  draft: { description: string | null; grain: string | null; owner: string | null; insteadOf: string | null; deprecated: boolean; tags: string[] };
  metrics: Array<{ name: string; expression: string; description: string | null }>;
  dropped: number;
  basedOn: string[];
  notes: string[];
  model: string;
  generatedAt: number;
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

export async function listContextTables(q?: string, connectionId?: string): Promise<Array<{ database: string; table: string; criticality: Criticality; state: TrustState }>> {
  const res = await api.get<{ tables: Array<{ database: string; table: string; criticality: Criticality; state: TrustState }> }>("/context/tables", { params: { connectionId, q: q || undefined } });
  return res.tables;
}

export function getTableContext(database: string, table: string, connectionId?: string): Promise<TableContext> {
  return api.get<TableContext>(`/context/tables/${seg(database)}/${seg(table)}`, { params: { connectionId } });
}

export function saveTableContext(database: string, table: string, curated: CuratedContext, connectionId?: string): Promise<TableContext> {
  return api.put<TableContext>(`/context/tables/${seg(database)}/${seg(table)}`, curated, { params: { connectionId } });
}

export function verifyTableContext(database: string, table: string, connectionId?: string): Promise<TableContext> {
  return api.post<TableContext>(`/context/tables/${seg(database)}/${seg(table)}/verify`, undefined, { params: { connectionId } });
}

export function draftTableContext(database: string, table: string, modelId?: string, connectionId?: string): Promise<TableContextDraft> {
  return api.post<TableContextDraft>(`/context/tables/${seg(database)}/${seg(table)}/draft`, { modelId }, { params: { connectionId } });
}

export async function listMetrics(connectionId?: string): Promise<Metric[]> {
  const res = await api.get<{ metrics: Metric[] }>("/context/metrics", { params: { connectionId } });
  return res.metrics;
}

export function saveMetric(database: string, table: string, metric: { name: string; expression: string; description?: string | null; owner?: string | null }, connectionId?: string): Promise<Metric> {
  return api.put<Metric>(`/context/tables/${seg(database)}/${seg(table)}/metrics`, metric, { params: { connectionId } });
}

export function deleteMetric(id: string, connectionId?: string): Promise<{ deleted: string }> {
  return api.delete(`/context/metrics/${seg(id)}`, { params: { connectionId } });
}

export function importDbtManifest(manifest: unknown, connectionId?: string): Promise<{ imported: number; skipped: number; tables: string[] }> {
  return api.post("/context/dbt-import", manifest, { params: { connectionId } });
}

export function compileWatcher(text: string, modelId?: string, connectionId?: string): Promise<CompiledWatcher> {
  return api.post<CompiledWatcher>("/context/watchers/compile", { text, modelId }, { params: { connectionId } });
}
