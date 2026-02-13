import React, { useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { GripVertical, Table2, Database, Code, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export interface ColumnDefinition {
    name: string;
    type: string;
    nullable: boolean;
    sampleValue?: any;
}

interface StepPreviewProps {
    columns: ColumnDefinition[];
    previewData: any[];
    tableName: string;
    onTableNameChange: (name: string) => void;
    onColumnChange: (index: number, field: keyof ColumnDefinition, value: any) => void;
    hasHeader: boolean;
    onHasHeaderChange: (checked: boolean) => void;
    format: string;
}

const CLICKHOUSE_TYPES = [
    { value: 'String', label: 'String', color: 'text-blue-400' },
    { value: 'Int64', label: 'Int64', color: 'text-green-400' },
    { value: 'Float64', label: 'Float64', color: 'text-green-400' },
    { value: 'Bool', label: 'Bool', color: 'text-yellow-400' },
    { value: 'Date', label: 'Date', color: 'text-purple-400' },
    { value: 'DateTime', label: 'DateTime', color: 'text-purple-400' },
    { value: 'UUID', label: 'UUID', color: 'text-orange-400' },
    { value: 'Array(String)', label: 'Array(String)', color: 'text-pink-400' },
];

export function StepPreview({
    columns,
    previewData,
    tableName,
    onTableNameChange,
    onColumnChange,
    hasHeader,
    onHasHeaderChange,
    format,
}: StepPreviewProps) {
    const [activeTab, setActiveTab] = useState<'schema' | 'data'>('schema');
    const isJSON = format.toUpperCase() === 'JSON';

    return (
        <div className="flex flex-col h-full space-y-6">
            {/* Table Name Section */}
            <div className="flex flex-col p-6 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                <div className="w-full grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="tableName" className="text-gray-400 flex items-center gap-2">
                            <Table2 className="w-4 h-4" /> Target Table Name
                        </Label>
                        <Input
                            id="tableName"
                            value={tableName}
                            onChange={(e) => onTableNameChange(e.target.value)}
                            placeholder="Enter table name"
                            className="bg-black/20 border-white/10 h-11 text-lg font-medium placeholder:text-gray-600 focus-visible:ring-blue-500/50"
                        />
                    </div>

                    <div className="space-y-2 flex flex-col justify-end">
                        {!isJSON && (
                            <div className="flex items-center space-x-2 h-11">
                                <Checkbox
                                    id="hasHeader"
                                    checked={hasHeader}
                                    onCheckedChange={(checked) => onHasHeaderChange(checked as boolean)}
                                    className="border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                />
                                <Label
                                    htmlFor="hasHeader"
                                    className="text-sm font-medium text-gray-300 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                >
                                    First row contains column names
                                </Label>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 flex flex-col">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-4 px-1">
                        <TabsList className="bg-white/5 border border-white/10">
                            <TabsTrigger value="schema" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">
                                <Database className="w-4 h-4 mr-2" /> Schema Definition
                            </TabsTrigger>
                            <TabsTrigger value="data" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
                                <Code className="w-4 h-4 mr-2" /> Data Preview ({previewData.length})
                            </TabsTrigger>
                        </TabsList>
                        <div className="text-xs text-gray-500">
                            {columns.length} columns detected
                        </div>
                    </div>

                    <TabsContent value="schema" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
                        <Card className="h-full bg-white/5 border-white/10 flex flex-col overflow-hidden">
                            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-white/10 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-black/20">
                                <div className="col-span-1 text-center">#</div>
                                <div className="col-span-4">Column Name</div>
                                <div className="col-span-3">Type</div>
                                <div className="col-span-2 text-center">Nullable</div>
                                <div className="col-span-2">Sample Value</div>
                            </div>
                            <ScrollArea className="flex-1">
                                <div className="py-2">
                                    <AnimatePresence>
                                        {columns.map((col, idx) => (
                                            <motion.div
                                                key={idx}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.03 }}
                                                className="grid grid-cols-12 gap-4 items-center px-6 py-3 border-b border-white/5 hover:bg-white/5 transition-colors group"
                                            >
                                                <div className="col-span-1 flex justify-center text-gray-600 font-mono text-xs">
                                                    {idx + 1}
                                                </div>
                                                <div className="col-span-4">
                                                    <Input
                                                        value={col.name}
                                                        onChange={(e) => onColumnChange(idx, 'name', e.target.value)}
                                                        className="h-8 bg-transparent border-transparent hover:border-white/10 focus:bg-black/20 focus:border-blue-500/50 transition-all font-medium text-gray-200 rounded-sm px-2"
                                                    />
                                                </div>
                                                <div className="col-span-3">
                                                    <Select
                                                        value={col.type}
                                                        onValueChange={(val) => onColumnChange(idx, 'type', val)}
                                                    >
                                                        <SelectTrigger className="h-8 border-transparent bg-transparent hover:bg-white/5 text-xs text-gray-300 rounded-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {CLICKHOUSE_TYPES.map(t => (
                                                                <SelectItem key={t.value} value={t.value}>
                                                                    <span className={cn("font-medium", t.color)}>{t.label}</span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="col-span-2 flex justify-center">
                                                    <div
                                                        className={cn(
                                                            "w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-colors",
                                                            col.nullable
                                                                ? "bg-blue-500/20 border-blue-500 text-blue-400"
                                                                : "border-gray-700 hover:border-gray-500"
                                                        )}
                                                        onClick={() => onColumnChange(idx, 'nullable', !col.nullable)}
                                                    >
                                                        {col.nullable && <Check className="w-3 h-3" />}
                                                    </div>
                                                </div>
                                                <div className="col-span-2 text-xs truncate text-gray-500 font-mono" title={String(col.sampleValue)}>
                                                    {String(col.sampleValue ?? '-')}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </ScrollArea>
                        </Card>
                    </TabsContent>

                    <TabsContent value="data" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
                        <Card className="h-full bg-white/5 border-white/10 flex flex-col overflow-hidden">
                            <div className="flex-1 w-full overflow-auto">
                                <Table>
                                    <TableHeader className="bg-black/20 sticky top-0 z-10">
                                        <TableRow className="hover:bg-transparent border-white/10">
                                            {columns.map((col, i) => (
                                                <TableHead key={i} className="whitespace-nowrap h-10 text-xs font-semibold text-gray-400 px-4">
                                                    {col.name}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewData.map((row, i) => (
                                            <TableRow key={i} className="border-white/5 hover:bg-white/5">
                                                {columns.map((col, j) => (
                                                    <TableCell key={j} className="whitespace-nowrap font-mono text-xs py-2 px-4 text-gray-300">
                                                        {String(row[col.name] ?? row[Object.keys(row)[j]] ?? '')}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                        {previewData.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={columns.length} className="text-center py-20 text-gray-500">
                                                    No data available for preview.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
