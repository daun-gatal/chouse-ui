/**
 * Undo adapters (ADR 0025 §1): how to read, compare, restore, delete and
 * re-create each kind of object a T1 action changes. Every step goes through
 * the same routes as the UI, as the person undoing.
 */

import type { ActionApi, ResourceKind } from "./types";
import { idOf } from "./toolkits/shared";

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
  recreate: async (api, before) => idOf(await api.post("/api/dashboards", before.document)),
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
  // A table Observe has not catalogued yet answers 404 but takes context: that is empty context, not a missing object.
  read: async (api, id) => contextBody(record((await readOrNull(() => api.get<Record<string, unknown>>(contextPath(id))))?.curated)),
  fingerprint: (state) => stableJson(pick(state, CONTEXT_FIELDS)),
  restore: async (api, id, before) => {
    await api.put(contextPath(id), contextBody(before));
  },
};

// ---------------------------------------------------------------------------
// Alert rules (no single-rule GET: read from the list)
// ---------------------------------------------------------------------------

const ALERT_RULE_FIELDS = ["name", "severity", "enabled", "aiRcaEnabled", "aiRcaModelId", "config", "channelIds"] as const;

const alertRule: ResourceAdapter = {
  read: async (api, id) => {
    const rules = await api.get<Array<Record<string, unknown>>>("/api/alerting/rules");
    return (Array.isArray(rules) ? rules : []).find((rule) => rule.id === id) ?? null;
  },
  fingerprint: (state) => stableJson(pick(state, ALERT_RULE_FIELDS)),
  restore: async (api, id, before) => {
    await api.put(`/api/alerting/rules/${seg(id)}`, pick(before, ALERT_RULE_FIELDS));
  },
  remove: async (api, id) => {
    await api.delete(`/api/alerting/rules/${seg(id)}`);
  },
  recreate: async (api, before) => idOf(await api.post("/api/alerting/rules", { ...pick(before, ALERT_RULE_FIELDS), sourceType: before.sourceType })),
};

// ---------------------------------------------------------------------------
// Context metrics, keyed by table and name (an upsert keeps the name)
// ---------------------------------------------------------------------------

/** A metric id: its database, table and name. */
export function metricKey(database: string, table: string, name: string): string {
  return JSON.stringify([database, table, name]);
}

function parseKey(id: string, size: number): string[] {
  const parsed: unknown = JSON.parse(id);
  if (!Array.isArray(parsed) || parsed.length !== size || parsed.some((part) => typeof part !== "string")) throw new Error("Invalid resource id");
  return parsed.filter((part): part is string => typeof part === "string");
}

const METRIC_FIELDS = ["name", "expression", "description", "owner"] as const;

async function findMetric(api: ActionApi, id: string): Promise<Record<string, unknown> | null> {
  const [database, table, name] = parseKey(id, 3);
  const listed = await api.get<{ metrics?: Array<Record<string, unknown>> }>("/api/context/metrics");
  return (listed.metrics ?? []).find((m) => m.database === database && m.table === table && m.name === name) ?? null;
}

const metric: ResourceAdapter = {
  read: findMetric,
  fingerprint: (state) => stableJson(pick(state, METRIC_FIELDS)),
  restore: async (api, id, before) => {
    const [database, table] = parseKey(id, 3);
    await api.put(`/api/context/tables/${seg(database)}/${seg(table)}/metrics`, pick(before, METRIC_FIELDS));
  },
  remove: async (api, id) => {
    const found = await findMetric(api, id);
    if (found && typeof found.id === "string") await api.delete(`/api/context/metrics/${seg(found.id)}`);
  },
  recreate: async (api, before) => {
    await api.put(`/api/context/tables/${seg(String(before.database))}/${seg(String(before.table))}/metrics`, pick(before, METRIC_FIELDS));
    return null;
  },
};

// ---------------------------------------------------------------------------
// Notebook cells ("<notebook id>:<cell id>")
// ---------------------------------------------------------------------------

function cellIds(id: string): [string, string] {
  const [notebookId, cellId] = id.split(":");
  if (!notebookId || !cellId) throw new Error("Invalid notebook cell id");
  return [notebookId, cellId];
}

const notebookCell: ResourceAdapter = {
  read: async (api, id) => {
    const [notebookId, cellId] = cellIds(id);
    const found = await readOrNull(() => api.get<{ cells?: Array<Record<string, unknown>> }>(`/api/notebooks/${seg(notebookId)}`));
    return found?.cells?.find((cell) => cell.id === cellId) ?? null;
  },
  fingerprint: (state) => stableJson({ kind: state.kind, content: state.content }),
  remove: async (api, id) => {
    const [notebookId, cellId] = cellIds(id);
    await api.delete(`/api/notebooks/${seg(notebookId)}/cells/${seg(cellId)}`);
  },
};

// ---------------------------------------------------------------------------
// Table criticality (Observe), keyed by table
// ---------------------------------------------------------------------------

const tableCriticality: ResourceAdapter = {
  read: async (api, id) => {
    const [database, table] = parseKey(id, 2);
    const listed = await api.get<{ tables?: Array<Record<string, unknown>> }>("/api/context/tables", { q: table });
    const found = (listed.tables ?? []).find((t) => t.database === database && t.table === table);
    return found ? { criticality: found.criticality ?? null } : null;
  },
  fingerprint: (state) => stableJson({ criticality: state.criticality ?? null }),
  restore: async (api, id, before) => {
    const [database, table] = parseKey(id, 2);
    await api.put(`/api/observe/datasets/${seg(database)}/${seg(table)}/criticality`, { criticality: before.criticality ?? null });
  },
};

// ---------------------------------------------------------------------------
// AI agents (read from the registry; deletes are versioned)
// ---------------------------------------------------------------------------

const AI_AGENT_FIELDS = ["slug", "name", "description", "systemPrompt", "tools", "skills", "subagents", "tuning", "harnessId", "modelConfigId", "enabled"] as const;

async function findAgent(api: ActionApi, id: string): Promise<Record<string, unknown> | null> {
  const registry = await api.get<{ agents?: Array<Record<string, unknown>> }>("/api/ai-agents/registry");
  return (registry.agents ?? []).find((agent) => agent.id === id) ?? null;
}

const aiAgent: ResourceAdapter = {
  read: findAgent,
  fingerprint: (state) => stableJson(pick(state, AI_AGENT_FIELDS)),
  remove: async (api, id) => {
    const found = await findAgent(api, id);
    if (found) await api.delete(`/api/ai-agents/agents/${seg(id)}?version=${encodeURIComponent(String(found.version))}`);
  },
};

export const RESOURCES: Record<ResourceKind, ResourceAdapter> = {
  saved_query: savedQuery,
  scheduled_query: scheduledQuery,
  health_promise: healthPromise,
  dashboard,
  table_context: tableContext,
  alert_rule: alertRule,
  metric,
  notebook_cell: notebookCell,
  table_criticality: tableCriticality,
  ai_agent: aiAgent,
};
