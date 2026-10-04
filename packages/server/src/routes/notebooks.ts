/**
 * `/api/notebooks` — investigation notebooks (ADR 0016 §7).
 *
 * Permission map:
 *   read / export        view permission of what the notebook is attached to:
 *                        Data Health incident → data_health:view, Observe incident →
 *                        observe:view, Doctor report → doctor:view (plus connection and
 *                        table access for incidents)
 *   add / delete cells   notebooks:edit (+ read access); query cells also need
 *                        query:execute and run read-only under the caller's own data access
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { validateQueryAccess } from "../middleware/dataAccess";
import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { getConnectionById } from "../rbac/services/connections";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { getDoctorReport } from "../services/doctorReports";
import { observeClient, selectRows } from "../services/observe/clickhouse";
import { incidentConnection } from "../services/observe/views";
import * as notebooks from "../services/notebooks/store";
import { validateReadOnlySelect } from "../services/scheduledQueries/validation";
import { AppError, requireParam } from "../types";
import { assertConnectionAccess, hasPermission, isAdmin, tableAccess } from "./observe/access";

const notebooksRoute = new Hono();
notebooksRoute.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status: 200 | 201 = 200): any {
  return c.json({ success: true, data }, status);
}

const ATTACHMENTS = ["incident_data_health", "incident_observe", "doctor_report"] as const;
type Attachment = (typeof ATTACHMENTS)[number];

/** Throws unless the caller may read what the notebook is attached to. Returns its connection. */
async function guardAttachment(c: Context, kind: notebooks.AttachedKind, ref: string | null): Promise<string | null> {
  if (kind === "doctor_report") {
    if (!hasPermission(c, PERMISSIONS.DOCTOR_VIEW)) throw AppError.forbidden("Doctor notebooks need doctor:view");
    return null;
  }
  if (kind === "incident_data_health" || kind === "incident_observe") {
    const source = kind === "incident_data_health" ? "data_health" : "observe";
    const permission = source === "data_health" ? PERMISSIONS.DATA_HEALTH_VIEW : PERMISSIONS.OBSERVE_VIEW;
    if (!hasPermission(c, permission)) throw AppError.forbidden(`Incident notebooks need ${permission}`);
    const target = ref ? await incidentConnection(source, ref) : null;
    if (!target) throw AppError.notFound("Incident not found");
    await assertConnectionAccess(c, target.connectionId);
    if (target.database && !(await tableAccess(c, target.connectionId))(target.database, target.table)) throw AppError.forbidden("You do not have access to this table");
    return target.connectionId;
  }
  if (!isAdmin(c)) throw AppError.forbidden("Unattached notebooks are admin-only");
  return null;
}

async function guardNotebook(c: Context, id: string): Promise<notebooks.Notebook> {
  const notebook = await notebooks.getNotebook(id);
  if (!notebook) throw AppError.notFound("Notebook not found");
  await guardAttachment(c, notebook.attachedKind, notebook.attachedRef);
  return notebook;
}

notebooksRoute.post(
  "/ensure",
  zValidator("json", z.object({ kind: z.enum(ATTACHMENTS), ref: z.string().min(1).max(100), title: z.string().trim().max(200).optional() })),
  async (c) => {
    const { kind, ref, title } = c.req.valid("json");
    const connectionId = await guardAttachment(c, kind as Attachment, ref);
    if (kind === "doctor_report" && !(await getDoctorReport(ref))) throw AppError.notFound("Doctor report not found");
    const notebook = await notebooks.ensureNotebook(kind as Attachment, ref, title ?? (kind === "doctor_report" ? "Doctor report" : "Incident investigation"), getRbacUser(c).sub, connectionId);
    return ok(c, { notebook, cells: await notebooks.listCells(notebook.id) });
  },
);

notebooksRoute.get("/:id", async (c) => {
  const notebook = await guardNotebook(c, requireParam(c, "id"));
  return ok(c, { notebook, cells: await notebooks.listCells(notebook.id) });
});

notebooksRoute.get("/:id/export", async (c) => {
  const notebook = await guardNotebook(c, requireParam(c, "id"));
  const markdown = notebooks.toMarkdown(notebook, await notebooks.listCells(notebook.id));
  return c.body(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="postmortem-${notebook.id}.md"` });
});

async function runQueryCell(c: Context, notebook: notebooks.Notebook, statement: string): Promise<{ columns: string[]; rows: unknown[][]; ranAt: number }> {
  if (!hasPermission(c, PERMISSIONS.QUERY_EXECUTE)) throw AppError.forbidden("Query cells need query:execute");
  const connectionId = notebook.connectionId;
  if (!connectionId) throw AppError.badRequest("This notebook has no connection; query cells are unavailable");
  await assertConnectionAccess(c, connectionId);
  const validation = validateReadOnlySelect(statement);
  if (!validation.ok) throw AppError.badRequest(validation.error ?? "Only a single read-only SELECT is allowed");
  const user = getRbacUser(c);
  const connection = await getConnectionById(connectionId);
  const access = await validateQueryAccess(user.sub, isAdmin(c), user.permissions, statement, connection?.database ?? undefined, connectionId);
  if (!access.allowed) throw AppError.forbidden(access.reason ?? "Access denied");
  const client = await observeClient(connectionId, "notebook");
  const rows = await selectRows<Record<string, unknown>>(client, statement, { maxExecutionTime: 30, maxResultRows: 200 });
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.slice(0, 200).map((r) => columns.map((col) => r[col])), ranAt: Date.now() };
}

notebooksRoute.post("/:id/cells", requirePermission(PERMISSIONS.NOTEBOOKS_EDIT), zValidator("json", notebooks.cellContentSchema), async (c) => {
  const notebook = await guardNotebook(c, requireParam(c, "id"));
  const body = c.req.valid("json");
  if (body.kind === "ai_finding") throw AppError.badRequest("AI findings are written by Chouse AI");
  const content = body.kind === "query" ? { ...body, snapshot: await runQueryCell(c, notebook, body.sql) } : body;
  const cell = await notebooks.addCell(notebook.id, content, "user", getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.NOTEBOOK_CELL_ADD, getRbacUser(c).sub, { resourceType: "notebook", resourceId: notebook.id, details: { kind: body.kind } });
  return ok(c, cell, 201);
});

notebooksRoute.post("/:id/cells/:cellId/run", requirePermission(PERMISSIONS.NOTEBOOKS_EDIT), async (c) => {
  const notebook = await guardNotebook(c, requireParam(c, "id"));
  const cell = await notebooks.getCell(requireParam(c, "cellId"));
  if (!cell || cell.notebookId !== notebook.id || cell.kind !== "query") throw AppError.notFound("Query cell not found");
  const snapshot = await runQueryCell(c, notebook, String(cell.content.sql ?? ""));
  await notebooks.updateCellContent(cell.id, { ...cell.content, snapshot });
  return ok(c, { ...cell, content: { ...cell.content, snapshot } });
});

notebooksRoute.delete("/:id/cells/:cellId", requirePermission(PERMISSIONS.NOTEBOOKS_EDIT), async (c) => {
  const notebook = await guardNotebook(c, requireParam(c, "id"));
  const cell = await notebooks.getCell(requireParam(c, "cellId"));
  if (!cell || cell.notebookId !== notebook.id) throw AppError.notFound("Cell not found");
  if (cell.authorKind === "ai" || (cell.authorId !== getRbacUser(c).sub && !isAdmin(c))) throw AppError.forbidden("Only the author or an admin can delete this cell");
  await notebooks.deleteCell(cell.id);
  return ok(c, { deleted: cell.id });
});

export default notebooksRoute;
