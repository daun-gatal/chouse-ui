/**
 * The workspace's ClickHouse-aware Monaco editor for a panel's SQL. Default
 * export so the Monaco chunk loads only when a panel is edited.
 */

import React, { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

import { useTheme } from "@/components/common/theme-provider";
import { createMonacoEditor, initializeMonacoGlobally } from "@/features/workspace/editor/monacoConfig";

interface Props {
  value: string;
  onChange: (value: string) => void;
  height: number;
}

export default function PanelSqlEditor({ value, onChange, height }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "chouse-light" : "chouse-dark";
  const themeRef = useRef(theme);

  useEffect(() => {
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let listener: monaco.IDisposable | null = null;
    let aborted = false;
    void (async () => {
      await initializeMonacoGlobally();
      if (aborted || !containerRef.current) return;
      editor = await createMonacoEditor(containerRef.current, themeRef.current);
      if (aborted) {
        editor.dispose();
        return;
      }
      editorRef.current = editor;
      editor.setValue(valueRef.current);
      listener = editor.onDidChangeModelContent(() => {
        const next = editor?.getValue() ?? "";
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChangeRef.current(next);
      });
    })();
    return () => {
      aborted = true;
      listener?.dispose();
      editor?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== editor.getValue()) {
      valueRef.current = value;
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={containerRef} className="w-full overflow-hidden rounded-xs border border-ink-500" style={{ height }} data-testid="panel-sql-editor" />;
}
