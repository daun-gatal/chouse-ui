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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table2, Database, Code, Check, Settings2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ENGINES } from './ImportWizard';
import { useDatabases, useTableSchema } from '@/hooks';

export interface ColumnDefinition {
    name: string;
    type: string;
    nullable: boolean;
    description?: string;
    sampleValue?: any;
    mappedTo?: string; // Target column name if appending
}

const TABLE_NAME_REGEX = /^[a-zA-Z0-9_]*$/;

interface StepPreviewProps {
    fileName?: string;
    importMode: 'create' | 'append';
    onImportModeChange: (mode: 'create' | 'append') => void;
    selectedDb: string;
    columns: ColumnDefinition[];
    previewData: any[];
    tableName: string;
    onTableNameChange: (name: string) => void;
    onColumnChange: (index: number, field: keyof ColumnDefinition, value: any) => void;
    onColumnsChange?: (columns: ColumnDefinition[]) => void;
    hasHeader: boolean;
    onHasHeaderChange: (checked: boolean) => void;
    format: string;
    // New props for Sort Key and Advanced Settings
    engine?: string;
    orderByColumns?: string[];
    onToggleOrderBy?: (columnName: string) => void;
    onEngineChange?: (engine: string) => void;
    partitionBy?: string;
    onPartitionByChange?: (val: string) => void;
    ttlExpression?: string;
    onTtlExpressionChange?: (val: string) => void;
    comment?: string;
    onCommentChange?: (val: string) => void;
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
    fileName,
    importMode,
    onImportModeChange,
    selectedDb,
    columns,
    previewData,
    tableName,
    onTableNameChange,
    onColumnChange,
    onColumnsChange,
    hasHeader,
    onHasHeaderChange,
    format,
    engine = 'MergeTree',
    orderByColumns = [],
    onToggleOrderBy,
    onEngineChange,
    partitionBy = '',
    onPartitionByChange,
    ttlExpression = '',
    onTtlExpressionChange,
    comment = '',
    onCommentChange,
}: StepPreviewProps) {
    const [activeTab, setActiveTab] = useState<'schema' | 'data'>('schema');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const isJSON = format.toUpperCase() === 'JSON';
    const tableNameInvalid = tableName.length > 0 && !TABLE_NAME_REGEX.test(tableName);
    const advancedSummaryParts = [
        engine && `Engine: ${engine}`,
        orderByColumns.length > 0 && `ORDER BY (${orderByColumns.join(', ')})`,
        partitionBy && `Partition: ${partitionBy}`,
        ttlExpression && 'TTL set',
        comment && 'Comment set',
    ].filter(Boolean) as string[];
    const hasAdvancedSummary = advancedSummaryParts.length > 0;

    const { data: databases = [] } = useDatabases();
    const existingTables = databases.find(db => db.name === selectedDb)?.children || [];
    const isTableExisting = existingTables.some(t => t.name === tableName);

    const { data: tableSchema } = useTableSchema(selectedDb, importMode === 'append' ? tableName : '', {
        enabled: importMode === 'append' && !!tableName && isTableExisting,
    });

    const prevSchemaRef = React.useRef(tableSchema);

    React.useEffect(() => {
        if (importMode === 'append' && tableSchema && tableSchema !== prevSchemaRef.current) {
            prevSchemaRef.current = tableSchema;

            const validColumnNames = new Set(tableSchema.map(c => c.name));
            let changed = false;
            const newCols = columns.map(col => {
                // Clear mappedTo if the target column does not exist in the new schema
                if (col.mappedTo && !validColumnNames.has(col.mappedTo)) {
                    changed = true;
                    return { ...col, mappedTo: '' };
                }
                return col;
            });

            if (changed && onColumnsChange) {
                onColumnsChange(newCols);
            }
        }
        // Also update ref if mode changes or schema becomes undefined
        if (tableSchema !== prevSchemaRef.current) {
            prevSchemaRef.current = tableSchema;
        }
    }, [tableSchema, importMode, columns, onColumnsChange]);

    return (
        <div className="flex flex-col space-y-6 pb-6">
            {/* Destination */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => onImportModeChange('create')}
                        className={cn(
                            "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                            importMode === 'create'
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "text-gray-400 border border-white/10 hover:bg-white/5 hover:text-gray-300"
                        )}
                    >
                        New table
                    </button>
                    <button
                        type="button"
                        onClick={() => onImportModeChange('append')}
                        className={cn(
                            "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                            importMode === 'append'
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "text-gray-400 border border-white/10 hover:bg-white/5 hover:text-gray-300"
                        )}
                    >
                        Append to existing
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-2">
                        <Label htmlFor="tableName" className="text-xs font-medium text-gray-500">
                            Table name
                        </Label>
                        {importMode === 'create' ? (
                            <>
                                <Input
                                    id="tableName"
                                    value={tableName}
                                    onChange={(e) => onTableNameChange(e.target.value)}
                                    placeholder="my_table"
                                    aria-invalid={tableNameInvalid}
                                    aria-describedby={tableNameInvalid ? 'tableName-hint' : undefined}
                                    className={cn(
                                        "h-10 bg-white/5 border-white/10 text-sm placeholder:text-gray-500 focus-visible:ring-emerald-500/50",
                                        tableNameInvalid && "border-red-500/50"
                                    )}
                                />
                                {tableNameInvalid && (
                                    <p id="tableName-hint" className="text-xs text-red-400" role="alert">
                                        Use only letters, numbers, and underscores.
                                    </p>
                                )}
                            </>
                        ) : (
                            <Select value={tableName} onValueChange={onTableNameChange}>
                                <SelectTrigger id="tableName" className="h-10 bg-white/5 border-white/10 text-sm focus-visible:ring-emerald-500/50">
                                    <SelectValue placeholder="Select table" />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-900 border-white/10">
                                    {existingTables.map(t => (
                                        <SelectItem key={t.name} value={t.name} className="focus:bg-emerald-500/15 focus:text-emerald-400">
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                    {existingTables.length === 0 && (
                                        <div className="p-3 text-sm text-gray-500 text-center">No tables</div>
                                    )}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    {!isJSON && (
                        <div className="flex items-end">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="hasHeader"
                                    checked={hasHeader}
                                    onCheckedChange={(c) => onHasHeaderChange(c as boolean)}
                                    className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                <Label htmlFor="hasHeader" className="text-sm text-gray-400 cursor-pointer">
                                    First row is header
                                </Label>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content Area - min height so schema/data area is usable when window scrolls */}
            <div className="flex flex-col min-h-[320px]">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex flex-col min-h-[300px]">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <TabsList className="bg-white/5 border border-white/10 p-0.5 rounded-lg">
                            <TabsTrigger value="schema" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 rounded-md text-sm">
                                <Database className="w-3.5 h-3.5 mr-1.5" /> Schema
                            </TabsTrigger>
                            <TabsTrigger value="data" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 rounded-md text-sm">
                                <Code className="w-3.5 h-3.5 mr-1.5" /> Data ({previewData.length})
                            </TabsTrigger>
                        </TabsList>
                        <span className="text-xs text-gray-500">{columns.length} columns</span>
                    </div>

                    <TabsContent value="schema" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden flex flex-col">
                        <Card className="flex-1 min-h-0 bg-white/[0.02] border-white/10 flex flex-col overflow-hidden rounded-xl">
                            {/* Mobile/tablet: column cards */}
                            <div className="md:hidden flex-1 min-h-0 flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-3 space-y-3 pb-4">
                                        {columns.map((col, idx) => (
                                            <div
                                                key={idx}
                                                className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-medium text-gray-500">Column {idx + 1}</span>
                                                    <span className="text-xs truncate text-gray-500 font-mono max-w-[50%]" title={String(col.sampleValue)}>
                                                        Sample: {String(col.sampleValue ?? '—')}
                                                    </span>
                                                </div>
                                                {importMode === 'create' ? (
                                                    <>
                                                        <div>
                                                            <Label className="text-xs text-gray-400">Name</Label>
                                                            <Input
                                                                value={col.name}
                                                                onChange={(e) => onColumnChange(idx, 'name', e.target.value)}
                                                                className="h-9 bg-black/20 border-white/10 text-sm mt-1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-xs text-gray-400">Type</Label>
                                                            <Select value={col.type} onValueChange={(val) => onColumnChange(idx, 'type', val)}>
                                                                <SelectTrigger className="h-9 border-white/10 bg-black/20 text-sm mt-1">
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
                                                        <div className="flex flex-wrap gap-3 items-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => onColumnChange(idx, 'nullable', !col.nullable)}
                                                                className={cn(
                                                                    "flex items-center gap-2 text-xs",
                                                                    col.nullable ? "text-blue-400" : "text-gray-500"
                                                                )}
                                                            >
                                                                <div                                                                 className={cn(
                                                                    "w-5 h-5 rounded border flex items-center justify-center",
                                                                    col.nullable ? "bg-emerald-500 border-emerald-500" : "bg-white/10 border-white/10"
                                                                )}>
                                                                    {col.nullable && <Check className="w-3 h-3 text-white" />}
                                                                </div>
                                                                Nullable
                                                            </button>
                                                            {onToggleOrderBy && col.name && (engine.includes('MergeTree') || engine === 'MergeTree') && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onToggleOrderBy(col.name)}
                                                                    className={cn(
                                                                        "flex items-center gap-2 text-xs",
                                                                        orderByColumns.includes(col.name) ? "text-emerald-400" : "text-gray-500"
                                                                    )}
                                                                >
                                                                    <div className={cn(
                                                                        "w-5 h-5 rounded border flex items-center justify-center",
                                                                        orderByColumns.includes(col.name) ? "bg-emerald-500 border-emerald-500" : "bg-white/10 border-white/10"
                                                                    )}>
                                                                        {orderByColumns.includes(col.name) && <Database className="w-3 h-3 text-white" />}
                                                                    </div>
                                                                    Sort key
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <Label className="text-xs text-gray-400">Description (optional)</Label>
                                                            <Input
                                                                value={col.description || ''}
                                                                onChange={(e) => onColumnChange(idx, 'description', e.target.value)}
                                                                placeholder="Optional"
                                                                className="h-9 bg-black/20 border-white/10 text-xs mt-1"
                                                            />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="text-sm font-medium text-gray-300">{col.name}</div>
                                                        <div>
                                                            <Label className="text-xs text-gray-400">Map to table column</Label>
                                                            <Select
                                                                value={col.mappedTo || "skip"}
                                                                onValueChange={(val) => onColumnChange(idx, 'mappedTo', val === 'skip' ? '' : val)}
                                                            >
                                                                <SelectTrigger className="h-9 border-white/10 bg-black/20 text-sm mt-1">
                                                                    <SelectValue placeholder="Skip column" />
                                                                </SelectTrigger>
                                                                <SelectContent className="bg-gray-900 border-white/10">
                                                                    <SelectItem value="skip" className="text-gray-500 italic">— Skip —</SelectItem>
                                                                    {tableSchema?.map(sc => (
                                                                        <SelectItem key={sc.name} value={sc.name} className="focus:bg-emerald-500/15 focus:text-emerald-400">
                                                                            {sc.name} <span className="text-gray-500 font-mono text-xs">{sc.type}</span>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>

                            {/* Desktop: table */}
                            <div className="hidden md:block flex-1 min-h-0 flex flex-col overflow-hidden">
                            {importMode === 'create' ? (
                                <div className="grid grid-cols-[40px_2.5fr_1.5fr_50px_50px_2.5fr_1.5fr] gap-4 px-5 py-2.5 border-b border-white/10 text-[11px] font-medium text-gray-500 uppercase tracking-wider bg-white/[0.02] shrink-0">
                                    <div className="text-center">#</div>
                                    <div>Column Name</div>
                                    <div>Type</div>
                                    <div className="text-center" title="Nullable">Null</div>
                                    <div className="text-center" title="Sort Key">Key</div>
                                    <div>Description</div>
                                    <div>Sample Value</div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-[40px_2.5fr_1fr_2.5fr_2fr] gap-4 px-5 py-2.5 border-b border-white/10 text-[11px] font-medium text-gray-500 uppercase tracking-wider bg-white/[0.02] shrink-0">
                                    <div className="text-center">#</div>
                                    <div className="flex items-center gap-1">File Column</div>
                                    <div className="text-center"></div>
                                    <div>Map To Table Column</div>
                                    <div>Sample Value</div>
                                </div>
                            )}
                            <ScrollArea className="flex-1 min-h-0">
                                <div className="py-2">
                                    <AnimatePresence>
                                        {columns.map((col, idx) => (
                                            <motion.div
                                                key={idx}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.03 }}
                                                className={cn(
                                                    "gap-4 items-center px-6 py-2 border-b border-white/5 hover:bg-white/5 transition-colors group",
                                                    importMode === 'create'
                                                        ? "grid grid-cols-[40px_2.5fr_1.5fr_50px_50px_2.5fr_1.5fr]"
                                                        : "grid grid-cols-[40px_2.5fr_1fr_2.5fr_2fr]"
                                                )}
                                            >
                                                <div className="flex justify-center text-gray-500 font-mono text-xs">
                                                    {idx + 1}
                                                </div>
                                                {importMode === 'create' ? (
                                                    <>
                                                        <div>
                                                            <Input
                                                                value={col.name}
                                                                onChange={(e) => onColumnChange(idx, 'name', e.target.value)}
                                                                className="h-8 bg-white/5 border-white/10 hover:border-white/20 focus:border-emerald-500/50 transition-all font-medium text-gray-200 rounded-md px-3 text-xs shadow-none"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Select
                                                                value={col.type}
                                                                onValueChange={(val) => onColumnChange(idx, 'type', val)}
                                                            >
                                                                <SelectTrigger className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-300 rounded-md px-3 shadow-none focus-visible:ring-emerald-500/50">
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
                                                        <div className="flex justify-center">
                                                            <div
                                                                className={cn(
                                                                    "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                                                                    col.nullable
                                                                        ? "bg-emerald-500 text-white border-emerald-500"
                                                                        : "bg-white/10 border-white/10 hover:border-white/20 text-transparent"
                                                                )}
                                                                onClick={() => onColumnChange(idx, 'nullable', !col.nullable)}
                                                            >
                                                                <Check className="w-3 h-3" />
                                                            </div>
                                                        </div>
                                                        <div className="flex justify-center">
                                                            {onToggleOrderBy && col.name && (
                                                                <div
                                                                    className={cn(
                                                                        "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                                                                        orderByColumns.includes(col.name)
                                                                            ? "bg-emerald-500 text-white border-emerald-500"
                                                                            : "bg-white/10 border-white/10 hover:border-white/20 text-transparent",
                                                                        (!engine.includes('MergeTree') && engine !== 'MergeTree') && "opacity-30 cursor-not-allowed"
                                                                    )}
                                                                    onClick={() => {
                                                                        if (engine.includes('MergeTree') || engine === 'MergeTree') {
                                                                            onToggleOrderBy(col.name);
                                                                        }
                                                                    }}
                                                                    title={orderByColumns.includes(col.name) ? "Remove from Sort Key" : "Add to Sort Key"}
                                                                >
                                                                    <Database className="w-3 h-3" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <Input
                                                                value={col.description || ''}
                                                                onChange={(e) => onColumnChange(idx, 'description', e.target.value)}
                                                                placeholder="Add description..."
                                                                className="h-8 bg-white/5 border-white/10 hover:border-white/20 focus:border-emerald-500/50 transition-all text-xs text-gray-400 rounded-md px-3 shadow-none"
                                                            />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center bg-black/20 h-8 px-3 rounded-md border border-white/10 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-gray-300">
                                                            {col.name}
                                                        </div>
                                                        <div className="flex justify-center text-gray-500">
                                                            <ChevronDown className="w-4 h-4 -rotate-90 animate-pulse" />
                                                        </div>
                                                        <div>
                                                            <Select
                                                                value={col.mappedTo || "skip"}
                                                                onValueChange={(val) => onColumnChange(idx, 'mappedTo', val === 'skip' ? '' : val)}
                                                            >
                                                                <SelectTrigger className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-300 rounded-md px-3 shadow-none focus-visible:ring-emerald-500/50">
                                                                    <SelectValue placeholder="Skip Column" />
                                                                </SelectTrigger>
                                                                <SelectContent className="bg-gray-900 border-white/10 text-gray-300">
                                                                    <SelectItem value="skip" className="text-gray-500 italic">— Skip —</SelectItem>
                                                                    {tableSchema?.map(sc => (
                                                                        <SelectItem key={sc.name} value={sc.name} className="focus:bg-emerald-500/15 focus:text-emerald-400">
                                                                            <span className="flex items-center gap-2">
                                                                                <span className="font-medium text-gray-200">{sc.name}</span>
                                                                                <span className="text-[10px] text-gray-500 font-mono">{sc.type}</span>
                                                                            </span>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </>
                                                )}
                                                <div className="text-xs truncate text-gray-500 font-mono" title={String(col.sampleValue)}>
                                                    {String(col.sampleValue ?? '-')}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </ScrollArea>
                            </div>
                            {/* Advanced Settings */}
                            {importMode === 'create' && onEngineChange && (
                                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-white/10 bg-white/[0.02] shrink-0">
                                    <CollapsibleTrigger className="w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 rounded">
                                        <div className="flex items-center justify-between w-full px-5 py-3 transition-colors hover:bg-white/5">
                                            <span className="flex items-center gap-2 text-xs font-medium text-gray-400">
                                                <Settings2 className={cn("h-3.5 w-3.5", advancedOpen && "text-emerald-400")} />
                                                Advanced
                                                {!advancedOpen && hasAdvancedSummary && (
                                                    <span className="text-gray-500 font-normal normal-case">
                                                        · {advancedSummaryParts.join(' · ')}
                                                    </span>
                                                )}
                                            </span>
                                            <ChevronDown className={cn("h-4 w-4 text-gray-500 transition-transform", advancedOpen && "rotate-180 text-emerald-400")} />
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="p-6 pt-2 space-y-5 border-t border-white/5">
                                            {/* Engine Selection */}
                                            <div className="space-y-2 text-left">
                                                <Label className="text-gray-300 text-xs">Table Engine</Label>
                                                <Select value={engine} onValueChange={onEngineChange}>
                                                    <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm focus-visible:ring-emerald-500/50">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {ENGINES.map((eng) => (
                                                            <SelectItem key={eng.value} value={eng.value}>
                                                                <div className="flex flex-col text-left">
                                                                    <span>{eng.label}</span>
                                                                    <span className="text-[10px] text-gray-400">{eng.description}</span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2 text-left">
                                                <Label className="text-gray-300 text-xs">Partition By</Label>
                                                <Input
                                                    value={partitionBy}
                                                    onChange={(e) => onPartitionByChange?.(e.target.value)}
                                                    placeholder="e.g., toYYYYMM(created_at) or leave empty for none"
                                                    className="bg-white/5 border-white/10 h-9 text-xs focus-visible:ring-emerald-500/50"
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                                                <div className="space-y-2">
                                                    <Label className="text-gray-300 text-xs">TTL Expression</Label>
                                                    <Input
                                                        value={ttlExpression}
                                                        onChange={(e) => onTtlExpressionChange?.(e.target.value)}
                                                        placeholder="e.g., created_at + INTERVAL 30 DAY"
                                                        className="bg-white/5 border-white/10 h-9 text-xs focus-visible:ring-emerald-500/50"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-gray-300 text-xs">Table Comment</Label>
                                                    <Input
                                                        value={comment}
                                                        onChange={(e) => onCommentChange?.(e.target.value)}
                                                        placeholder="Optional description"
                                                        className="bg-white/5 border-white/10 h-9 text-xs focus-visible:ring-emerald-500/50"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </Card>
                    </TabsContent>

                    <TabsContent value="data" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden flex flex-col">
                        <Card className="flex-1 min-h-0 bg-white/[0.02] border-white/10 flex flex-col overflow-hidden rounded-xl">
                            <p className="text-xs text-gray-500 px-4 py-2 border-b border-white/10 shrink-0">
                                Preview (first {previewData.length} row{previewData.length !== 1 ? 's' : ''})
                            </p>
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
        </div >
    );
}
