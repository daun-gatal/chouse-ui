/**
 * The `readonly` level a request carries (ADR 0033 §4). It comes from the
 * person's permissions and from ClickHouse's parse of the statement, never
 * from CHouse reading the text, so a write that CHouse took for a read is
 * refused by ClickHouse (code 164) instead of running.
 */

import type { CheckedStatement } from "./checked";

/** `1` refuses every change including settings; `2` refuses writes and lets a statement set its own settings. */
export type ReadOnlyLevel = 1 | 2;

/**
 * The level for a checked statement. A feature that only reads names its own
 * level. Otherwise a statement gets `2` when the person may write nothing, or
 * when the statement is a read; a write from a person who may write gets none.
 */
export function readonlyFor(statement: CheckedStatement, feature?: ReadOnlyLevel): "1" | "2" | undefined {
  if (feature === 1 || feature === 2) return feature === 1 ? "1" : "2";
  if (!statement.mayWrite || statement.isRead) return "2";
  return undefined;
}
