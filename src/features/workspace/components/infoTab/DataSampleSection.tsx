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
          <div className="group flex h-full w-full cursor-default items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim transition-colors group-hover:text-paper">
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
      <div className="flex h-[300px] flex-col items-center justify-center gap-3 rounded-xs border border-ink-500 bg-ink-100">
        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Loading sample data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-400">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    );
  }

  if (!sample || sample.data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No data available in this table</p>
      </div>
    );
  }

  return (
    <div className="relative h-[450px]">
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
