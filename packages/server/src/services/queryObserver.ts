/**
 * Query observation hook (ADR 0020).
 *
 * Code that wants to see the ClickHouse queries run on its behalf — today the
 * AI usage recorder, around one AI tool call — runs that work inside
 * `observeQueries`. The query layer asks the active observer for a query id
 * and extra `log_comment` fields, and reports each query's statistics back.
 * Nothing is observed, and nothing changes, when no observer is active. The
 * tags go on the query, never on the client: ClientManager keys its client
 * cache on the client-level log_comment.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface ObservedQuery {
  queryId: string;
  /** The connection the query ran on, when the caller knows it. */
  connectionId?: string;
  sql: string;
  elapsedMs: number;
  readRows: number;
  readBytes: number;
  resultRows: number;
  /** Serialized size of the returned rows. */
  resultBytes: number;
  /** Output column names. */
  columns: string[];
  error?: string;
}

export interface QueryObserver {
  /** A query id to use when the caller did not choose one. */
  nextQueryId(): string;
  /** Fields merged into the query's `log_comment`. */
  logTags(): Record<string, string>;
  onQuery(query: ObservedQuery): void;
}

const storage = new AsyncLocalStorage<QueryObserver>();

export function observeQueries<T>(observer: QueryObserver, fn: () => Promise<T>): Promise<T> {
  return storage.run(observer, fn);
}

export function activeQueryObserver(): QueryObserver | undefined {
  return storage.getStore();
}

/** Report to the active observer, never letting an observer bug fail the query. */
export function reportQuery(observer: QueryObserver | undefined, query: ObservedQuery): void {
  if (!observer) return;
  try {
    observer.onQuery(query);
  } catch {
    // Observation is best-effort by design.
  }
}

/** Size of a value as the JSON the caller will pass on; 0 when it cannot be serialized. */
export function jsonSize(value: unknown): number {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text === undefined ? 0 : Buffer.byteLength(text, "utf8");
  } catch {
    return 0;
  }
}
