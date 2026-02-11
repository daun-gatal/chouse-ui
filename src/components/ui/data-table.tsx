"use client"

import * as React from "react"
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    useReactTable,
} from "@tanstack/react-table"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    className?: string
    stickyFirstColumn?: boolean
    stickyHeader?: boolean
}

export function DataTable<TData, TValue>({
    columns,
    data,
    className,
    stickyFirstColumn = true,
    stickyHeader = true,
}: DataTableProps<TData, TValue>) {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: {
            pagination: {
                pageSize: 100,
            },
        },
    })

    return (
        <div className={cn("flex flex-col gap-2 h-full w-full", className)}>
            <div className="relative flex-1 w-full overflow-auto rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_20px_rgba(255,255,255,0.02)] transition-all duration-700 group/table">
                {/* Top light source highlight */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none z-20" />

                {/* Raw table used to avoid Shadcn Table component's nested overflow-auto wrapper which breaks sticky headers */}
                <table className="border-collapse min-w-full w-max table-auto text-sm">
                    <thead className={cn(
                        "z-40 border-b border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
                        stickyHeader && "sticky top-0"
                    )}>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id} className={cn(
                                "border-0 h-11 backdrop-blur-sm transition-colors",
                                stickyHeader
                                    ? "bg-zinc-900/98 supports-[backdrop-filter]:bg-zinc-900/95 supports-[backdrop-filter]:backdrop-blur-xl"
                                    : "bg-white/[0.02]"
                            )}>
                                {headerGroup.headers.map((header, index) => {
                                    const isFirst = index === 0 && stickyFirstColumn;
                                    return (
                                        <th
                                            key={header.id}
                                            className={cn(
                                                "p-0 border-r border-white/5 last:border-r-0 font-medium text-muted-foreground transition-colors relative",
                                                isFirst && "sticky left-0 z-50 bg-zinc-900/98 backdrop-blur-sm supports-[backdrop-filter]:bg-zinc-900/95 supports-[backdrop-filter]:backdrop-blur-xl after:absolute after:inset-0 after:bg-white/[0.03] after:pointer-events-none"
                                            )}
                                        >
                                            <div className="h-full w-full flex items-center px-4">
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                        header.column.columnDef.header,
                                                        header.getContext()
                                                    )}
                                            </div>
                                        </th>
                                    )
                                })}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="bg-transparent text-white/90">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {table.getRowModel().rows?.length ? (
                                table.getRowModel().rows.map((row, rowIndex) => (
                                    <motion.tr
                                        key={row.id}
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.98 }}
                                        transition={{
                                            duration: 0.2,
                                            delay: Math.min(rowIndex * 0.02, 0.4),
                                            ease: "easeOut"
                                        }}
                                        className={cn(
                                            "group transition-all duration-300 border-b border-white/[0.03] hover:bg-white/[0.04] last:border-b-0 h-9",
                                            row.getIsSelected() && "bg-white/[0.05]"
                                        )}
                                    >
                                        {row.getVisibleCells().map((cell, cellIndex) => {
                                            const isFirst = cellIndex === 0 && stickyFirstColumn;
                                            const meta = cell.column.columnDef.meta as { wrap?: boolean } | undefined;
                                            return (
                                                <td
                                                    key={cell.id}
                                                    className={cn(
                                                        "p-0 px-4 h-full align-middle border-r border-white/[0.01] last:border-r-0 py-2 transition-colors duration-300",
                                                        isFirst && "sticky left-0 z-20 bg-zinc-900/98 backdrop-blur-sm supports-[backdrop-filter]:bg-zinc-900/95 supports-[backdrop-filter]:backdrop-blur-xl group-hover:bg-zinc-800/98 after:absolute after:inset-0 after:bg-white/[0.01] after:pointer-events-none shadow-[4px_0_12px_rgba(0,0,0,0.4)]",
                                                        meta?.wrap ? "whitespace-normal min-w-[300px]" : "whitespace-nowrap"
                                                    )}
                                                >
                                                    <div className="transition-transform duration-300 group-hover:translate-x-0.5">
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </motion.tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={columns.length} className="h-24 text-center text-white/20 italic font-light">
                                        No results found.
                                    </td>
                                </tr>
                            )}
                        </AnimatePresence>
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between px-2 py-2 border-t border-white/5 bg-white/[0.02]">
                <div className="flex items-center space-x-2">
                    <p className="text-xs text-muted-foreground font-medium">Rows per page</p>
                    <Select
                        value={`${table.getState().pagination.pageSize}`}
                        onValueChange={(value) => {
                            table.setPageSize(Number(value))
                        }}
                    >
                        <SelectTrigger className="h-8 w-[70px] bg-white/5 border-white/10 text-xs">
                            <SelectValue placeholder={table.getState().pagination.pageSize} />
                        </SelectTrigger>
                        <SelectContent side="top">
                            {[10, 20, 30, 50, 100].map((pageSize) => (
                                <SelectItem key={pageSize} value={`${pageSize}`} className="text-xs">
                                    {pageSize}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center space-x-6 lg:space-x-8">
                    <div className="flex w-[100px] items-center justify-center text-xs font-medium text-muted-foreground">
                        Page {table.getState().pagination.pageIndex + 1} of{" "}
                        {table.getPageCount()}
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="outline"
                            className="hidden h-8 w-8 p-0 lg:flex bg-white/5 border-white/10 hover:bg-white/10"
                            onClick={() => table.setPageIndex(0)}
                            disabled={!table.getCanPreviousPage()}
                        >
                            <span className="sr-only">Go to first page</span>
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-white/5 border-white/10 hover:bg-white/10"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                        >
                            <span className="sr-only">Go to previous page</span>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-white/5 border-white/10 hover:bg-white/10"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                        >
                            <span className="sr-only">Go to next page</span>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="hidden h-8 w-8 p-0 lg:flex bg-white/5 border-white/10 hover:bg-white/10"
                            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                            disabled={!table.getCanNextPage()}
                        >
                            <span className="sr-only">Go to last page</span>
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
