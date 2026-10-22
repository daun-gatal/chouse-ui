/**
 * Dashboard annotations and notes (ADR 0023 §5): what changed, read from what
 * CHouse already records in the RBAC database — never from ClickHouse, so a
 * dashboard's annotations add no load to the cluster it watches.
 *
 * Every source answers on its own: its events, or the reason it could not
 * (no permission, or a failure). A source the viewer may not read is reported
 * as such, never quietly left out. Events about a table the viewer may not
 * read are left out of that source, as the observability views do.
 */

import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";

import { PERMISSIONS } from "../../rbac/schema/base";
import { evaluateRules, getRulesForUser } from "../../rbac/services/dataAccess";
import { all, num, one, run, str, strOrNull } from "../observe/db";
import type { Permission } from "../../rbac/schema/base";
import { has, isAdmin, type Viewer } from "./access";
import type { AnnotationSource } from "./spec";

/** The most events one source returns, newest first. */
export const MAX_EVENTS_PER_SOURCE = 200;
export const MAX_NOTE_LENGTH = 500;

export interface AnnotationEvent {
  id: string;
  source: AnnotationSource;
  /** Unix milliseconds (UTC). */
  at: number;
  title: string;
  detail: string | null;
  /** The table or object it is about, when there is one. */
  objectRef: string | null;
  /** Notes only: who wrote it. */
  authorId?: string;
  authorName?: string | null;
}

export type SourceResult =
  | { source: AnnotationSource; ok: true; events: AnnotationEvent[]; truncated: boolean }
  | { source: AnnotationSource; ok: false; error: string };

export interface AnnotationQuery {
  viewer: Viewer;
  connectionId: string;
  dashboardId: string;
  fromMs: number;
  toMs: number;
}

type TablePredicate = (objectRef: string | null) => boolean;

/** Whether the viewer may read the table an event is about (admins: all; system tables: admins only, as in Observe). */
async function tablePredicate(viewer: Viewer, connectionId: string): Promise<TablePredicate> {
  if (isAdmin(viewer)) return () => true;
  const rules = await getRulesForUser(viewer.id, connectionId);
  return (objectRef) => {
    if (!objectRef) return true;
    const dot = objectRef.indexOf(".");
    const database = dot < 0 ? objectRef : objectRef.slice(0, dot);
    const table = dot < 0 ? null : objectRef.slice(dot + 1);
    if (["system", "information_schema", "INFORMATION_SCHEMA"].includes(database)) return false;
    return evaluateRules(rules, database, table).allowed;
  };
}

function capped(source: AnnotationSource, events: AnnotationEvent[]): SourceResult {
  return { source, ok: true, events: events.slice(0, MAX_EVENTS_PER_SOURCE), truncated: events.length > MAX_EVENTS_PER_SOURCE };
}

function parseDetails(raw: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(str(raw)) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const CHANGE_KINDS: Partial<Record<AnnotationSource, string>> = { ddl: "ddl", upgrades: "version", settings: "settings", writers: "writer" };

async function changeEvents(source: AnnotationSource, q: AnnotationQuery, allowed: TablePredicate): Promise<SourceResult> {
  const kind = CHANGE_KINDS[source];
  if (!kind) throw new Error(`${source} is not a change-event source`);
  const rows = await all(sql`
    SELECT id, occurred_at, node, object_ref, summary, details FROM obs_change_events
    WHERE connection_id = ${q.connectionId} AND kind = ${kind} AND occurred_at >= ${q.fromMs} AND occurred_at < ${q.toMs}
    ORDER BY occurred_at DESC LIMIT ${MAX_EVENTS_PER_SOURCE * 2}`);
  const events: AnnotationEvent[] = [];
  for (const r of rows) {
    const objectRef = strOrNull(r.object_ref);
    if (!allowed(objectRef)) continue;
    const details = parseDetails(r.details);
    const node = strOrNull(r.node);
    const title = source === "ddl"
      ? `${typeof details.kind === "string" ? details.kind.toUpperCase() : "DDL"}${objectRef ? ` ${objectRef}` : ""}`
      : source === "upgrades" ? `Upgraded${node ? ` ${node}` : ""}: ${str(r.summary)}`
        : str(r.summary);
    const user = typeof details.user === "string" ? details.user : null;
    events.push({
      id: `change:${str(r.id)}`,
      source,
      at: num(r.occurred_at),
      title,
      detail: source === "ddl" ? `${str(r.summary)}${user ? ` — by ${user}` : ""}` : null,
      objectRef,
    });
  }
  return capped(source, events);
}

async function alertEvents(q: AnnotationQuery): Promise<SourceResult> {
  // Only the alerts on this dashboard that watch the connection on view.
  const alerts = await all(sql`SELECT id, name FROM dashboard_alerts WHERE dashboard_id = ${q.dashboardId} AND connection_id = ${q.connectionId}`);
  if (alerts.length === 0) return capped("alerts", []);
  const names = new Map(alerts.map((a) => [str(a.id), str(a.name)]));
  const rows = await all(sql`
    SELECT id, rule_id, severity, fired_at, payload FROM alert_events
    WHERE rule_id IN (${sql.join([...names.keys()].map((id) => sql`${id}`), sql`, `)}) AND fired_at >= ${q.fromMs} AND fired_at < ${q.toMs}
    ORDER BY fired_at DESC LIMIT ${MAX_EVENTS_PER_SOURCE + 1}`);
  return capped("alerts", rows.map((r) => {
    const payload = parseDetails(r.payload);
    return {
      id: `alert:${str(r.id)}`,
      source: "alerts" as const,
      at: num(r.fired_at),
      title: typeof payload.title === "string" ? payload.title : names.get(str(r.rule_id)) ?? "Panel alert",
      detail: typeof payload.text === "string" ? payload.text : null,
      objectRef: null,
    };
  }));
}

async function incidentEvents(q: AnnotationQuery, allowed: TablePredicate): Promise<SourceResult> {
  const rows = await all(sql`
    SELECT id, kind, subject_ref, severity, summary, opened_at, recovered_at FROM obs_incidents
    WHERE connection_id = ${q.connectionId}
      AND ((opened_at >= ${q.fromMs} AND opened_at < ${q.toMs}) OR (recovered_at >= ${q.fromMs} AND recovered_at < ${q.toMs}))
    ORDER BY opened_at DESC LIMIT ${MAX_EVENTS_PER_SOURCE * 2}`);
  const events: AnnotationEvent[] = [];
  for (const r of rows) {
    const subject = strOrNull(r.subject_ref);
    // Subjects are tables (db.table) or other objects; only a table is checked against data access.
    if (subject && subject.includes(".") && !allowed(subject)) continue;
    const opened = num(r.opened_at);
    const recovered = r.recovered_at === null || r.recovered_at === undefined ? null : num(r.recovered_at);
    if (opened >= q.fromMs && opened < q.toMs) {
      events.push({ id: `incident:${str(r.id)}:open`, source: "incidents", at: opened, title: `Incident (${str(r.severity)}): ${str(r.summary)}`, detail: str(r.kind), objectRef: subject });
    }
    if (recovered !== null && recovered >= q.fromMs && recovered < q.toMs) {
      events.push({ id: `incident:${str(r.id)}:recovered`, source: "incidents", at: recovered, title: `Recovered: ${str(r.summary)}`, detail: str(r.kind), objectRef: subject });
    }
  }
  events.sort((a, b) => b.at - a.at);
  return capped("incidents", events);
}

async function fixEvents(q: AnnotationQuery): Promise<SourceResult> {
  const rows = await all(sql`
    SELECT e.id, e.status, e.finished_at, a.title, a.action_type FROM remediation_executions e
    JOIN remediation_actions a ON a.id = e.action_id
    WHERE a.connection_id = ${q.connectionId} AND e.status = 'succeeded' AND e.finished_at >= ${q.fromMs} AND e.finished_at < ${q.toMs}
    ORDER BY e.finished_at DESC LIMIT ${MAX_EVENTS_PER_SOURCE + 1}`);
  return capped("fixes", rows.map((r) => ({
    id: `fix:${str(r.id)}`,
    source: "fixes" as const,
    at: num(r.finished_at),
    title: `Fix applied: ${str(r.title)}`,
    detail: str(r.action_type),
    objectRef: null,
  })));
}

async function noteEvents(q: AnnotationQuery): Promise<SourceResult> {
  const rows = await all(sql`
    SELECT n.id, n.at, n.text, n.author_id, u.username AS author_name FROM dashboard_notes n
    LEFT JOIN rbac_users u ON u.id = n.author_id
    WHERE n.dashboard_id = ${q.dashboardId} AND n.connection_id = ${q.connectionId} AND n.at >= ${q.fromMs} AND n.at < ${q.toMs}
    ORDER BY n.at DESC LIMIT ${MAX_EVENTS_PER_SOURCE + 1}`);
  return capped("notes", rows.map((r) => ({
    id: str(r.id),
    source: "notes" as const,
    at: num(r.at),
    title: str(r.text),
    detail: null,
    objectRef: null,
    authorId: str(r.author_id),
    authorName: strOrNull(r.author_name),
  })));
}

/** What each source needs beyond view access to the dashboard. */
const NEEDS: Record<AnnotationSource, Permission | null> = {
  ddl: PERMISSIONS.OBSERVE_VIEW,
  upgrades: PERMISSIONS.OBSERVE_VIEW,
  settings: PERMISSIONS.OBSERVE_VIEW,
  writers: PERMISSIONS.OBSERVE_VIEW,
  alerts: PERMISSIONS.ALERTING_VIEW,
  incidents: PERMISSIONS.OBSERVE_VIEW,
  fixes: PERMISSIONS.OBSERVE_VIEW,
  notes: null,
};

/** Each source's events for the viewer and the connection on view (see the module comment). */
export async function loadAnnotations(q: AnnotationQuery, sources: AnnotationSource[]): Promise<SourceResult[]> {
  let allowed: TablePredicate | null = null;
  const predicate = async (): Promise<TablePredicate> => {
    allowed ??= await tablePredicate(q.viewer, q.connectionId);
    return allowed;
  };
  const results: SourceResult[] = [];
  for (const source of sources) {
    const needs = NEEDS[source];
    if (needs !== null && !has(q.viewer, needs)) {
      results.push({ source, ok: false, error: `Needs ${needs}` });
      continue;
    }
    try {
      if (source in CHANGE_KINDS) results.push(await changeEvents(source, q, await predicate()));
      else if (source === "alerts") results.push(await alertEvents(q));
      else if (source === "incidents") results.push(await incidentEvents(q, await predicate()));
      else if (source === "fixes") results.push(await fixEvents(q));
      else results.push(await noteEvents(q));
    } catch (error) {
      results.push({ source, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

// ============================================
// Notes
// ============================================

export interface NoteRecord {
  id: string;
  dashboardId: string;
  connectionId: string;
  at: number;
  text: string;
  authorId: string;
  createdAt: number;
}

export async function addNote(dashboardId: string, connectionId: string, at: number, text: string, authorId: string): Promise<NoteRecord> {
  const note: NoteRecord = { id: randomUUID(), dashboardId, connectionId, at, text, authorId, createdAt: Date.now() };
  await run(sql`INSERT INTO dashboard_notes (id, dashboard_id, connection_id, at, text, author_id, created_at)
    VALUES (${note.id}, ${dashboardId}, ${connectionId}, ${at}, ${text}, ${authorId}, ${note.createdAt})`);
  return note;
}

export async function getNote(dashboardId: string, noteId: string): Promise<NoteRecord | null> {
  const r = await one(sql`SELECT * FROM dashboard_notes WHERE id = ${noteId} AND dashboard_id = ${dashboardId}`);
  if (!r) return null;
  return { id: str(r.id), dashboardId: str(r.dashboard_id), connectionId: str(r.connection_id), at: num(r.at), text: str(r.text), authorId: str(r.author_id), createdAt: num(r.created_at) };
}

export async function deleteNote(noteId: string): Promise<void> {
  await run(sql`DELETE FROM dashboard_notes WHERE id = ${noteId}`);
}
