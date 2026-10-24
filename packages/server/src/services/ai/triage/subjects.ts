/**
 * Auto-triage triggers (ADR 0024 §Phase 4): where new subjects come from.
 * Each trigger lists what appeared after a watermark, oldest first, and says
 * what the triage agent gets as evidence, which connection it investigates,
 * and which investigation notebook (if any) its findings go to.
 */

import { AlertSourceType } from "../../alerting/types";
import type { AttachedKind } from "../../notebooks/store";
import { all, json, num, one, sql, str, strOrNull } from "../../observe/db";
import { incidentDetail } from "../../observe/views";

export const TRIAGE_TRIGGERS = ["data_health_incident", "observe_incident", "fleet_alert", "scheduled_run_failed", "doctor_report"] as const;
export type TriageTrigger = (typeof TRIAGE_TRIGGERS)[number];

export const TRIGGER_LABELS: Record<TriageTrigger, string> = {
  data_health_incident: "Data Health incident",
  observe_incident: "Observe incident",
  fleet_alert: "Fleet alert",
  scheduled_run_failed: "Failed scheduled run",
  doctor_report: "Doctor report with findings",
};

export interface TriageSubject {
  trigger: TriageTrigger;
  id: string;
  title: string;
  /** When it appeared (ms): the rule's watermark moves past it. */
  at: number;
  /** The connection the agent investigates; null means every active connection. */
  connectionId: string | null;
  /** Where findings are written, when the subject has an investigation notebook. */
  notebook: { kind: AttachedKind; ref: string } | null;
  /** Where people open it in CHouse. */
  link: string;
  evidence: Record<string, unknown>;
}

/** How many new subjects one tick takes per trigger; the rest wait for the next tick. */
export const SUBJECTS_PER_TICK = 3;

async function dataHealthIncidents(since: number, limit: number): Promise<TriageSubject[]> {
  const rows = await all(sql`
    SELECT i.id, i.opened_at, i.summary, p.name AS promise_name, p.connection_id
    FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id
    WHERE i.opened_at > ${since} ORDER BY i.opened_at LIMIT ${limit}`);
  const out: TriageSubject[] = [];
  for (const r of rows) {
    const id = str(r.id);
    out.push({
      trigger: "data_health_incident", id, at: num(r.opened_at),
      title: `${str(r.promise_name)}: ${str(r.summary)}`,
      connectionId: str(r.connection_id),
      notebook: { kind: "incident_data_health", ref: id },
      link: `/data/incidents/data_health/${encodeURIComponent(id)}`,
      evidence: (await incidentDetail("data_health", id)) ?? {},
    });
  }
  return out;
}

async function observeIncidents(since: number, limit: number): Promise<TriageSubject[]> {
  const rows = await all(sql`SELECT id, opened_at, summary, connection_id FROM obs_incidents WHERE opened_at > ${since} ORDER BY opened_at LIMIT ${limit}`);
  const out: TriageSubject[] = [];
  for (const r of rows) {
    const id = str(r.id);
    out.push({
      trigger: "observe_incident", id, at: num(r.opened_at), title: str(r.summary),
      connectionId: str(r.connection_id),
      notebook: { kind: "incident_observe", ref: id },
      link: `/data/incidents/observe/${encodeURIComponent(id)}`,
      evidence: (await incidentDetail("observe", id)) ?? {},
    });
  }
  return out;
}

/** Fleet alerts are recorded as "node — metric: summary"; the node name finds the connection. */
async function fleetAlerts(since: number, limit: number): Promise<TriageSubject[]> {
  const rows = await all(sql`
    SELECT e.id, e.fired_at, e.severity, e.payload, r.name AS rule_name
    FROM alert_events e JOIN alert_rules r ON r.id = e.rule_id
    WHERE r.source_type = ${AlertSourceType.FleetThreshold} AND e.fired_at > ${since} ORDER BY e.fired_at LIMIT ${limit}`);
  const out: TriageSubject[] = [];
  for (const r of rows) {
    const payload = str(r.payload);
    const node = payload.split(" — ")[0]?.trim() ?? "";
    const conn = node ? await one(sql`SELECT id FROM rbac_clickhouse_connections WHERE name = ${node} LIMIT 1`) : null;
    out.push({
      trigger: "fleet_alert", id: str(r.id), at: num(r.fired_at), title: payload,
      connectionId: conn ? str(conn.id) : null,
      notebook: null,
      link: "/fleet",
      evidence: { rule: str(r.rule_name), severity: str(r.severity), alert: payload, node },
    });
  }
  return out;
}

async function failedScheduledRuns(since: number, limit: number): Promise<TriageSubject[]> {
  const rows = await all(sql`
    SELECT r.id, r.finished_at, r.status, r.trigger, r.message, r.duration_ms, r.attempt, r.slot_at,
           q.name, q.query, q.connection_id, q.frequency
    FROM scheduled_query_runs r JOIN scheduled_queries q ON q.id = r.query_id
    WHERE r.status IN ('failed', 'error') AND r.finished_at > ${since} ORDER BY r.finished_at LIMIT ${limit}`);
  return rows.map((r) => ({
    trigger: "scheduled_run_failed" as const,
    id: str(r.id), at: num(r.finished_at),
    title: `Scheduled query "${str(r.name)}" ${str(r.status)}`,
    connectionId: str(r.connection_id),
    notebook: null,
    link: "/data/scheduled-queries/jobs",
    evidence: {
      query: str(r.name), sql: str(r.query), frequency: str(r.frequency), status: str(r.status), trigger: str(r.trigger),
      error: strOrNull(r.message), durationMs: num(r.duration_ms), attempt: num(r.attempt), slotAt: num(r.slot_at),
    },
  }));
}

/** Doctor reports that found something; healthy ones need no triage. */
async function doctorReports(since: number, limit: number): Promise<TriageSubject[]> {
  const rows = await all(sql`
    SELECT id, created_at, status, summary, analysis FROM doctor_reports
    WHERE created_at > ${since} AND status IN ('warning', 'critical') ORDER BY created_at LIMIT ${limit}`);
  return rows.map((r) => {
    const analysis = json<Record<string, unknown>>(r.analysis, {});
    return {
      trigger: "doctor_report" as const,
      id: str(r.id), at: num(r.created_at),
      title: `Doctor report (${str(r.status)}): ${str(r.summary).slice(0, 160)}`,
      connectionId: null,
      notebook: { kind: "doctor_report" as const, ref: str(r.id) },
      link: `/doctor/${encodeURIComponent(str(r.id))}`,
      evidence: { status: str(r.status), summary: str(r.summary), verdict: analysis.verdict ?? null, nodes: analysis.nodes ?? [], recommendations: analysis.recommendations ?? [] },
    };
  });
}

const SOURCES: Record<TriageTrigger, (since: number, limit: number) => Promise<TriageSubject[]>> = {
  data_health_incident: dataHealthIncidents,
  observe_incident: observeIncidents,
  fleet_alert: fleetAlerts,
  scheduled_run_failed: failedScheduledRuns,
  doctor_report: doctorReports,
};

/** Subjects of `trigger` that appeared after `since`, oldest first. */
export async function newSubjects(trigger: TriageTrigger, since: number, limit = SUBJECTS_PER_TICK): Promise<TriageSubject[]> {
  return SOURCES[trigger](since, limit);
}
