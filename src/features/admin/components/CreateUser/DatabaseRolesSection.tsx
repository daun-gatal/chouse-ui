import React, { useState, useEffect } from "react";
import { FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X, ChevronDown, ChevronRight, Database, Table2, Layers } from "lucide-react";
import { useDatabases } from "@/hooks";
import { cn } from "@/lib/utils";

// Structure for database-table access
export interface DatabaseTableAccess {
  database: string;
  allTables: boolean;  // If true, grant on db.*, if false, grant on specific tables
  tables: string[];    // Specific tables (only used if allTables is false)
}

interface DatabaseRolesSectionProps {
  form: any;
  roles: string[];
  databases: string[];
}

const DatabaseRolesSection: React.FC<DatabaseRolesSectionProps> = ({ form }) => {
  const { data: databasesData = [] } = useDatabases();
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  
  // Use local state to track database access, synced from form
  const [localAccess, setLocalAccess] = useState<DatabaseTableAccess[]>([]);
  
  // Sync from form values on mount and when form changes (controlled updates only)
  const syncFromForm = () => {
    const formAccess = form.getValues("databaseAccess") || [];
    const legacyGrant = form.getValues("grantDatabases") || [];
    
    if (formAccess.length > 0) {
      setLocalAccess(formAccess);
    } else if (legacyGrant.length > 0) {
      // Convert legacy format
      setLocalAccess(legacyGrant.map((db: string) => ({
        database: db,
        allTables: true,
        tables: []
      })));
    }
  };
  
  // Use local state as effective access
  const effectiveAccess = localAccess;

  // Sync from form on mount
  useEffect(() => {
    syncFromForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to update both local state and form
  const updateAccess = (newAccess: DatabaseTableAccess[]) => {
    setLocalAccess(newAccess);
    form.setValue("databaseAccess", newAccess);
    form.setValue("grantDatabases", newAccess.map(d => d.database));
  };

  const toggleDatabaseExpand = (db: string) => {
    const newExpanded = new Set(expandedDatabases);
    if (newExpanded.has(db)) {
      newExpanded.delete(db);
    } else {
      newExpanded.add(db);
    }
    setExpandedDatabases(newExpanded);
  };

  const addDatabase = (dbName: string) => {
    const existing = effectiveAccess.find(d => d.database === dbName);
    if (!existing) {
      const newAccess: DatabaseTableAccess[] = [
        ...effectiveAccess,
        { database: dbName, allTables: true, tables: [] }
      ];
      updateAccess(newAccess);
      // Auto-expand newly added database
      setExpandedDatabases(prev => new Set([...prev, dbName]));
    }
  };

  const removeDatabase = (dbName: string) => {
    const newAccess = effectiveAccess.filter(d => d.database !== dbName);
    updateAccess(newAccess);
  };

  const toggleAllTables = (dbName: string, allTables: boolean) => {
    const newAccess = effectiveAccess.map(d => 
      d.database === dbName 
        ? { ...d, allTables, tables: allTables ? [] : d.tables }
        : d
    );
    updateAccess(newAccess);
  };

  const toggleTable = (dbName: string, tableName: string) => {
    const newAccess = effectiveAccess.map(d => {
      if (d.database !== dbName) return d;
      
      const hasTable = d.tables.includes(tableName);
      const newTables = hasTable 
        ? d.tables.filter(t => t !== tableName)
        : [...d.tables, tableName];
      
      return { ...d, tables: newTables, allTables: false };
    });
    updateAccess(newAccess);
  };

  const selectAllTablesInDb = (dbName: string) => {
    const dbInfo = databasesData.find(d => d.name === dbName);
    if (!dbInfo) return;
    
    const allTableNames = dbInfo.children.map(t => t.name);
    const newAccess = effectiveAccess.map(d => 
      d.database === dbName 
        ? { ...d, allTables: false, tables: allTableNames }
        : d
    );
    updateAccess(newAccess);
  };

  const clearAllTablesInDb = (dbName: string) => {
    const newAccess = effectiveAccess.map(d => 
      d.database === dbName 
        ? { ...d, tables: [] }
        : d
    );
    updateAccess(newAccess);
  };

  // Get tables for a database
  const getTablesForDatabase = (dbName: string) => {
    const dbInfo = databasesData.find(d => d.name === dbName);
    return dbInfo?.children || [];
  };

  // Get access info for a database
  const getAccessForDatabase = (dbName: string) => {
    return effectiveAccess.find(d => d.database === dbName);
  };

  // Count selected items for summary
  const getSelectionSummary = (access: DatabaseTableAccess) => {
    if (access.allTables) return "All tables";
    if (access.tables.length === 0) return "No tables selected";
    return `${access.tables.length} table${access.tables.length > 1 ? 's' : ''}`;
  };

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="databaseAccess"
        render={() => (
          <FormItem>
            <FormLabel className="text-white flex items-center gap-2">
              <Database className="h-4 w-4" />
              Database & Table Access
            </FormLabel>
            <FormDescription className="text-gray-400">
              Select databases and optionally restrict access to specific tables within each database.
            </FormDescription>
            
            {/* Database selector */}
            <Select onValueChange={addDatabase}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white">
                <SelectValue placeholder="Add database access..." />
              </SelectTrigger>
              <SelectContent>
                {databasesData.map((db) => (
                  <SelectItem
                    key={db.name}
                    value={db.name}
                    disabled={effectiveAccess.some(d => d.database === db.name)}
                  >
                    <div className="flex items-center gap-2">
                      <Database className="h-3 w-3" />
                      {db.name}
                      <span className="text-xs text-gray-400">
                        ({db.children.length} tables)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Selected databases with table selection */}
            <div className="space-y-3 mt-4">
              {effectiveAccess.length === 0 && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                  ⚠️ No databases selected. User will NOT have access to any database data.
                </div>
              )}

              {effectiveAccess.map((access) => {
                const tables = getTablesForDatabase(access.database);
                const isExpanded = expandedDatabases.has(access.database);
                
                return (
                  <div 
                    key={access.database}
                    className="rounded-lg border border-white/10 bg-white/5 overflow-hidden"
                  >
                    {/* Database header */}
                    <div className="flex items-center justify-between p-3 bg-white/5">
                      <div className="flex items-center gap-2 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleDatabaseExpand(access.database)}
                          className="p-1 hover:bg-white/10 rounded transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                        <Database className="h-4 w-4 text-blue-400" />
                        <span className="font-medium text-white">{access.database}</span>
                        <Badge variant="outline" className="text-xs bg-white/5">
                          {getSelectionSummary(access)}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDatabase(access.database)}
                        className="h-7 w-7 p-0 text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Expanded content - table selection */}
                    {isExpanded && (
                      <div className="p-3 border-t border-white/10 space-y-3">
                        {/* All tables toggle */}
                        <div className="flex items-center justify-between p-2 rounded bg-white/5">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`all-${access.database}`}
                              checked={access.allTables}
                              onCheckedChange={(checked) => toggleAllTables(access.database, !!checked)}
                            />
                            <label 
                              htmlFor={`all-${access.database}`}
                              className="text-sm font-medium text-white cursor-pointer flex items-center gap-2"
                            >
                              <Layers className="h-4 w-4 text-purple-400" />
                              All Tables (*.*)
                            </label>
                          </div>
                          <span className="text-xs text-gray-400">
                            Grants access to all current and future tables
                          </span>
                        </div>

                        {/* Specific tables selection */}
                        {!access.allTables && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-400">
                                Or select specific tables:
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => selectAllTablesInDb(access.database)}
                                  className="h-6 text-xs"
                                >
                                  Select All
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => clearAllTablesInDb(access.database)}
                                  className="h-6 text-xs"
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 rounded bg-black/20">
                              {tables.length === 0 ? (
                                <span className="text-xs text-gray-500 col-span-full">
                                  No tables in this database
                                </span>
                              ) : (
                                tables.map((table) => (
                                  <div 
                                    key={table.name}
                                    className={cn(
                                      "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                                      access.tables.includes(table.name)
                                        ? "bg-blue-500/20 border border-blue-500/30"
                                        : "bg-white/5 border border-transparent hover:bg-white/10"
                                    )}
                                    onClick={() => toggleTable(access.database, table.name)}
                                  >
                                    <Checkbox
                                      checked={access.tables.includes(table.name)}
                                      onCheckedChange={() => toggleTable(access.database, table.name)}
                                    />
                                    <Table2 className="h-3 w-3 text-gray-400" />
                                    <span className="text-xs text-white truncate">{table.name}</span>
                                  </div>
                                ))
                              )}
                            </div>

                            {access.tables.length === 0 && !access.allTables && (
                              <p className="text-xs text-amber-400">
                                ⚠️ No tables selected. Select tables or enable "All Tables".
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
};

export default DatabaseRolesSection;
