/**
 * `/api/observe` — the Data Observability Platform read and control API
 * (ADR 0016). Every route: authenticated, feature-permission gated,
 * connection-access checked, and filtered by per-table data access.
 *
 * Permission map (also documented in docs/adr/0016):
 *   status, overview, lineage, pipelines, datasets, coverage   observe:view
 *   pin criticality, dismiss suggestion, ack incident, re-run RCA  observe:edit
 *   incidents                                                   observe:view or data_health:view
 *   performance, fingerprint series, EXPLAIN diff               performance:view (+ query text: query:history:view:all)
 *   capacity                                                    capacity:view (cost section: cost:view)
 *   cost rates                                                  cost:view + settings:update
 *   codec trials                                                upgrades:run
 *   schema preflight                                            query:execute:ddl, table:alter or table:drop
 *   privilege report / re-check                                 connections:view / connections:edit
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requireAnyPermission, requirePermission, getRbacUser } from "../../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../../rbac/schema/base";
import { getConnectionWithPassword, getUserConnections, listConnections } from "../../rbac/services/connections";
import { createAuditLogWithContext } from "../../rbac/services/rbac";
import { checkPrivileges, probeCapabilities } from "../../services/observe/capabilities";
import { observeClient, selectRows } from "../../services/observe/clickhouse";
import { setCostRates, startCodecTrial } from "../../services/observe/codecTrials";
import { acknowledgeObserveIncident, type IncidentSource } from "../../services/observe/incidents";
import { computeAndStoreRca } from "../../services/observe/rcaService";
import { computeSuggestions, dismissSuggestion, pinCriticality } from "../../services/observe/suggestions";
import * as views from "../../services/observe/views";
import { analyzeDdl } from "../../services/schemaPreflight/impact";
import { AppError, requireParam } from "../../types";
import { assertConnectionAccess, canSeeAllQueryText, hasPermission, isAdmin, scopedConnection, tableAccess } from "./access";

const observe = new Hono();
observe.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

function incidentScope(c: Context): views.IncidentScope {
  const user = getRbacUser(c);
  const dataHealthAll = hasPermission(c, PERMISSIONS.DATA_HEALTH_VIEW_ALL);
  return {
    includeDataHealth: hasPermission(c, PERMISSIONS.DATA_HEALTH_VIEW),
    dataHealthOwner: dataHealthAll ? null : user.sub,
    includeObserve: hasPermission(c, PERMISSIONS.OBSERVE_VIEW),
  };
}

function requireTable(allowed: views.Allowed, database: string, table: string): void {
  if (!allowed(database, table)) throw AppError.forbidden("You do not have access to this table");
}

// --- status ----------------------------------------------------------------------

observe.get("/status", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  return ok(c, await views.collectorStatus(connectionId));
});

observe.get("/privileges", requirePermission(PERMISSIONS.CONNECTIONS_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  const status = await views.collectorStatus(connectionId);
  const missing = [...new Set(status.collectors.flatMap((s) => (s.missingPrivileges as string[] | null) ?? []))];
  return ok(c, { missingGrants: missing, collectors: status.collectors });
});

observe.post("/privileges/check", requirePermission(PERMISSIONS.CONNECTIONS_EDIT), async (c) => {
  const { connectionId } = await scopedConnection(c);
  const conn = await getConnectionWithPassword(connectionId);
  if (!conn) throw AppError.notFound("Connection not found");
  const client = await observeClient(connectionId, "privileges");
  const caps = await probeCapabilities(connectionId, client, true);
  return ok(c, { serverVersion: caps.serverVersion, ...(await checkPrivileges(client, caps, conn.username)) });
});

// --- overview, lineage, pipelines, datasets, coverage ------------------------------

observe.get("/overview", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, await views.overview(connectionId, allowed, incidentScope(c)));
});

observe.get("/lineage", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const node = c.req.query("node") || null;
  const depth = Math.min(8, Math.max(1, Number(c.req.query("depth") ?? 3)));
  const direction = (["up", "down", "both"].includes(c.req.query("direction") ?? "") ? c.req.query("direction") : "both") as "up" | "down" | "both";
  if (node?.startsWith("table:")) {
    const fq = node.slice(6);
    const dot = fq.indexOf(".");
    requireTable(allowed, fq.slice(0, dot), fq.slice(dot + 1));
  }
  return ok(c, await views.lineageGraph(connectionId, allowed, node, depth, direction));
});

observe.get("/lineage/impact", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const node = c.req.query("node");
  if (!node) throw AppError.badRequest("node is required");
  const graph = await views.lineageGraph(connectionId, allowed, node, 6, "down", 2000);
  return ok(c, { node, impacted: graph.nodes.filter((n) => n.id !== node), edges: graph.edges });
});

observe.get("/pipelines", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, { pipelines: await views.listPipelines(connectionId, allowed, { kind: c.req.query("kind"), status: c.req.query("status") }) });
});

observe.get("/pipelines/:id/samples", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const id = decodeURIComponent(requireParam(c, "id"));
  const visible = (await views.listPipelines(connectionId, allowed)).some((p) => p.id === id);
  if (!visible) throw AppError.notFound("Pipeline not found");
  const samples = await views.pipelineSamples(connectionId, id);
  // Error texts can quote other users' data; show them to those who may see all query history.
  return ok(c, { samples: canSeeAllQueryText(c) ? samples : samples.map((s) => ({ ...s, errorSample: s.errorSample ? "(hidden: needs query:history:view:all)" : null })) });
});

observe.get("/datasets", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, { datasets: await views.listDatasets(connectionId, allowed, { q: c.req.query("q"), state: c.req.query("state"), criticality: c.req.query("criticality") }) });
});

observe.get("/datasets/:database/:table", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const database = requireParam(c, "database");
  const table = requireParam(c, "table");
  requireTable(allowed, database, table);
  const detail = await views.datasetDetail(connectionId, database, table, canSeeAllQueryText(c));
  if (!detail) throw AppError.notFound("Dataset not found");
  return ok(c, detail);
});

observe.put(
  "/datasets/:database/:table/criticality",
  requirePermission(PERMISSIONS.OBSERVE_EDIT),
  zValidator("json", z.object({ criticality: z.enum(["critical", "important", "standard"]).nullable() })),
  async (c) => {
    const { connectionId, allowed } = await scopedConnection(c);
    const database = requireParam(c, "database");
    const table = requireParam(c, "table");
    requireTable(allowed, database, table);
    const { criticality } = c.req.valid("json");
    if (!(await pinCriticality(connectionId, database, table, criticality))) throw AppError.notFound("Dataset not found");
    await createAuditLogWithContext(c, AUDIT_ACTIONS.OBSERVE_CRITICALITY_PIN, getRbacUser(c).sub, { resourceType: "table", resourceId: `${database}.${table}`, details: { connectionId, criticality } });
    return ok(c, { pinned: criticality });
  },
);

observe.get("/coverage", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const datasets = await views.listDatasets(connectionId, allowed);
  const byCriticality = ["critical", "important", "standard"].map((level) => {
    const set = datasets.filter((d) => d.criticality === level);
    return { criticality: level, tables: set.length, promised: set.filter((d) => d.hasPromise).length };
  });
  const suggestions = (await computeSuggestions(connectionId)).filter((s) => allowed(s.database, s.table));
  const capacity = await views.capacity(connectionId, allowed, false);
  const readers = await views.listDatasets(connectionId, allowed);
  return ok(c, {
    tables: datasets.length,
    learned: datasets.filter((d) => d.state !== "learning").length,
    promised: datasets.filter((d) => d.hasPromise).length,
    byCriticality,
    unprotectedHot: datasets.filter((d) => !d.hasPromise && d.reads7d >= 100).length,
    suggestions,
    cold: capacity.cold,
    readers: readers.length,
  });
});

observe.post(
  "/suggestions/dismiss",
  requirePermission(PERMISSIONS.OBSERVE_EDIT),
  zValidator("json", z.object({ key: z.string().min(1).max(300) })),
  async (c) => {
    const { connectionId } = await scopedConnection(c);
    const { key } = c.req.valid("json");
    await dismissSuggestion(connectionId, key, getRbacUser(c).sub);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.OBSERVE_SUGGESTION_DISMISS, getRbacUser(c).sub, { resourceType: "suggestion", resourceId: key, details: { connectionId } });
    return ok(c, { dismissed: key });
  },
);

// --- incidents -------------------------------------------------------------------

async function incidentGuard(c: Context, source: IncidentSource, id: string): Promise<{ connectionId: string }> {
  if (source === "data_health" && !hasPermission(c, PERMISSIONS.DATA_HEALTH_VIEW)) throw AppError.forbidden("Data Health incidents need data_health:view");
  if (source === "observe" && !hasPermission(c, PERMISSIONS.OBSERVE_VIEW)) throw AppError.forbidden("Observability incidents need observe:view");
  const ref = await views.incidentConnection(source, id);
  if (!ref) throw AppError.notFound("Incident not found");
  await assertConnectionAccess(c, ref.connectionId);
  const allowed = await tableAccess(c, ref.connectionId);
  if (ref.database && !allowed(ref.database, ref.table)) throw AppError.forbidden("You do not have access to this table");
  return { connectionId: ref.connectionId };
}

function parseSource(raw: string): IncidentSource {
  if (raw !== "data_health" && raw !== "observe") throw AppError.badRequest("Unknown incident source");
  return raw;
}

observe.get("/incidents", requireAnyPermission([PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DATA_HEALTH_VIEW]), async (c) => {
  const requested = c.req.query("connectionId");
  const user = getRbacUser(c);
  const connectionIds = requested
    ? [requested]
    : user.roles.includes("super_admin") ? (await listConnections({ activeOnly: false })).connections.map((x) => x.id) : (await getUserConnections(user.sub)).map((x) => x.id);
  if (requested) await assertConnectionAccess(c, requested);
  const allowed = new Map<string, views.Allowed>();
  for (const id of connectionIds) allowed.set(id, await tableAccess(c, id));
  const status = c.req.query("status") === "all" ? "all" : "active";
  return ok(c, { incidents: await views.listIncidents(connectionIds, allowed, { ...incidentScope(c), status }) });
});

observe.get("/incidents/:source/:id", requireAnyPermission([PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DATA_HEALTH_VIEW]), async (c) => {
  const source = parseSource(requireParam(c, "source"));
  await incidentGuard(c, source, requireParam(c, "id"));
  const detail = await views.incidentDetail(source, requireParam(c, "id"));
  if (!detail) throw AppError.notFound("Incident not found");
  return ok(c, detail);
});

observe.post("/incidents/:source/:id/rca", requirePermission(PERMISSIONS.OBSERVE_EDIT), async (c) => {
  const source = parseSource(requireParam(c, "source"));
  await incidentGuard(c, source, requireParam(c, "id"));
  return ok(c, await computeAndStoreRca(source, requireParam(c, "id")));
});

observe.post("/incidents/observe/:id/acknowledge", requirePermission(PERMISSIONS.OBSERVE_EDIT), async (c) => {
  const id = requireParam(c, "id");
  await incidentGuard(c, "observe", id);
  const incident = await acknowledgeObserveIncident(id, getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.OBSERVE_INCIDENT_ACKNOWLEDGE, getRbacUser(c).sub, { resourceType: "incident", resourceId: id });
  return ok(c, incident);
});

// --- performance -----------------------------------------------------------------

observe.get("/performance", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, await views.performance(connectionId, allowed, canSeeAllQueryText(c)));
});

observe.get("/performance/fingerprints/:fingerprint", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  return ok(c, { series: await views.fingerprintSeries(connectionId, requireParam(c, "fingerprint")) });
});

observe.post(
  "/performance/explain",
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  zValidator("json", z.object({ fingerprint: z.string().min(1).max(40), compareConnectionId: z.string().min(1).optional() })),
  async (c) => {
    if (!canSeeAllQueryText(c)) throw AppError.forbidden("EXPLAIN of other users' queries needs query:history:view:all");
    const { connectionId, allowed } = await scopedConnection(c);
    const { fingerprint, compareConnectionId } = c.req.valid("json");
    const perf = await views.performance(connectionId, allowed, true);
    const regression = (perf.regressions as Array<{ fingerprint: string; sampleQuery: string | null }>).find((r) => r.fingerprint === fingerprint);
    const sample = regression?.sampleQuery;
    if (!sample || !/^\s*(with|select)\b/i.test(sample)) throw AppError.badRequest("No read-only sample query for this shape");
    const explain = async (id: string): Promise<string[]> => {
      const client = await observeClient(id, "explain");
      const rows = await selectRows<{ explain: string }>(client, `EXPLAIN indexes = 1 ${sample}`, { maxExecutionTime: 15 });
      return rows.map((r) => r.explain);
    };
    const plans: Record<string, string[]> = { [connectionId]: await explain(connectionId) };
    if (compareConnectionId) {
      await assertConnectionAccess(c, compareConnectionId);
      plans[compareConnectionId] = await explain(compareConnectionId);
    }
    return ok(c, { plans });
  },
);

// --- capacity & cost -------------------------------------------------------------

observe.get("/capacity", requirePermission(PERMISSIONS.CAPACITY_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, await views.capacity(connectionId, allowed, hasPermission(c, PERMISSIONS.COST_VIEW)));
});

observe.put(
  "/cost-rates",
  requirePermission(PERMISSIONS.COST_VIEW),
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  zValidator("json", z.object({ currency: z.string().trim().min(1).max(8), perTibRead: z.number().min(0).max(1e6), perCpuHour: z.number().min(0).max(1e6) })),
  async (c) => {
    const body = c.req.valid("json");
    await setCostRates(body.currency, body.perTibRead, body.perCpuHour, getRbacUser(c).sub);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.OBSERVE_COST_RATES_UPDATE, getRbacUser(c).sub, { details: body });
    return ok(c, body);
  },
);

observe.post(
  "/codec-trials",
  requirePermission(PERMISSIONS.UPGRADES_RUN),
  zValidator("json", z.object({ database: z.string().min(1).max(64), table: z.string().min(1).max(64), column: z.string().min(1).max(64), candidateCodec: z.string().min(1).max(100) })),
  async (c) => {
    const { connectionId, allowed } = await scopedConnection(c);
    const body = c.req.valid("json");
    requireTable(allowed, body.database, body.table);
    let id: string;
    try {
      id = await startCodecTrial({ connectionId, ...body }, getRbacUser(c).sub);
    } catch (error) {
      throw AppError.badRequest(error instanceof Error ? error.message : String(error));
    }
    await createAuditLogWithContext(c, AUDIT_ACTIONS.OBSERVE_CODEC_TRIAL, getRbacUser(c).sub, { resourceType: "table", resourceId: `${body.database}.${body.table}`, details: { connectionId, ...body, trialId: id } });
    return ok(c, { id });
  },
);

// --- schema preflight ------------------------------------------------------------

observe.post(
  "/preflight",
  requireAnyPermission([PERMISSIONS.QUERY_EXECUTE_DDL, PERMISSIONS.TABLE_ALTER, PERMISSIONS.TABLE_DROP]),
  zValidator("json", z.object({ sql: z.string().min(1).max(100_000) })),
  async (c) => {
    const { connectionId, allowed } = await scopedConnection(c);
    const conn = await getConnectionWithPassword(connectionId);
    const result = await analyzeDdl(connectionId, c.req.valid("json").sql, conn?.database || "default");
    // Dependents in tables the user cannot read are counted, not named.
    const visible = result.items.filter((i) => !i.ref.includes(".") || (() => { const [d, t] = i.ref.split("."); return allowed(d, t); })());
    const hidden = result.items.length - visible.length;
    return ok(c, { ...result, items: visible, hiddenDependents: hidden, canOverride: isAdmin(c) || hasPermission(c, PERMISSIONS.SCHEMA_OVERRIDE) });
  },
);

export default observe;
