/**
 * Query API
 */

import { api, getSessionId, getRbacAccessToken } from './client';
import { invokeAI, fetchAiModels, type QueryOptimization } from './ai';
import type { FleetDoctorModel } from './fleet';

// ============================================
// Types
// ============================================

export interface QueryStatistics {
  elapsed: number;
  rows_read: number;
  bytes_read: number;
}

export interface QueryMeta {
  name: string;
  type: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  meta: QueryMeta[];
  data: T[];
  statistics: QueryStatistics;
  rows: number;
  queryId?: string | null;
  error?: string | null;
}

export interface IntellisenseFunctionInfo {
  name: string;
  is_aggregate: boolean;
  description: string;
  syntax: string;
}

export interface IntellisenseData {
  columns: Array<{
    database: string;
    table: string;
    column_name: string;
    column_type: string;
  }>;
  functions: IntellisenseFunctionInfo[];
  keywords: string[];
}

// ============================================
// Query Type Detection
// ============================================

/**
 * Detect the type of SQL query to route to the appropriate endpoint
 */
export function detectQueryType(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'alter' | 'truncate' | 'show' | 'system' | 'unknown' {
  const normalized = sql.trim().toUpperCase();

  // Check for SELECT (including WITH clauses)
  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return 'select';
  }

  // Check for INSERT
  if (normalized.startsWith('INSERT')) {
    return 'insert';
  }

  // Check for UPDATE
  if (normalized.startsWith('UPDATE')) {
    return 'update';
  }

  // Check for DELETE
  if (normalized.startsWith('DELETE')) {
    return 'delete';
  }

  // Check for CREATE
  if (normalized.startsWith('CREATE')) {
    return 'create';
  }

  // Check for DROP
  if (normalized.startsWith('DROP')) {
    return 'drop';
  }

  // Check for ALTER
  if (normalized.startsWith('ALTER')) {
    return 'alter';
  }

  // Check for TRUNCATE
  if (normalized.startsWith('TRUNCATE')) {
    return 'truncate';
  }

  // Check for SHOW
  if (normalized.startsWith('SHOW')) {
    return 'show';
  }

  // Check for system queries (DESCRIBE, DESC, or SELECT from system tables)
  if (normalized.startsWith('DESCRIBE') || normalized.startsWith('DESC')) {
    return 'system';
  }

  // Check if it's a SELECT from system database
  if (normalized.startsWith('SELECT') && normalized.includes('FROM SYSTEM.')) {
    return 'system';
  }

  return 'unknown';
}

// ============================================
// API Functions
// ============================================

/**
 * Execute a SQL query
 * Routes to the generic execution endpoint which handles parsing and permission checks
 */
export async function executeQuery<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string,
  signal?: AbortSignal,
  maxResultRows?: number
): Promise<QueryResult<T>> {
  // Use the generic execution endpoint for all queries
  // The backend determines the query type and validates permissions
  return api.post<QueryResult<T>>(
    '/query/execute',
    { query, format, queryId, maxResultRows },
    { signal }
  );
}

/**
 * Execute SELECT queries from tables (read-only)
 */
export async function executeSelect<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/select', { query, format, queryId });
}

/**
 * Execute INSERT statements into tables
 */
export async function executeInsert<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/insert', { query, format, queryId });
}

/**
 * Execute UPDATE statements on tables
 */
export async function executeUpdate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/update', { query, format, queryId });
}

/**
 * Execute DELETE statements from tables
 */
export async function executeDelete<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/delete', { query, format, queryId });
}

/**
 * Execute CREATE TABLE statements (DDL)
 */
export async function executeCreate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's CREATE DATABASE or CREATE TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?DATABASE/i)) {
    return api.post<QueryResult<T>>('/query/database/create', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/create', { query, format, queryId });
  }
}

/**
 * Execute DROP statements (DDL)
 * Auto-routes to /query/table/drop or /query/database/drop
 */
export async function executeDrop<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's DROP DATABASE or DROP TABLE
  const normalized = query.trim().toUpperCase();

  if (normalized.match(/^DROP\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/drop', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/drop', { query, format, queryId });
  }
}

/**
 * Execute ALTER statements (DDL)
 * Auto-routes to /query/table/alter or /query/database/alter
 */
export async function executeAlter<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's ALTER DATABASE or ALTER TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^ALTER\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/alter', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/alter', { query, format, queryId });
  }
}

/**
 * Execute TRUNCATE TABLE statements
 */
export async function executeTruncate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/truncate', { query, format, queryId });
}

/**
 * Execute SHOW queries (read-only system queries)
 */
export async function executeShow<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/show', { query, format, queryId });
}

/**
 * Execute system queries (DESCRIBE, system table queries)
 */
export async function executeSystem<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/system', { query, format, queryId });
}

/**
 * Get intellisense data for SQL editor
 */
export async function getIntellisenseData(): Promise<IntellisenseData> {
  return api.get<IntellisenseData>('/query/intellisense');
}

/**
 * Get Visual Explain Plan for a query
 * @param query - The SQL query to explain
 * @param type - The type of explain (plan, ast, syntax, pipeline, estimate)
 */
export async function explainQuery(
  query: string,
  type: 'plan' | 'ast' | 'syntax' | 'pipeline' | 'estimate' = 'plan'
): Promise<import('@/types/explain').ExplainResult> {
  return api.post<import('@/types/explain').ExplainResult>('/query/explain', { query, type });
}


/**
 * Optimize a SQL query using AI
 * @param query - The SQL query to optimize
 * @param database - Optional database context
 */
export async function optimizeQuery(
  query: string,
  database?: string,
  additionalPrompt?: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<QueryOptimization> {
  return invokeAI<QueryOptimization>("optimize-query", { query, database, additionalPrompt }, { modelId, signal });
}

/**
 * Debug a failed SQL query using AI
 * @param query - The failed SQL query
 * @param error - The error message
 * @param database - Optional database context
 */
export async function debugQuery(
  query: string,
  error: string,
  database?: string,
  additionalPrompt?: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<{
  fixedQuery: string;
  originalQuery: string;
  errorAnalysis: string;
  explanation: string;
  summary: string;
}> {
  return invokeAI("debug-query", { query, error, database, additionalPrompt }, { modelId, signal });
}

/**
 * Check if a query can be optimized (Lightweight check)
 * @param query - The SQL query to check
 */
export async function checkQueryOptimization(
  query: string,
  modelId?: string
): Promise<{ canOptimize: boolean; reason: string }> {
  return invokeAI("check-optimize", { query }, { modelId });
}

/**
 * Optimize a query straight from the Query Logs view by its query_id, using
 * Chouse AI's heavy-query engine. The backend pulls the FULL query text from
 * system.query_log (so it's never truncated like the preview), proposes an
 * optimized version under the hard requirements, and computes a before -> after
 * EXPLAIN estimate. Returns the same unified `QueryOptimization` shape as the
 * SQL editor's optimize-query, so both open the same dialog.
 */
export async function optimizeQueryFromLog(
  queryId: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<QueryOptimization> {
  return invokeAI<QueryOptimization>("optimize-log", { queryId }, { modelId, signal });
}

/** Active AI models available to the "Optimize with Chouse AI" picker. */
export async function fetchOptimizeModels(): Promise<FleetDoctorModel[]> {
  return fetchAiModels();
}

// ============================================
// Streaming query execution
// ============================================

/**
 * Callbacks for the NDJSON stream from /query/execute-stream.
 * All callbacks are called on the main thread as lines arrive.
 */
export interface QueryStreamCallbacks {
  /** Fired once when column names and types are known (very early). */
  onMeta: (meta: QueryMeta[], queryId: string) => void;
  /**
   * Fired for each batch of rows.  Batches are emitted roughly every 500 rows
   * or when the network chunk boundary falls — whichever comes first.
   */
  onRows: (rows: Record<string, unknown>[]) => void;
  /** Fired once when the stream ends normally. */
  onEnd: (stats: QueryStatistics, totalRows: number) => void;
  /** Fired if a server-side or network error interrupts the stream. */
  onError: (message: string) => void;
}

/**
 * Stream a SQL query from /query/execute-stream, calling the provided
 * callbacks as data arrives.  Rows are delivered in compact array form from
 * the server and reconstituted as `Record<string, unknown>` here using the
 * column names received in the meta line.
 *
 * Bypasses `ApiClient.request()` because the response is NDJSON, not the
 * standard `{success, data}` envelope.  Auth headers are added manually.
 */
export async function executeQueryStream(
  query: string,
  queryId: string | undefined,
  signal: AbortSignal | undefined,
  maxResultRows: number | undefined,
  callbacks: QueryStreamCallbacks
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  const sessionId = getSessionId();
  if (sessionId) headers["X-Session-ID"] = sessionId;

  const token = getRbacAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

  const response = await fetch(`${API_BASE_URL}/query/execute-stream`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ query, queryId, maxResultRows }),
    signal,
  });

  if (!response.ok) {
    // Non-streaming error (auth failure, 403, etc.)
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch { /* ignore */ }
    callbacks.onError(message);
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let names: string[] = [];

  // Row batch accumulator — flush to onRows every BATCH_SIZE rows
  const BATCH_SIZE = 500;
  const rowBatch: Record<string, unknown>[] = [];
  let totalRowsReceived = 0;

  const flushBatch = (): void => {
    if (rowBatch.length > 0) {
      callbacks.onRows(rowBatch.splice(0));
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete lines
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);

        if (!line) {
          nl = buffer.indexOf("\n");
          continue;
        }

        // Parse the line
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          nl = buffer.indexOf("\n");
          continue;
        }

        if (Array.isArray(parsed)) {
          // Compact data row: reconstruct as Record using column names.
          // Client-side cap: discard rows beyond maxResultRows even if the
          // server sends them (belt-and-suspenders — server should cap first).
          if (maxResultRows !== undefined && totalRowsReceived >= maxResultRows) {
            nl = buffer.indexOf("\n");
            continue;
          }
          const row: Record<string, unknown> = {};
          for (let i = 0; i < names.length; i++) {
            row[names[i]] = parsed[i] ?? null;
          }
          rowBatch.push(row);
          totalRowsReceived++;
          if (rowBatch.length >= BATCH_SIZE) flushBatch();
        } else if (parsed !== null && typeof parsed === "object") {
          const msg = parsed as Record<string, unknown>;
          if (msg.t === "m") {
            // Meta line
            names = msg.names as string[];
            const types = msg.types as string[];
            const meta: QueryMeta[] = names.map((name, i) => ({
              name,
              type: (types[i] ?? "String") as string,
            }));
            callbacks.onMeta(meta, (msg.qid as string) ?? queryId ?? "");
          } else if (msg.t === "e") {
            // End line — flush remaining rows first
            flushBatch();
            callbacks.onEnd(
              msg.stats as QueryStatistics ?? { elapsed: 0, rows_read: 0, bytes_read: 0 },
              (msg.rows as number) ?? 0
            );
          } else if (msg.t === "err") {
            flushBatch();
            callbacks.onError((msg.message as string) ?? "Unknown streaming error");
            return;
          }
        }

        nl = buffer.indexOf("\n");
      }
    }

    // Flush any partial last line (shouldn't normally happen)
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim()) as Record<string, unknown>;
        if (parsed.t === "e") {
          flushBatch();
          callbacks.onEnd(
            parsed.stats as QueryStatistics ?? { elapsed: 0, rows_read: 0, bytes_read: 0 },
            (parsed.rows as number) ?? 0
          );
        }
      } catch { /* ignore partial line */ }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      // Propagate abort so the caller can handle it silently
      throw error;
    }
    callbacks.onError(error instanceof Error ? error.message : String(error));
  } finally {
    reader.releaseLock();
  }
}

/** Chouse AI's diagnosis of a system.errors entry — cause + concrete fix steps. */
export interface ErrorDiagnosis {
  code?: number;
  name: string;
  summary: string;
  cause: string;
  impact: string;
  solutions: string[];
}

/**
 * Ask Chouse AI to diagnose a server error and propose a SOLUTION (not an
 * optimized query). The backend may inspect the node's system.* read-only to
 * ground the cause, then returns a structured diagnosis + ordered fix steps.
 */
export async function diagnoseServerError(
  name: string,
  code?: number,
  message?: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<ErrorDiagnosis> {
  return invokeAI<ErrorDiagnosis>("diagnose-error", { name, code, message }, { modelId, signal });
}

/**
 * Ask Chouse AI to diagnose the part/partition health of a table (Parts tab) and
 * propose a solution — too many parts, merge pressure, bad partition key, etc.
 */
export async function diagnoseTableParts(
  database: string,
  table: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<ErrorDiagnosis> {
  return invokeAI<ErrorDiagnosis>("diagnose-parts", { database, table }, { modelId, signal });
}

/**
 * Ask Chouse AI to diagnose a column-level schema issue surfaced by the Schema
 * Advisor (Nullable / oversized integer / weak compression) and propose a
 * concrete ALTER TABLE DDL — investigated read-only on the connected node.
 */
export async function diagnoseSchemaIssue(
  database: string,
  table: string,
  column: string,
  columnType: string,
  category: "nullable" | "oversized" | "compression",
  metrics?: { totalRows?: number; compressedBytes?: number; uncompressedBytes?: number },
  modelId?: string,
  signal?: AbortSignal,
): Promise<ErrorDiagnosis> {
  return invokeAI<ErrorDiagnosis>(
    "diagnose-schema",
    { database, table, column, columnType, category, metrics },
    { modelId, signal },
  );
}
