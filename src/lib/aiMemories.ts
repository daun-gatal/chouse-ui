/**
 * Helpers for AI memory (ADR 0024 §Phase 3) in the chat and in
 * AI Governance › Memories.
 */

/** A note the assistant kept during a reply, as the chat shows it with an undo. */
export interface SavedMemoryNote {
  memoryId: string;
  scope: "user" | "connection";
  status: "active" | "proposed";
  note: string;
}

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

/**
 * Notes a reply kept: successful `remember` calls, once each. A note that was
 * already known is left out (nothing new to undo).
 */
export function savedMemories(toolCalls: ReadonlyArray<{ name: string; result?: unknown }> | null | undefined): SavedMemoryNote[] {
  const out: SavedMemoryNote[] = [];
  for (const call of toolCalls ?? []) {
    if (call.name !== "remember") continue;
    const result = asRecord(call.result);
    if (!result || result.saved !== true || result.alreadyKnown === true) continue;
    const { memoryId, scope, status, note } = result;
    if (typeof memoryId !== "string" || typeof note !== "string") continue;
    if (out.some((m) => m.memoryId === memoryId)) continue;
    out.push({
      memoryId,
      scope: scope === "connection" ? "connection" : "user",
      status: status === "proposed" ? "proposed" : "active",
      note,
    });
  }
  return out;
}

/** The export as a file the user can save. */
export function memoryExportFile(exportedAt: string, memories: unknown[]): { name: string; text: string } {
  const day = exportedAt.slice(0, 10);
  return { name: `chouse-memories-${day}.json`, text: `${JSON.stringify({ exportedAt, memories }, null, 2)}\n` };
}
