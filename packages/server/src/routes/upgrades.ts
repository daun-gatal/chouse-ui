/**
 * `/api/upgrades` — the upgrade check (ADR 0029, amending ADR 0016 §9).
 *
 * Permission map:
 *   status, references, fleet, assessments            upgrades:view
 *   run a check                                       upgrades:run (+ access to every connection involved)
 *   query text in tried shapes                        query:history:view:all
 *
 * Evidence that names a table is shown only to users whose data access
 * policies let them read it; the rest are counted, not named.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, SYSTEM_ROLES } from "../rbac/schema/base";
import { getUserConnections, listConnections } from "../rbac/services/connections";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { json, one, sql, strOrNull } from "../services/observe/db";
import { selectRows } from "../services/observe/clickhouse";
import { clientForConnection } from "../services/scheduledQueries/chClient";
import { CheckInputError, getAssessment, latestChecks, listAssessments, startAssessment, type Assessment } from "../services/upgrades/assess";
import { upgradeCheckEnabled } from "../services/upgrades/fetch";
import { getReleaseData, upgradeTargets, versionStatus } from "../services/upgrades/releaseData";
import { lineOf, plainVersion } from "../services/upgrades/versions";
import { AppError, requireParam } from "../types";
import { assertConnectionAccess, canSeeAllQueryText, scopedConnection, tableAccess, type TablePredicate } from "./observe/access";

const upgrades = new Hono();
upgrades.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status: 200 | 201 | 202 = 200): any {
  return c.json({ success: true, data }, status);
}

async function accessibleConnections(c: Context): Promise<Array<{ id: string; name: string }>> {
  const user = getRbacUser(c);
  const connections = user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) ? (await listConnections({ activeOnly: true })).connections : await getUserConnections(user.sub);
  return connections.map((x) => ({ id: x.id, name: x.name }));
}

/** The version a connection last reported: the fleet snapshot the Fleet card shows, else the capability probe. */
async function knownVersion(connectionId: string): Promise<string | null> {
  const snap = await one(sql`SELECT payload FROM fleet_snapshots WHERE connection_id = ${connectionId} AND metric = 'summary' AND error IS NULL ORDER BY captured_at DESC LIMIT 1`);
  const fromFleet = json<Array<Record<string, unknown>>>(snap?.payload, [])[0]?.server_version;
  if (typeof fromFleet === "string" && fromFleet) return fromFleet;
  const caps = await one(sql`SELECT server_version FROM obs_capabilities WHERE connection_id = ${connectionId}`);
  return caps ? strOrNull(caps.server_version) : null;
}

async function liveVersion(connectionId: string): Promise<string | null> {
  try {
    const client = await clientForConnection(connectionId, JSON.stringify({ source: "observe", collector: "upgrades" }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [row] = await Promise.race([
        selectRows<{ v: string }>(client, "SELECT version() AS v", { maxExecutionTime: 5 }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 8_000);
        }),
      ]);
      return row?.v ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function tableVisible(allowed: TablePredicate, qualified: string): boolean {
  const [db, ...rest] = qualified.split(".");
  return allowed(db, rest.join(".") || null);
}

/**
 * Rows naming a table the reader may not see are dropped and counted; query
 * text stays only for readers who may see all query history.
 */
export function visibleAssessment(a: Assessment, allowed: TablePredicate, canSeeQueries = false): Assessment & { hiddenRows: number } {
  let hiddenRows = 0;
  const findings = a.findings.map((f) => {
    const rows = f.evidence.rows.filter((r) => {
      const visible = (!r.table || tableVisible(allowed, r.table)) && (r.tables ?? []).every((t) => tableVisible(allowed, t));
      if (!visible) hiddenRows++;
      return visible;
    }).map((r) => (canSeeQueries || r.query === undefined ? r : { ...r, query: undefined }));
    const hidden = f.evidence.rows.length - rows.length;
    return { ...f, evidence: { ...f.evidence, rows, totalRows: Math.max(0, f.evidence.totalRows - hidden), hiddenRows: hidden } };
  });
  const { workloadNames: _names, ...summary } = a.summary;
  void _names;
  return { ...a, summary, findings, hiddenRows };
}

upgrades.get("/status", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  const raw = (await liveVersion(connectionId)) ?? (await knownVersion(connectionId));
  const enabled = upgradeCheckEnabled();
  const version = raw ? plainVersion(raw) : null;
  const line = version ? lineOf(version) : null;
  const release = enabled ? await getReleaseData(line ? [line] : []) : null;
  return ok(c, {
    enabled,
    version,
    release: release ? { fetchedAt: release.fetchedAt, hubLines: release.hubLines, supported: release.supported, partial: release.errors.length > 0 } : null,
    current: release && raw ? versionStatus(raw, release) : null,
    targets: release && raw ? upgradeTargets(raw, release) : [],
  });
});

/** Connections the user can access that run `target`'s line: the exact comparison's candidates. */
upgrades.get("/references", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  const target = c.req.query("target") ?? "";
  const line = lineOf(plainVersion(target) ?? "");
  if (!line) throw AppError.badRequest("target must be a version such as 26.8");
  const out: Array<{ connectionId: string; name: string; version: string }> = [];
  const others = (await accessibleConnections(c)).filter((conn) => conn.id !== connectionId).slice(0, 100);
  // The version the Fleet last saw, else ask the server; a connection that doesn't answer is left out.
  await Promise.all(others.map(async (conn) => {
    const version = (await knownVersion(conn.id)) ?? (await liveVersion(conn.id));
    const plain = version ? plainVersion(version) : null;
    if (plain && lineOf(plain) === line) out.push({ connectionId: conn.id, name: conn.name, version: plain });
  }));
  return ok(c, { references: out.sort((a, b) => a.name.localeCompare(b.name)) });
});

/** Version status and the last check for every connection the user can access (the Fleet colour). */
upgrades.get("/fleet", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const connections = await accessibleConnections(c);
  const versions = new Map<string, string | null>();
  for (const conn of connections) versions.set(conn.id, await knownVersion(conn.id));
  const enabled = upgradeCheckEnabled();
  const lines = [...new Set([...versions.values()].map((v) => (v ? lineOf(plainVersion(v) ?? "") : null)).filter((l): l is string => Boolean(l)))];
  const release = enabled ? await getReleaseData(lines) : null;
  const checks = await latestChecks(connections.map((x) => x.id));
  const nodes = connections.map((conn) => {
    const version = versions.get(conn.id) ?? null;
    return { connectionId: conn.id, name: conn.name, version: version ? plainVersion(version) : null, status: release && version ? versionStatus(version, release) : null, lastCheck: checks[conn.id] ?? null };
  });
  return ok(c, { enabled, nodes });
});

upgrades.get("/assessments", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  const assessments = (await listAssessments(connectionId)).map((a) => {
    const { workloadNames: _names, ...summary } = a.summary;
    void _names;
    return { ...a, summary };
  });
  return ok(c, { assessments });
});

upgrades.get("/assessments/:id", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const assessment = await getAssessment(requireParam(c, "id"));
  if (!assessment) throw AppError.notFound("Check not found");
  await assertConnectionAccess(c, assessment.connectionId);
  return ok(c, visibleAssessment(assessment, await tableAccess(c, assessment.connectionId), canSeeAllQueryText(c)));
});

upgrades.post(
  "/assessments",
  requirePermission(PERMISSIONS.UPGRADES_RUN),
  zValidator("json", z.object({
    targetVersion: z.string().trim().regex(/^\d{1,3}\.\d{1,2}(\.\d{1,4}(\.\d{1,6})?)?$/, "Use a version such as 26.8 or 26.8.36.3"),
    referenceConnectionId: z.string().min(1).max(64).nullish(),
    tryQueries: z.boolean().default(true),
  })),
  async (c) => {
    const { connectionId } = await scopedConnection(c);
    const { targetVersion, referenceConnectionId, tryQueries } = c.req.valid("json");
    let reference: { connectionId: string; name: string } | null = null;
    if (referenceConnectionId) {
      if (referenceConnectionId === connectionId) throw AppError.badRequest("Pick a different connection to compare with");
      await assertConnectionAccess(c, referenceConnectionId);
      const conn = (await accessibleConnections(c)).find((x) => x.id === referenceConnectionId);
      if (!conn) throw AppError.notFound("Connection not found");
      reference = { connectionId: conn.id, name: conn.name };
    }
    let id: string;
    try {
      id = await startAssessment({ connectionId, targetVersion, reference, tryQueries, actorId: getRbacUser(c).sub });
    } catch (error) {
      if (error instanceof CheckInputError) throw AppError.badRequest(error.message);
      throw error;
    }
    await createAuditLogWithContext(c, AUDIT_ACTIONS.UPGRADE_ASSESS, getRbacUser(c).sub, { resourceType: "connection", resourceId: connectionId, details: { targetVersion, reference: reference?.connectionId ?? null, tryQueries, assessmentId: id } });
    return ok(c, { id, status: "running" }, 202);
  },
);

export default upgrades;
