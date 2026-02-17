import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { createMonacoDiffEditor, initializeMonacoGlobally } from '@/features/workspace/editor/monacoConfig';
import { useTheme } from "@/components/common/theme-provider";
import { diffLines } from 'diff';

interface DiffEditorProps {
    original: string;
    modified: string;
    language?: string;
    options?: monaco.editor.IDiffEditorConstructionOptions;
    className?: string;
}

export const DiffEditor: React.FC<DiffEditorProps> = ({
    original,
    modified,
    language = "sql",
    options = {},
    className = "h-[500px] w-full border rounded-md overflow-hidden",
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const { theme } = useTheme();

    const updateDecorations = (editor: monaco.editor.IStandaloneDiffEditor, originalText: string, modifiedText: string) => {
        const changes = diffLines(originalText, modifiedText);
        const originalEditor = editor.getOriginalEditor();
        const modifiedEditor = editor.getModifiedEditor();

        const originalDecorations: monaco.editor.IModelDeltaDecoration[] = [];
        const modifiedDecorations: monaco.editor.IModelDeltaDecoration[] = [];

        let originalLine = 1;
        let modifiedLine = 1;

        changes.forEach((change) => {
            const lineCount = change.count || 0;

            if (change.removed) {
                originalDecorations.push({
                    range: new monaco.Range(originalLine, 1, originalLine + lineCount - 1, 1),
                    options: {
                        isWholeLine: true,
                        className: 'my-removed-line',
                        linesDecorationsClassName: 'my-removed-line-gutter',
                    }
                });
                originalLine += lineCount;
            } else if (change.added) {
                modifiedDecorations.push({
                    range: new monaco.Range(modifiedLine, 1, modifiedLine + lineCount - 1, 1),
                    options: {
                        isWholeLine: true,
                        className: 'my-added-line',
                        linesDecorationsClassName: 'my-added-line-gutter',
                    }
                });
                modifiedLine += lineCount;
            } else {
                originalLine += lineCount;
                modifiedLine += lineCount;
            }
        });

        // Apply decorations to both editors
        // We use createDecorationsCollection which replaces previous decorations if we tracked them, 
        // but since we are re-calculating on change, creating new collections is acceptable for this use case.
        originalEditor.createDecorationsCollection(originalDecorations);
        modifiedEditor.createDecorationsCollection(modifiedDecorations);
    };

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            // Small delay to ensure container is ready and styled
            await new Promise(resolve => setTimeout(resolve, 50));

            if (!containerRef.current || !isMounted) return;

            // Ensure Monaco is initialized with theme
            initializeMonacoGlobally();

            if (editorRef.current) {
                editorRef.current.dispose();
            }

            const editorTheme = theme === "light" ? "vs-light" : "chouse-dark";

            const editor = await createMonacoDiffEditor(containerRef.current, editorTheme, {
                renderSideBySide: true, // Default to side-by-side
                originalEditable: false,
                readOnly: true,
                renderIndicators: true,
                ...options, // Allow overriding options (e.g., renderSideBySide: false)
            });

            if (!isMounted) {
                editor.dispose();
                return;
            }

            editorRef.current = editor;

            const originalModel = monaco.editor.createModel(original, language);
            const modifiedModel = monaco.editor.createModel(modified, language);

            editor.setModel({
                original: originalModel,
                modified: modifiedModel
            });

            // Initial decoration update
            updateDecorations(editor, original, modified);
        };

        const timer = setTimeout(() => {
            init();
        }, 50);

        return () => {
            isMounted = false;
            clearTimeout(timer);
            if (editorRef.current) {
                editorRef.current.dispose();
            }
        };
    }, [theme]);

    useEffect(() => {
        if (!containerRef.current || !editorRef.current) return;

        const resizeObserver = new ResizeObserver(() => {
            editorRef.current?.layout();
        });

        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        if (editorRef.current) {
            const model = editorRef.current.getModel();
            if (model) {
                let changed = false;
                if (model.original.getValue() !== original) {
                    model.original.setValue(original);
                    changed = true;
                }
                if (model.modified.getValue() !== modified) {
                    model.modified.setValue(modified);
                    changed = true;
                }

                if (changed) {
                    updateDecorations(editorRef.current, original, modified);
                }
            }
        }
    }, [original, modified]);

    return (
        <div ref={containerRef} className={className} />
    );
};