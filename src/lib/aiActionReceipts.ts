/**
 * Receipts for what an AI reply changed (ADR 0025): the actions its write
 * tools ran, filed or proposed, read from the tool results of the reply.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The action ids a reply's tool calls recorded, in order and once each. */
export function actionReceipts(toolCalls: ReadonlyArray<{ result?: unknown }> | null | undefined): string[] {
  const ids: string[] = [];
  for (const call of toolCalls ?? []) {
    const result = asRecord(call.result);
    if (!result || typeof result.actionId !== "string") continue;
    if (result.done !== true && result.submitted !== true && result.proposed !== true) continue;
    if (!ids.includes(result.actionId)) ids.push(result.actionId);
  }
  return ids;
}
