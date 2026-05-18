import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import * as monaco from "monaco-editor";
import { useTheme } from "@/components/common/theme-provider";
import { useWorkspaceStore, useAuthStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import {
  initializeMonacoGlobally,
  createMonacoEditor,
} from "@/features/workspace/editor/monacoConfig";
import { Button } from "@/components/ui/button";
import { CirclePlay, Save, Copy, AlertTriangle, PenLine, Cloud, CloudOff, Loader2, Check, CircleStop, FileCode, ChevronDown, Database, Network, Sparkles, Wand2, Keyboard, Search, Code2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSavedQueries, useKillQuery } from "@/hooks";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";

export interface SqlEditorHandle {
  format: () => void;
  commentLine: () => void;
  find: () => void;
  save: () => void;
  saveAs: () => void;
  /** Opens the kill-query confirmation dialog (same as clicking Stop). */
  stop: () => void;
  /** Returns the current selection if any, otherwise the full editor content. */
  getQuery: () => string;
}

interface SQLEditorProps {
  tabId: string;
  onRunQuery: (query: string) => void;
  onExplain?: (query: string) => void;
  onOptimize?: (query: string) => void;
  onOpenShortcuts?: () => void;
}

type SaveMode = "save" | "save-as";
type SaveStatus = "idle" | "saving" | "saved" | "unsaved";

const AUTO_SAVE_DELAY = 2000; // 2 seconds after user stops typing

// Detect Mac once at module level (navigator.platform is deprecated but still
// the most reliable synchronous check; userAgentData is not yet universal)
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);

/** Returns a readable shortcut string for the current platform.
 *  mod  = Ctrl on Windows/Linux, ⌘ on Mac
 *  shift = Shift / ⇧
 *  alt  = Alt / ⌥
 */
function kbd(key: string, { mod = false, shift = false, alt = false } = {}) {
  if (isMac) {
    const parts: string[] = [];
    if (mod)   parts.push("⌘");
    if (shift) parts.push("⇧");
    if (alt)   parts.push("⌥");
    parts.push(key);
    return parts.join("");
  }
  const parts: string[] = [];
  if (mod)   parts.push("Ctrl");
  if (shift) parts.push("Shift");
  if (alt)   parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

const SQLEditor = React.forwardRef<SqlEditorHandle, SQLEditorProps>(function SQLEditor(
  { tabId, onRunQuery, onExplain, onOptimize, onOpenShortcuts },
  ref
) {
  const { getTabById, updateTab, saveQuery, updateSavedQuery } = useWorkspaceStore();
  const { activeConnectionId } = useAuthStore();
  const { hasPermission, hasAnyPermission } = useRbacStore();

  // Check permissions for saving queries
  const canSaveQuery = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_CREATE);
  const canUpdateQuery = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_UPDATE);
  const canManageSavedQueries = canSaveQuery || canUpdateQuery;

  // Check permission for AI optimizer
  const canOptimizeQuery = hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);

  const editorRef = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tab = getTabById(tabId);
  const { theme } = useTheme();
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>("save");
  const [queryName, setQueryName] = useState("");
  const [isSaving, setIsSaving] = useState(false);



  // Permissions for live queries
  const canKillQuery = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_KILL);

  // Kill query mutation
  const killQueryMutation = useKillQuery();

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isKillDialogOpen, setIsKillDialogOpen] = useState(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>("");
  const savedStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stable refs for save handlers so useImperativeHandle can reference them
  // before the actual useCallback definitions appear later in this component.
  const saveHandlerRef = useRef<() => void>(() => {});
  const saveAsHandlerRef = useRef<() => void>(() => {});

  // Get saved queries to check for duplicates
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId ?? undefined);

  // Refs to avoid stale closures in Monaco listeners
  const latestTabRef = useRef(tab);
  const onRunQueryRef = useRef(onRunQuery);
  const getCurrentQueryRef = useRef<() => string>(() => "");

  useEffect(() => {
    latestTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    onRunQueryRef.current = onRunQuery;
  }, [onRunQuery]);

  const editorTheme = theme === "light" ? "chouse-light" : "chouse-dark";

  // Check if name already exists (excluding current query if updating)
  const isDuplicateName = useMemo(() => {
    if (!queryName.trim()) return false;
    const normalizedName = queryName.trim().toLowerCase();
    return savedQueries.some(
      (q) => q.name.toLowerCase() === normalizedName && q.id !== tabId
    );
  }, [queryName, savedQueries, tabId]);

  const getCurrentQuery = useCallback(() => {
    if (monacoRef.current) {
      const selection = monacoRef.current.getSelection();
      const model = monacoRef.current.getModel();

      if (selection && model && !selection.isEmpty()) {
        return model.getValueInRange(selection);
      }
      return monacoRef.current.getValue();
    }
    // Fallback to tab content from store when Monaco editor is not ready
    // This can happen during hot module reloading in development
    const currentTab = latestTabRef.current;
    if (currentTab?.content && typeof currentTab.content === "string") {
      return currentTab.content;
    }
    return "";
  }, []);

  const getFullContent = useCallback(() => {
    if (monacoRef.current) {
      return monacoRef.current.getValue();
    }
    // Fallback to tab content from store when Monaco editor is not ready
    const currentTab = latestTabRef.current;
    if (currentTab?.content && typeof currentTab.content === "string") {
      return currentTab.content;
    }
    return "";
  }, []);

  // Keep the ref updated with the latest getCurrentQuery function
  useEffect(() => {
    getCurrentQueryRef.current = getCurrentQuery;
  }, [getCurrentQuery]);

  // Sync editor content when tab content changes externally (e.g. from Debugger or Optimizer)
  useEffect(() => {
    if (monacoRef.current && tab?.content) {
      const currentEditorValue = monacoRef.current.getValue();
      const newContent = typeof tab.content === "string" ? tab.content : "";
      // Only update if content is different to avoid cursor jumping or infinite loops
      // (though onDidChangeModelContent updates store, which triggers this, so check is crucial)
      if (currentEditorValue !== newContent) {
        monacoRef.current.setValue(newContent);
      }
    }
  }, [tab?.content]);

  const handleRunQuery = useCallback(() => {
    const content = getCurrentQuery();
    if (content.trim()) {
      onRunQuery(content);
    } else {
      toast.error("Please enter a query to run");
    }
  }, [onRunQuery, getCurrentQuery]);

  const handleKillQuery = useCallback(() => {
    if (tab?.queryId) {
      killQueryMutation.mutate(tab.queryId, {
        onSuccess: () => {
          setIsKillDialogOpen(false);
        }
      });
    }
  }, [tab?.queryId, killQueryMutation]);

  const handleExplain = useCallback(() => {
    if (onExplain) {
      const content = getCurrentQuery();
      if (content.trim()) {
        onExplain(content);
      } else {
        toast.error("Please enter a query to explain");
      }
    }
  }, [onExplain, getCurrentQuery]);

  const handleOptimizeQuery = useCallback(() => {
    const content = getCurrentQuery();
    if (content.trim()) {
      if (onOptimize) {
        onOptimize(content);
      }
    } else {
      toast.error("Please enter a query to optimize");
    }
  }, [getCurrentQuery, onOptimize]);

  const handleFormatQuery = useCallback(() => {
    if (monacoRef.current) {
      monacoRef.current.getAction("editor.action.formatDocument")?.run();
      toast.success("Query formatted");
    }
  }, []);

  const handleCommentLine = useCallback(() => {
    monacoRef.current?.getAction("editor.action.commentLine")?.run();
    monacoRef.current?.focus();
  }, []);

  const handleFind = useCallback(() => {
    monacoRef.current?.getAction("actions.find")?.run();
  }, []);

  // Expose editor actions to parent via ref.
  // save/saveAs delegate through stable refs so the order of hook calls
  // doesn't matter (handleSaveShortcut is defined further down).
  React.useImperativeHandle(ref, () => ({
    format: handleFormatQuery,
    commentLine: handleCommentLine,
    find: handleFind,
    save: () => saveHandlerRef.current(),
    saveAs: () => saveAsHandlerRef.current(),
    stop: () => setIsKillDialogOpen(true),
    getQuery: getCurrentQuery,
  }), [handleFormatQuery, handleCommentLine, handleFind, getCurrentQuery]);

  const isSavingRef = useRef(false);

  // Auto-save function
  const performAutoSave = useCallback(async () => {
    if (!latestTabRef.current?.isSaved || isSavingRef.current) return;

    const currentContent = getFullContent();

    // Don't save if content hasn't changed from last save
    if (currentContent === lastSavedContentRef.current) {
      log.debug('[AutoSave] Skipping save for tab (content unchanged)', { tabId });
      setSaveStatus("saved");
      return;
    }

    if (!currentContent.trim()) return;

    setSaveStatus("saving");
    isSavingRef.current = true;

    try {
      log.debug('[AutoSave] Saving tab', { tabId });
      await updateSavedQuery(tabId, currentContent);
      log.debug('[AutoSave] Successfully saved tab', { tabId });
      lastSavedContentRef.current = currentContent;
      setSaveStatus("saved");

      // Clear saved status after 3 seconds
      if (savedStatusTimeoutRef.current) {
        clearTimeout(savedStatusTimeoutRef.current);
      }
      savedStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (error) {
      log.error("Auto-save failed:", error);
      setSaveStatus("unsaved");
    } finally {
      isSavingRef.current = false;
    }
  }, [activeConnectionId, tabId, updateSavedQuery, getFullContent]);

  // Schedule auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    // Use the latest tab state from ref
    if (!latestTabRef.current?.isSaved) return;

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Mark as unsaved (has pending changes)
    setSaveStatus("unsaved");

    // Schedule new save
    log.debug('[AutoSave] Scheduled save', { tabId, delayMs: AUTO_SAVE_DELAY });
    autoSaveTimeoutRef.current = setTimeout(() => {
      performAutoSave();
    }, AUTO_SAVE_DELAY);
  }, [performAutoSave, tabId]);

  const scheduleAutoSaveRef = useRef(scheduleAutoSave);
  useEffect(() => {
    scheduleAutoSaveRef.current = scheduleAutoSave;
  }, [scheduleAutoSave]);

  useEffect(() => {
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let changeListener: monaco.IDisposable | null = null;
    let isAborted = false; // Flag to handle React Strict Mode double-invoke

    const initEditor = async () => {
      await initializeMonacoGlobally();

      // Check if cleanup was called during async operation (React Strict Mode)
      if (isAborted) {
        return;
      }

      if (editorRef.current) {
        editor = await createMonacoEditor(editorRef.current, editorTheme);

        // Check again after async operation
        if (isAborted) {
          editor.dispose();
          return;
        }

        monacoRef.current = editor;

        // Use latestTabRef to avoid stale closure with tab content
        const currentTab = latestTabRef.current;
        if (currentTab?.content) {
          const content = typeof currentTab.content === "string" ? currentTab.content : "";
          editor.setValue(content);
          // Initialize last saved content for saved queries
          if (currentTab.isSaved) {
            lastSavedContentRef.current = content;
          }
        }

        changeListener = editor.onDidChangeModelContent(() => {
          const newContent = editor?.getValue() || "";
          updateTab(tabId, { content: newContent });

          // Trigger auto-save for saved queries using latest ref
          if (latestTabRef.current?.isSaved) {
            scheduleAutoSaveRef.current();
          }
        });

        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          () => {
            // Use ref to avoid stale closure - getCurrentQuery might not be updated
            const content = getCurrentQueryRef.current();
            if (content.trim()) {
              onRunQueryRef.current(content);
            } else {
              toast.error("Please enter a query to run");
            }
          }
        );

        // Add Ctrl/Cmd+S for save
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => handleSaveShortcut()
        );

        // Add Ctrl/Cmd+Shift+S for save as
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
          () => handleSaveAs()
        );

        // F5 – run query (common in DB tools like DBeaver, TablePlus)
        editor.addCommand(
          monaco.KeyCode.F5,
          () => {
            const content = getCurrentQueryRef.current();
            if (content.trim()) {
              onRunQueryRef.current(content);
            } else {
              toast.error("Please enter a query to run");
            }
          }
        );

        // Cmd/Ctrl+Shift+F – format query (matches VS Code Option+Shift+F convention)
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
          () => {
            monacoRef.current?.getAction("editor.action.formatDocument")?.run();
            toast.success("Query formatted");
          }
        );

        // Cmd/Ctrl+Shift+E – explain query plan
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
          () => {
            const currentTab = latestTabRef.current;
            if (currentTab && onExplain) {
              const content = getCurrentQueryRef.current();
              if (content.trim()) {
                onExplain(content);
              } else {
                toast.error("Please enter a query to explain");
              }
            }
          }
        );

        // Cmd/Ctrl+Shift+I – AI optimize (I for Improve / Intelligence)
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
          () => {
            if (onOptimize) {
              const content = getCurrentQueryRef.current();
              if (content.trim()) {
                onOptimize(content);
              } else {
                toast.error("Please enter a query to optimize");
              }
            }
          }
        );
      }
    };

    initEditor();

    return () => {
      isAborted = true; // Signal any pending async operations to abort
      if (changeListener) {
        changeListener.dispose();
      }
      if (editor) {
        editor.dispose();
      }
      // Clear the monaco ref to prevent stale reference after HMR
      monacoRef.current = null;
      // Clear auto-save timeout on unmount
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (savedStatusTimeoutRef.current) {
        clearTimeout(savedStatusTimeoutRef.current);
      }
    };
  }, [tabId, editorTheme]); // Removed handleRunQuery as it's handled by refs now

  // Update lastSavedContentRef when tab becomes saved
  useEffect(() => {
    if (tab?.isSaved && tab.content) {
      const content = typeof tab.content === "string" ? tab.content : "";
      lastSavedContentRef.current = content;
      setSaveStatus("saved");

      // Clear saved status after 3 seconds
      if (savedStatusTimeoutRef.current) {
        clearTimeout(savedStatusTimeoutRef.current);
      }
      savedStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    }
  }, [tab?.isSaved]);

  // Quick save (Ctrl+S) - updates if saved, otherwise opens dialog
  const handleSaveShortcut = useCallback(() => {
    if (!activeConnectionId) {
      toast.warning("Please connect to a server before saving queries.");
      return;
    }

    if (tab?.isSaved) {
      // Already saved - do immediate save (bypass auto-save delay)
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      performAutoSave();
    } else {
      // New query - open save dialog
      openSaveDialog("save");
    }
  }, [activeConnectionId, tab?.isSaved, performAutoSave]);

  // Open save dialog with specified mode
  const openSaveDialog = (mode: SaveMode) => {
    if (!activeConnectionId) {
      toast.warning("Please connect to a server before saving queries.");
      return;
    }

    setSaveMode(mode);

    if (mode === "save" && tab?.isSaved) {
      setQueryName(tab.title);
    } else if (mode === "save-as") {
      const baseName = tab?.title || "Untitled Query";
      const copyName = baseName.includes(" (copy)")
        ? baseName
        : `${baseName} (copy)`;
      setQueryName(copyName);
    } else {
      setQueryName(tab?.title || "Untitled Query");
    }

    setIsSaveDialogOpen(true);
  };

  // Keep stable refs up-to-date so useImperativeHandle delegates work correctly
  saveHandlerRef.current = handleSaveShortcut;

  // Handle "Save As" action
  const handleSaveAs = () => {
    openSaveDialog("save-as");
  };
  saveAsHandlerRef.current = handleSaveAs;

  // Handle the actual save from dialog
  const handleSaveQuery = async () => {
    const query = getFullContent();
    if (!queryName.trim()) {
      toast.error("Please enter a query name.");
      return;
    }

    if (!query.trim()) {
      toast.error("Please enter a query to save.");
      return;
    }

    setIsSaving(true);
    try {
      if (saveMode === "save" && tab?.isSaved) {
        await updateSavedQuery(tabId, query, queryName.trim());
        lastSavedContentRef.current = query;
      } else {
        await saveQuery(tabId, queryName.trim(), query);
        lastSavedContentRef.current = query;
      }
      setIsSaveDialogOpen(false);
      setSaveStatus("saved");
    } catch (error) {
      log.error("Error saving query:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQueryNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQueryName(e.target.value);
  };

  const handleQueryNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isDuplicateName) {
      handleSaveQuery();
    }
  };

  if (!tab) return null;

  const dialogTitle = saveMode === "save-as"
    ? "Save As New Query"
    : (tab?.isSaved ? "Update Query" : "Save Query");

  const dialogDescription = saveMode === "save-as"
    ? "Create a new copy of this query with a different name:"
    : (tab?.isSaved ? "Update the saved query name:" : "Enter a name for this query:");

  // Render save status indicator — editorial mono pill, semantic dot
  const renderSaveStatus = () => {
    if (!tab.isSaved) return null;

    const statusMap: Record<SaveStatus, { dot: string; label: string; icon: React.ReactNode }> = {
      saving: { dot: "bg-blue-400", label: "Saving", icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> },
      saved: { dot: "bg-emerald-400", label: "Saved", icon: <Check className="h-3 w-3" aria-hidden /> },
      unsaved: { dot: "bg-brand", label: "Unsaved", icon: <Cloud className="h-3 w-3" aria-hidden /> },
      idle: { dot: "bg-paper-faint", label: "Synced", icon: <Cloud className="h-3 w-3" aria-hidden /> },
    };
    const s = statusMap[saveStatus];

    return (
      <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
        <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
        {s.label}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col bg-ink-50">
      <div className="sticky top-0 z-10 flex flex-none items-center justify-between border-b border-ink-500 bg-ink-100 px-3 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <FileCode className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint leading-none">
                Editor
              </span>
              <span className="truncate max-w-[260px] font-mono text-[13px] text-paper leading-none">
                {tab.title}
              </span>
            </div>
          </div>
          {tab.isSaved && (
            <>
              <span className="h-5 w-px bg-ink-500" aria-hidden />
              {renderSaveStatus()}
            </>
          )}
        </div>

        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div ref={editorRef} className="flex-1" />

      {/* Save query dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="overflow-hidden rounded-md border-ink-500 bg-ink-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-paper">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-paper-muted">{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Input
              type="text"
              placeholder="Query name"
              value={queryName}
              onChange={handleQueryNameChange}
              onKeyDown={handleQueryNameKeyDown}
              autoFocus
              className={cn(
                "h-10 rounded-xs border-ink-500 bg-ink-200 font-mono text-[13px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0",
                isDuplicateName && "border-brand focus-visible:border-brand"
              )}
            />

            {isDuplicateName && (
              <div className="flex items-start gap-2 rounded-xs border border-brand/30 bg-brand/[0.04] p-3 text-[13px] text-paper-muted">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span>
                  A query with this name already exists.
                  {saveMode === "save-as" && " A new copy will be created."}
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)} className="rounded-xs border-ink-500 bg-transparent text-paper hover:border-ink-700 hover:bg-ink-200">
              Cancel
            </Button>
            <Button
              onClick={handleSaveQuery}
              disabled={!queryName.trim() || isSaving}
              className="rounded-xs bg-brand text-ink-50 hover:bg-brand-soft disabled:opacity-60"
            >
              {isSaving ? "Saving…" : saveMode === "save-as" ? "Save as new" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {/* Kill query confirmation */}
      <AlertDialog open={isKillDialogOpen} onOpenChange={setIsKillDialogOpen}>
        <AlertDialogContent className="rounded-md border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-paper">Stop query execution?</AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">
              This will attempt to terminate the currently running query on the ClickHouse server.
              Any partial results may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xs border-ink-500 bg-transparent text-paper hover:border-ink-700 hover:bg-ink-200">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleKillQuery}
              disabled={killQueryMutation.isPending}
              className="rounded-xs bg-red-600 text-paper hover:bg-red-500"
            >
              {killQueryMutation.isPending ? "Stopping…" : "Stop query"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export default SQLEditor;
