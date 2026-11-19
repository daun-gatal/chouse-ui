import React, { useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef, CellContext } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { resultColumnAccessors } from "@/lib/resultColumns";
import { formatResultCell } from "@/lib/resultCells";
import { useTableSample } from "@/hooks";
import { SkeletonRows } from "@/components/common/Skeletons";

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

    const meta: { name: string; type: string }[] = sample.meta;
    const accessors = resultColumnAccessors(meta.map((col) => col.name));
    return meta.map((col, index) => {
      // Determine type class for the header badge
      const type = col.type?.toLowerCase() || "";
      const typeClass = type.includes("string") ? "type-string" :
        (type.includes("int") || type.includes("float") || type.includes("decimal")) ? "type-number" :
          type.includes("bool") ? "type-boolean" :
            (type.includes("date") || type.includes("time")) ? "type-date" :
              (type.includes("array") || type.includes("map") || type.includes("tuple") || type.includes("json")) ? "type-object" : "";

      return {
        ...accessors[index],
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
          const { text, className, title } = formatResultCell(getValue());
          return (
            <span className={cn("font-mono text-[12px] tabular-nums", className)} title={title}>
              {text}
            </span>
          );
        },
      };
    });
  }, [sample?.meta]);

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
        <table className="w-full">
          <tbody>
            <SkeletonRows count={6} cols={5} />
          </tbody>
        </table>
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
