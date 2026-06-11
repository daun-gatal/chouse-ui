import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, FileX2, Download, ExternalLink, Lightbulb,
         CirclePlay, CircleStop, Wand2, Code2, Search, Network, Sparkles, Keyboard, Save, Copy,
         TriangleAlert } from "lucide-react";
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
import { useWorkspaceStore, useRbacStore, RBAC_PERMISSIONS, usePreferencesStore } from "@/stores";
import { useDatabases, useConfig } from "@/hooks";
import { queryApi } from "@/api";
import type { QueryOptimization } from "@/api/ai";

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
  const { getTabById, runQuery, updateTab, abortQuery } = useWorkspaceStore();
  const { maxResultRows } = usePreferencesStore();
  // Using refetch to handle side effects
  const { refetch: refetchDatabases } = useDatabases();
  const tab = getTabById(tabId);
  const [activeTab, setActiveTab] = useState<string>("results");

  // Ref to the SQL editor — used by the hint strip to invoke editor actions
  const editorRef = useRef<SqlEditorHandle>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Open the Shortcuts dialog when the command palette dispatches the event.
  useEffect(() => {
    const handler = () => setIsShortcutsOpen(true);
    window.addEventListener("shortcuts:open", handler);
    return () => window.removeEventListener("shortcuts:open", handler);
  }, []);


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
  const [optimizationResult, setOptimizationResult] = useState<QueryOptimization | null>(null);
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
    setDebugQueryString(query);
    setOptimizerAutoStart(false);
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
          <div className="group flex h-full w-full cursor-default items-center justify-between px-1">
            <span className="truncate font-mono text-[12px] lowercase text-paper-muted transition-colors group-hover:text-paper">
              {col.name}
            </span>
            <span className={cn("cell-type-badge font-mono text-[9px] transition-all duration-500", typeClass)}>
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
            className="rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-brand hover:bg-ink-200 hover:text-brand"
            onClick={() => {
              setDebugError(errorMessage);
              const currentContent = typeof tab?.content === 'string' ? tab.content : '';
              if (!debugQueryString && currentContent) {
                setDebugQueryString(currentContent);
              }
              setIsDebugDialogOpen(true);
            }}
          >
            <Sparkles className="mr-2 h-3.5 w-3.5" />
            Debug with AI
          </Button>
        </div>
      )}
    </div>
  );

  const renderEmpty = () => (
    <div className="h-full flex items-center justify-center px-6">
      <div className="flex flex-col items-center text-center">
        <FileX2 size={32} className="text-paper-faint mb-3" aria-hidden />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
          Nothing to show
        </p>
        <p className="mt-2 text-[12px] text-paper-muted">
          Run a query and the result lands here.
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

    // Detect likely truncation: the server used result_overflow_mode:"break" so
    // if data.length equals the configured cap the result was almost certainly cut.
    // Suppress the banner while still streaming — the count isn't final yet.
    const isTruncated = !tab?.isStreaming && rowData.length >= maxResultRows;

    return (
      <div className="h-full w-full flex flex-col overflow-hidden bg-transparent">
        {/* Streaming progress — rows are still arriving */}
        {tab?.isStreaming && (
          <div className="flex shrink-0 items-center gap-2 border-b border-ink-500 bg-ink-100 px-4 py-1.5">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand" aria-hidden />
            <span className="font-mono text-[11px] text-paper-dim">
              Streaming… {rowData.length.toLocaleString()} rows received
            </span>
          </div>
        )}
        {/* Truncation warning — shown when result hits the configured row cap */}
        {isTruncated && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-900/40 bg-amber-950/30 px-4 py-2">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
            <span className="font-mono text-[11px] text-amber-300">
              Results capped at{" "}
              <strong>{maxResultRows.toLocaleString()}</strong> rows — add a{" "}
              <code className="rounded-xs bg-amber-900/40 px-1">LIMIT</code> clause or raise the
              limit in{" "}
              <a
                href="/preferences"
                className="underline decoration-amber-500/60 underline-offset-2 hover:text-amber-200"
              >
                Preferences
              </a>
              .
            </span>
          </div>
        )}
        <div className="flex-1 w-full overflow-hidden relative">
          <DataTable
            columns={columns}
            data={rowData}
            stickyHeader={true}
            stickyFirstColumn={false}
            className="border-0 rounded-none shadow-none bg-transparent h-full"
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
          <TabsList className="h-9 w-full justify-start rounded-none border-b border-ink-500 bg-ink-100 px-3">
            <TabsTrigger value="results" className="rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper">
              Results
              {hasData && <span className="ml-2 text-paper-faint">({resultData.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="statistics" className="rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper">
              Statistics
            </TabsTrigger>
            <TabsTrigger
              value="explain"
              className="group relative flex items-center gap-2 rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper"
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
                className="cursor-pointer rounded-xs p-0.5 opacity-0 transition-opacity hover:bg-ink-300 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePopout();
                }}
                title="Open in new window"
              >
                <ExternalLink size={12} className="text-paper-muted" />
              </span>
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 overflow-hidden w-full relative">
            <TabsContent value="explain" className="absolute inset-0 m-0 h-full overflow-hidden bg-ink-50 data-[state=inactive]:hidden">
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
        <TabsList className="h-9 w-full justify-start rounded-none border-b border-ink-500 bg-ink-100 px-3">
          <TabsTrigger value="results" className="rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper">
            Results
            {hasData && (
              <span className="ml-2 flex items-center gap-2 text-paper-faint">
                <span>({resultData.length} rows)</span>
                <DownloadDialog data={resultData} trigger={
                  <Button variant="ghost" size="icon" className="h-5 w-5 rounded-xs p-0 text-paper-dim hover:bg-ink-300 hover:text-paper">
                    <Download className="h-3 w-3" />
                  </Button>
                } />
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="statistics" className="rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper">
            Statistics
          </TabsTrigger>
          {(explainPlan || isExplainLoading || explainError) && (
            <TabsTrigger
              value="explain"
              className="group relative flex items-center gap-2 rounded-none border-x border-t border-transparent px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:border-ink-500 data-[state=active]:bg-ink-50 data-[state=active]:text-paper"
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
                className="cursor-pointer rounded-xs p-0.5 opacity-0 transition-opacity hover:bg-ink-300 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePopout();
                }}
                title="Open in new window"
              >
                <ExternalLink size={12} className="text-paper-muted" />
              </span>
            </TabsTrigger>
          )}
        </TabsList>
        <div className="flex-1 overflow-hidden w-full relative">
          <TabsContent value="results" className="h-full m-0 flex flex-col overflow-hidden w-full data-[state=inactive]:hidden absolute inset-0">
            {renderResultsTab()}
          </TabsContent>
          <TabsContent value="statistics" className="absolute inset-0 m-0 h-full overflow-auto bg-ink-50 p-4 data-[state=inactive]:hidden">
            {renderStatisticsResults()}
          </TabsContent>
          <TabsContent value="explain" className="absolute inset-0 m-0 h-full overflow-hidden bg-ink-50 data-[state=inactive]:hidden">
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
    // Explain is a standard ClickHouse feature (EXPLAIN PLAN) — anyone who can
    // run a query in this editor can also explain it. AI Optimize is the
    // AI-feature-gated one and stays behind canOptimize.
    const items: { icon: React.ReactNode; label: string; shortcut: string; action: () => void }[] = [
      { icon: <Network  className="h-3 w-3 shrink-0" />, label: "Explain",     shortcut: kbd("E", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleExplain(q); } },
      ...(canOptimize ? [{ icon: <Sparkles className="h-3 w-3 shrink-0" />, label: "AI Optimize", shortcut: kbd("I", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleOptimize(q); } }] : []),
    ];
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOptimize, handleExplain, handleOptimize]);

  return (
    <div className="h-full bg-ink-50">
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

        <ResizableHandle className="h-px bg-ink-500 transition-colors hover:bg-ink-700 data-[resize-handle-active]:bg-brand" />

        {/* Results panel with action strip pinned at top */}
        <ResizablePanel defaultSize={50} minSize={12}>
          <div className="flex h-full flex-col bg-ink-50">
            {/* Action strip */}
            <div className="scrollbar-none flex flex-shrink-0 select-none items-center overflow-x-auto border-b border-ink-500 bg-ink-100">
              {/* Run / Stop */}
              {tab?.isLoading ? (
                <button
                  type="button"
                  onClick={() => {
                    // Abort the in-flight HTTP download immediately so the
                    // editor exits loading state without waiting for the full
                    // response body (e.g. a no-LIMIT query with millions of rows).
                    abortQuery(tabId);
                    // Also open the kill dialog to cancel the CH-side query if
                    // it is still executing (requires KILL QUERY permission).
                    if (canKillQuery) editorRef.current?.stop();
                  }}
                  disabled={!canKillQuery}
                  className={cn(
                    "flex shrink-0 items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    canKillQuery
                      ? "cursor-pointer text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      : "cursor-not-allowed text-paper-faint"
                  )}
                >
                  <CircleStop className="h-3.5 w-3.5 shrink-0" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStripRunQuery}
                  className="flex shrink-0 cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper transition-colors hover:bg-brand hover:text-ink-50"
                >
                  <CirclePlay className="h-3.5 w-3.5 shrink-0" />
                  <span>Run</span>
                  <kbd className="ml-1 hidden font-mono text-[10px] text-paper-faint md:inline">
                    {kbd("↵", { mod: true })} · F5
                  </kbd>
                </button>
              )}

              {/* Feature-gated actions */}
              {stripItems.length > 0 && (
                <>
                  <div className="mx-0.5 h-4 w-px shrink-0 bg-ink-500" aria-hidden />
                  {stripItems.map(({ icon, label, shortcut, action }, i, arr) => (
                    <React.Fragment key={label}>
                      <button
                        type="button"
                        onClick={action}
                        className="flex shrink-0 cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                      >
                        {icon}
                        <span>{label}</span>
                        <kbd className="ml-1 hidden font-mono text-[10px] text-paper-faint md:inline">{shortcut}</kbd>
                      </button>
                      {i < arr.length - 1 && <div className="mx-0.5 h-4 w-px shrink-0 bg-ink-500" aria-hidden />}
                    </React.Fragment>
                  ))}
                </>
              )}

              <div className="min-w-2 flex-1" />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-hidden">
              {renderResults()}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Shortcuts dialog */}
      <Dialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>
        <DialogContent className="overflow-hidden rounded-md border-ink-500 bg-ink-100 p-0 sm:max-w-sm">
          <DialogHeader className="border-b border-ink-500 px-5 pb-3 pt-5">
            <DialogTitle className="flex items-center gap-2 text-base text-paper">
              <Keyboard className="h-4 w-4 text-paper-muted" aria-hidden />
              Keyboard shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs text-paper-muted">
              {isMac ? "Tap" : "Click"} any row to run the action directly.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-1 py-2">
            {([
              { icon: <CirclePlay className="h-3.5 w-3.5" />, label: "Run query",      hint: `${kbd("↵", { mod: true })} · F5`, note: "Runs selection if text is selected", action: handleStripRunQuery },
              { icon: <Wand2      className="h-3.5 w-3.5" />, label: "Format query",   hint: kbd("F", { mod: true, shift: true }), action: () => editorRef.current?.format() },
              { icon: <Code2      className="h-3.5 w-3.5" />, label: "Toggle comment", hint: kbd("/", { mod: true }),              action: () => editorRef.current?.commentLine() },
              { icon: <Search     className="h-3.5 w-3.5" />, label: "Find",           hint: kbd("F", { mod: true }),              action: () => editorRef.current?.find() },
              { icon: <Network  className="h-3.5 w-3.5" />, label: "Explain query plan", hint: kbd("E", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleExplain(q); } },
              ...(canOptimize   ? [{ icon: <Sparkles className="h-3.5 w-3.5" />, label: "AI optimize",        hint: kbd("I", { mod: true, shift: true }), action: () => { const q = editorRef.current?.getQuery() ?? ""; if (q) handleOptimize(q); } }] : []),
              ...((canSaveQuery || canUpdateQuery) ? [{ icon: <Save className="h-3.5 w-3.5" />, label: "Save",     hint: kbd("S", { mod: true }),              action: () => editorRef.current?.save() }] : []),
              ...(canSaveQuery                     ? [{ icon: <Copy className="h-3.5 w-3.5" />, label: "Save as…", hint: kbd("S", { mod: true, shift: true }), action: () => editorRef.current?.saveAs() }] : []),
            ] as { icon: React.ReactNode; label: string; hint: string; note?: string; action: () => void }[]).map(({ icon, label, hint, note, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => { action(); setIsShortcutsOpen(false); }}
                className="group flex w-full items-center gap-3 rounded-xs px-3.5 py-2.5 text-left transition-colors hover:bg-ink-200"
              >
                <span className="shrink-0 text-paper-dim transition-colors group-hover:text-paper">{icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-snug text-paper">{label}</span>
                  {note && <span className="block text-[11px] leading-tight text-paper-faint">{note}</span>}
                </span>
                <kbd className="hidden shrink-0 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted sm:inline">{hint}</kbd>
              </button>
            ))}

            <div className="mt-2 border-t border-ink-500 px-3.5 pb-1 pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Editor built-ins</p>
              <div className="space-y-1.5 text-[12px] text-paper-muted">
                {[
                  { label: "Find & replace", hint: kbd("H", { mod: true }) },
                  { label: "Go to line",     hint: isMac ? "⌃G" : "Ctrl+G" },
                  { label: "Select all",     hint: kbd("A", { mod: true }) },
                  { label: "Undo / Redo",    hint: `${kbd("Z", { mod: true })} / ${kbd("Z", { mod: true, shift: true })}` },
                  { label: "Multi-cursor",   hint: isMac ? "⌥ Click" : "Alt+Click" },
                ].map(({ label, hint }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span>{label}</span>
                    <kbd className="font-mono text-[10px] text-paper-faint">{hint}</kbd>
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
