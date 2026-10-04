/**
 * Investigation notebooks (ADR 0016 §7): shared by incidents and Doctor
 * reports. Cells are AI findings, read-only query cells (stored SQL plus a
 * snapshot result that can be re-run), notes, charts and action references.
 */

import { randomUUID } from "crypto";

import { z } from "zod";

import { all, json, num, one, run, sql, str, strOrNull, type Row } from "../observe/db";

export const CELL_KINDS = ["ai_finding", "query", "note", "chart", "action"] as const;
export type CellKind = (typeof CELL_KINDS)[number];
export type AttachedKind = "incident_data_health" | "incident_observe" | "doctor_report" | "none";

export const cellContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), text: z.string().trim().min(1).max(20_000) }),
  z.object({
    kind: z.literal("query"),
    sql: z.string().trim().min(1).max(20_000),
    title: z.string().trim().max(200).nullish(),
    snapshot: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.unknown())).max(200), ranAt: z.number() }).nullish(),
  }),
  z.object({ kind: z.literal("chart"), title: z.string().trim().max(200), series: z.array(z.object({ x: z.number(), y: z.number() })).max(2000), unit: z.string().max(40).nullish() }),
  z.object({ kind: z.literal("ai_finding"), summary: z.string().max(20_000), status: z.string().max(40).nullish(), detail: z.record(z.unknown()).nullish() }),
  z.object({ kind: z.literal("action"), actionId: z.string().min(1).max(64) }),
]);
export type CellContent = z.infer<typeof cellContentSchema>;

export interface Notebook {
  id: string;
  title: string;
  ownerId: string | null;
  attachedKind: AttachedKind;
  attachedRef: string | null;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookCell {
  id: string;
  notebookId: string;
  position: number;
  kind: CellKind;
  authorKind: "user" | "ai";
  authorId: string | null;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

function notebookRow(r: Row): Notebook {
  return {
    id: str(r.id),
    title: str(r.title),
    ownerId: strOrNull(r.owner_id),
    attachedKind: (str(r.attached_kind) || "none") as AttachedKind,
    attachedRef: strOrNull(r.attached_ref),
    connectionId: strOrNull(r.connection_id),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function cellRow(r: Row): NotebookCell {
  return {
    id: str(r.id),
    notebookId: str(r.notebook_id),
    position: num(r.position),
    kind: str(r.kind) as CellKind,
    authorKind: str(r.author_kind) === "ai" ? "ai" : "user",
    authorId: strOrNull(r.author_id),
    content: json<Record<string, unknown>>(r.content, {}),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export async function getNotebook(id: string): Promise<Notebook | null> {
  const row = await one(sql`SELECT * FROM notebooks WHERE id = ${id}`);
  return row ? notebookRow(row) : null;
}

export async function findByAttachment(kind: AttachedKind, ref: string): Promise<Notebook | null> {
  const row = await one(sql`SELECT * FROM notebooks WHERE attached_kind = ${kind} AND attached_ref = ${ref}`);
  return row ? notebookRow(row) : null;
}

/** Get or create the notebook attached to an incident / report (idempotent). */
export async function ensureNotebook(kind: AttachedKind, ref: string, title: string, ownerId: string | null, connectionId: string | null): Promise<Notebook> {
  const existing = await findByAttachment(kind, ref);
  if (existing) return existing;
  const now = Date.now();
  const id = kind === "doctor_report" ? `nb-doctor-${ref}` : randomUUID();
  await run(sql`
    INSERT INTO notebooks (id, title, owner_id, attached_kind, attached_ref, connection_id, created_at, updated_at)
    VALUES (${id}, ${title.slice(0, 200)}, ${ownerId}, ${kind}, ${ref}, ${connectionId}, ${now}, ${now})
    ON CONFLICT (attached_kind, attached_ref) DO NOTHING
  `);
  const created = await findByAttachment(kind, ref);
  if (!created) throw new Error("Notebook could not be created");
  return created;
}

export async function listCells(notebookId: string): Promise<NotebookCell[]> {
  return (await all(sql`SELECT * FROM notebook_cells WHERE notebook_id = ${notebookId} ORDER BY position, created_at`)).map(cellRow);
}

export async function addCell(notebookId: string, content: CellContent, authorKind: "user" | "ai", authorId: string | null): Promise<NotebookCell> {
  const parsed = cellContentSchema.parse(content);
  const now = Date.now();
  const id = randomUUID();
  const last = await one(sql`SELECT MAX(position) AS p FROM notebook_cells WHERE notebook_id = ${notebookId}`);
  const position = last && last.p !== null ? num(last.p) + 1 : 0;
  const { kind, ...rest } = parsed;
  await run(sql`
    INSERT INTO notebook_cells (id, notebook_id, position, kind, author_kind, author_id, content, created_at, updated_at)
    VALUES (${id}, ${notebookId}, ${position}, ${kind}, ${authorKind}, ${authorId}, ${JSON.stringify(rest)}, ${now}, ${now})
  `);
  await run(sql`UPDATE notebooks SET updated_at = ${now} WHERE id = ${notebookId}`);
  const row = await one(sql`SELECT * FROM notebook_cells WHERE id = ${id}`);
  if (!row) throw new Error("Cell was not stored");
  return cellRow(row);
}

export async function updateCellContent(cellId: string, content: Record<string, unknown>): Promise<void> {
  await run(sql`UPDATE notebook_cells SET content = ${JSON.stringify(content)}, updated_at = ${Date.now()} WHERE id = ${cellId}`);
}

export async function getCell(cellId: string): Promise<NotebookCell | null> {
  const row = await one(sql`SELECT * FROM notebook_cells WHERE id = ${cellId}`);
  return row ? cellRow(row) : null;
}

export async function deleteCell(cellId: string): Promise<void> {
  await run(sql`DELETE FROM notebook_cells WHERE id = ${cellId}`);
}

function mdTable(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) return "";
  const header = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, 50).map((r) => `| ${r.map((v) => String(v ?? "").replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}

/** Postmortem export: the notebook as Markdown. */
export function toMarkdown(notebook: Notebook, cells: NotebookCell[], extra: { header?: string } = {}): string {
  const lines = [`# ${notebook.title}`, "", extra.header ?? "", `_Exported ${new Date().toISOString()}_`, ""];
  for (const cell of cells) {
    const when = new Date(cell.createdAt).toISOString();
    const by = cell.authorKind === "ai" ? "Chouse AI" : cell.authorId ?? "user";
    lines.push(`## ${cell.kind.replace("_", " ")} — ${by}, ${when}`, "");
    const c = cell.content;
    if (cell.kind === "note") lines.push(String(c.text ?? ""));
    if (cell.kind === "ai_finding") lines.push(String(c.summary ?? ""));
    if (cell.kind === "query") {
      lines.push("```sql", String(c.sql ?? ""), "```");
      const snapshot = c.snapshot as { columns?: string[]; rows?: unknown[][] } | undefined;
      if (snapshot?.columns) lines.push("", mdTable(snapshot.columns, snapshot.rows ?? []));
    }
    if (cell.kind === "chart") lines.push(`Chart: ${String(c.title ?? "")} (${Array.isArray(c.series) ? c.series.length : 0} points)`);
    if (cell.kind === "action") lines.push(`Remediation action ${String(c.actionId ?? "")}`);
    lines.push("");
  }
  return lines.join("\n");
}
