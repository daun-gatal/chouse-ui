/**
 * Helpers for approving AI actions (ADR 0024 §Phase 2): the chat approval card
 * and AI Governance › Approvals.
 */

/** "14:05" until it expires, "0:00" once it has. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** "in 3h", "in 12m", "in 40s", or "expired" — for longer waits than a chat's. */
export function expiresIn(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  if (ms >= 3_600_000) return `in ${Math.floor(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `in ${Math.floor(ms / 60_000)}m`;
  return `in ${Math.ceil(ms / 1000)}s`;
}

/** Arguments as the editor shows them. */
export function argsToText(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

/** Read edited arguments; the server still validates them against the tool. */
export function parseArgsText(text: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Enter a JSON object, like the one shown." };
  return { ok: true, args: parsed as Record<string, unknown> };
}

/** Argument pairs worth showing on a card: scalars as text, the rest as compact JSON, long values cut. */
export function argRows(args: Record<string, unknown>, max = 160): Array<[string, string]> {
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return [key, text.length > max ? `${text.slice(0, max - 1)}…` : text];
    });
}
