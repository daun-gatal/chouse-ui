/**
 * Investigation notebook (ADR 0016 §7) attached to an incident or a Doctor
 * report: Chouse AI findings, read-only query cells with saved snapshots,
 * notes and fix references, exportable as a Markdown postmortem.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Bot, Download, FileText, Loader2, Play, StickyNote, Terminal, Trash2, Wrench } from "lucide-react";

import { exportNotebook, querySnapshot, type NotebookAttachment, type NotebookCell } from "@/api/notebooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useAttachedNotebook, useNotebookMutations } from "./hooks";
import { formatAgo } from "./lib";
import { EmptyState, ErrorState, OBS_LABEL, Panel } from "./ui";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function CellIcon({ kind }: { kind: NotebookCell["kind"] }): ReactElement {
  const Icon = kind === "ai_finding" ? Bot : kind === "query" ? Terminal : kind === "action" ? Wrench : kind === "chart" ? FileText : StickyNote;
  return <Icon className={kind === "ai_finding" ? "h-3.5 w-3.5 text-brand" : "h-3.5 w-3.5 text-paper-faint"} aria-hidden />;
}

function SnapshotTable({ cell }: { cell: NotebookCell }): ReactElement | null {
  const snapshot = querySnapshot(cell);
  if (!snapshot) return null;
  if (snapshot.rows.length === 0) return <p className="mt-2 text-[11px] text-paper-faint">No rows · ran {formatAgo(snapshot.ranAt)}</p>;
  return (
    <div className="mt-2">
      <div className="max-h-56 overflow-auto rounded-xs border border-ink-500">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead className="sticky top-0 bg-ink-200">
            <tr>{snapshot.columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap border-b border-ink-500 px-2 py-1 text-left font-medium text-paper-muted">{c}</th>)}</tr>
          </thead>
          <tbody>
            {snapshot.rows.slice(0, 50).map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={j} className="whitespace-nowrap border-b border-ink-500/50 px-2 py-1 text-paper">{v === null ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-paper-faint">{snapshot.rows.length} rows · snapshot from {formatAgo(snapshot.ranAt)}</p>
    </div>
  );
}

function CellBody({ cell }: { cell: NotebookCell }): ReactElement {
  const c = cell.content;
  switch (cell.kind) {
    case "note":
      return <p className="whitespace-pre-wrap text-[12px] text-paper">{String(c.text ?? "")}</p>;
    case "ai_finding":
      return <p className="whitespace-pre-wrap text-[12px] text-paper">{String(c.summary ?? "")}</p>;
    case "query":
      return (
        <div>
          {typeof c.title === "string" && c.title && <p className="text-[12px] font-medium text-paper">{c.title}</p>}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{String(c.sql ?? "")}</pre>
          <SnapshotTable cell={cell} />
        </div>
      );
    case "action":
      return <p className="text-[12px] text-paper">Fix <span className="font-mono">{String(c.actionId ?? "")}</span> — see Fixes for its status.</p>;
    default:
      return <p className="text-[12px] text-paper-muted">{String(c.title ?? cell.kind)}</p>;
  }
}

export function NotebookPanel({ kind, attachedRef, title }: { kind: NotebookAttachment; attachedRef: string; title: string }): ReactElement {
  const { hasPermission } = useRbacStore();
  const canEdit = hasPermission(RBAC_PERMISSIONS.NOTEBOOKS_EDIT);
  const canQuery = canEdit && hasPermission(RBAC_PERMISSIONS.QUERY_EXECUTE);
  const notebook = useAttachedNotebook(kind, attachedRef, title);
  const mutations = useNotebookMutations(kind, attachedRef);
  const [mode, setMode] = useState<"note" | "query">("note");
  const [text, setText] = useState("");
  const [exporting, setExporting] = useState(false);

  if (notebook.isLoading) return <Panel title="Investigation notebook"><p className="text-[11px] text-paper-muted">Opening notebook…</p></Panel>;
  if (notebook.isError || !notebook.data) return <ErrorState title="The notebook could not be opened." error={notebook.error} />;

  const { notebook: nb, cells } = notebook.data;

  const addCell = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    try {
      await mutations.add.mutateAsync({ notebookId: nb.id, cell: mode === "note" ? { kind: "note", text: value } : { kind: "query", sql: value } });
      setText("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the cell"));
    }
  };

  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const markdown = await exportNotebook(nb.id);
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `postmortem-${nb.id}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error, "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Panel
      title="Investigation notebook"
      meta={`${cells.length} cells · shared with everyone who can see this ${kind === "doctor_report" ? "report" : "incident"}`}
      actions={<Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={exporting} onClick={() => void download()}>{exporting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Download className="mr-1.5 h-3 w-3" />}Export postmortem</Button>}
    >
      {cells.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing recorded yet" body="Chouse AI findings, query snapshots and notes collect here." />
      ) : (
        <ol className="space-y-2">
          {cells.map((cell) => (
            <li key={cell.id} className="rounded-xs border border-ink-500 bg-ink-200/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CellIcon kind={cell.kind} />
                  <span className={OBS_LABEL}>{cell.authorKind === "ai" ? "Chouse AI" : cell.kind}</span>
                  <span className="text-[10px] text-paper-faint">{formatAgo(cell.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1">
                  {cell.kind === "query" && canQuery && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Re-run query" disabled={mutations.rerun.isPending} onClick={() => void mutations.rerun.mutateAsync({ notebookId: nb.id, cellId: cell.id }).catch((e: unknown) => toast.error(errorMessage(e, "Re-run failed")))}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canEdit && cell.authorKind === "user" && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete cell" onClick={() => void mutations.remove.mutateAsync({ notebookId: nb.id, cellId: cell.id }).catch((e: unknown) => toast.error(errorMessage(e, "Delete failed")))}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
              <CellBody cell={cell} />
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <div className="mt-3 rounded-xs border border-ink-500 p-3">
          <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Cell type">
            <Button type="button" role="radio" aria-checked={mode === "note"} variant={mode === "note" ? "default" : "ghost"} className="h-7 rounded-xs text-[11px]" onClick={() => setMode("note")}><StickyNote className="mr-1 h-3 w-3" /> Note</Button>
            {canQuery && <Button type="button" role="radio" aria-checked={mode === "query"} variant={mode === "query" ? "default" : "ghost"} className="h-7 rounded-xs text-[11px]" onClick={() => setMode("query")}><Terminal className="mr-1 h-3 w-3" /> Query</Button>}
          </div>
          <Textarea aria-label={mode === "note" ? "Note" : "Read-only SELECT"} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "note" ? "What did you find?" : "SELECT … (read-only, runs under your data access)"} className={mode === "query" ? "rounded-xs font-mono text-[11px]" : "rounded-xs"} />
          <div className="mt-2 flex justify-end">
            <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!text.trim() || mutations.add.isPending} onClick={() => void addCell()}>
              {mutations.add.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{mode === "note" ? "Add note" : "Run and add"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
