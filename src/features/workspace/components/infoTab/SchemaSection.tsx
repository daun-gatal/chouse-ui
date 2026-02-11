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
      header: () => <span className="font-medium text-white/60 lowercase text-[13px]">column</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[12px] text-white/80">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: "type",
      header: () => <span className="font-medium text-white/60 lowercase text-[13px]">type</span>,
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
                      (typeLower.includes("array") || typeLower.includes("map") || typeLower.includes("tuple") || typeLower.includes("json")) ? "bg-[#9cdcfe]" : "bg-white/20"
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
      header: () => <span className="font-medium text-white/60 lowercase text-[13px]">default type</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] text-white/40 italic">{getValue() as string || "-"}</span>
      ),
    },
    {
      accessorKey: "default_expression",
      header: () => <span className="font-medium text-white/60 lowercase text-[13px]">default expression</span>,
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] text-white/40">{getValue() as string || "-"}</span>
      ),
    },
    {
      accessorKey: "comment",
      header: () => <span className="font-medium text-white/60 lowercase text-[13px]">comment</span>,
      cell: ({ getValue }) => (
        <span className="text-[12px] text-white/40 font-light italic leading-relaxed">{getValue() as string || "-"}</span>
      ),
      meta: { wrap: true },
    },
  ], []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] bg-white/[0.02] rounded-xl border border-white/5 backdrop-blur-sm">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400 opacity-50" />
        <span className="mt-4 text-white/20 text-xs tracking-[0.3em] font-light uppercase">Analyzing Schema...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-red-400/60 font-mono text-sm">{error.message}</p>
      </div>
    );
  }

  if (!schema || schema.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-white/20 font-light tracking-widest uppercase text-xs">No schema information found</p>
      </div>
    );
  }

  return (
    <div className="h-[450px] relative">
      <DataTable
        columns={columns}
        data={schema}
        className="h-full"
      />
    </div>
  );
};

export default SchemaSection;
