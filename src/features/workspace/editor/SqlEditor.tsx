import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import * as monaco from "monaco-editor";
import { useTheme } from "@/components/common/theme-provider";
import { useWorkspaceStore, useAuthStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import {
  initializeMonacoGlobally,
  createMonacoEditor,
} from "@/features/workspace/editor/monacoConfig";
import { Button } from "@/components/ui/button";
import { CirclePlay, Save, Copy, AlertTriangle, PenLine, Cloud, CloudOff, Loader2, Check, CircleStop, FileCode, ChevronDown, Database } from "lucide-react";
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

interface SQLEditorProps {
  tabId: string;
  onRunQuery: (query: string) => void;
}

type SaveMode = "save" | "save-as";
type SaveStatus = "idle" | "saving" | "saved" | "unsaved";

const AUTO_SAVE_DELAY = 2000; // 2 seconds after user stops typing

const SQLEditor: React.FC<SQLEditorProps> = ({ tabId, onRunQuery }) => {
  const { getTabById, updateTab, saveQuery, updateSavedQuery } = useWorkspaceStore();
  const { activeConnectionId } = useAuthStore();
  const { hasPermission, hasAnyPermission } = useRbacStore();

  // Check permissions for saving queries
  const canSaveQuery = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_CREATE);
  const canUpdateQuery = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_UPDATE);
  const canManageSavedQueries = canSaveQuery || canUpdateQuery;

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

  // Get saved queries to check for duplicates
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId ?? undefined);

  // Refs to avoid stale closures in Monaco listeners
  const latestTabRef = useRef(tab);
  const onRunQueryRef = useRef(onRunQuery);

  useEffect(() => {
    latestTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    onRunQueryRef.current = onRunQuery;
  }, [onRunQuery]);

  const editorTheme = theme === "light" ? "vs-light" : "chouse-dark";

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
    return "";
  }, []);

  const getFullContent = useCallback(() => {
    return monacoRef.current?.getValue() || "";
  }, []);

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

  const isSavingRef = useRef(false);

  // Auto-save function
  const performAutoSave = useCallback(async () => {
    if (!latestTabRef.current?.isSaved || isSavingRef.current) return;

    const currentContent = getFullContent();

    // Don't save if content hasn't changed from last save
    if (currentContent === lastSavedContentRef.current) {
      console.log(`[AutoSave] Skipping save for tab ${tabId}: content unchanged`);
      setSaveStatus("saved");
      return;
    }

    if (!currentContent.trim()) return;

    setSaveStatus("saving");
    isSavingRef.current = true;

    try {
      console.log(`[AutoSave] Saving tab ${tabId}...`);
      await updateSavedQuery(tabId, currentContent);
      console.log(`[AutoSave] Successfully saved tab ${tabId}`);
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
      console.error("Auto-save failed:", error);
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
    console.log(`[AutoSave] Scheduled save for tab ${tabId} in ${AUTO_SAVE_DELAY}ms`);
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

    const initEditor = async () => {
      await initializeMonacoGlobally();
      if (editorRef.current) {
        editor = await createMonacoEditor(editorRef.current, editorTheme);
        monacoRef.current = editor;

        if (tab?.content) {
          const content = typeof tab.content === "string" ? tab.content : "";
          editor.setValue(content);
          // Initialize last saved content for saved queries
          if (tab.isSaved) {
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
            const content = getCurrentQuery();
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
      }
    };

    initEditor();

    return () => {
      if (changeListener) {
        changeListener.dispose();
      }
      if (editor) {
        editor.dispose();
      }
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

  // Handle "Save As" action
  const handleSaveAs = () => {
    openSaveDialog("save-as");
  };

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
      console.error("Error saving query:", error);
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

  // Render save status indicator
  const renderSaveStatus = () => {
    if (!tab.isSaved) return null;

    switch (saveStatus) {
      case "saving":
        return (
          <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving...
          </span>
        );
      case "saved":
        return (
          <span className="flex items-center gap-1 text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            <Check className="h-3 w-3" />
            Saved
          </span>
        );
      case "unsaved":
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
            <Cloud className="h-3 w-3" />
            Unsaved
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] text-gray-400 bg-white/5 px-1.5 py-0.5 rounded">
            <Cloud className="h-3 w-3" />
            Synced
          </span>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#14141a]">
      <div className="px-4 py-2 flex items-center justify-between border-b border-white/5 bg-white/5 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <FileCode className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-1">Editor</span>
              <span className="text-sm font-semibold truncate max-w-[200px] leading-none">
                {tab.title}
              </span>
            </div>
          </div>
          <Separator orientation="vertical" className="h-6 mx-1" />
          {renderSaveStatus()}
        </div>

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl shadow-2xl backdrop-blur-md">
              {tab?.isLoading && canKillQuery ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsKillDialogOpen(true)}
                      disabled={killQueryMutation.isPending}
                      className="h-8 w-8 p-0 text-muted-foreground hover:bg-red-600 hover:text-white transition-all duration-200"
                    >
                      <CircleStop className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Terminate current query execution</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRunQuery}
                      className="h-8 w-8 p-0 text-muted-foreground hover:bg-blue-600 hover:text-white transition-all duration-200 ring-offset-black"
                    >
                      <CirclePlay className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>Run query (Ctrl+Enter)</p>
                  </TooltipContent>
                </Tooltip>
              )}

              <Separator orientation="vertical" className="h-4 mx-1 opacity-50" />

              {/* Save Dropdown - Only show if user has permission to save queries */}
              {canManageSavedQueries && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 hover:bg-white/10"
                          disabled={tab.type === "home" || tab.type === "information" || isSaving}
                        >
                          <Save className="h-4 w-4 text-muted-foreground mr-1" />
                          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end">
                      Save & Management Options
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-48">
                    {tab.isSaved ? (
                      <>
                        {canUpdateQuery && (
                          <DropdownMenuItem onClick={() => performAutoSave()} className="gap-2">
                            <Save className="h-3.5 w-3.5" />
                            <span>Save Now</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">⌘S</span>
                          </DropdownMenuItem>
                        )}
                        {canUpdateQuery && (
                          <DropdownMenuItem onClick={() => openSaveDialog("save")} className="gap-2">
                            <PenLine className="h-3.5 w-3.5" />
                            <span>Rename & Save</span>
                          </DropdownMenuItem>
                        )}
                        {canSaveQuery && (canUpdateQuery && <DropdownMenuSeparator />)}
                        {canSaveQuery && (
                          <DropdownMenuItem onClick={handleSaveAs} className="gap-2">
                            <Copy className="h-3.5 w-3.5" />
                            <span>Save As...</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">⇧⌘S</span>
                          </DropdownMenuItem>
                        )}
                      </>
                    ) : (
                      <>
                        {canSaveQuery && (
                          <DropdownMenuItem onClick={() => openSaveDialog("save")} className="gap-2">
                            <Save className="h-3.5 w-3.5" />
                            <span>Save Query</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">⌘S</span>
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </TooltipProvider>
        </div>
      </div>
      <div ref={editorRef} className="flex-1" />

      {/* Save Query Dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Input
              type="text"
              placeholder="Query Name"
              value={queryName}
              onChange={handleQueryNameChange}
              onKeyDown={handleQueryNameKeyDown}
              autoFocus
              className={cn(isDuplicateName && "border-amber-500 focus-visible:ring-amber-500")}
            />

            {isDuplicateName && (
              <div className="flex items-start gap-2 text-amber-500 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  A query with this name already exists.
                  {saveMode === "save-as" && " A new copy will be created."}
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveQuery}
              disabled={!queryName.trim() || isSaving}
            >
              {isSaving ? "Saving..." : (saveMode === "save-as" ? "Save As New" : "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Kill Query Confirmation Dialog */}
      <AlertDialog open={isKillDialogOpen} onOpenChange={setIsKillDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Query Execution?</AlertDialogTitle>
            <AlertDialogDescription>
              This will attempt to terminate the currently running query on the ClickHouse server.
              Any partial results may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleKillQuery}
              disabled={killQueryMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {killQueryMutation.isPending ? "Stopping..." : "Stop Query"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SQLEditor;
