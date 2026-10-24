/**
 * Chobi's Now tab (ADR 0025 §6): what needs a look, built from data — no model
 * call. Every read goes through the existing API routes in-process as the
 * viewer, so the briefing shows exactly what the viewer could open themselves:
 * the same connection access, table access and feature permissions.
 */

import { environmentOf } from "../ai/actions/tiers";
import type { ActionApi } from "../ai/actions/types";
import { PERMISSIONS } from "../../rbac/schema/base";

export type BriefingSeverity = "bad" | "warn" | "info";

export interface BriefingItem {
  /** Stable across briefings, so the UI can tell a new item from one it already showed. */
  key: string;
  kind: "incident" | "schedule" | "connection" | "approval" | "watch";
  severity: BriefingSeverity;
  title: string;
  detail: string | null;
  /** When it started or last changed (ms). */
  at: number | null;
  connectionId: string | null;
  /** What to open: an incident, a scheduled job, an action. */
  ref: { type: "incident"; source: string; id: string } | { type: "job"; id: string } | { type: "action"; id: string } | { type: "promise"; id: string } | null;
}

export interface ConnectionBriefing {
  id: string;
  name: string;
  production: boolean;
  /** unreachable: the fleet poller could not read it; attention: it has items; ok: nothing to report. */
  status: "ok" | "attention" | "unreachable";
  items: BriefingItem[];
}

export interface Briefing {
  generatedAt: number;
  /** Approvals waiting for this viewer, and anything else not tied to one connection. */
  general: BriefingItem[];
  connections: ConnectionBriefing[];
  ai: { changedToday: number; undoable: number };
  /** Sections the viewer cannot see, or that failed to load, so the UI can say so instead of "all clear". */
  unavailable: string[];
}

export interface BriefingViewer {
  id: string;
  permissions: readonly string[];
  superAdmin: boolean;
}

interface ConnectionRow { id: string; name: string; metadata?: Record<string, unknown> | null }
interface IncidentRow { source: string; id: string; connectionId: string; title: string; status: string; severity: string; openedAt: number; lastEventAt: number; subject: string | null; rootCause: { summary: string } | null }
interface JobRow { id: string; name: string; kind: string; connectionId: string; enabled: boolean; lastRun: { status: string; error?: string | null; startedAt?: number | null; finishedAt?: number | null } | null }
/** `capturedAt` is in unix seconds, as the fleet poller stores it. */
interface SnapshotRow { connectionId: string; capturedAt: number; metrics: Record<string, { error: string | null } | undefined> }
interface Snapshots { connections: SnapshotRow[]; workerEnabled: boolean }
interface ActionRow { id: string; title: string; description: string; status: string; tier: string | null; source: string; origin: string; connectionId: string | null; createdAt: number; decidedAt: number | null; undoAvailable: boolean; canDecide: boolean; expiresAt: number }

const DAY_MS = 24 * 60 * 60 * 1000;
/** A fleet snapshot older than this says nothing about the connection now. */
const STALE_SNAPSHOT_MS = 10 * 60 * 1000;
/** Items per connection; the UI links to the full page for more. */
const MAX_ITEMS = 6;

const SEVERITY_RANK: Record<BriefingSeverity, number> = { bad: 0, warn: 1, info: 2 };

function can(viewer: BriefingViewer, ...permissions: string[]): boolean {
  return viewer.superAdmin || permissions.some((p) => viewer.permissions.includes(p));
}

function incidentSeverity(severity: string): BriefingSeverity {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high" || s === "error" || s === "unhealthy") return "bad";
  if (s === "info" || s === "low") return "info";
  return "warn";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

async function settle<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work };
  } catch {
    return { ok: false };
  }
}

function byPriority(a: BriefingItem, b: BriefingItem): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.at ?? 0) - (a.at ?? 0);
}

export async function buildBriefing(api: ActionApi, viewer: BriefingViewer, now: number = Date.now()): Promise<Briefing> {
  const seeIncidents = can(viewer, PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DATA_HEALTH_VIEW);
  const seeSchedules = can(viewer, PERMISSIONS.SCHEDULED_QUERIES_VIEW);
  const [connections, incidents, jobs, snapshots, inbox, activity] = await Promise.all([
    settle(api.get<ConnectionRow[]>("/api/rbac/connections/my")),
    seeIncidents ? settle(api.get<{ incidents: IncidentRow[] }>("/api/observe/incidents")) : Promise.resolve(null),
    seeSchedules ? settle(api.get<{ jobs: JobRow[] }>("/api/scheduled-queries")) : Promise.resolve(null),
    settle(api.get<Snapshots>("/api/fleet/snapshots")),
    settle(api.get<{ actions: ActionRow[] }>("/api/ai-actions/inbox")),
    settle(api.get<{ actions: ActionRow[] }>("/api/ai-actions/activity", { limit: "200" })),
  ]);

  const unavailable: string[] = [];
  if (!connections.ok) unavailable.push("connections");
  if (incidents === null) unavailable.push("incidents (needs observe:view or data_health:view)");
  else if (!incidents.ok) unavailable.push("incidents");
  if (jobs === null) unavailable.push("scheduled queries (needs scheduled_queries:view)");
  else if (!jobs.ok) unavailable.push("scheduled queries");
  if (!snapshots.ok) unavailable.push("fleet health");
  // Without the poller the snapshots are whatever was last written, which says nothing about now.
  else if (!snapshots.value.workerEnabled) unavailable.push("fleet health (the fleet poller is off)");

  const perConnection = new Map<string, BriefingItem[]>();
  const add = (connectionId: string, item: BriefingItem): void => {
    const list = perConnection.get(connectionId) ?? [];
    list.push(item);
    perConnection.set(connectionId, list);
  };

  for (const incident of incidents?.ok ? incidents.value.incidents : []) {
    add(incident.connectionId, {
      key: `incident:${incident.source}:${incident.id}`,
      kind: "incident",
      severity: incidentSeverity(incident.severity),
      title: incident.title,
      detail: incident.rootCause?.summary ?? incident.subject,
      at: incident.lastEventAt || incident.openedAt,
      connectionId: incident.connectionId,
      ref: { type: "incident", source: incident.source, id: incident.id },
    });
  }

  // Data Health checks run as scheduled jobs; their failures are already incidents.
  for (const job of jobs?.ok ? jobs.value.jobs : []) {
    const status = job.lastRun?.status;
    if (job.kind === "data_health_check" || !job.enabled || (status !== "failed" && status !== "error")) continue;
    add(job.connectionId, {
      key: `schedule:${job.id}:${job.lastRun?.startedAt ?? ""}`,
      kind: "schedule",
      severity: "warn",
      title: `${job.name} failed`,
      detail: job.lastRun?.error ?? null,
      at: job.lastRun?.finishedAt ?? job.lastRun?.startedAt ?? null,
      connectionId: job.connectionId,
      ref: { type: "job", id: job.id },
    });
  }

  const unreachable = new Set<string>();
  for (const snapshot of snapshots.ok && snapshots.value.workerEnabled ? snapshots.value.connections : []) {
    const error = snapshot.metrics.summary?.error ?? null;
    const capturedAt = snapshot.capturedAt * 1000;
    if (!error && now - capturedAt <= STALE_SNAPSHOT_MS) continue;
    if (error) unreachable.add(snapshot.connectionId);
    add(snapshot.connectionId, {
      key: `connection:${snapshot.connectionId}:${error ? "error" : "stale"}`,
      kind: "connection",
      severity: error ? "bad" : "info",
      title: error ? "Cannot reach the cluster" : "No fresh fleet data",
      detail: error ?? `Last snapshot ${Math.round((now - capturedAt) / 60_000)} minutes ago.`,
      at: capturedAt,
      connectionId: snapshot.connectionId,
      ref: null,
    });
  }

  const general: BriefingItem[] = [];
  const waiting = inbox.ok ? inbox.value.actions : [];
  const decidable = waiting.filter((a) => a.canDecide);
  if (decidable.length > 0) {
    const held = decidable.filter((a) => a.source === "held").length;
    general.push({
      key: `approvals:${decidable.map((a) => a.id).sort().join(",")}`,
      kind: "approval",
      severity: "warn",
      title: `${plural(decidable.length, "change")} waiting for your answer`,
      detail: held > 0 ? `${plural(held, "agent")} paused until you confirm.` : decidable.map((a) => a.title).slice(0, 3).join(" · "),
      at: Math.max(...decidable.map((a) => a.createdAt)),
      connectionId: null,
      ref: decidable.length === 1 ? { type: "action", id: decidable[0].id } : null,
    });
  }

  const today = (activity.ok ? activity.value.actions : []).filter((a) => (a.decidedAt ?? a.createdAt) >= now - DAY_MS && (a.status === "executed" || a.status === "approved"));

  // Only connections the viewer lists get a section: items for anything else are dropped, never shown loose.
  const connectionRows = connections.ok ? connections.value : [];
  const briefings: ConnectionBriefing[] = connectionRows.map((connection) => {
    const items = (perConnection.get(connection.id) ?? []).sort(byPriority).slice(0, MAX_ITEMS);
    return {
      id: connection.id,
      name: connection.name,
      production: environmentOf(connection.metadata) === "production",
      status: unreachable.has(connection.id) ? "unreachable" : items.length > 0 ? "attention" : "ok",
      items,
    };
  });

  return {
    generatedAt: now,
    general,
    connections: briefings,
    ai: { changedToday: today.length, undoable: today.filter((a) => a.undoAvailable).length },
    unavailable,
  };
}
