/**
 * Chobi API (ADR 0025 §6): the Now tab's briefing — built from data, no model
 * call — and the organization's Chobi settings.
 */

import { api } from "./client";

export type BriefingSeverity = "bad" | "warn" | "info";

export type BriefingRef =
  | { type: "incident"; source: string; id: string }
  | { type: "job"; id: string }
  | { type: "action"; id: string }
  | { type: "promise"; id: string };

export interface BriefingItem {
  /** Stable across briefings: a key Chobi has not seen before is news. */
  key: string;
  kind: "incident" | "schedule" | "connection" | "approval" | "watch";
  severity: BriefingSeverity;
  title: string;
  detail: string | null;
  at: number | null;
  connectionId: string | null;
  ref: BriefingRef | null;
}

export interface ConnectionBriefing {
  id: string;
  name: string;
  production: boolean;
  status: "ok" | "attention" | "unreachable";
  items: BriefingItem[];
}

export interface Briefing {
  generatedAt: number;
  general: BriefingItem[];
  connections: ConnectionBriefing[];
  ai: { changedToday: number; undoable: number };
  /** Sections the viewer cannot see or that failed to load. */
  unavailable: string[];
}

/** Need You alerts (ADR 0026): requests waiting on a person, sent to team channels. */
export interface ChobiAlerts {
  enabled: boolean;
  events: { secondApprover: boolean; background: boolean; heldMcp: boolean };
  /** Only alert once a request has waited this long. */
  delayMinutes: number;
  channels: Array<{ channelId: string; approveFromChat: boolean }>;
}

export interface ChobiSettings {
  /** The CHouse logo instead of the character. */
  plainMode: boolean;
  /** Chobi may point out news on its own. */
  nudges: boolean;
  alerts: ChobiAlerts;
  /** Suggest notes worth keeping after a conversation. */
  memorySuggestions: boolean;
  /** Whether the server knows its public address (alerts need it for their review link). */
  publicBaseUrl: boolean;
  updatedAt: number | null;
}

export async function getBriefing(fresh = false): Promise<Briefing> {
  return api.get<Briefing>("/chobi/briefing", { params: fresh ? { fresh: "1" } : undefined });
}

export async function getChobiSettings(): Promise<ChobiSettings> {
  return api.get<ChobiSettings>("/chobi/settings");
}

export async function updateChobiSettings(update: Partial<Pick<ChobiSettings, "plainMode" | "nudges" | "alerts" | "memorySuggestions">>): Promise<ChobiSettings> {
  return api.put<ChobiSettings>("/chobi/settings", update);
}
