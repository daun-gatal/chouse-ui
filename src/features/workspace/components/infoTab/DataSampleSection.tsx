import React from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, themeBalham, colorSchemeDark, ColDef } from "ag-grid-community";
import { Loader2 } from "lucide-react";
import { useTheme } from "@/components/common/theme-provider";
import { useTableSample, usePaginationPreference } from "@/hooks";

interface DataSampleSectionProps {
  database: string;
  tableName: string;
}

const DataSampleSection: React.FC<DataSampleSectionProps> = ({ database, tableName }) => {
  const { theme } = useTheme();
  const { pageSize: paginationPageSize } = usePaginationPreference('dataSample');
  const { data: sample, isLoading, error } = useTableSample(database, tableName, 100);

  const gridTheme =
    theme === "light" ? themeBalham : themeBalham.withPart(colorSchemeDark);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        <span className="ml-2 text-gray-400">Loading sample data...</span>
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

  if (!sample || sample.data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-gray-400">No data available in this table</p>
      </div>
    );
  }

  const columnDefs: ColDef[] = sample.meta.map((col) => ({
    headerName: col.name,
    field: col.name,
    flex: 1,
    minWidth: 100,
  }));

  return (
    <div className="h-[400px]">
      <AgGridReact
        rowData={sample.data}
        columnDefs={columnDefs}
        defaultColDef={{
          sortable: true,
          filter: true,
          resizable: true,
        }}
        modules={[AllCommunityModule]}
        theme={gridTheme}
        pagination={true}
        paginationPageSize={paginationPageSize}
        enableCellTextSelection={true}
      />
    </div>
  );
};

export default DataSampleSection;
