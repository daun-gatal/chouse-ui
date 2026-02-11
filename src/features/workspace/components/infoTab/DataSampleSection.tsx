import React, { useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import DOMPurify from "dompurify";
import { format as formatDate } from "date-fns";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef, CellContext } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { useTableSample } from "@/hooks";

// Formatting utility for TanStack Table values
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

const DataSampleSection = ({
  database,
  tableName,
}: {
  database: string;
  tableName: string;
}) => {
  const {
    data: sample,
    isLoading,
    error,
  } = useTableSample(database, tableName);

  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (!sample?.meta) return [];

    return sample.meta.map((col: { name: string; type: string }) => {
      // Determine type class for the header badge
      const type = col.type?.toLowerCase() || "";
      const typeClass = type.includes("string") ? "type-string" :
        (type.includes("int") || type.includes("float") || type.includes("decimal")) ? "type-number" :
          type.includes("bool") ? "type-boolean" :
            (type.includes("date") || type.includes("time")) ? "type-date" :
              (type.includes("array") || type.includes("map") || type.includes("tuple") || type.includes("json")) ? "type-object" : "";

      return {
        accessorKey: col.name,
        header: () => (
          <div className="flex items-center justify-between w-full group cursor-default h-full">
            <span className="truncate font-medium text-white/60 group-hover:text-white/90 transition-colors duration-300 lowercase text-[13px]">
              {col.name}
            </span>
            <span className={cn("cell-type-badge text-[9px] font-mono transition-all duration-500", typeClass)}>
              {col.type}
            </span>
          </div>
        ),
        cell: ({ getValue }: CellContext<Record<string, any>, any>) => {
          const value = getValue();
          const { html, className } = formatCellValue(value);
          const sanitizedHtml = DOMPurify.sanitize(html);
          return (
            <span
              className={cn("font-mono text-[12px] tabular-nums", className)}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          );
        },
      };
    });
  }, [sample?.meta]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-black/5 rounded-lg border border-white/5 backdrop-blur-sm">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400 opacity-50" />
        <span className="ml-3 text-white/20 text-sm tracking-widest uppercase font-light">Loading sample data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-red-400/60 font-mono text-sm">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    );
  }

  if (!sample || sample.data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-white/20 font-light tracking-widest uppercase text-xs">No data available in this table</p>
      </div>
    );
  }

  return (
    <div className="h-[450px] relative">
      <DataTable
        columns={columns}
        data={sample.data}
        className="h-full"
        stickyFirstColumn={false}
        stickyHeader={true}
      />
    </div>
  );
};

export default DataSampleSection;
