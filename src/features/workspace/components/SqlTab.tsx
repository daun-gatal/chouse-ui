import React, { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, FileX2, Maximize2, Download } from "lucide-react";
import DOMPurify from "dompurify";
import { format as formatDate } from "date-fns";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef, CellContext } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

// Component imports
import SQLEditor from "@/features/workspace/editor/SqlEditor";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import DownloadDialog from "@/components/common/DownloadDialog";
import EmptyQueryResult from "./EmptyQueryResult";
import StatisticsDisplay from "./StatisticsDisplay";

// Store
import { useWorkspaceStore } from "@/stores";
import { useDatabases } from "@/hooks";

// Types
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
  const { getTabById, runQuery } = useWorkspaceStore();
  // Using refetch to handle side effects
  const { refetch: refetchDatabases } = useDatabases();
  const tab = getTabById(tabId);
  const [activeTab, setActiveTab] = useState<string>("results");

  // Detect schema-changing queries to refresh database explorer
  const isSchemaModifyingQuery = (query: string): boolean => {
    return /^\s*(CREATE|DROP|ALTER|TRUNCATE|RENAME|INSERT|UPDATE|DELETE)\s+/i.test(
      query
    );
  };

  // Handle query execution
  const handleRunQuery = useCallback(
    async (query: string) => {
      try {
        const shouldRefresh = isSchemaModifyingQuery(query);
        const result = await runQuery(query, tabId);

        if (!result.error && shouldRefresh) {
          // Trigger refetch but don't await blocking UI
          refetchDatabases();
          toast.success("Data Explorer refreshed due to schema change");
        }
      } catch (error) {
        console.error("Error running query:", error);
        toast.error(
          "Failed to execute query. Please check the console for more details."
        );
      }
    },
    [runQuery, tabId, refetchDatabases]
  );

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
    <div className="m-4">
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
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
        </TabsList>
        <div className="flex-1 overflow-hidden w-full relative">
          <TabsContent value="results" className="h-full m-0 flex flex-col overflow-hidden w-full data-[state=inactive]:hidden absolute inset-0">
            {renderResultsTab()}
          </TabsContent>
          <TabsContent value="statistics" className="h-full m-0 overflow-auto data-[state=inactive]:hidden absolute inset-0 bg-background/50 backdrop-blur-sm p-4">
            {renderStatisticsResults()}
          </TabsContent>
        </div>
      </Tabs>
    );
  };

  // Render main results section based on current state
  const renderResults = () => {
    if (tab?.isLoading) return renderLoading();
    if (tab?.error) return renderError(tab.error);
    if (!tab?.result) return renderEmpty();
    if (tab.result.error) return renderError(tab.result.error);

    return renderResultTabs();
  };

  // Return null if tab doesn't exist
  if (!tab) return null;

  return (
    <div className="h-full bg-white/[0.02]">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50} minSize={25}>
          <SQLEditor tabId={tabId} onRunQuery={handleRunQuery} />
        </ResizablePanel>
        <ResizableHandle withHandle className="bg-white/5 hover:bg-white/10 transition-colors" />
        <ResizablePanel defaultSize={50} minSize={25}>
          {renderResults()}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default SqlTab;
