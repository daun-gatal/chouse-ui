/**
 * "Who can act from this channel" (ADR 0026 §4): the allowlist a bot
 * channel's buttons answer to. People type platform entries — a Slack user or
 * user group ID, a Google email or domain, a Telegram user ID — and pick
 * CHouse users and roles; the list only narrows who can act.
 */

import { ChannelType } from "@/api/alerting";

export interface ChannelActors {
  mode: "any" | "only";
  platformUsers: string[];
  platformGroups: string[];
  domains: string[];
  users: string[];
  roles: string[];
}

export const ANYONE: ChannelActors = { mode: "any", platformUsers: [], platformGroups: [], domains: [], users: [], roles: [] };

/** The stored allowlist, or "anyone with the permission". */
export function actorsOf(config: Record<string, unknown>): ChannelActors {
  const raw = config.actors;
  if (!raw || typeof raw !== "object") return ANYONE;
  const r = raw as Partial<ChannelActors>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { mode: r.mode === "only" ? "only" : "any", platformUsers: list(r.platformUsers), platformGroups: list(r.platformGroups), domains: list(r.domains), users: list(r.users), roles: list(r.roles) };
}

export type PlatformField = "platformUsers" | "platformGroups" | "domains";

/** Where a typed entry goes for this platform, or why it does not fit. */
export function classifyEntry(type: ChannelType, text: string): { field: PlatformField; value: string } | { error: string } {
  const value = text.trim();
  if (!value) return { error: "Type an entry first" };
  if (type === ChannelType.Slack) {
    if (/^U[A-Z0-9]{6,20}$/.test(value) || /^W[A-Z0-9]{6,20}$/.test(value)) return { field: "platformUsers", value };
    if (/^S[A-Z0-9]{6,20}$/.test(value)) return { field: "platformGroups", value };
    return { error: "A Slack user ID looks like U0123ABCD, a user group ID like S0123ABCD" };
  }
  if (type === ChannelType.GoogleChat) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { field: "platformUsers", value: value.toLowerCase() };
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return { field: "domains", value: value.toLowerCase() };
    return { error: "Type an email (ana@example.com) or a domain (example.com)" };
  }
  if (type === ChannelType.Telegram) {
    if (/^\d{3,20}$/.test(value)) return { field: "platformUsers", value };
    return { error: "A Telegram user ID is a number" };
  }
  return { error: "This channel has no buttons" };
}

export const ENTRY_HINT: Partial<Record<ChannelType, string>> = {
  [ChannelType.Slack]: "Slack user ID (U…) or user group ID (S…)",
  [ChannelType.GoogleChat]: "Email or Workspace domain",
  [ChannelType.Telegram]: "Telegram user ID",
};

/** Add an entry, once. */
export function withEntry(actors: ChannelActors, field: keyof Omit<ChannelActors, "mode">, value: string): ChannelActors {
  if (actors[field].includes(value)) return actors;
  return { ...actors, [field]: [...actors[field], value] };
}

export function withoutEntry(actors: ChannelActors, field: keyof Omit<ChannelActors, "mode">, value: string): ChannelActors {
  return { ...actors, [field]: actors[field].filter((v) => v !== value) };
}

/** A one-line summary for lists: who can act from a channel. */
export function actorsSummary(actors: ChannelActors, roleNames: Map<string, string> = new Map()): string {
  if (actors.mode === "any") return "Anyone with the permission can act";
  const parts = [
    ...actors.platformGroups,
    ...actors.platformUsers,
    ...actors.domains,
    ...actors.roles.map((r) => `Role: ${roleNames.get(r) ?? r}`),
    ...(actors.users.length ? [`${actors.users.length} user${actors.users.length === 1 ? "" : "s"}`] : []),
  ];
  return parts.length ? `Only ${parts.join(", ")}` : "Nobody can act (the list is empty)";
}
