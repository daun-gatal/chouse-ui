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

export interface ChobiSettings {
  /** The CHouse logo instead of the character. */
  plainMode: boolean;
  /** Chobi may point out news on its own. */
  nudges: boolean;
  updatedAt: number | null;
}

export async function getBriefing(fresh = false): Promise<Briefing> {
  return api.get<Briefing>("/chobi/briefing", { params: fresh ? { fresh: "1" } : undefined });
}

export async function getChobiSettings(): Promise<ChobiSettings> {
  return api.get<ChobiSettings>("/chobi/settings");
}

export async function updateChobiSettings(update: Partial<Pick<ChobiSettings, "plainMode" | "nudges">>): Promise<ChobiSettings> {
  return api.put<ChobiSettings>("/chobi/settings", update);
}
