/**
 * Alert event history (Admin › Alerting): how one recorded event reads.
 */

/** One line for an event: panel alerts record JSON with a title and text, others plain text. */
export function eventSummary(payload: string | null): string {
  if (payload === null) return "—";
  if (!payload.startsWith("{")) return payload;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && (parsed as { source?: unknown }).source === "dashboard_panel_alert") {
      const { title, text } = parsed as { title?: unknown; text?: unknown };
      if (typeof title === "string" && typeof text === "string") return `${title} — ${text}`;
    }
  } catch {
    // Not JSON after all: show it as recorded.
  }
  return payload;
}
