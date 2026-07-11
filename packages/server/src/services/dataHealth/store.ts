import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";

import { getDatabase, getDatabaseType, type PostgresDb, type SqliteDb } from "../../rbac/db";
import {
  dataHealthCheckDefinitionSchema,
  type DataHealthCheckDefinition,
  type DataHealthMetricEvaluation,
  type DataHealthIncidentKind,
  type DataHealthIncidentRow,
  type DataHealthIncidentStatus,
  type DataHealthIncidentTransition,
  type DataHealthPromiseRow,
  type DataHealthPromiseState,
  type DataHealthSampleRow,
} from "./types";

async function all(statement: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(statement) as Array<Record<string, unknown>>;
  }
  const result = await (db as PostgresDb).execute(statement);
  const rows = result as unknown as { rows?: Array<Record<string, unknown>> };
  return Array.isArray(result) ? result as unknown as Array<Record<string, unknown>> : rows.rows ?? [];
}

async function run(statement: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(statement);
    return;
  }
  await (db as PostgresDb).execute(statement);
}

const bool = (value: unknown): boolean => Number(value) === 1;
const nullableString = (value: unknown): string | null => value == null ? null : String(value);
const nullableNumber = (value: unknown): number | null => value == null ? null : Number(value);

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function promiseRow(row: Record<string, unknown>): DataHealthPromiseRow {
  const sourceType = row.source_type === "query" ? "query" : "table";
  const criticality = row.criticality === "critical" || row.criticality === "important" ? row.criticality : "standard";
  const statusValues: DataHealthPromiseState[] = ["healthy", "degraded", "unhealthy", "unknown", "paused"];
  const rawStatus = String(row.status);
  const status = statusValues.includes(rawStatus as DataHealthPromiseState) ? rawStatus as DataHealthPromiseState : "unknown";
  return {
    id: String(row.id),
    scheduledQueryId: String(row.scheduled_query_id),
    name: String(row.name),
    description: nullableString(row.description),
    connectionId: String(row.connection_id),
    sourceType,
    databaseName: nullableString(row.database_name),
    tableName: nullableString(row.table_name),
    sourceQuery: nullableString(row.source_query),
    eventTimeColumn: nullableString(row.event_time_column),
    rowFilter: nullableString(row.row_filter),
    ownerId: nullableString(row.owner_id),
    ownerDisplayName: nullableString(row.owner_display_name),
    criticality,
    timezone: String(row.timezone ?? "UTC"),
    runbookUrl: nullableString(row.runbook_url),
    enabled: bool(row.enabled),
    status,
    graceSecs: Number(row.grace_secs ?? 0),
    breachAfter: Number(row.breach_after ?? 2),
    recoverAfter: Number(row.recover_after ?? 2),
    retentionDays: Number(row.retention_days ?? 90),
    schemaSnapshot: parseJson<Array<{ name: string; type: string }>>(row.schema_snapshot),
    lastEvaluatedAt: nullableNumber(row.last_evaluated_at),
    lastHealthyAt: nullableNumber(row.last_healthy_at),
    createdBy: nullableString(row.created_by),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export interface CreatePromiseMetadataInput {
  scheduledQueryId: string;
  name: string;
  description: string | null;
  connectionId: string;
  sourceType: "table" | "query";
  databaseName: string | null;
  tableName: string | null;
  sourceQuery: string | null;
  eventTimeColumn: string | null;
  rowFilter: string | null;
  ownerId: string | null;
  criticality: DataHealthPromiseRow["criticality"];
  timezone: string;
  runbookUrl: string | null;
  enabled: boolean;
  graceSecs: number;
  breachAfter: number;
  recoverAfter: number;
  retentionDays: number;
  schemaSnapshot: Array<{ name: string; type: string }> | null;
  createdBy: string | null;
}

export async function listPromises(ownerId?: string | null): Promise<DataHealthPromiseRow[]> {
  const rows = ownerId
    ? await all(sql`
        SELECT p.*, COALESCE(u.display_name, u.username, u.email) AS owner_display_name
        FROM data_health_promises p
        LEFT JOIN rbac_users u ON u.id = p.owner_id
        WHERE p.owner_id = ${ownerId}
        ORDER BY p.name
      `)
    : await all(sql`
        SELECT p.*, COALESCE(u.display_name, u.username, u.email) AS owner_display_name
        FROM data_health_promises p
        LEFT JOIN rbac_users u ON u.id = p.owner_id
        ORDER BY p.name
      `);
  return rows.map(promiseRow);
}

export async function getPromise(id: string): Promise<DataHealthPromiseRow | null> {
  const rows = await all(sql`
    SELECT p.*, COALESCE(u.display_name, u.username, u.email) AS owner_display_name
    FROM data_health_promises p
    LEFT JOIN rbac_users u ON u.id = p.owner_id
    WHERE p.id = ${id}
    LIMIT 1
  `);
  return rows[0] ? promiseRow(rows[0]) : null;
}

export async function getPromiseByJobId(scheduledQueryId: string): Promise<DataHealthPromiseRow | null> {
  const rows = await all(sql`
    SELECT p.*, COALESCE(u.display_name, u.username, u.email) AS owner_display_name
    FROM data_health_promises p
    LEFT JOIN rbac_users u ON u.id = p.owner_id
    WHERE p.scheduled_query_id = ${scheduledQueryId}
    LIMIT 1
  `);
  return rows[0] ? promiseRow(rows[0]) : null;
}

export async function createPromiseMetadata(input: CreatePromiseMetadataInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const schemaSnapshot = input.schemaSnapshot ? JSON.stringify(input.schemaSnapshot) : null;
  await run(sql`
    INSERT INTO data_health_promises (
      id, scheduled_query_id, name, description, connection_id, source_type,
      database_name, table_name, source_query, event_time_column, row_filter,
      owner_id, criticality, timezone, runbook_url, enabled, status,
      grace_secs, breach_after, recover_after, retention_days, schema_snapshot,
      created_by, created_at, updated_at
    ) VALUES (
      ${id}, ${input.scheduledQueryId}, ${input.name}, ${input.description}, ${input.connectionId}, ${input.sourceType},
      ${input.databaseName}, ${input.tableName}, ${input.sourceQuery}, ${input.eventTimeColumn}, ${input.rowFilter},
      ${input.ownerId}, ${input.criticality}, ${input.timezone}, ${input.runbookUrl}, ${input.enabled ? 1 : 0}, 'unknown',
      ${input.graceSecs}, ${input.breachAfter}, ${input.recoverAfter}, ${input.retentionDays}, ${schemaSnapshot},
      ${input.createdBy}, ${now}, ${now}
    )
  `);
  return id;
}

export async function updatePromiseMetadata(id: string, input: CreatePromiseMetadataInput): Promise<boolean> {
  const existing = await getPromise(id);
  if (!existing) return false;
  const schemaSnapshot = input.schemaSnapshot ? JSON.stringify(input.schemaSnapshot) : null;
  await run(sql`
    UPDATE data_health_promises SET
      name = ${input.name}, description = ${input.description}, connection_id = ${input.connectionId},
      source_type = ${input.sourceType}, database_name = ${input.databaseName}, table_name = ${input.tableName},
      source_query = ${input.sourceQuery}, event_time_column = ${input.eventTimeColumn}, row_filter = ${input.rowFilter},
      owner_id = ${input.ownerId}, criticality = ${input.criticality}, timezone = ${input.timezone},
      runbook_url = ${input.runbookUrl}, enabled = ${input.enabled ? 1 : 0},
      status = CASE WHEN ${input.enabled ? 1 : 0} = 0 THEN 'paused' WHEN status = 'paused' THEN 'unknown' ELSE status END,
      grace_secs = ${input.graceSecs}, breach_after = ${input.breachAfter}, recover_after = ${input.recoverAfter},
      retention_days = ${input.retentionDays}, schema_snapshot = ${schemaSnapshot}, updated_at = ${Date.now()}
    WHERE id = ${id}
  `);
  return true;
}

export async function replaceChecks(promiseId: string, checks: DataHealthCheckDefinition[]): Promise<void> {
  const parsed = checks.map((check) => dataHealthCheckDefinitionSchema.parse(check));
  const existingRows = await all(sql`SELECT id, check_key FROM data_health_promise_checks WHERE promise_id = ${promiseId}`);
  const existingByKey = new Map(existingRows.map((row) => [String(row.check_key), String(row.id)]));
  const retainedIds = new Set<string>();
  const now = Date.now();
  for (let position = 0; position < parsed.length; position++) {
    const check = parsed[position];
    const existingId = existingByKey.get(check.checkKey);
    if (existingId) {
      retainedIds.add(existingId);
      await run(sql`
        UPDATE data_health_promise_checks SET
          type = ${check.type}, name = ${check.name}, severity = ${check.severity},
          config = ${JSON.stringify(check.config)}, enabled = ${check.enabled ? 1 : 0},
          position = ${position}, updated_at = ${now}
        WHERE id = ${existingId}
      `);
    } else {
      const id = randomUUID();
      retainedIds.add(id);
      await run(sql`
        INSERT INTO data_health_promise_checks (id, promise_id, check_key, type, name, severity, config, enabled, position, created_at, updated_at)
        VALUES (${id}, ${promiseId}, ${check.checkKey}, ${check.type}, ${check.name}, ${check.severity}, ${JSON.stringify(check.config)}, ${check.enabled ? 1 : 0}, ${position}, ${now}, ${now})
      `);
    }
  }
  for (const row of existingRows) {
    const id = String(row.id);
    if (!retainedIds.has(id)) await run(sql`DELETE FROM data_health_promise_checks WHERE id = ${id}`);
  }
}

export async function getChecks(promiseId: string): Promise<DataHealthCheckDefinition[]> {
  const rows = await all(sql`SELECT * FROM data_health_promise_checks WHERE promise_id = ${promiseId} ORDER BY position, check_key`);
  return rows.map((row) => dataHealthCheckDefinitionSchema.parse({
    checkKey: String(row.check_key),
    name: String(row.name),
    type: String(row.type),
    severity: String(row.severity),
    enabled: bool(row.enabled),
    config: parseJson<Record<string, unknown>>(row.config) ?? {},
  }));
}

export async function insertEvaluations(
  promiseId: string,
  runId: string,
  slotAt: number,
  evaluations: DataHealthMetricEvaluation[],
  origin: "live" | "backtest" = "live",
): Promise<void> {
  const checkRows = await all(sql`SELECT id, check_key FROM data_health_promise_checks WHERE promise_id = ${promiseId}`);
  const ids = new Map(checkRows.map((row) => [String(row.check_key), String(row.id)]));
  const now = Date.now();
  for (const evaluation of evaluations) {
    const checkId = ids.get(evaluation.checkKey);
    if (!checkId) continue;
    const evidence = JSON.stringify({ message: evaluation.message });
    if (getDatabaseType() === "sqlite") {
      await run(sql`
        INSERT OR IGNORE INTO data_health_samples (
          id, promise_id, check_id, run_id, origin, outcome, observed_value,
          expected_lower, expected_upper, evidence, slot_at, created_at
        ) VALUES (
          ${randomUUID()}, ${promiseId}, ${checkId}, ${runId}, ${origin}, ${evaluation.outcome}, ${evaluation.observedValue},
          ${evaluation.expectedLower}, ${evaluation.expectedUpper}, ${evidence}, ${slotAt}, ${now}
        )
      `);
    } else {
      await run(sql`
        INSERT INTO data_health_samples (
          id, promise_id, check_id, run_id, origin, outcome, observed_value,
          expected_lower, expected_upper, evidence, slot_at, created_at
        ) VALUES (
          ${randomUUID()}, ${promiseId}, ${checkId}, ${runId}, ${origin}, ${evaluation.outcome}, ${evaluation.observedValue},
          ${evaluation.expectedLower}, ${evaluation.expectedUpper}, ${evidence}, ${slotAt}, ${now}
        ) ON CONFLICT (check_id, slot_at, origin) DO NOTHING
      `);
    }
  }
}

export async function metricHistory(promiseId: string, limitPerCheck = 100): Promise<Record<string, number[]>> {
  const checks = await all(sql`SELECT id, check_key FROM data_health_promise_checks WHERE promise_id = ${promiseId}`);
  const history: Record<string, number[]> = {};
  for (const check of checks) {
    const rows = await all(sql`
      SELECT observed_value FROM data_health_samples
      WHERE check_id = ${String(check.id)} AND observed_value IS NOT NULL AND outcome IN ('pass', 'breach')
      ORDER BY slot_at DESC LIMIT ${limitPerCheck}
    `);
    history[String(check.check_key)] = rows.map((row) => Number(row.observed_value)).filter(Number.isFinite);
  }
  return history;
}

export async function updatePromiseEvaluation(id: string, state: Exclude<DataHealthPromiseState, "paused">, evaluatedAt: number): Promise<void> {
  const updatedAt = Date.now();
  if (state === "healthy") {
    await run(sql`
      UPDATE data_health_promises SET
        status = ${state}, last_evaluated_at = ${evaluatedAt},
        last_healthy_at = ${evaluatedAt}, updated_at = ${updatedAt}
      WHERE id = ${id}
    `);
    return;
  }
  await run(sql`
    UPDATE data_health_promises SET
      status = ${state}, last_evaluated_at = ${evaluatedAt}, updated_at = ${updatedAt}
    WHERE id = ${id}
  `);
}

function sampleRow(row: Record<string, unknown>): DataHealthSampleRow {
  const evidence = parseJson<Record<string, unknown>>(row.evidence);
  return {
    id: String(row.id),
    promiseId: String(row.promise_id),
    checkId: String(row.check_id),
    checkKey: String(row.check_key ?? row.check_id),
    runId: nullableString(row.run_id),
    origin: row.origin === "backtest" ? "backtest" : "live",
    outcome: row.outcome as DataHealthSampleRow["outcome"],
    observedValue: nullableNumber(row.observed_value),
    expectedLower: nullableNumber(row.expected_lower),
    expectedUpper: nullableNumber(row.expected_upper),
    evidence,
    slotAt: Number(row.slot_at),
    createdAt: Number(row.created_at),
  };
}

export async function listSamples(promiseId: string, limit = 200, offset = 0): Promise<DataHealthSampleRow[]> {
  const rows = await all(sql`
    SELECT s.*, c.check_key FROM data_health_samples s
    JOIN data_health_promise_checks c ON c.id = s.check_id
    WHERE s.promise_id = ${promiseId}
    ORDER BY s.slot_at DESC LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.map(sampleRow);
}

function incidentRow(row: Record<string, unknown>): DataHealthIncidentRow {
  const statusValues: DataHealthIncidentStatus[] = ["open", "acknowledged", "snoozed", "recovered"];
  const rawStatus = String(row.status);
  return {
    id: String(row.id),
    promiseId: String(row.promise_id),
    status: statusValues.includes(rawStatus as DataHealthIncidentStatus) ? rawStatus as DataHealthIncidentStatus : "open",
    severity: row.severity === "critical" ? "critical" : "warning",
    kind: row.kind === "execution" ? "execution" : "data",
    summary: String(row.summary),
    openedAt: Number(row.opened_at),
    acknowledgedBy: nullableString(row.acknowledged_by),
    acknowledgedAt: nullableNumber(row.acknowledged_at),
    snoozedUntil: nullableNumber(row.snoozed_until),
    recoveredAt: nullableNumber(row.recovered_at),
    lastEventAt: Number(row.last_event_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listIncidents(promiseId?: string, limit = 100, offset = 0): Promise<DataHealthIncidentRow[]> {
  const rows = promiseId
    ? await all(sql`SELECT * FROM data_health_incidents WHERE promise_id = ${promiseId} ORDER BY last_event_at DESC LIMIT ${limit} OFFSET ${offset}`)
    : await all(sql`SELECT * FROM data_health_incidents ORDER BY last_event_at DESC LIMIT ${limit} OFFSET ${offset}`);
  return rows.map(incidentRow);
}

export async function getIncident(id: string): Promise<DataHealthIncidentRow | null> {
  const rows = await all(sql`SELECT * FROM data_health_incidents WHERE id = ${id} LIMIT 1`);
  return rows[0] ? incidentRow(rows[0]) : null;
}

async function activeIncident(promiseId: string, kind: DataHealthIncidentKind): Promise<DataHealthIncidentRow | null> {
  const rows = await all(sql`
    SELECT * FROM data_health_incidents
    WHERE promise_id = ${promiseId} AND kind = ${kind} AND status <> 'recovered'
    ORDER BY opened_at DESC LIMIT 1
  `);
  return rows[0] ? incidentRow(rows[0]) : null;
}

async function addIncidentEvent(incidentId: string, type: string, runId: string | null, actorId: string | null, payload: Record<string, unknown>): Promise<void> {
  await run(sql`
    INSERT INTO data_health_incident_events (id, incident_id, type, actor_id, run_id, payload, created_at)
    VALUES (${randomUUID()}, ${incidentId}, ${type}, ${actorId}, ${runId}, ${JSON.stringify(payload)}, ${Date.now()})
  `);
}

async function consecutiveDataSlots(promiseId: string, expectBad: boolean, limit: number): Promise<number> {
  const rows = await all(sql`
    SELECT slot_at,
      MAX(CASE WHEN outcome = 'breach' THEN 1 ELSE 0 END) AS has_breach,
      MAX(CASE WHEN outcome = 'pass' THEN 1 ELSE 0 END) AS has_pass
    FROM data_health_samples
    WHERE promise_id = ${promiseId} AND origin = 'live'
    GROUP BY slot_at ORDER BY slot_at DESC LIMIT ${limit}
  `);
  let count = 0;
  for (const row of rows) {
    const matches = expectBad ? Number(row.has_breach) === 1 : Number(row.has_breach) === 0 && Number(row.has_pass) === 1;
    if (!matches) break;
    count++;
  }
  return count;
}

export async function transitionDataIncident(
  promise: DataHealthPromiseRow,
  state: Exclude<DataHealthPromiseState, "paused">,
  runId: string,
  summary: string,
): Promise<DataHealthIncidentTransition> {
  const isBad = state === "degraded" || state === "unhealthy";
  const active = await activeIncident(promise.id, "data");
  if (isBad) {
    const streak = await consecutiveDataSlots(promise.id, true, promise.breachAfter);
    if (streak < promise.breachAfter) return { type: "none", incident: active };
    const severity = state === "unhealthy" ? "critical" : "warning";
    const now = Date.now();
    if (!active) {
      const id = randomUUID();
      await run(sql`
        INSERT INTO data_health_incidents (
          id, promise_id, status, severity, kind, summary, opened_at,
          last_event_at, created_at, updated_at
        ) VALUES (${id}, ${promise.id}, 'open', ${severity}, 'data', ${summary}, ${now}, ${now}, ${now}, ${now})
      `);
      await addIncidentEvent(id, "opened", runId, null, { state, summary });
      return { type: "opened", incident: await getIncident(id) };
    }
    if (active.severity === "warning" && severity === "critical") {
      await run(sql`UPDATE data_health_incidents SET severity = 'critical', summary = ${summary}, last_event_at = ${now}, updated_at = ${now} WHERE id = ${active.id}`);
      await addIncidentEvent(active.id, "escalated", runId, null, { state, summary });
      return { type: "escalated", incident: await getIncident(active.id) };
    }
    await run(sql`UPDATE data_health_incidents SET summary = ${summary}, last_event_at = ${now}, updated_at = ${now} WHERE id = ${active.id}`);
    return { type: "none", incident: await getIncident(active.id) };
  }

  if (state === "healthy" && active) {
    const streak = await consecutiveDataSlots(promise.id, false, promise.recoverAfter);
    if (streak >= promise.recoverAfter) {
      const now = Date.now();
      await run(sql`UPDATE data_health_incidents SET status = 'recovered', recovered_at = ${now}, last_event_at = ${now}, updated_at = ${now} WHERE id = ${active.id}`);
      await addIncidentEvent(active.id, "recovered", runId, null, { state });
      return { type: "recovered", incident: await getIncident(active.id) };
    }
  }
  return { type: "none", incident: active };
}

export async function acknowledgeIncident(id: string, actorId: string): Promise<DataHealthIncidentRow | null> {
  const incident = await getIncident(id);
  if (!incident || incident.status === "recovered") return incident;
  const now = Date.now();
  await run(sql`UPDATE data_health_incidents SET status = 'acknowledged', acknowledged_by = ${actorId}, acknowledged_at = ${now}, updated_at = ${now} WHERE id = ${id}`);
  await addIncidentEvent(id, "acknowledged", null, actorId, {});
  return getIncident(id);
}

export async function snoozeIncident(id: string, actorId: string, until: number): Promise<DataHealthIncidentRow | null> {
  const incident = await getIncident(id);
  if (!incident || incident.status === "recovered") return incident;
  const now = Date.now();
  await run(sql`UPDATE data_health_incidents SET status = 'snoozed', snoozed_until = ${until}, updated_at = ${now} WHERE id = ${id}`);
  await addIncidentEvent(id, "snoozed", null, actorId, { until });
  return getIncident(id);
}
