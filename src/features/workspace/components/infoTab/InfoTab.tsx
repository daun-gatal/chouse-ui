import React, { useState, useMemo, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Database, Table, Code, ChevronUp, ChevronDown, Copy, Check } from "lucide-react";
import { useTableInfo, useDatabaseInfo } from "@/hooks";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { formatClickHouseSQL } from "@/lib/formatSql";
import SchemaSection from "./SchemaSection";
import DataSampleSection from "./DataSampleSection";

interface InfoTabProps {
  database: string;
  tableName?: string;
}

const InfoTab: React.FC<InfoTabProps> = ({ database, tableName }) => {
  const [createTableQueryOpen, setCreateTableQueryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Use appropriate hook based on whether we're viewing a database or table
  const {
    data: tableInfo,
    isLoading: tableLoading,
    error: tableError,
  } = useTableInfo(database, tableName || "");

  const {
    data: databaseInfo,
    isLoading: dbLoading,
    error: dbError,
  } = useDatabaseInfo(database);

  const isLoading = tableName ? tableLoading : dbLoading;
  const error = tableName ? tableError : dbError;
  const info = tableName ? tableInfo : databaseInfo;

  // Format the CREATE TABLE query
  const formattedQuery = useMemo(() => {
    if (!info || !info.create_table_query) return "";
    return formatClickHouseSQL(String(info.create_table_query));
  }, [info]);

  // Filter out only create_table_query (handled separately)
  // Show all other fields, including 0, false, empty strings, etc.
  const regularFields = useMemo(() => {
    if (!info) return [];
    return Object.entries(info).filter(([key]) =>
      key !== "create_table_query"
    );
  }, [info]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const copyToClipboard = async () => {
    if (!formattedQuery) return;

    // Clear any existing timeout
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    try {
      await navigator.clipboard.writeText(formattedQuery);
      setCopied(true);
      toast.success("Query copied to clipboard");
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('[InfoTab] Failed to copy query:', errorMessage);
      toast.error("Failed to copy query");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Loading information…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-red-400">Failed to load information</p>
          <p className="text-[12px] text-paper-dim">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-dim">
          {tableName ? (
            <Table className="h-4 w-4" />
          ) : (
            <Database className="h-4 w-4" />
          )}
        </div>
        <div>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
            <span className="h-px w-6 bg-ink-700" />
            <span>{tableName ? `Table in ${database}` : "Database"}</span>
          </span>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-paper">
            {tableName || database}
          </h2>
        </div>
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="h-9 gap-0.5 rounded-xs border border-ink-500 bg-ink-100 p-0.5">
          <TabsTrigger
            value="overview"
            className="rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors data-[state=active]:bg-ink-200 data-[state=active]:text-paper data-[state=inactive]:text-paper-dim hover:text-paper"
          >
            Overview
          </TabsTrigger>
          {tableName && (
            <>
              <TabsTrigger
                value="schema"
                className="rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors data-[state=active]:bg-ink-200 data-[state=active]:text-paper data-[state=inactive]:text-paper-dim hover:text-paper"
              >
                Schema
              </TabsTrigger>
              <TabsTrigger
                value="sample"
                className="rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors data-[state=active]:bg-ink-200 data-[state=active]:text-paper data-[state=inactive]:text-paper-dim hover:text-paper"
              >
                Data Sample
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="space-y-4">
            {info && (
              <>
                {/* CREATE TABLE Query - Full width */}
                {info.create_table_query && (
                  <div className="rounded-xs border border-ink-500 bg-ink-100 p-3">
                    <Collapsible open={createTableQueryOpen} onOpenChange={setCreateTableQueryOpen}>
                      <CollapsibleTrigger asChild>
                        <div className="w-full cursor-pointer text-left">
                          <div className="mb-2 flex w-full items-center justify-between">
                            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                              <Code className="h-3 w-3" />
                              Create Table Query
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1.5 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard();
                                }}
                              >
                                {copied ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </Button>
                              {createTableQueryOpen ? (
                                <ChevronUp className="h-4 w-4 text-paper-dim" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-paper-dim" />
                              )}
                            </div>
                          </div>
                          {!createTableQueryOpen && (
                            <p className="w-full truncate text-left font-mono text-[12px] text-paper-muted">
                              {formattedQuery.substring(0, 100)}...
                            </p>
                          )}
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="relative">
                          <Textarea
                            readOnly
                            value={formattedQuery}
                            className="h-[300px] resize-none overflow-auto rounded-xs border-ink-500 bg-ink-200 pr-20 font-mono text-xs text-paper-muted sm:text-sm"
                            style={{ whiteSpace: 'pre', wordBreak: 'break-word' }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-2 top-2 h-7 gap-1.5 rounded-xs border border-ink-500 bg-ink-100 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
                            onClick={copyToClipboard}
                          >
                            {copied ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}

                {/* Regular fields in grid */}
                {regularFields.length > 0 && (
                  <div className="grid grid-cols-2 gap-4">
                    {regularFields.map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-xs border border-ink-500 bg-ink-100 p-3"
                      >
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="truncate font-mono text-[12px] text-paper">
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value) || "-"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {tableName && (
          <>
            <TabsContent value="schema" className="mt-4">
              <SchemaSection database={database} tableName={tableName} />
            </TabsContent>

            <TabsContent value="sample" className="mt-4">
              <DataSampleSection database={database} tableName={tableName} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
};

export default InfoTab;
