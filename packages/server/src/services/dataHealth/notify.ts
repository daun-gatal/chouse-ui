/**
 * Data Health alerts in chat (ADR 0026 §6): an open incident's alert carries
 * Acknowledge and Snooze 1h; whenever the incident changes — from chat, from
 * CHouse, or when it recovers — every message about it shows its state, and
 * once it recovers the messages are closed.
 */

import { editSubject, type NotifyMessage } from "../alerting/notify";
import { registerChatAction } from "../alerting/notify/actions";
import { userNames } from "../ai/actions/store";
import { logger } from "../../utils/logger";
import * as store from "./store";
import type { DataHealthIncidentRow } from "./types";

export const SNOOZE_FROM_CHAT_MS = 60 * 60_000;

export function incidentPath(id: string): string {
  return `/data/incidents/data_health/${encodeURIComponent(id)}`;
}

/** The buttons an incident's alert offers in its current state. */
export function incidentButtons(incident: Pick<DataHealthIncidentRow, "id" | "status">): NonNullable<NotifyMessage["buttons"]> {
  if (incident.status === "recovered") return [];
  const buttons: NonNullable<NotifyMessage["buttons"]> = [];
  if (incident.status !== "acknowledged") buttons.push({ action: "data_health.ack", label: "Acknowledge", value: incident.id, style: "primary" });
  if (incident.status !== "snoozed") buttons.push({ action: "data_health.snooze", label: "Snooze 1h", value: incident.id });
  return buttons;
}

function clock(ms: number): string {
  return new Date(ms).toUTCString().replace(/:\d\d GMT$/, " UTC");
}

/** One line on where the incident stands. */
export function incidentStatusLine(incident: DataHealthIncidentRow, names: Map<string, string>): string {
  const who = incident.acknowledgedBy ? names.get(incident.acknowledgedBy) ?? "someone" : "someone";
  switch (incident.status) {
    case "acknowledged":
      return `Acknowledged by ${who}`;
    case "snoozed":
      return `Snoozed until ${clock(incident.snoozedUntil ?? Date.now())}`;
    case "recovered":
      return `Recovered ${clock(incident.recoveredAt ?? Date.now())}`;
    default:
      return "Open";
  }
}

/** The alert as posted, with its status line and buttons brought up to date. */
export function withIncidentState(posted: NotifyMessage, incident: DataHealthIncidentRow, names: Map<string, string>): NotifyMessage {
  const facts = (posted.facts ?? []).filter((f) => f.label !== "Status");
  return {
    ...posted,
    severity: incident.status === "recovered" ? "success" : posted.severity,
    facts: [...facts, { label: "Status", value: incidentStatusLine(incident, names) }],
    buttons: incidentButtons(incident),
  };
}

/** Bring every message about this incident up to date. Never throws. */
export async function refreshIncidentMessages(incidentId: string): Promise<void> {
  try {
    const incident = await store.getIncident(incidentId);
    if (!incident) return;
    const names = await userNames([incident.acknowledgedBy]);
    await editSubject("data_health", incidentId, (posted) => withIncidentState(posted, incident, names), { close: incident.status === "recovered" });
  } catch (error) {
    logger.warn({ module: "DataHealth", incidentId, err: error instanceof Error ? error.message : String(error) }, "Could not update the incident's chat messages");
  }
}

registerChatAction({
  action: "data_health.ack",
  run: async (api, incidentId) => {
    await api.post(`/api/data-health/incidents/${encodeURIComponent(incidentId)}/acknowledge`, {});
    return "Acknowledged.";
  },
});

registerChatAction({
  action: "data_health.snooze",
  run: async (api, incidentId) => {
    await api.post(`/api/data-health/incidents/${encodeURIComponent(incidentId)}/snooze`, { until: Date.now() + SNOOZE_FROM_CHAT_MS });
    return "Snoozed for an hour.";
  },
});
