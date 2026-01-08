import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Database, Table } from "lucide-react";
import { useTableInfo, useDatabaseInfo } from "@/hooks";
import SchemaSection from "./SchemaSection";
import DataSampleSection from "./DataSampleSection";

interface InfoTabProps {
  database: string;
  tableName?: string;
}

const InfoTab: React.FC<InfoTabProps> = ({ database, tableName }) => {
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
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(info).map(([key, value]) => (
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
