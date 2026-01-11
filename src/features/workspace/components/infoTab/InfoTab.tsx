import React, { useState, useMemo, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Database, Table, Code, ChevronUp, ChevronDown, Copy, Check } from "lucide-react";
import { useTableInfo, useDatabaseInfo } from "@/hooks";
import { toast } from "sonner";
import { format } from "sql-formatter";
import SchemaSection from "./SchemaSection";
import DataSampleSection from "./DataSampleSection";

// Format SQL query using sql-formatter
function formatSqlQuery(sql: string): string {
  if (!sql) return "";
  
  try {
    // Use sql-formatter with ClickHouse dialect settings
    return format(sql, {
      language: 'sql', // Use generic SQL dialect
      tabWidth: 2,
      keywordCase: 'upper',
      linesBetweenQueries: 2,
      indentStyle: 'standard',
    });
  } catch (error) {
    // If formatting fails, return original query
    console.warn('Failed to format SQL query:', error);
    return sql.trim();
  }
}

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
    return formatSqlQuery(String(info.create_table_query));
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
      console.error('[InfoTab] Failed to copy query:', errorMessage);
      toast.error("Failed to copy query");
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        <span className="ml-2 text-gray-400">Loading information...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to load information</p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {tableName ? (
          <Table className="h-6 w-6 text-green-400" />
        ) : (
          <Database className="h-6 w-6 text-blue-400" />
        )}
        <div>
          <h2 className="text-xl font-semibold text-white">
            {tableName || database}
          </h2>
          <p className="text-sm text-gray-400">
            {tableName ? `Table in ${database}` : "Database"}
          </p>
        </div>
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {tableName && (
            <>
              <TabsTrigger value="schema">Schema</TabsTrigger>
              <TabsTrigger value="sample">Data Sample</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="space-y-4">
            {info && (
              <>
                {/* CREATE TABLE Query - Full width */}
                {info.create_table_query && (
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <Collapsible open={createTableQueryOpen} onOpenChange={setCreateTableQueryOpen}>
                      <CollapsibleTrigger className="w-full text-left">
                        <div className="flex items-center justify-between w-full mb-2">
                          <p className="text-xs text-gray-400 capitalize flex items-center gap-2">
                            <Code className="h-3 w-3" />
                            Create Table Query
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs gap-1.5 px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard();
                              }}
                            >
                              {copied ? (
                                <>
                                  <Check className="h-3 w-3 text-green-400" />
                                  <span className="text-green-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </Button>
                            {createTableQueryOpen ? (
                              <ChevronUp className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </div>
                        {!createTableQueryOpen && (
                          <p className="text-sm text-white font-mono truncate text-left w-full">
                            {formattedQuery.substring(0, 100)}...
                          </p>
                        )}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="relative">
                          <Textarea
                            readOnly
                            value={formattedQuery}
                            className="h-[300px] font-mono text-xs sm:text-sm text-gray-300 bg-black/40 border-white/10 resize-none overflow-auto pr-20"
                            style={{ whiteSpace: 'pre', wordBreak: 'break-word' }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute top-2 right-2 h-7 text-xs gap-1.5 px-2 bg-white/10 hover:bg-white/20"
                            onClick={copyToClipboard}
                          >
                            {copied ? (
                              <>
                                <Check className="h-3 w-3 text-green-400" />
                                <span className="text-green-400">Copied</span>
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
                        className="p-3 rounded-lg bg-white/5 border border-white/10"
                      >
                        <p className="text-xs text-gray-400 mb-1 capitalize">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="text-sm text-white font-mono truncate">
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
