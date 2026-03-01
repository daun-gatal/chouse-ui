import React, { useState, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Loader2, FileX2, Download, ExternalLink, Lightbulb,
         CirclePlay, CircleStop, Wand2, Code2, Search, Network, Sparkles, Keyboard, Save, Copy } from "lucide-react";
import DOMPurify from "dompurify";
import { format as formatDate } from "date-fns";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
// Component imports
import SQLEditor, { type SqlEditorHandle } from "@/features/workspace/editor/SqlEditor";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DownloadDialog from "@/components/common/DownloadDialog";
import EmptyQueryResult from "./EmptyQueryResult";
import StatisticsDisplay from "./StatisticsDisplay";
import ExplainTab from "./ExplainTab";
import { DebugQueryDialog } from "@/components/common/DebugQueryDialog";
import { OptimizeQueryDialog } from "@/components/common/OptimizeQueryDialog";

// Store and Hooks
import { useWorkspaceStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useDatabases, useConfig } from "@/hooks";
import { queryApi } from "@/api";

// ── Platform-aware keyboard hint helpers ────────────────────────────────────
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);

function kbd(key: string, { mod = false, shift = false } = {}) {
  if (isMac) {
    const parts: string[] = [];
    if (mod)   parts.push("⌘");
    if (shift) parts.push("⇧");
    parts.push(key);
    return parts.join("");
  }
  const parts: string[] = [];
  if (mod)   parts.push("Ctrl");
  if (shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

// Types
import { ExplainType, ExplainResult } from "@/types/explain";

interface SqlTabProps {
  tabId: string;
}

interface IRow {
  [key: string]: unknown;
}

// Format values for TanStack table (same as DataSampleSection)
const formatCellValue = (value: unknown): { html: string; className?: string; type?: string } => {
  if (value === null || value === undefined) {
    return { html: "NULL", className: "cell-null" };
  }

  const type = typeof value;

  if (type === 'number') {
    return {
      html: (value as number).toLocaleString(),
      className: "cell-number",
      type: "number"
    };
  }

  if (type === 'boolean') {
    return {
      html: value ? "TRUE" : "FALSE",
      className: "cell-boolean",
      type: "boolean"
    };
  }

  if (value instanceof Date || (type === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value as string))) {
    try {
      const date = type === 'string' ? new Date(value as string) : (value as Date);
      return {
        html: formatDate(date, "yyyy-MM-dd HH:mm:ss"),
        className: "cell-date",
        type: "date"
      };
    } catch {
      return { html: String(value), className: "cell-string", type: "string" };
    }
  }

  if (type === 'object') {
    const json = JSON.stringify(value);
    const truncated = json.length > 50 ? json.substring(0, 50) + "..." : json;
    return {
      html: truncated,
      className: "cell-object-preview",
      type: "object"
    };
  }

  return { html: String(value), className: "cell-string", type: "string" };
};

/**
 * SqlTab component that provides a SQL editor and result viewer
 * 
 * Migrated from AgGrid to DataTable for consistent Ethereal styling.
 * Metadata tab removed as requested.
 */
const SqlTab: React.FC<SqlTabProps> = ({ tabId }) => {
  const { getTabById, runQuery, updateTab } = useWorkspaceStore();
  // Using refetch to handle side effects
  const { refetch: refetchDatabases } = useDatabases();
  const tab = getTabById(tabId);
  const [activeTab, setActiveTab] = useState<string>("results");

  // Ref to the SQL editor — used by the hint strip to invoke editor actions
  const editorRef = useRef<SqlEditorHandle>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);


  // Explain state
  const [explainPlan, setExplainPlan] = useState<ExplainResult | null>(null);
  const [isExplainLoading, setIsExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainType, setExplainType] = useState<ExplainType>('plan');
  const [explainRefreshKey, setExplainRefreshKey] = useState(0);
  const lastExplainQueryRef = useRef<string>('');

  // Debugger state
  const [isDebugDialogOpen, setIsDebugDialogOpen] = useState(false);
  const [debugError, setDebugError] = useState<string>("");
  const [debugQueryString, setDebugQueryString] = useState<string>("");

  // Optimizer state
  const [isOptimizerOpen, setIsOptimizerOpen] = useState(false);
  const [optimizerAutoStart, setOptimizerAutoStart] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<{
    optimizedQuery: string;
    explanation: string;
    summary: string;
    tips: string[];
    originalQuery: string;
  } | null>(null);
  const [optimizationReason, setOptimizationReason] = useState<string>("");

  // Feature Flags & Permissions
  const { data: config } = useConfig();
  const { hasPermission } = useRbacStore();
  const canDebug = config?.features?.aiOptimizer && hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);
  // Separate check for cleaner logic, though currently identical to canDebug
  const canOptimize = config?.features?.aiOptimizer && hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);

  // RBAC for hint strip
  const canKillQuery    = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_KILL);
  const canSaveQuery    = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_CREATE);
  const canUpdateQuery  = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_UPDATE);

  // Detect schema-changing queries to refresh database explorer
  const isSchemaModifyingQuery = (query: string): boolean => {
    return /^\s*(CREATE|DROP|ALTER|TRUNCATE|RENAME|INSERT|UPDATE|DELETE)\s+/i.test(
      query
    );
  };

  // Background optimization check
  const checkOptimization = useCallback(async (query: string) => {
    if (!canOptimize) return;

    // reset previous result when running new query
    // reset previous result when running new query
    setOptimizationResult(null);
    setOptimizerAutoStart(false);
    setOptimizationReason("");

    try {
      // Light-weight boolean check
      queryApi.checkQueryOptimization(query)
        .then(result => {
          log.debug("[SqlTab] checkQueryOptimization result", { canOptimize: result.canOptimize, reason: result.reason });
          if (result.canOptimize) {
            toast("Your query can be optimized", {
              description: "AI analysis found potential improvements.",
              duration: Infinity,
              action: {
                label: "View",
                onClick: () => {
                  setOptimizerAutoStart(false);
                  setOptimizationReason(result.reason);
                  setIsOptimizerOpen(true);
                }
              },
              icon: <Lightbulb className="w-4 h-4 text-amber-400" />
            });
          }
        })
        .catch(err => {
          // Silent fail for background check
          log.debug("Background optimization check failed", err);
        });
    } catch (e) {
      // ignore
    }
  }, [canOptimize]);

  // Handle manual optimization trigger
  const handleOptimize = useCallback((query: string) => {
    setOptimizerAutoStart(false); // Manual trigger usually implies fresh start or we can set true
    setIsOptimizerOpen(true);
  }, []);

  // Handle query execution
  const handleRunQuery = useCallback(
    async (query: string) => {
      setExplainPlan(null);
      setExplainError(null);
      setActiveTab("results");

      // Save valid query for debugging context if needed later
      setDebugQueryString(query);

      setDebugQueryString(query);

      try {
        const shouldRefresh = isSchemaModifyingQuery(query);
        const result = await runQuery(query, tabId);

        if (!result.error) {
          checkOptimization(query);
        }

        if (!result.error && shouldRefresh) {
          // Trigger refetch but don't await blocking UI
          refetchDatabases();
          toast.success("Data Explorer refreshed due to schema change");
        }
      } catch (error) {
        log.error("Error running query:", error);
        toast.error(
          "Failed to execute query. Please check the console for more details."
        );
      }
    },
    [runQuery, tabId, refetchDatabases, canOptimize, checkOptimization]
  );

  // Runs whatever is currently in the editor (selection or full content) — used by hint strip
  const handleStripRunQuery = useCallback(() => {
    const query = editorRef.current?.getQuery() ?? "";
    if (query) handleRunQuery(query);
  }, [handleRunQuery]);

  // Handle explain query
  const handleExplain = useCallback(
    async (query: string, type?: ExplainType) => {
      // If no type specified, use the current explainType (preserve user's view)
      const targetType = type || explainType;

      setIsExplainLoading(true);
      setExplainError(null);
      setActiveTab("explain");
      setExplainType(targetType);
      setExplainRefreshKey(prev => prev + 1); // Increment to trigger refresh
      lastExplainQueryRef.current = query;

      try {
        const plan = await queryApi.explainQuery(query, targetType);
        setExplainPlan(plan);
      } catch (error: any) {
        log.error("Error explaining query:", error);
        setExplainError(error.message || "Failed to explain query");
        setExplainPlan(null);
      } finally {
        setIsExplainLoading(false);
      }
    },
    [explainType]
  );

  // Handle explain type change (re-explain with different type)
  const handleExplainTypeChange = useCallback(
    async (type: ExplainType) => {
      if (lastExplainQueryRef.current) {
        await handleExplain(lastExplainQueryRef.current, type);
      }
    },
    [handleExplain]
  );

  // Handle popout explain plan
  const handlePopout = useCallback(() => {
    if (!explainPlan) return;

    try {
      // Store both the explain result and the query for Analysis view
      const popoutData = {
        explainResult: explainPlan,
        query: lastExplainQueryRef.current
      };
      localStorage.setItem('explain_popout_data', JSON.stringify(popoutData));

      const width = 1200;
      const height = 800;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;

      window.open(
        '/explain-popout',
        'ExplainPlanVisualizer',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
      );
    } catch (error) {
      log.error("Failed to popout explain plan:", error);
      toast.error("Failed to open explain plan in new window");
    }
  }, [explainPlan]);

  // Generate TanStack columns from result metadata
  const columns = useMemo<ColumnDef<IRow>[]>(() => {
    if (!tab?.result?.meta || !tab.result.meta.length) return [];

    return tab.result.meta.map((col: { name: string; type: string }) => {
      const type = col.type?.toLowerCase() || "";
      const typeClass = type.includes("string") ? "type-string" :
        (type.includes("int") || type.includes("float") || type.includes("decimal")) ? "type-number" :
          type.includes("bool") ? "type-boolean" :
            (type.includes("date") || type.includes("time")) ? "type-date" :
              (type.includes("array") || type.includes("map") || type.includes("tuple") || type.includes("json")) ? "type-object" : "";

      return {
        accessorKey: col.name,
        header: () => (
          <div className="flex items-center justify-between w-full group cursor-default h-full px-1">
            <span className="truncate font-medium text-white/60 group-hover:text-white/90 transition-colors duration-300 lowercase text-[13px]">
              {col.name}
            </span>
            <span className={cn("cell-type-badge text-[9px] font-mono transition-all duration-500", typeClass)}>
              {col.type}
            </span>
          </div>
        ),
        cell: ({ getValue }) => {
          const value = getValue();
          const { html, className } = formatCellValue(value);
          const sanitizedHtml = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['em', 'strong', 'b', 'i', 'u', 'code', 'pre'],
            ALLOWED_ATTR: ['class'],
          });

          return (
            <div
              className={cn("w-full h-full truncate font-mono text-xs", className)}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              title={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
            />
          );
        },
        meta: {
          wrap: false // Assuming no wrap by default for SQL results table to save space, but could make toggleable
        }
      };
    });
  }, [tab?.result?.meta]);

  const rowData = useMemo(() => {
    return (tab?.result?.data || []) as IRow[];
  }, [tab?.result?.data]);


  // UI rendering functions
  const renderLoading = () => (
    <div className="h-full w-full flex items-center justify-center">
      <Loader2 size={24} className="animate-spin mr-2" />
      <p>Running query...</p>
    </div>
  );

  const renderError = (errorMessage: string) => (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-3">
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="font-mono text-xs mt-1 whitespace-pre-wrap break-all">
          {errorMessage}
        </AlertDescription>
      </Alert>

      {canDebug && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="bg-red-950/20 hover:bg-red-900/40 border-red-800 text-red-200"
            onClick={() => {
              setDebugError(errorMessage);
              const currentContent = typeof tab?.content === 'string' ? tab.content : '';
              if (!debugQueryString && currentContent) {
                setDebugQueryString(currentContent);
              }
              setIsDebugDialogOpen(true);
            }}
          >
            <Sparkles className="w-3.5 h-3.5 mr-2" />
            Debug with AI
          </Button>
        </div>
      )}
    </div>
  );

  const renderEmpty = () => (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center">
        <FileX2 size={48} className="text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          There's no data yet! Run a query to get started.
        </p>
      </div>
    </div>
  );

  const renderResultsTab = () => {
    if (!columns.length || !rowData.length) {
      return tab?.result?.statistics ? (
        <EmptyQueryResult statistics={tab.result.statistics} />
      ) : null;
    }

    return (
      <div className="h-full w-full flex flex-col overflow-hidden bg-transparent">
        {/* Toolbar mostly removed as AgGrid auto-size is handled internally or css. Download now in tabs. */}
        <div className="flex-1 w-full overflow-hidden relative">
          <DataTable
            columns={columns}
            data={rowData}
            stickyHeader={true}
            stickyFirstColumn={false}
            className="border-0 rounded-none shadow-none bg-transparent h-full" // Clean integration
          />
        </div>
      </div>
    );
  };

  const renderStatisticsResults = () => {
    if (!tab?.result?.statistics) return null;
    return <StatisticsDisplay statistics={tab.result.statistics} />;
  };

  const renderResultTabs = () => {
    const resultData = tab?.result?.data ?? [];
    // Metadata removed
    const hasData = resultData.length > 0;

    // If explain is active, strictly show only explain tab content and trigger
    if (activeTab === "explain" || (explainPlan && !tab?.result)) {
      return (
        <Tabs
          value="explain"
          onValueChange={(val) => {
            // Allow switching back to results if we have them
            if (val !== "explain") {
              setActiveTab(val);
              // Optional: Clear explain plan if switching away?
              // setExplainPlan(null); 
            }
          }}
          className="h-full flex flex-col"
        >
          <TabsList className="rounded-none border-b border-white/5 bg-black/20 backdrop-blur-md px-4 w-full justify-start h-10">
            {/* Show Results trigger to allow going back, but defaulting to Explain view */}
            <TabsTrigger value="results" className="data-[state=active]:bg-white/5">
              Results
              {hasData && <span className="ml-2 text-xs text-muted-foreground">({resultData.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="statistics" className="data-[state=active]:bg-white/5">
              Statistics
            </TabsTrigger>
            <TabsTrigger
              value="explain"
              className="data-[state=active]:bg-white/5 group relative flex items-center gap-2"
              draggable
              onDragEnd={(e) => {
                if (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight) {
                  handlePopout();
                }
              }}
            >
              Explain
              <span
                role="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-white/10 rounded p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePopout();
                }}
                title="Open in new window"
              >
                <ExternalLink size={12} className="text-white" />
              </span>
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 overflow-hidden w-full relative">
            <TabsContent value="explain" className="h-full m-0 overflow-hidden data-[state=inactive]:hidden absolute inset-0 bg-background/50 backdrop-blur-sm">
              <ExplainTab
                plan={explainPlan}
                isLoading={isExplainLoading}
                error={explainError}
                currentType={explainType}
                onTypeChange={handleExplainTypeChange}
                query={lastExplainQueryRef.current}
                refreshKey={explainRefreshKey}
              />
            </TabsContent>
          </div>
        </Tabs>
      );
    }

    return (
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col"
      >
        <TabsList className="rounded-none border-b border-white/5 bg-black/20 backdrop-blur-md px-4 w-full justify-start h-10">
          <TabsTrigger value="results" className="data-[state=active]:bg-white/5">
            Results
            {hasData && (
              <div className="ml-2 text-muted-foreground items-center flex gap-2">
                <span className="text-xs">({resultData.length} rows)</span>
                <DownloadDialog data={resultData} trigger={
                  <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-white/10 p-0 rounded-sm">
                    <Download className="h-3 w-3" />
                  </Button>
                } />
              </div>
            )}
          </TabsTrigger>
          {/* Metadata Tab Removed */}
          <TabsTrigger value="statistics" className="data-[state=active]:bg-white/5">
            Statistics
          </TabsTrigger>
          {(explainPlan || isExplainLoading || explainError) && (
            <TabsTrigger
              value="explain"
              className="data-[state=active]:bg-white/5 group relative flex items-center gap-2"
              draggable
              onDragEnd={(e) => {
                if (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight) {
                  handlePopout();
                }
              }}
            >
              Explain
              <span
                role="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-white/10 rounded p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePopout();
                }}
                title="Open in new window"
              >
                <ExternalLink size={12} className="text-white" />
              </span>
            </TabsTrigger>
          )}
        </TabsList>
        <div className="flex-1 overflow-hidden w-full relative">
          <TabsContent value="results" className="h-full m-0 flex flex-col overflow-hidden w-full data-[state=inactive]:hidden absolute inset-0">
            {renderResultsTab()}
          </TabsContent>
          <TabsContent value="statistics" className="h-full m-0 overflow-auto data-[state=inactive]:hidden absolute inset-0 bg-background/50 backdrop-blur-sm p-4">
            {renderStatisticsResults()}
          </TabsContent>
          <TabsContent value="explain" className="h-full m-0 overflow-hidden data-[state=inactive]:hidden absolute inset-0 bg-background/50 backdrop-blur-sm">
            <ExplainTab
              plan={explainPlan}
              isLoading={isExplainLoading}
              error={explainError}
              currentType={explainType}
              onTypeChange={handleExplainTypeChange}
              query={lastExplainQueryRef.current}
            />
          </TabsContent>
        </div>
      </Tabs>
    );
  };

  // Render main results section based on current state
  const renderResults = () => {
    if (tab?.isLoading) return renderLoading();
    if (tab?.error) return renderError(tab.error);

    // Always show tabs if explain is active or we have results/statistics
    // This allows switching back to explain even if the query resulted in an error or empty result later?
    // Actually, traditionally Explain is a separate action.
    // If I click Explain, I want to see the Explain tab.
    // If I click Run, I want to see Results.

    // If explain is loading or has data/error and active tab is explain, show tabs
    const isExplainActive = activeTab === "explain" || explainPlan || isExplainLoading || explainError;

    if (isExplainActive) {
      return renderResultTabs();
    }

    if (!tab?.result) return renderEmpty();
    if (tab.result.error) return renderError(tab.result.error);

    return renderResultTabs();
  };

  // Return null if tab doesn't exist
  if (!tab) return null;

  // ── Hint strip items — only the most important actions.
  //    Format / Comment / Find / Save are all accessible via the Shortcuts dialog.
  const stripItems = useMemo(() => {
    const items: { icon: React.ReactNode; label: string; shortcut: string; action: () => void }[] = [
      ...(canOptimize ? [{ icon: <Network  className="h-3 w-3 shrink-0 text-purple-400" />, label: "Explain",     shortcut: kbd("E", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleExplain(q); } }] : []),
      ...(canOptimize ? [{ icon: <Sparkles className="h-3 w-3 shrink-0 text-pink-400" />,   label: "AI Optimize", shortcut: kbd("I", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleOptimize(q); } }] : []),
    ];
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOptimize, handleExplain, handleOptimize]);

  return (
    <div className="h-full bg-white/[0.02]">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50} minSize={20}>
          <SQLEditor
            ref={editorRef}
            tabId={tabId}
            onRunQuery={handleRunQuery}
            onExplain={handleExplain}
            onOptimize={handleOptimize}
            onOpenShortcuts={() => setIsShortcutsOpen(true)}
          />
        </ResizablePanel>

        {/* Standard thin handle — no strip inside, so the library's global
            *{cursor:row-resize!important} only applies to this small element */}
        <ResizableHandle className="bg-white/5 hover:bg-white/10 transition-colors" />

        {/* ── Results panel — strip pinned at its top ─────────────────────────
            The strip is a normal div (not a resize handle), so cursor behaves
            exactly as CSS says. It is part of the results panel so it can never
            be squeezed out by the editor panel growing. The results panel's
            minSize guarantees the strip is always fully visible.
        ─────────────────────────────────────────────────────────────────────── */}
        <ResizablePanel defaultSize={50} minSize={12}>
          <div className="h-full flex flex-col">
            {/* Action strip */}
            <div className="flex-shrink-0 flex items-center border-b border-white/5 bg-black/20 backdrop-blur-sm overflow-x-auto scrollbar-none select-none">
              {/* Run / Stop */}
              {tab?.isLoading ? (
                <button
                  onClick={() => { if (canKillQuery) editorRef.current?.stop(); }}
                  disabled={!canKillQuery}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors touch-manipulation shrink-0",
                    canKillQuery
                      ? "cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      : "cursor-not-allowed text-muted-foreground/40"
                  )}
                >
                  <CircleStop className="h-3.5 w-3.5 shrink-0" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  onClick={handleStripRunQuery}
                  className="cursor-pointer flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 active:bg-blue-500/20 transition-colors touch-manipulation shrink-0"
                >
                  <CirclePlay className="h-3.5 w-3.5 shrink-0" />
                  <span>Run</span>
                  <kbd className="hidden md:inline ml-1 text-[11px] text-blue-400/50 font-mono">
                    {kbd("↵", { mod: true })}·F5
                  </kbd>
                </button>
              )}

              {/* Feature-gated actions */}
              {stripItems.length > 0 && (
                <>
                  <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
                  {stripItems.map(({ icon, label, shortcut, action }, i, arr) => (
                    <React.Fragment key={label}>
                      <button
                        onClick={action}
                        className="cursor-pointer flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground/70 hover:text-foreground hover:bg-white/5 active:bg-white/10 transition-colors touch-manipulation shrink-0"
                      >
                        {icon}
                        <span>{label}</span>
                        <kbd className="hidden md:inline ml-1 text-[11px] text-muted-foreground/40 font-mono">{shortcut}</kbd>
                      </button>
                      {i < arr.length - 1 && <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />}
                    </React.Fragment>
                  ))}
                </>
              )}

              <div className="flex-1 min-w-2" />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-hidden">
              {renderResults()}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* ── Shortcuts Dialog ────────────────────────────────────────────────── */}
      <Dialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Keyboard className="h-4 w-4" />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isMac ? "Tap" : "Click"} any row to run the action directly.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 px-1.5 max-h-[70vh] overflow-y-auto">
            {([
              { icon: <CirclePlay className="h-3.5 w-3.5 text-blue-400" />, label: "Run query",      hint: `${kbd("↵", { mod: true })} · F5`, note: "Runs selection if text is selected", action: handleStripRunQuery },
              { icon: <Wand2      className="h-3.5 w-3.5" />,               label: "Format query",   hint: kbd("F", { mod: true, shift: true }), action: () => editorRef.current?.format() },
              { icon: <Code2      className="h-3.5 w-3.5" />,               label: "Toggle comment", hint: kbd("/", { mod: true }),              action: () => editorRef.current?.commentLine() },
              { icon: <Search     className="h-3.5 w-3.5" />,               label: "Find",           hint: kbd("F", { mod: true }),              action: () => editorRef.current?.find() },
              ...(canOptimize   ? [{ icon: <Network  className="h-3.5 w-3.5 text-purple-400" />, label: "Explain query plan", hint: kbd("E", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleExplain(q); } }] : []),
              ...(canOptimize   ? [{ icon: <Sparkles className="h-3.5 w-3.5 text-pink-400" />,   label: "AI optimize",        hint: kbd("I", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleOptimize(q); } }] : []),
              ...((canSaveQuery || canUpdateQuery) ? [{ icon: <Save className="h-3.5 w-3.5" />, label: "Save",     hint: kbd("S", { mod: true }),              action: () => editorRef.current?.save() }] : []),
              ...(canSaveQuery                     ? [{ icon: <Copy className="h-3.5 w-3.5" />, label: "Save as…", hint: kbd("S", { mod: true, shift: true }), action: () => editorRef.current?.saveAs() }] : []),
            ] as { icon: React.ReactNode; label: string; hint: string; note?: string; action: () => void }[]).map(({ icon, label, hint, note, action }) => (
              <button
                key={label}
                onClick={() => { action(); setIsShortcutsOpen(false); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm text-left hover:bg-white/5 active:bg-white/10 transition-colors touch-manipulation group"
              >
                <span className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0">{icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-[13px] leading-snug">{label}</span>
                  {note && <span className="block text-[11px] text-muted-foreground/60 leading-tight">{note}</span>}
                </span>
                <kbd className="hidden sm:inline shrink-0 text-[11px] font-mono text-muted-foreground/50 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">{hint}</kbd>
              </button>
            ))}

            <div className="mt-2 pt-2 border-t border-white/5 px-3.5 pb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2">Editor built-ins</p>
              <div className="space-y-1.5 text-[12px] text-muted-foreground/60">
                {[
                  { label: "Find & replace", hint: kbd("H", { mod: true }) },
                  { label: "Go to line",     hint: isMac ? "⌃G" : "Ctrl+G" },
                  { label: "Select all",     hint: kbd("A", { mod: true }) },
                  { label: "Undo / Redo",    hint: `${kbd("Z", { mod: true })} / ${kbd("Z", { mod: true, shift: true })}` },
                  { label: "Multi-cursor",   hint: isMac ? "⌥ Click" : "Alt+Click" },
                ].map(({ label, hint }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span>{label}</span>
                    <kbd className="text-[11px] font-mono text-muted-foreground/40">{hint}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DebugQueryDialog
        isOpen={isDebugDialogOpen}
        onClose={() => setIsDebugDialogOpen(false)}
        query={debugQueryString}
        error={debugError}
        database={typeof tab?.content === 'object' ? tab.content.database : undefined} // Not fully accurate if content struct changed
        onAccept={(fixedQuery) => {
          updateTab(tabId, { content: fixedQuery });
        }}
      />

      <OptimizeQueryDialog
        isOpen={isOptimizerOpen}
        onClose={() => setIsOptimizerOpen(false)}
        query={debugQueryString || (typeof tab?.content === 'string' ? tab.content : '')}
        database={typeof tab?.content === 'object' ? tab.content.database : undefined}
        initialResult={optimizationResult}
        autoStart={optimizerAutoStart}
        initialPrompt={optimizationReason ? `Detected potential issue: ${optimizationReason}` : undefined}
        onAccept={(optimizedQuery) => {
          updateTab(tabId, { content: optimizedQuery });
        }}
      />
    </div>
  );
};

export default SqlTab;
