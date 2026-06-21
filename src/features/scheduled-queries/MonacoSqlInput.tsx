/**
 * A self-contained Monaco SQL editor — the same ClickHouse-aware editor the
 * Explorer/workspace uses (syntax highlighting + schema intellisense scoped to
 * the active connection), so the builder's "Read-only SELECT" field behaves like
 * the Explorer query input. Includes auto-format and an "expand" action that
 * opens a large, glassy editor window where the query can be test-run (the
 * {{…}} window tokens are substituted with a sample 24h window). Default-exported
 * for lazy loading so the heavy Monaco chunk only loads when the builder opens.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as monaco from "monaco-editor";
import { toast } from "sonner";
import { Wand2, Maximize2, Minimize2, Play, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { executeQueryStream, type QueryMeta } from "@/api/query";
import { usePreferencesStore } from "@/stores";
import { initializeMonacoGlobally, createMonacoEditor } from "@/features/workspace/editor/monacoConfig";
import { useTheme } from "@/components/common/theme-provider";
import { cn } from "@/lib/utils";
import { substituteMacros, previewMacros } from "./macros";
import { MacrosHelp } from "./MacrosHelp";

interface MonacoSqlInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Inline (collapsed) height in px. */
  height?: number;
  className?: string;
}

/**
 * Compile the `{{…}}` window macros with a concrete sample window (last 24h) so
 * the query is valid ClickHouse for an ad-hoc test run. The real scheduler binds
 * these per slot — this is only for previewing results in the builder.
 */
function substituteWindowTokens(sql: string): string {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return substituteMacros(sql, { slotStartMs: dayAgo, slotEndMs: now, prevRunAtMs: dayAgo });
}

/** One managed Monaco editor instance + its toolbar. */
function MonacoEditorCore({
  value,
  onChange,
  fill,
  height = 220,
  className,
  rightSlot,
}: {
  value: string;
  onChange: (value: string) => void;
  fill?: boolean;
  height?: number;
  className?: string;
  rightSlot?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);

  const { resolvedTheme } = useTheme();
  const editorTheme = resolvedTheme === "light" ? "chouse-light" : "chouse-dark";

  useEffect(() => {
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let changeListener: monaco.IDisposable | null = null;
    let aborted = false;

    void (async () => {
      await initializeMonacoGlobally();
      if (aborted || !containerRef.current) return;
      editor = await createMonacoEditor(containerRef.current, editorTheme);
      if (aborted) {
        editor.dispose();
        return;
      }
      editorRef.current = editor;
      editor.setValue(valueRef.current ?? "");
      changeListener = editor.onDidChangeModelContent(() => {
        const next = editor?.getValue() ?? "";
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChangeRef.current(next);
      });
    })();

    return () => {
      aborted = true;
      changeListener?.dispose();
      editor?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== editor.getValue()) {
      valueRef.current = value;
      editor.setValue(value ?? "");
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  const format = () => editorRef.current?.getAction("editor.action.formatDocument")?.run();

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xs border border-ink-500", fill && "h-full min-h-0 flex-1", className)}>
      <div className="flex items-center justify-between border-b border-ink-500 bg-ink-200 px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">SQL</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={format}
            title="Auto-format"
            className="grid h-6 w-6 place-items-center rounded-xs text-paper-muted hover:bg-ink-300 hover:text-paper"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </button>
          {rightSlot}
        </div>
      </div>
      <div ref={containerRef} className={cn(fill && "min-h-0 flex-1")} style={fill ? undefined : { height }} />
    </div>
  );
}

interface RunOutcome {
  meta: QueryMeta[];
  rows: Array<Record<string, unknown>>;
  total: number;
}

const DISPLAY_CAP = 1000;

function ResultsPanel({ outcome, error }: { outcome: RunOutcome | null; error: string | null }) {
  const shown = outcome ? outcome.rows.slice(0, DISPLAY_CAP) : [];
  return (
    <div className="flex h-56 shrink-0 flex-col overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex items-center justify-between border-b border-ink-500 bg-ink-200 px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Results</span>
        {outcome && (
          <span className="font-mono text-[10px] text-paper-muted">
            {outcome.total > shown.length ? `showing ${shown.length.toLocaleString()} of ` : ""}{outcome.total.toLocaleString()} row(s)
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-3 font-mono text-[11px] text-red-600">{error}</p>
        ) : !outcome ? (
          <p className="p-3 text-[12px] text-paper-muted">Run to preview results.</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-[12px] text-paper-muted">No rows returned.</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-ink-50">
              <tr>
                {outcome.meta.map((m) => (
                  <th key={m.name} className="whitespace-nowrap px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-paper-faint">{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i} className="border-t border-ink-500">
                  {outcome.meta.map((m) => (
                    <td key={m.name} className="whitespace-nowrap px-2 py-1 font-mono text-paper">{String(row[m.name] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Live preview of what each `{{…}}` macro resolves to (sample last-24h window). */
function MacroPreview({ query }: { query: string }) {
  const previews = useMemo(() => previewMacros(query), [query]);
  if (previews.length === 0) return null;
  return (
    <div className="rounded-xs border border-ink-500 bg-ink-50 px-2 py-1.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">Macro preview (sample 24h window)</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {previews.map((p) => (
          <span key={p.macro} className="font-mono text-[10px]">
            <span className="text-paper-faint">{p.macro}</span> <span className="text-paper-faint">=</span> <span className="text-paper">{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MonacoSqlInput({ value, onChange, height = 220, className }: MonacoSqlInputProps) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bound the test run by the same MAX RESULT ROWS preference the Explorer uses,
  // so it can't pull an unbounded result (ClickHouse caps with result_overflow_mode='break').
  const maxResultRows = usePreferencesStore((s) => s.maxResultRows);

  const runQuery = async () => {
    const sql = substituteWindowTokens(value).trim();
    if (!sql) {
      toast.error("Nothing to run");
      return;
    }
    setRunning(true);
    setError(null);
    setOutcome(null);

    // Stream the result (same path the Explorer/workspace uses), bounded by the
    // MAX RESULT ROWS preference — rows arrive incrementally and ClickHouse caps
    // the scan with result_overflow_mode='break'.
    let meta: QueryMeta[] = [];
    const acc: Array<Record<string, unknown>> = [];
    try {
      await executeQueryStream(sql, undefined, undefined, maxResultRows, {
        onMeta(m) {
          meta = m;
          setOutcome({ meta, rows: [], total: 0 });
        },
        onRows(rows) {
          for (const r of rows) if (acc.length < DISPLAY_CAP) acc.push(r);
          setOutcome({ meta, rows: acc.slice(), total: acc.length });
        },
        onEnd(_stats, totalRows) {
          setOutcome({ meta, rows: acc.slice(), total: totalRows });
          setRunning(false);
        },
        onError(message) {
          setError(message);
          setOutcome(null);
          setRunning(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
      setOutcome(null);
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <MonacoEditorCore
        value={value}
        onChange={onChange}
        height={height}
        className={className}
        rightSlot={
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expand editor"
            className="grid h-6 w-6 place-items-center rounded-xs text-paper-muted hover:bg-ink-300 hover:text-paper"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        }
      />
      <MacroPreview query={value} />

      {/* Glassy expand window — a nested dialog (portals to body, so it escapes
          the builder dialog's transform and fills the viewport). Test-runnable. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[82vh] w-[88vw] max-w-5xl flex-col gap-3 border-ink-500 bg-ink-100/85 p-4 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="text-[14px] font-semibold text-paper">Read-only SELECT</DialogTitle>
              <MacrosHelp />
            </div>
            <p className="text-[11px] text-paper-muted">Run uses a sample last-24h window for {"{{slot_start}}"} / {"{{slot_end}}"} / {"{{prev_run_at}}"}.</p>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <MonacoEditorCore
              value={value}
              onChange={onChange}
              fill
              rightSlot={
                <>
                  <button
                    type="button"
                    onClick={() => void runQuery()}
                    disabled={running}
                    title="Run (sample window)"
                    className="flex h-6 items-center gap-1 rounded-xs bg-brand px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                  >
                    {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    title="Collapse editor"
                    className="grid h-6 w-6 place-items-center rounded-xs text-paper-muted hover:bg-ink-300 hover:text-paper"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </button>
                </>
              }
            />
            <MacroPreview query={value} />
            <ResultsPanel outcome={outcome} error={error} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
