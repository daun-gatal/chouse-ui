import React from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, themeBalham, colorSchemeDark } from "ag-grid-community";
import { Loader2 } from "lucide-react";
import { useTheme } from "@/components/common/theme-provider";
import { useTableSchema } from "@/hooks";

interface SchemaSectionProps {
  database: string;
  tableName: string;
}

const SchemaSection: React.FC<SchemaSectionProps> = ({ database, tableName }) => {
  const { theme } = useTheme();
  const { data: schema, isLoading, error } = useTableSchema(database, tableName);

  const gridTheme =
    theme === "light" ? themeBalham : themeBalham.withPart(colorSchemeDark);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        <span className="ml-2 text-gray-400">Loading schema...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-red-400">{error.message}</p>
      </div>
    );
  }

  if (!schema || schema.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-gray-400">No schema information available</p>
      </div>
    );
  }

  return (
    <div className="h-[400px]">
      <AgGridReact
        rowData={schema}
        columnDefs={[
          { headerName: "Column", field: "name", flex: 2 },
          { headerName: "Type", field: "type", flex: 2 },
          { headerName: "Default Type", field: "default_type", flex: 1 },
          { headerName: "Default Expression", field: "default_expression", flex: 2 },
          { headerName: "Comment", field: "comment", flex: 2 },
        ]}
        defaultColDef={{
          sortable: true,
          filter: true,
          resizable: true,
        }}
        modules={[AllCommunityModule]}
        theme={gridTheme}
        enableCellTextSelection={true}
      />
    </div>
  );
};

export default SchemaSection;
