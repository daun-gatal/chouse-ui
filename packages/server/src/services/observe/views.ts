/**
 * Read models for the ADR 0016 API. Every function takes the caller's table
 * predicate so nothing about a table the user may not read leaves the server.
 */

import { all, json, num, numOrNull, one, sql, str, strOrNull, type Row } from "./db";
import { downstreamOf, upstreamOf, type GraphEdge } from "./rca";
import { getStoredRca } from "./rcaService";
import { getObserveIncident, listObserveIncidents, type IncidentSource } from "./incidents";
import { checkVolume, type VolumeBand } from "./baselines";

export type Allowed = (database: string | null | undefined, table: string | null | undefined) => boolean;

function nodeOk(allowed: Allowed, nodeId: string | null): boolean {
  if (!nodeId || !nodeId.startsWith("table:")) return true;
  const fq = nodeId.slice(6);
  const dot = fq.indexOf(".");
  return allowed(fq.slice(0, dot), fq.slice(dot + 1));
}

// --- collector status ---------------------------------------------------------

export async function collectorStatus(connectionId: string): Promise<{ collectors: Row[]; serverVersion: string | null; probedAt: number | null }> {
  const collectors = (await all(sql`SELECT * FROM obs_collector_status WHERE connection_id = ${connectionId} ORDER BY collector`)).map((r) => ({
    collector: str(r.collector),
    state: str(r.state),
    lastRunAt: numOrNull(r.last_run_at),
    lastOkAt: numOrNull(r.last_ok_at),
    lastError: strOrNull(r.last_error),
    missingPrivileges: json<string[] | null>(r.missing_privileges, null),
    durationMs: numOrNull(r.duration_ms),
  }));
  const caps = await one(sql`SELECT server_version, probed_at FROM obs_capabilities WHERE connection_id = ${connectionId}`);
  return { collectors, serverVersion: caps ? strOrNull(caps.server_version) : null, probedAt: caps ? numOrNull(caps.probed_at) : null };
}

// --- datasets -------------------------------------------------------------------

export interface DatasetSummary {
  database: string;
  table: string;
  state: string;
  stateReason: string | null;
  criticality: string;
  criticalityPinned: boolean;
  lastWriteAt: number | null;
  cadenceSeconds: number | null;
  readers7d: number;
  reads7d: number;
  totalRows: number | null;
  totalBytes: number | null;
  engine: string | null;
  hasPromise: boolean;
  openIncident: boolean;
}

export async function listDatasets(connectionId: string, allowed: Allowed, filter: { q?: string; state?: string; criticality?: string } = {}): Promise<DatasetSummary[]> {
  const rows = await all(sql`
    SELECT b.*, t.engine FROM obs_table_baselines b
    LEFT JOIN obs_catalog_tables t ON t.connection_id = b.connection_id AND t.database_name = b.database_name AND t.table_name = b.table_name
    WHERE b.connection_id = ${connectionId}`);
  const promises = await all(sql`SELECT database_name, table_name, id FROM data_health_promises WHERE connection_id = ${connectionId}`);
  const promised = new Set(promises.map((p) => `${str(p.database_name)}.${str(p.table_name)}`));
  const openIncidents = new Set((await all(sql`
    SELECT p.database_name, p.table_name FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id
    WHERE p.connection_id = ${connectionId} AND i.status <> 'recovered'`)).map((r) => `${str(r.database_name)}.${str(r.table_name)}`));
  const q = filter.q?.toLowerCase();
  return rows
    .filter((r) => allowed(str(r.database_name), str(r.table_name)))
    .filter((r) => !q || `${str(r.database_name)}.${str(r.table_name)}`.toLowerCase().includes(q))
    .filter((r) => !filter.state || str(r.state) === filter.state)
    .filter((r) => !filter.criticality || str(r.criticality) === filter.criticality)
    .map((r) => {
      const fq = `${str(r.database_name)}.${str(r.table_name)}`;
      return {
        database: str(r.database_name),
        table: str(r.table_name),
        state: str(r.state),
        stateReason: strOrNull(r.state_reason),
        criticality: str(r.criticality),
        criticalityPinned: num(r.criticality_pinned) === 1,
        lastWriteAt: numOrNull(r.last_write_at),
        cadenceSeconds: numOrNull(r.cadence_p50_s),
        readers7d: num(r.readers_7d),
        reads7d: num(r.reads_7d),
        totalRows: numOrNull(r.total_rows),
        totalBytes: numOrNull(r.total_bytes),
        engine: strOrNull(r.engine),
        hasPromise: promised.has(fq),
        openIncident: openIncidents.has(fq),
      };
    })
    .sort((a, b) => impact(b) - impact(a));
}

function impact(d: DatasetSummary): number {
  const severity = d.state === "stale" ? 3 : d.state === "degraded" ? 2 : 0;
  return (d.reads7d + 1) * Math.log2(2 + d.readers7d) * (1 + severity * 10) * (d.criticality === "critical" ? 3 : d.criticality === "important" ? 2 : 1);
}

export async function datasetDetail(connectionId: string, database: string, table: string, canSeeQueryText: boolean): Promise<Record<string, unknown> | null> {
  const baseline = await one(sql`SELECT * FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  const catalog = await one(sql`SELECT * FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  if (!baseline && !catalog) return null;
  const now = Date.now();
  const hours = (await all(sql`
    SELECT sampled_at, rows_added, bytes_added FROM obs_table_samples
    WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND granularity = 'hour' AND sampled_at >= ${now - 48 * 3600 * 1000}
    ORDER BY sampled_at`)).map((h) => ({ hour: num(h.sampled_at), rows: num(h.rows_added), bytes: num(h.bytes_added) }));
  const band = baseline ? json<VolumeBand>(baseline.volume_band, {}) : {};
  const volume = hours.map((h) => {
    const v = checkVolume(band, h.hour, h.rows);
    return { ...h, expected: v.expected, lower: v.lower, upper: v.upper };
  });
  const profiles = await all(sql`
    SELECT * FROM obs_column_profiles WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND profiled_at >= ${now - 14 * 86_400_000}
    ORDER BY column_name, profiled_at`);
  const drift = new Map<string, Array<Record<string, unknown>>>();
  for (const p of profiles) {
    const list = drift.get(str(p.column_name)) ?? [];
    list.push({ at: num(p.profiled_at), nullRatio: numOrNull(p.null_ratio), distinct: numOrNull(p.distinct_count), p50: numOrNull(p.p50), p95: numOrNull(p.p95), top: json(p.top_values, []) });
    drift.set(str(p.column_name), list);
  }
  const schemaHistory = (await all(sql`
    SELECT occurred_at, summary, details FROM obs_change_events WHERE connection_id = ${connectionId} AND kind = 'ddl' AND object_ref = ${`${database}.${table}`}
    ORDER BY occurred_at DESC LIMIT 50`)).map((e) => ({ at: num(e.occurred_at), summary: str(e.summary), details: json(e.details, {}) }));
  const usage = (await all(sql`
    SELECT principal_kind, COUNT(DISTINCT principal_id) AS principals, SUM(reads) AS reads, SUM(read_bytes) AS bytes FROM obs_usage_rollups
    WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND principal_kind <> '_filters' AND day >= ${now - 7 * 86_400_000}
    GROUP BY principal_kind`)).map((u) => ({ kind: str(u.principal_kind), principals: num(u.principals), reads: num(u.reads), bytes: num(u.bytes) }));
  const filtersRow = await one(sql`SELECT filter_columns FROM obs_usage_rollups WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND principal_kind = '_filters'`);
  const filterCounts = filtersRow ? json<Record<string, number>>(filtersRow.filter_columns, {}) : {};
  const sortingKey = catalog ? str(catalog.sorting_key) : "";
  const keyColumns = sortingKey.split(",").map((k) => k.trim().replace(/^.*\(|\).*$/g, ""));
  const totalFilterRuns = Object.values(filterCounts).reduce((a, b) => a + b, 0) || 1;
  const filters = Object.entries(filterCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([column, runs]) => ({ column, share: Math.round((runs / totalFilterRuns) * 100) / 100, inSortingKey: keyColumns.includes(column) }));
  const unread = (await all(sql`
    SELECT c.column_name, c.column_type FROM obs_catalog_columns c
    WHERE c.connection_id = ${connectionId} AND c.database_name = ${database} AND c.table_name = ${table}`)).map((c) => str(c.column_name));
  const promises = (await all(sql`SELECT id, name, status, criticality FROM data_health_promises WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`))
    .map((p) => ({ id: str(p.id), name: str(p.name), status: str(p.status), criticality: str(p.criticality) }));
  return {
    database,
    table,
    catalog: catalog ? {
      engine: str(catalog.engine), sortingKey, partitionKey: str(catalog.partition_key), primaryKey: str(catalog.primary_key),
      totalRows: numOrNull(catalog.total_rows), totalBytes: numOrNull(catalog.total_bytes), comment: strOrNull(catalog.comment),
      createQuery: canSeeQueryText ? strOrNull(catalog.create_query) : null,
    } : null,
    baseline: baseline ? {
      state: str(baseline.state), stateReason: strOrNull(baseline.state_reason), criticality: str(baseline.criticality), criticalityPinned: num(baseline.criticality_pinned) === 1,
      cadenceP50: numOrNull(baseline.cadence_p50_s), cadenceP99: numOrNull(baseline.cadence_p99_s), lastWriteAt: numOrNull(baseline.last_write_at),
      readers7d: num(baseline.readers_7d), reads7d: num(baseline.reads_7d),
    } : null,
    volume,
    drift: Object.fromEntries(drift),
    schemaHistory,
    usage,
    filters,
    columns: unread,
    promises,
  };
}

// --- lineage ---------------------------------------------------------------------

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  database: string | null;
  table: string | null;
  status: string | null;
  statusReason: string | null;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: string;
  origin: string;
  columns: string[];
  observations: number;
}

async function loadGraph(connectionId: string): Promise<{ nodes: Map<string, GraphNode>; edges: GraphLink[] }> {
  const nodeRows = await all(sql`SELECT * FROM obs_lineage_nodes WHERE connection_id = ${connectionId}`);
  const baselineRows = await all(sql`SELECT database_name, table_name, state, state_reason FROM obs_table_baselines WHERE connection_id = ${connectionId}`);
  const pipelineRows = await all(sql`SELECT target_node, status, status_reason FROM obs_pipelines WHERE connection_id = ${connectionId}`);
  const state = new Map(baselineRows.map((b) => [`table:${str(b.database_name)}.${str(b.table_name)}`, { status: str(b.state), reason: strOrNull(b.state_reason) }]));
  for (const p of pipelineRows) {
    const target = str(p.target_node);
    if (target && !["healthy", "unsupported_on_version"].includes(str(p.status))) state.set(target, { status: str(p.status), reason: strOrNull(p.status_reason) });
  }
  const nodes = new Map<string, GraphNode>(nodeRows.map((n) => {
    const s = state.get(str(n.node_id));
    return [str(n.node_id), { id: str(n.node_id), kind: str(n.kind), label: str(n.label), database: strOrNull(n.database_name), table: strOrNull(n.table_name), status: s?.status ?? null, statusReason: s?.reason ?? null }];
  }));
  const edges = (await all(sql`SELECT * FROM obs_lineage_edges WHERE connection_id = ${connectionId}`)).map((e) => ({
    id: str(e.edge_id), source: str(e.source_id), target: str(e.target_id), kind: str(e.kind), origin: str(e.origin), columns: json<string[]>(e.columns, []), observations: num(e.observations),
  }));
  return { nodes, edges };
}

export async function lineageGraph(connectionId: string, allowed: Allowed, focus: string | null, depth: number, direction: "up" | "down" | "both", maxNodes = 300): Promise<{ nodes: GraphNode[]; edges: GraphLink[]; truncated: boolean; totalNodes: number }> {
  const { nodes, edges } = await loadGraph(connectionId);
  const visible = edges.filter((e) => nodeOk(allowed, e.source) && nodeOk(allowed, e.target));
  let keep: Set<string>;
  if (focus) {
    keep = new Set([focus]);
    const g: GraphEdge[] = visible.map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
    const walk = (next: (n: string) => string[]): void => {
      let frontier = [focus];
      for (let d = 0; d < depth && frontier.length > 0; d++) {
        const nextFrontier: string[] = [];
        for (const n of frontier) for (const m of next(n)) if (!keep.has(m)) { keep.add(m); nextFrontier.push(m); }
        frontier = nextFrontier;
      }
    };
    if (direction !== "down") walk(upstreamOf(g));
    if (direction !== "up") walk(downstreamOf(g));
  } else {
    keep = new Set(visible.flatMap((e) => [e.source, e.target]));
  }
  const ids = [...keep].filter((id) => nodeOk(allowed, id)).slice(0, maxNodes);
  const idSet = new Set(ids);
  return {
    nodes: ids.map((id) => nodes.get(id) ?? { id, kind: id.split(":")[0], label: id.split(":").slice(1).join(":"), database: null, table: null, status: null, statusReason: null }),
    edges: visible.filter((e) => idSet.has(e.source) && idSet.has(e.target)),
    truncated: keep.size > maxNodes,
    totalNodes: nodes.size,
  };
}

// --- pipelines -------------------------------------------------------------------

export async function listPipelines(connectionId: string, allowed: Allowed, filter: { kind?: string; status?: string } = {}): Promise<Array<Record<string, unknown>>> {
  const rows = await all(sql`SELECT * FROM obs_pipelines WHERE connection_id = ${connectionId} ORDER BY name`);
  const since = Date.now() - 24 * 3600 * 1000;
  const samples = await all(sql`SELECT pipeline_id, sampled_at, units_in, errors, lag_seconds, backlog FROM obs_pipeline_samples WHERE connection_id = ${connectionId} AND sampled_at >= ${since} ORDER BY sampled_at`);
  const series = new Map<string, Array<{ at: number; units: number | null; errors: number | null }>>();
  for (const s of samples) {
    const list = series.get(str(s.pipeline_id)) ?? [];
    list.push({ at: num(s.sampled_at), units: numOrNull(s.units_in), errors: numOrNull(s.errors) });
    series.set(str(s.pipeline_id), list);
  }
  return rows
    .filter((r) => nodeOk(allowed, strOrNull(r.target_node)) && nodeOk(allowed, strOrNull(r.source_node)))
    .filter((r) => !filter.kind || str(r.kind) === filter.kind)
    .filter((r) => !filter.status || str(r.status) === filter.status)
    .map((r) => {
      const points = series.get(str(r.pipeline_id)) ?? [];
      return {
        id: str(r.pipeline_id),
        kind: str(r.kind),
        engine: str(r.engine),
        name: str(r.name),
        sourceLabel: strOrNull(r.source_label),
        sourceNode: strOrNull(r.source_node),
        targetNode: strOrNull(r.target_node),
        status: str(r.status),
        statusReason: strOrNull(r.status_reason),
        statusSince: num(r.status_since),
        unsupported: strOrNull(r.unsupported),
        attrs: json(r.attrs, {}),
        units24h: points.reduce((sum, p) => sum + (p.units ?? 0), 0),
        errors24h: points.reduce((sum, p) => sum + (p.errors ?? 0), 0),
        sparkline: points.slice(-60).map((p) => p.units ?? 0),
      };
    });
}

export async function pipelineSamples(connectionId: string, pipelineId: string): Promise<Array<Record<string, unknown>>> {
  return (await all(sql`SELECT * FROM obs_pipeline_samples WHERE connection_id = ${connectionId} AND pipeline_id = ${pipelineId} ORDER BY sampled_at DESC LIMIT 500`)).map((s) => ({
    at: num(s.sampled_at), unitsIn: numOrNull(s.units_in), bytesIn: numOrNull(s.bytes_in), lastSuccessAt: numOrNull(s.last_success_at), lagSeconds: numOrNull(s.lag_seconds),
    backlog: numOrNull(s.backlog), backlogUnit: strOrNull(s.backlog_unit), errors: numOrNull(s.errors), errorSample: strOrNull(s.error_sample), errorClass: strOrNull(s.error_class),
    progressing: s.progressing === null ? null : num(s.progressing) === 1,
  }));
}

// --- incidents -------------------------------------------------------------------

export interface UnifiedIncident {
  source: IncidentSource;
  id: string;
  connectionId: string;
  kind: string;
  title: string;
  status: string;
  severity: string;
  openedAt: number;
  lastEventAt: number;
  subject: string | null;
  rootCause: { layer: string; summary: string } | null;
}

export async function listIncidents(connectionIds: string[], allowed: Map<string, Allowed>, opts: { status?: "active" | "all" } = {}): Promise<UnifiedIncident[]> {
  if (connectionIds.length === 0) return [];
  const status = opts.status ?? "active";
  const dh = await all(sql`
    SELECT i.*, p.connection_id, p.database_name, p.table_name, p.name AS promise_name FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id
    WHERE p.connection_id IN (${sql.join(connectionIds.map((c) => sql`${c}`), sql`, `)}) ${status === "active" ? sql`AND i.status <> 'recovered'` : sql``}
    ORDER BY i.last_event_at DESC LIMIT 500`);
  const ob = await listObserveIncidents({ connectionIds, status, limit: 500 });
  const rcas = new Map((await all(sql`SELECT incident_source, incident_id, root_cause FROM incident_rca`)).map((r) => [`${str(r.incident_source)}:${str(r.incident_id)}`, json<{ layer: string; summary: string } | null>(r.root_cause, null)]));
  const out: UnifiedIncident[] = [];
  for (const i of dh) {
    const pred = allowed.get(str(i.connection_id));
    if (!pred || !pred(strOrNull(i.database_name), strOrNull(i.table_name))) continue;
    out.push({
      source: "data_health", id: str(i.id), connectionId: str(i.connection_id), kind: str(i.kind) === "execution" ? "execution" : "data",
      title: `${str(i.promise_name)}: ${str(i.summary)}`, status: str(i.status), severity: str(i.severity), openedAt: num(i.opened_at), lastEventAt: num(i.last_event_at),
      subject: i.database_name ? `table:${str(i.database_name)}.${str(i.table_name)}` : null, rootCause: rcas.get(`data_health:${str(i.id)}`) ?? null,
    });
  }
  for (const i of ob) {
    const pipeline = i.kind === "pipeline" ? await one(sql`SELECT target_node FROM obs_pipelines WHERE connection_id = ${i.connectionId} AND pipeline_id = ${i.subjectRef}`) : null;
    const subject = pipeline ? strOrNull(pipeline.target_node) : null;
    if (!nodeOk(allowed.get(i.connectionId) ?? (() => false), subject)) continue;
    out.push({
      source: "observe", id: i.id, connectionId: i.connectionId, kind: i.kind, title: i.summary, status: i.status, severity: i.severity,
      openedAt: i.openedAt, lastEventAt: i.lastEventAt, subject, rootCause: rcas.get(`observe:${i.id}`) ?? null,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.lastEventAt - a.lastEventAt : a.severity === "critical" ? -1 : 1));
}

export async function incidentDetail(source: IncidentSource, id: string): Promise<Record<string, unknown> | null> {
  let base: Record<string, unknown> | null = null;
  if (source === "data_health") {
    const i = await one(sql`
      SELECT i.*, p.connection_id, p.database_name, p.table_name, p.name AS promise_name FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id WHERE i.id = ${id}`);
    if (!i) return null;
    const events = (await all(sql`SELECT type, created_at, payload FROM data_health_incident_events WHERE incident_id = ${id} ORDER BY created_at`)).map((e) => ({ type: str(e.type), at: num(e.created_at), payload: json(e.payload, {}) }));
    base = {
      source, id, connectionId: str(i.connection_id), kind: str(i.kind), title: `${str(i.promise_name)}: ${str(i.summary)}`, status: str(i.status), severity: str(i.severity),
      openedAt: num(i.opened_at), lastEventAt: num(i.last_event_at), promiseId: str(i.promise_id), database: strOrNull(i.database_name), table: strOrNull(i.table_name), events,
    };
  } else {
    const i = await getObserveIncident(id);
    if (!i) return null;
    base = { source, ...i, title: i.summary };
  }
  return { ...base, rca: await getStoredRca(source, id) };
}

export async function incidentConnection(source: IncidentSource, id: string): Promise<{ connectionId: string; database: string | null; table: string | null } | null> {
  if (source === "data_health") {
    const r = await one(sql`SELECT p.connection_id, p.database_name, p.table_name FROM data_health_incidents i JOIN data_health_promises p ON p.id = i.promise_id WHERE i.id = ${id}`);
    return r ? { connectionId: str(r.connection_id), database: strOrNull(r.database_name), table: strOrNull(r.table_name) } : null;
  }
  const r = await one(sql`SELECT connection_id, kind, subject_ref FROM obs_incidents WHERE id = ${id}`);
  if (!r) return null;
  const pipeline = str(r.kind) === "pipeline" ? await one(sql`SELECT target_node FROM obs_pipelines WHERE connection_id = ${str(r.connection_id)} AND pipeline_id = ${str(r.subject_ref)}`) : null;
  const node = pipeline ? str(pipeline.target_node) : "";
  const fq = node.startsWith("table:") ? node.slice(6) : "";
  const dot = fq.indexOf(".");
  return { connectionId: str(r.connection_id), database: fq ? fq.slice(0, dot) : null, table: fq ? fq.slice(dot + 1) : null };
}

// --- overview --------------------------------------------------------------------

export async function overview(connectionId: string, allowed: Allowed): Promise<Record<string, unknown>> {
  const datasets = await listDatasets(connectionId, allowed);
  const pipelines = await listPipelines(connectionId, allowed);
  const incidents = await listIncidents([connectionId], new Map([[connectionId, allowed]]));
  const critical = datasets.filter((d) => d.criticality === "critical");
  const changes = (await all(sql`SELECT occurred_at, kind, summary, object_ref FROM obs_change_events WHERE connection_id = ${connectionId} ORDER BY occurred_at DESC LIMIT 20`))
    .filter((c) => {
      const ref = strOrNull(c.object_ref);
      if (!ref) return true;
      const dot = ref.indexOf(".");
      return allowed(ref.slice(0, dot), ref.slice(dot + 1));
    })
    .slice(0, 8)
    .map((c) => ({ at: num(c.occurred_at), kind: str(c.kind), summary: str(c.summary), objectRef: strOrNull(c.object_ref) }));
  const statusCounts: Record<string, number> = {};
  for (const p of pipelines) statusCounts[String(p.status)] = (statusCounts[String(p.status)] ?? 0) + 1;
  return {
    tables: {
      total: datasets.length,
      trusted: datasets.filter((d) => d.state === "trusted").length,
      stale: datasets.filter((d) => d.state === "stale").length,
      degraded: datasets.filter((d) => d.state === "degraded").length,
      learning: datasets.filter((d) => d.state === "learning").length,
    },
    coverage: {
      critical: critical.length,
      criticalPromised: critical.filter((d) => d.hasPromise).length,
      promised: datasets.filter((d) => d.hasPromise).length,
    },
    incidents: {
      open: incidents.length,
      critical: incidents.filter((i) => i.severity === "critical").length,
      top: incidents.slice(0, 3),
    },
    pipelines: { total: pipelines.length, byStatus: statusCounts, attention: pipelines.filter((p) => !["healthy", "unsupported_on_version"].includes(String(p.status))).slice(0, 8) },
    topTables: datasets.slice(0, 12),
    recentChanges: changes,
  };
}

// --- performance -----------------------------------------------------------------

export async function performance(connectionId: string, allowed: Allowed, canSeeQueryText: boolean): Promise<Record<string, unknown>> {
  const regressions = await all(sql`SELECT * FROM obs_regressions WHERE connection_id = ${connectionId} AND status = 'open' ORDER BY ratio DESC LIMIT 100`);
  const fingerprints = await all(sql`SELECT fingerprint, replica, tables, user_name, sample_query FROM obs_query_fingerprints WHERE connection_id = ${connectionId}`);
  const tablesByFp = new Map(fingerprints.map((f) => [`${str(f.fingerprint)}|${str(f.replica)}`, json<string[]>(f.tables, [])]));
  const fpAllowed = (fp: string, replica: string): boolean => (tablesByFp.get(`${fp}|${replica}`) ?? []).every((t) => {
    const dot = t.indexOf(".");
    return allowed(t.slice(0, dot), t.slice(dot + 1));
  });
  const changes = (await all(sql`SELECT * FROM obs_change_events WHERE connection_id = ${connectionId} AND occurred_at >= ${Date.now() - 7 * 86_400_000} ORDER BY occurred_at`))
    .map((c) => ({ id: str(c.id), kind: str(c.kind), at: num(c.occurred_at), node: strOrNull(c.node), objectRef: strOrNull(c.object_ref), summary: str(c.summary) }))
    .filter((c) => {
      if (!c.objectRef) return true;
      const dot = c.objectRef.indexOf(".");
      return allowed(c.objectRef.slice(0, dot), c.objectRef.slice(dot + 1));
    });
  const counts = await one(sql`SELECT COUNT(*) AS n FROM obs_query_fingerprints WHERE connection_id = ${connectionId}`);
  const improved = await one(sql`SELECT COUNT(*) AS n FROM obs_regressions WHERE connection_id = ${connectionId} AND status = 'resolved' AND resolved_at >= ${Date.now() - 7 * 86_400_000}`);
  return {
    fingerprints: counts ? num(counts.n) : 0,
    resolved7d: improved ? num(improved.n) : 0,
    regressions: regressions.filter((r) => fpAllowed(str(r.fingerprint), str(r.replica))).map((r) => ({
      id: str(r.id), fingerprint: str(r.fingerprint), replica: str(r.replica), metric: str(r.metric), baseline: num(r.baseline_value), current: num(r.current_value),
      ratio: num(r.ratio), runs: num(r.runs), onsetAt: num(r.onset_at), linkedChanges: json(r.linked_changes, []),
      sampleQuery: canSeeQueryText ? strOrNull(r.sample_query) : null,
    })),
    changes,
  };
}

export async function fingerprintSeries(connectionId: string, fingerprint: string): Promise<Array<Record<string, unknown>>> {
  return (await all(sql`SELECT * FROM obs_fingerprint_rollups WHERE connection_id = ${connectionId} AND fingerprint = ${fingerprint} ORDER BY hour`)).map((r) => ({
    hour: num(r.hour), replica: str(r.replica), runs: num(r.runs), errors: num(r.errors), p50: numOrNull(r.p50_ms), p95: numOrNull(r.p95_ms), readBytes: numOrNull(r.avg_read_bytes), serverVersion: strOrNull(r.server_version),
  }));
}

// --- capacity & cost -------------------------------------------------------------

export async function capacity(connectionId: string, allowed: Allowed, includeCost: boolean): Promise<Record<string, unknown>> {
  const forecasts = (await all(sql`SELECT * FROM obs_capacity_forecasts WHERE connection_id = ${connectionId} ORDER BY days_to_threshold`)).map((f) => ({
    node: str(f.node), disk: str(f.disk_name), usedRatio: num(f.used_ratio), growthPerDay: numOrNull(f.growth_bytes_per_day), daysToThreshold: numOrNull(f.days_to_threshold), threshold: num(f.threshold),
  }));
  const history = (await all(sql`SELECT node, disk_name, sampled_at, total_bytes, free_bytes FROM obs_capacity_samples WHERE connection_id = ${connectionId} AND sampled_at >= ${Date.now() - 30 * 86_400_000} ORDER BY sampled_at`))
    .map((s) => ({ node: str(s.node), disk: str(s.disk_name), at: num(s.sampled_at), used: num(s.total_bytes) - num(s.free_bytes), total: num(s.total_bytes) }));
  const growth = (await all(sql`
    SELECT database_name, table_name, SUM(bytes_added) AS bytes FROM obs_table_samples
    WHERE connection_id = ${connectionId} AND granularity = 'hour' AND sampled_at >= ${Date.now() - 30 * 86_400_000}
    GROUP BY database_name, table_name ORDER BY bytes DESC LIMIT 50`))
    .filter((g) => allowed(str(g.database_name), str(g.table_name)))
    .slice(0, 10)
    .map((g) => ({ database: str(g.database_name), table: str(g.table_name), bytesPerDay: num(g.bytes) / 30 }));
  const cold = (await all(sql`
    SELECT b.database_name, b.table_name, b.total_bytes, b.reads_7d, b.last_write_at FROM obs_table_baselines b
    WHERE b.connection_id = ${connectionId} AND b.reads_7d = 0 AND COALESCE(b.total_bytes, 0) > 0 ORDER BY b.total_bytes DESC LIMIT 50`))
    .filter((c) => allowed(str(c.database_name), str(c.table_name)))
    .slice(0, 20)
    .map((c) => ({ database: str(c.database_name), table: str(c.table_name), totalBytes: num(c.total_bytes), lastWriteAt: numOrNull(c.last_write_at) }));
  const trials = (await all(sql`SELECT * FROM obs_codec_trials WHERE connection_id = ${connectionId} ORDER BY created_at DESC LIMIT 50`))
    .filter((t) => allowed(str(t.database_name), str(t.table_name)))
    .map((t) => ({ id: str(t.id), database: str(t.database_name), table: str(t.table_name), column: str(t.column_name), current: strOrNull(t.current_codec), candidate: str(t.candidate_codec), status: str(t.status), ratioBefore: numOrNull(t.ratio_before), ratioAfter: numOrNull(t.ratio_after), savedBytes: numOrNull(t.saved_bytes), error: strOrNull(t.error), createdAt: num(t.created_at) }));
  let cost: Record<string, unknown> | null = null;
  if (includeCost) {
    const rates = await one(sql`SELECT * FROM obs_cost_rates WHERE id = 1`);
    const byConsumer = (await all(sql`
      SELECT principal_kind, principal_id, SUM(read_bytes) AS bytes FROM obs_usage_rollups
      WHERE connection_id = ${connectionId} AND principal_kind <> '_filters' AND day >= ${Date.now() - 30 * 86_400_000}
      GROUP BY principal_kind, principal_id ORDER BY bytes DESC LIMIT 20`)).map((r) => ({ kind: str(r.principal_kind), id: str(r.principal_id), readBytes: num(r.bytes) }));
    const perTib = rates ? num(rates.per_tib_read) : 0;
    cost = {
      currency: rates ? str(rates.currency) : "USD",
      perTibRead: perTib,
      perCpuHour: rates ? num(rates.per_cpu_hour) : 0,
      byConsumer: byConsumer.map((c) => ({ ...c, cost: (c.readBytes / 1024 ** 4) * perTib })),
    };
  }
  return { forecasts, history, growth, cold, trials, cost };
}
