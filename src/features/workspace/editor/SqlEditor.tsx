import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import * as monaco from "monaco-editor";
import { useTheme } from "@/components/common/theme-provider";
import { useWorkspaceStore, useAuthStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import {
  initializeMonacoGlobally,
  createMonacoEditor,
} from "@/features/workspace/editor/monacoConfig";
import { Button } from "@/components/ui/button";
import { CirclePlay, Save, Copy, AlertTriangle, PenLine, Cloud, CloudOff, Loader2, Check } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSavedQueries } from "@/hooks";
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
  
  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>("");
  const savedStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get saved queries to check for duplicates
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId ?? undefined);

  const editorTheme = theme === "light" ? "vs-light" : "vs-dark";

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

  // Auto-save function
  const performAutoSave = useCallback(async () => {
    if (!tab?.isSaved || !activeConnectionId) return;
    
    const currentContent = getFullContent();
    
    // Don't save if content hasn't changed from last save
    if (currentContent === lastSavedContentRef.current) {
      setSaveStatus("saved");
      return;
    }
    
    if (!currentContent.trim()) return;

    setSaveStatus("saving");
    
    try {
      await updateSavedQuery(tabId, currentContent);
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
    }
  }, [tab?.isSaved, activeConnectionId, tabId, updateSavedQuery, getFullContent]);

  // Schedule auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    if (!tab?.isSaved) return;
    
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Mark as unsaved (has pending changes)
    setSaveStatus("unsaved");
    
    // Schedule new save
    autoSaveTimeoutRef.current = setTimeout(() => {
      performAutoSave();
    }, AUTO_SAVE_DELAY);
  }, [tab?.isSaved, performAutoSave]);

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
          
          // Trigger auto-save for saved queries
          if (tab?.isSaved) {
            scheduleAutoSave();
          }
        });

        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          handleRunQuery
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
  }, [tabId, editorTheme, handleRunQuery]);

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
    <div className="h-full flex flex-col">
      <div className="px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-[200px]">
            {tab.title}
          </span>
          {renderSaveStatus()}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="link" onClick={handleRunQuery} className="gap-2">
            <CirclePlay className="h-6 w-6" />
          </Button>

          {/* Save Dropdown - Only show if user has permission to save queries */}
          {canManageSavedQueries && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="link"
                  className="gap-1"
                  disabled={tab.type === "home" || tab.type === "information" || isSaving}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
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
    </div>
  );
};

export default SQLEditor;
