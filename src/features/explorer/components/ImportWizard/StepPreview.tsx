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
            <div className="space-y-4 rounded-xs border border-ink-500 bg-ink-100 p-5">
                <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                    <span className="h-px w-6 bg-ink-700" />
                    <span>Destination</span>
                </span>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => onImportModeChange('create')}
                        className={cn(
                            "rounded-xs border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                            importMode === 'create'
                                ? "border-brand/40 bg-brand/10 text-brand"
                                : "border-ink-500 bg-ink-200 text-paper-dim hover:bg-ink-300 hover:text-paper"
                        )}
                    >
                        New table
                    </button>
                    <button
                        type="button"
                        onClick={() => onImportModeChange('append')}
                        className={cn(
                            "rounded-xs border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                            importMode === 'append'
                                ? "border-brand/40 bg-brand/10 text-brand"
                                : "border-ink-500 bg-ink-200 text-paper-dim hover:bg-ink-300 hover:text-paper"
                        )}
                    >
                        Append to existing
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-4 pt-1 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="tableName" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
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
                                        "h-10 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0",
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
                                <SelectTrigger id="tableName" className="h-10 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0">
                                    <SelectValue placeholder="Select table" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                    {existingTables.map(t => (
                                        <SelectItem key={t.name} value={t.name} className="focus:bg-ink-200 focus:text-paper">
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                    {existingTables.length === 0 && (
                                        <div className="p-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">No tables</div>
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
                                    className="border-ink-500"
                                />
                                <Label htmlFor="hasHeader" className="cursor-pointer text-[13px] text-paper-muted">
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
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <TabsList className="h-9 gap-0.5 rounded-xs border border-ink-500 bg-ink-100 p-0.5">
                            <TabsTrigger value="schema" className="rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors data-[state=active]:bg-ink-200 data-[state=active]:text-paper data-[state=inactive]:text-paper-dim hover:text-paper">
                                <Database className="mr-1.5 h-3.5 w-3.5" /> Schema
                            </TabsTrigger>
                            <TabsTrigger value="data" className="rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors data-[state=active]:bg-ink-200 data-[state=active]:text-paper data-[state=inactive]:text-paper-dim hover:text-paper">
                                <Code className="mr-1.5 h-3.5 w-3.5" /> Data ({previewData.length})
                            </TabsTrigger>
                        </TabsList>
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">{columns.length} columns</span>
                    </div>

                    <TabsContent value="schema" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden flex flex-col">
                        <Card className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100">
                            {/* Mobile/tablet: column cards */}
                            <div className="md:hidden flex-1 min-h-0 flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-3 space-y-3 pb-4">
                                        {columns.map((col, idx) => (
                                            <div
                                                key={idx}
                                                className="space-y-3 rounded-xs border border-ink-500 bg-ink-200 p-4"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Column {idx + 1}</span>
                                                    <span className="max-w-[50%] truncate font-mono text-[11px] text-paper-faint" title={String(col.sampleValue)}>
                                                        Sample: {String(col.sampleValue ?? '—')}
                                                    </span>
                                                </div>
                                                {importMode === 'create' ? (
                                                    <>
                                                        <div>
                                                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</Label>
                                                            <Input
                                                                value={col.name}
                                                                onChange={(e) => onColumnChange(idx, 'name', e.target.value)}
                                                                className="mt-1 h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Type</Label>
                                                            <Select value={col.type} onValueChange={(val) => onColumnChange(idx, 'type', val)}>
                                                                <SelectTrigger className="mt-1 h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                                                    {CLICKHOUSE_TYPES.map(t => (
                                                                        <SelectItem key={t.value} value={t.value}>
                                                                            <span className={cn("font-medium", t.color)}>{t.label}</span>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => onColumnChange(idx, 'nullable', !col.nullable)}
                                                                className={cn(
                                                                    "flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]",
                                                                    col.nullable ? "text-brand" : "text-paper-dim"
                                                                )}
                                                            >
                                                                <div className={cn(
                                                                    "flex h-5 w-5 items-center justify-center rounded-xs border",
                                                                    col.nullable ? "border-brand bg-brand text-ink-50" : "border-ink-500 bg-ink-100"
                                                                )}>
                                                                    {col.nullable && <Check className="h-3 w-3" />}
                                                                </div>
                                                                Nullable
                                                            </button>
                                                            {onToggleOrderBy && col.name && (engine.includes('MergeTree') || engine === 'MergeTree') && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onToggleOrderBy(col.name)}
                                                                    className={cn(
                                                                        "flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]",
                                                                        orderByColumns.includes(col.name) ? "text-brand" : "text-paper-dim"
                                                                    )}
                                                                >
                                                                    <div className={cn(
                                                                        "flex h-5 w-5 items-center justify-center rounded-xs border",
                                                                        orderByColumns.includes(col.name) ? "border-brand bg-brand text-ink-50" : "border-ink-500 bg-ink-100"
                                                                    )}>
                                                                        {orderByColumns.includes(col.name) && <Database className="h-3 w-3" />}
                                                                    </div>
                                                                    Sort key
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Description (optional)</Label>
                                                            <Input
                                                                value={col.description || ''}
                                                                onChange={(e) => onColumnChange(idx, 'description', e.target.value)}
                                                                placeholder="Optional"
                                                                className="mt-1 h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-[11px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                                                            />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="font-mono text-[13px] font-medium text-paper">{col.name}</div>
                                                        <div>
                                                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Map to table column</Label>
                                                            <Select
                                                                value={col.mappedTo || "skip"}
                                                                onValueChange={(val) => onColumnChange(idx, 'mappedTo', val === 'skip' ? '' : val)}
                                                            >
                                                                <SelectTrigger className="mt-1 h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0">
                                                                    <SelectValue placeholder="Skip column" />
                                                                </SelectTrigger>
                                                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                                                    <SelectItem value="skip" className="italic text-paper-dim">— Skip —</SelectItem>
                                                                    {tableSchema?.map(sc => (
                                                                        <SelectItem key={sc.name} value={sc.name} className="focus:bg-ink-200 focus:text-paper">
                                                                            {sc.name} <span className="font-mono text-xs text-paper-faint">{sc.type}</span>
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
                                <div className="grid shrink-0 grid-cols-[40px_2.5fr_1.5fr_50px_50px_2.5fr_1.5fr] gap-4 border-b border-ink-500 bg-ink-200 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                    <div className="text-center">#</div>
                                    <div>Column Name</div>
                                    <div>Type</div>
                                    <div className="text-center" title="Nullable">Null</div>
                                    <div className="text-center" title="Sort Key">Key</div>
                                    <div>Description</div>
                                    <div>Sample Value</div>
                                </div>
                            ) : (
                                <div className="grid shrink-0 grid-cols-[40px_2.5fr_1fr_2.5fr_2fr] gap-4 border-b border-ink-500 bg-ink-200 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
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
                                                    "group items-center gap-4 border-b border-ink-500 px-6 py-2 transition-colors hover:bg-ink-200",
                                                    importMode === 'create'
                                                        ? "grid grid-cols-[40px_2.5fr_1.5fr_50px_50px_2.5fr_1.5fr]"
                                                        : "grid grid-cols-[40px_2.5fr_1fr_2.5fr_2fr]"
                                                )}
                                            >
                                                <div className="flex justify-center font-mono text-xs text-paper-faint">
                                                    {idx + 1}
                                                </div>
                                                {importMode === 'create' ? (
                                                    <>
                                                        <div>
                                                            <Input
                                                                value={col.name}
                                                                onChange={(e) => onColumnChange(idx, 'name', e.target.value)}
                                                                className="h-8 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-xs text-paper shadow-none transition-colors hover:border-ink-700 focus-visible:border-brand focus-visible:ring-0"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Select
                                                                value={col.type}
                                                                onValueChange={(val) => onColumnChange(idx, 'type', val)}
                                                            >
                                                                <SelectTrigger className="h-8 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-xs text-paper shadow-none transition-colors hover:bg-ink-300 focus-visible:border-brand focus-visible:ring-0">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
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
                                                                    "flex h-5 w-5 cursor-pointer items-center justify-center rounded-xs border transition-colors",
                                                                    col.nullable
                                                                        ? "border-brand bg-brand text-ink-50"
                                                                        : "border-ink-500 bg-ink-200 text-transparent hover:border-ink-700"
                                                                )}
                                                                onClick={() => onColumnChange(idx, 'nullable', !col.nullable)}
                                                            >
                                                                <Check className="h-3 w-3" />
                                                            </div>
                                                        </div>
                                                        <div className="flex justify-center">
                                                            {onToggleOrderBy && col.name && (
                                                                <div
                                                                    className={cn(
                                                                        "flex h-5 w-5 cursor-pointer items-center justify-center rounded-xs border transition-colors",
                                                                        orderByColumns.includes(col.name)
                                                                            ? "border-brand bg-brand text-ink-50"
                                                                            : "border-ink-500 bg-ink-200 text-transparent hover:border-ink-700",
                                                                        (!engine.includes('MergeTree') && engine !== 'MergeTree') && "cursor-not-allowed opacity-30"
                                                                    )}
                                                                    onClick={() => {
                                                                        if (engine.includes('MergeTree') || engine === 'MergeTree') {
                                                                            onToggleOrderBy(col.name);
                                                                        }
                                                                    }}
                                                                    title={orderByColumns.includes(col.name) ? "Remove from Sort Key" : "Add to Sort Key"}
                                                                >
                                                                    <Database className="h-3 w-3" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <Input
                                                                value={col.description || ''}
                                                                onChange={(e) => onColumnChange(idx, 'description', e.target.value)}
                                                                placeholder="Add description..."
                                                                className="h-8 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-xs text-paper-muted placeholder:text-paper-faint shadow-none transition-colors hover:border-ink-700 focus-visible:border-brand focus-visible:ring-0"
                                                            />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex h-8 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-xs border border-ink-500 bg-ink-200 px-3 font-mono text-xs text-paper">
                                                            {col.name}
                                                        </div>
                                                        <div className="flex justify-center text-paper-faint">
                                                            <ChevronDown className="h-4 w-4 -rotate-90 animate-pulse" />
                                                        </div>
                                                        <div>
                                                            <Select
                                                                value={col.mappedTo || "skip"}
                                                                onValueChange={(val) => onColumnChange(idx, 'mappedTo', val === 'skip' ? '' : val)}
                                                            >
                                                                <SelectTrigger className="h-8 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-xs text-paper shadow-none transition-colors hover:bg-ink-300 focus-visible:border-brand focus-visible:ring-0">
                                                                    <SelectValue placeholder="Skip Column" />
                                                                </SelectTrigger>
                                                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                                                    <SelectItem value="skip" className="italic text-paper-dim">— Skip —</SelectItem>
                                                                    {tableSchema?.map(sc => (
                                                                        <SelectItem key={sc.name} value={sc.name} className="focus:bg-ink-200 focus:text-paper">
                                                                            <span className="flex items-center gap-2">
                                                                                <span className="font-medium text-paper">{sc.name}</span>
                                                                                <span className="font-mono text-[10px] text-paper-faint">{sc.type}</span>
                                                                            </span>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </>
                                                )}
                                                <div className="truncate font-mono text-xs text-paper-faint" title={String(col.sampleValue)}>
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
                                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="shrink-0 border-t border-ink-500 bg-ink-200">
                                    <CollapsibleTrigger className="w-full rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                                        <div className="flex w-full items-center justify-between px-5 py-3 transition-colors hover:bg-ink-300">
                                            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
                                                <Settings2 className={cn("h-3.5 w-3.5", advancedOpen && "text-brand")} />
                                                Advanced
                                                {!advancedOpen && hasAdvancedSummary && (
                                                    <span className="font-mono text-[10px] normal-case tracking-normal text-paper-dim">
                                                        · {advancedSummaryParts.join(' · ')}
                                                    </span>
                                                )}
                                            </span>
                                            <ChevronDown className={cn("h-4 w-4 text-paper-dim transition-transform", advancedOpen && "rotate-180 text-brand")} />
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="space-y-5 border-t border-ink-500 p-6 pt-4">
                                            {/* Engine Selection */}
                                            <div className="space-y-2 text-left">
                                                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Table Engine</Label>
                                                <Select value={engine} onValueChange={onEngineChange}>
                                                    <SelectTrigger className="h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                                        {ENGINES.map((eng) => (
                                                            <SelectItem key={eng.value} value={eng.value}>
                                                                <div className="flex flex-col text-left">
                                                                    <span>{eng.label}</span>
                                                                    <span className="text-[10px] text-paper-dim">{eng.description}</span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2 text-left">
                                                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Partition By</Label>
                                                <Input
                                                    value={partitionBy}
                                                    onChange={(e) => onPartitionByChange?.(e.target.value)}
                                                    placeholder="e.g., toYYYYMM(created_at) or leave empty for none"
                                                    className="h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-xs text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 gap-5 text-left md:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">TTL Expression</Label>
                                                    <Input
                                                        value={ttlExpression}
                                                        onChange={(e) => onTtlExpressionChange?.(e.target.value)}
                                                        placeholder="e.g., created_at + INTERVAL 30 DAY"
                                                        className="h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-xs text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Table Comment</Label>
                                                    <Input
                                                        value={comment}
                                                        onChange={(e) => onCommentChange?.(e.target.value)}
                                                        placeholder="Optional description"
                                                        className="h-9 rounded-xs border-ink-500 bg-ink-100 font-mono text-xs text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
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
                        <Card className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100">
                            <p className="shrink-0 border-b border-ink-500 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                Preview (first {previewData.length} row{previewData.length !== 1 ? 's' : ''})
                            </p>
                            <div className="w-full flex-1 overflow-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-ink-200">
                                        <TableRow className="border-ink-500 hover:bg-transparent">
                                            {columns.map((col, i) => (
                                                <TableHead key={i} className="h-10 whitespace-nowrap px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                                    {col.name}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewData.map((row, i) => (
                                            <TableRow key={i} className="border-ink-500 hover:bg-ink-200">
                                                {columns.map((col, j) => (
                                                    <TableCell key={j} className="whitespace-nowrap px-4 py-2 font-mono text-xs text-paper-muted">
                                                        {String(row[col.name] ?? row[Object.keys(row)[j]] ?? '')}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                        {previewData.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={columns.length} className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
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
