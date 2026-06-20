/**
 * A self-contained Monaco SQL editor — the same ClickHouse-aware editor the
 * Explorer/workspace uses (syntax highlighting + schema intellisense scoped to
 * the active connection), so the builder's "Read-only SELECT" field behaves like
 * the Explorer query input. Includes auto-format and an "expand" action that
 * opens a large, glassy editor window. Default-exported for lazy loading so the
 * heavy Monaco chunk only loads when the builder opens.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as monaco from "monaco-editor";
import { Wand2, Maximize2, Minimize2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { initializeMonacoGlobally, createMonacoEditor } from "@/features/workspace/editor/monacoConfig";
import { useTheme } from "@/components/common/theme-provider";
import { cn } from "@/lib/utils";

interface MonacoSqlInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Inline (collapsed) height in px. */
  height?: number;
  className?: string;
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
  /** Fill the parent's height (flex) instead of a fixed px height. */
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
    let aborted = false; // guards React Strict Mode double-invoke

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

  // Sync external value changes (prefill / edit / the other open editor).
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

export default function MonacoSqlInput({ value, onChange, height = 220, className }: MonacoSqlInputProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
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

      {/* Glassy expand window — a nested dialog (portals to body, so it escapes
          the builder dialog's transform and fills the viewport). */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[82vh] w-[88vw] max-w-5xl flex-col gap-3 border-ink-500 bg-ink-100/85 p-4 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-semibold text-paper">Read-only SELECT</DialogTitle>
          </DialogHeader>
          <MonacoEditorCore
            value={value}
            onChange={onChange}
            fill
            rightSlot={
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Collapse editor"
                className="grid h-6 w-6 place-items-center rounded-xs text-paper-muted hover:bg-ink-300 hover:text-paper"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
