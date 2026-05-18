import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useTableSchema } from "@/hooks";
import { cn } from "@/lib/utils";

interface SchemaSectionProps {
  database: string;
  tableName: string;
}

const SchemaSection: React.FC<SchemaSectionProps> = ({ database, tableName }) => {
  const { data: schema, isLoading, error } = useTableSchema(database, tableName);

  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      accessorKey: "name",
      header: () => <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Column</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[12px] text-paper">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: "type",
      header: () => <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Type</span>,
      cell: ({ getValue }) => {
        const type = (getValue() as string) || "";
        const typeLower = type.toLowerCase();
        const typeClass = typeLower.includes("string") ? "type-string" :
          (typeLower.includes("int") || typeLower.includes("float") || typeLower.includes("decimal")) ? "type-number" :
            typeLower.includes("bool") ? "type-boolean" :
              (typeLower.includes("date") || typeLower.includes("time")) ? "type-date" :
                (typeLower.includes("array") || typeLower.includes("map") || typeLower.includes("tuple") || typeLower.includes("json")) ? "type-object" : "";

        return (
          <div className="flex items-center gap-2">
            <div className={cn("h-1.5 w-1.5 rounded-full shrink-0",
              typeLower.includes("string") ? "bg-[#ce9178]" :
                (typeLower.includes("int") || typeLower.includes("float") || typeLower.includes("decimal")) ? "bg-[#b5cea8]" :
                  typeLower.includes("bool") ? "bg-[#569cd6]" :
                    (typeLower.includes("date") || typeLower.includes("time")) ? "bg-[#4fc1ff]" :
                      (typeLower.includes("array") || typeLower.includes("map") || typeLower.includes("tuple") || typeLower.includes("json")) ? "bg-[#9cdcfe]" : "bg-ink-700"
            )} />
            <span className={cn("font-mono text-[12px]", typeClass)}>
              {type}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "default_type",
      header: () => <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Default Type</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] italic text-paper-faint">{getValue() as string || "-"}</span>
      ),
    },
    {
      accessorKey: "default_expression",
      header: () => <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Default Expression</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] text-paper-faint">{getValue() as string || "-"}</span>
      ),
    },
    {
      accessorKey: "comment",
      header: () => <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Comment</span>,
      cell: ({ getValue }) => (
        <span className="text-[12px] italic leading-relaxed text-paper-faint">{getValue() as string || "-"}</span>
      ),
      meta: { wrap: true },
    },
  ], []);

  if (isLoading) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center gap-3 rounded-xs border border-ink-500 bg-ink-100">
        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Analyzing schema…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-400">{error.message}</p>
      </div>
    );
  }

  if (!schema || schema.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No schema information found</p>
      </div>
    );
  }

  return (
    <div className="relative h-[450px]">
      <DataTable
        columns={columns}
        data={schema}
        className="h-full"
      />
    </div>
  );
};

export default SchemaSection;
