/**
 * Undo adapters (ADR 0025 §1): how to read, compare, restore, delete and
 * re-create each kind of object a T1 action changes. Every step goes through
 * the same routes as the UI, as the person undoing.
 */

import type { ActionApi, ResourceKind } from "./types";

export interface ResourceAdapter {
  /** The object as it is now, or null when it is gone (or not visible to the caller). */
  read(api: ActionApi, id: string): Promise<Record<string, unknown> | null>;
  /** What "unchanged" means: undo refuses once this differs from right after the call. */
  fingerprint(state: Record<string, unknown>): string;
  restore?(api: ActionApi, id: string, before: Record<string, unknown>, current: Record<string, unknown>): Promise<void>;
  remove?(api: ActionApi, id: string): Promise<void>;
  /** Create the object again from its snapshot; returns the new id. */
  recreate?(api: ActionApi, before: Record<string, unknown>): Promise<string | null>;
}

export function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status: unknown }).status === 404);
}

async function readOrNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Key-sorted JSON, so the same object always prints the same way. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function pick(state: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, state[key] ?? null]));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function idOf(value: unknown): string | null {
  const id = record(value).id;
  return typeof id === "string" ? id : null;
}

const seg = (value: string): string => encodeURIComponent(value);

// ---------------------------------------------------------------------------
// Saved queries
// ---------------------------------------------------------------------------

const SAVED_QUERY_FIELDS = ["name", "query", "description", "isPublic", "connectionId", "connectionName"] as const;

const savedQuery: ResourceAdapter = {
  read: (api, id) => readOrNull(() => api.get<Record<string, unknown>>(`/api/saved-queries/${seg(id)}`)),
  fingerprint: (state) => stableJson(pick(state, SAVED_QUERY_FIELDS)),
  restore: async (api, id, before) => {
    await api.put(`/api/saved-queries/${seg(id)}`, {
      name: before.name,
      query: before.query,
      description: typeof before.description === "string" ? before.description : "",
      isPublic: before.isPublic === true,
      connectionId: before.connectionId ?? null,
      connectionName: before.connectionName ?? null,
    });
  },
  remove: async (api, id) => {
    await api.delete(`/api/saved-queries/${seg(id)}`);
  },
  recreate: async (api, before) => idOf(await api.post("/api/saved-queries", {
    connectionId: before.connectionId ?? null,
    connectionName: before.connectionName ?? null,
    name: before.name,
    query: before.query,
    description: typeof before.description === "string" ? before.description : undefined,
    isPublic: before.isPublic === true,
  })),
};

// ---------------------------------------------------------------------------
// Scheduled queries (the edit route takes the whole job)
// ---------------------------------------------------------------------------

export const SCHEDULED_JOB_FIELDS = [
  "name", "description", "connectionId", "query", "enabled", "frequency", "hour", "dayOfWeek", "dayOfMonth", "cronExpr",
  "timezone", "outputMode", "destDatabase", "destTable", "outputConfig", "maxRows", "timeoutSecs", "useFinal",
  "seqConsistency", "maxAttempts", "retentionDays", "channelIds",
] as const;

/** The body the scheduled-query routes accept, from a job as GET returns it. */
export function scheduledJobBody(job: Record<string, unknown>): Record<string, unknown> {
  const body = pick(job, SCHEDULED_JOB_FIELDS);
  if (!Array.isArray(body.channelIds)) body.channelIds = [];
  for (const key of Object.keys(body)) if (body[key] === null && !["description", "cronExpr", "destDatabase", "destTable", "outputConfig"].includes(key)) delete body[key];
  return body;
}

const scheduledQuery: ResourceAdapter = {
  read: (api, id) => readOrNull(() => api.get<Record<string, unknown>>(`/api/scheduled-queries/${seg(id)}`)),
  fingerprint: (state) => stableJson(scheduledJobBody(state)),
  restore: async (api, id, before) => {
    await api.patch(`/api/scheduled-queries/${seg(id)}`, scheduledJobBody(before));
  },
  remove: async (api, id) => {
    await api.delete(`/api/scheduled-queries/${seg(id)}`);
  },
  recreate: async (api, before) => idOf(await api.post("/api/scheduled-queries", scheduledJobBody(before))),
};

// ---------------------------------------------------------------------------
// Data Health promises (the edit route takes the whole promise)
// ---------------------------------------------------------------------------

/** The body the Data Health routes accept, from a promise as GET returns it. */
export function healthPromiseBody(promise: Record<string, unknown>): Record<string, unknown> {
  const schedule = record(promise.schedule);
  const optional = (key: string): Record<string, unknown> => (promise[key] != null ? { [key]: promise[key] } : {});
  const source = promise.sourceType === "query"
    ? { sourceType: "query", sourceQuery: promise.sourceQuery }
    : { sourceType: "table", databaseName: promise.databaseName, tableName: promise.tableName };
  return {
    name: promise.name,
    description: promise.description ?? null,
    connectionId: promise.connectionId,
    source: {
      ...source,
      ...optional("eventTimeColumn"),
      ...optional("eventTimeType"),
      ...optional("eventTimeEncoding"),
      ...optional("eventTimeTimezone"),
      rowFilter: promise.rowFilter ?? null,
    },
    ownerId: promise.ownerId ?? null,
    criticality: promise.criticality ?? "standard",
    timezone: "UTC",
    runbookUrl: promise.runbookUrl ?? null,
    enabled: promise.enabled !== false,
    frequency: schedule.frequency,
    upstreamJobId: promise.upstreamJobId ?? null,
    hour: schedule.hour ?? 8,
    dayOfWeek: schedule.dayOfWeek ?? 1,
    dayOfMonth: schedule.dayOfMonth ?? 1,
    cronExpr: schedule.cronExpr ?? null,
    graceSecs: promise.graceSecs ?? 0,
    breachAfter: promise.breachAfter ?? 2,
    recoverAfter: promise.recoverAfter ?? 2,
    retentionDays: promise.retentionDays ?? 90,
    timeoutSecs: schedule.timeoutSecs ?? 60,
    channelIds: Array.isArray(promise.channelIds) ? promise.channelIds : [],
    checks: Array.isArray(promise.checks) ? promise.checks : [],
    runNow: false,
  };
}

const healthPromise: ResourceAdapter = {
  read: (api, id) => readOrNull(() => api.get<Record<string, unknown>>(`/api/data-health/${seg(id)}`)),
  fingerprint: (state) => stableJson(healthPromiseBody(state)),
  restore: async (api, id, before) => {
    await api.patch(`/api/data-health/${seg(id)}`, healthPromiseBody(before));
  },
  remove: async (api, id) => {
    await api.delete(`/api/data-health/${seg(id)}`);
  },
  recreate: async (api, before) => idOf(await api.post("/api/data-health", healthPromiseBody(before))),
};

// ---------------------------------------------------------------------------
// Dashboards (the document from /export; edits are versioned)
// ---------------------------------------------------------------------------

const dashboard: ResourceAdapter = {
  read: async (api, id) => {
    const exported = await readOrNull(() => api.get<Record<string, unknown>>(`/api/dashboards/${seg(id)}/export`));
    if (!exported) return null;
    const detail = await api.get<Record<string, unknown>>(`/api/dashboards/${seg(id)}`);
    return { document: record(exported.dashboard), version: record(detail.dashboard).version ?? null };
  },
  fingerprint: (state) => stableJson(state.document),
  restore: async (api, id, before, current) => {
    await api.put(`/api/dashboards/${seg(id)}`, { version: current.version, dashboard: before.document });
  },
  remove: async (api, id) => {
    await api.delete(`/api/dashboards/${seg(id)}`);
  },
  recreate: async (api, before) => {
    const created = await api.post<Record<string, unknown>>("/api/dashboards", before.document);
    return idOf(record(created.dashboard)) ?? idOf(created);
  },
};

// ---------------------------------------------------------------------------
// Table context (curated fields of one table)
// ---------------------------------------------------------------------------

const CONTEXT_FIELDS = ["description", "grain", "owner", "insteadOf", "deprecated", "tags"] as const;

/** A table context id: the database and table, JSON-encoded so names with dots stay unambiguous. */
export function tableContextId(database: string, table: string): string {
  return JSON.stringify([database, table]);
}

function contextPath(id: string): string {
  const parsed: unknown = JSON.parse(id);
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    throw new Error("Invalid table context id");
  }
  return `/api/context/tables/${seg(parsed[0])}/${seg(parsed[1])}`;
}

function contextBody(curated: Record<string, unknown>): Record<string, unknown> {
  return {
    description: curated.description ?? null,
    grain: curated.grain ?? null,
    owner: curated.owner ?? null,
    insteadOf: curated.insteadOf ?? null,
    deprecated: curated.deprecated === true,
    tags: Array.isArray(curated.tags) ? curated.tags : [],
  };
}

const tableContext: ResourceAdapter = {
  read: async (api, id) => {
    const found = await readOrNull(() => api.get<Record<string, unknown>>(contextPath(id)));
    return found ? contextBody(record(found.curated)) : null;
  },
  fingerprint: (state) => stableJson(pick(state, CONTEXT_FIELDS)),
  restore: async (api, id, before) => {
    await api.put(contextPath(id), contextBody(before));
  },
};

export const RESOURCES: Record<ResourceKind, ResourceAdapter> = {
  saved_query: savedQuery,
  scheduled_query: scheduledQuery,
  health_promise: healthPromise,
  dashboard,
  table_context: tableContext,
};
