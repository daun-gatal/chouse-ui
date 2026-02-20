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
import { GripVertical, Table2, Database, Code, Check, Settings2, ChevronDown } from 'lucide-react';
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

interface StepPreviewProps {
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
        <div className="flex flex-col h-full space-y-6">
            {/* Import Mode Selection */}
            <div className="flex p-1 rounded-lg bg-black/20 border border-white/10 w-fit shrink-0">
                <button
                    onClick={() => onImportModeChange('create')}
                    className={cn(
                        "px-4 py-2 rounded-md text-sm font-medium transition-all",
                        importMode === 'create'
                            ? "bg-blue-600/20 text-blue-400 shadow-sm border border-blue-500/30"
                            : "text-gray-400 hover:text-gray-300 hover:bg-white/5"
                    )}
                >
                    Create New Table
                </button>
                <button
                    onClick={() => onImportModeChange('append')}
                    className={cn(
                        "px-4 py-2 rounded-md text-sm font-medium transition-all",
                        importMode === 'append'
                            ? "bg-blue-600/20 text-blue-400 shadow-sm border border-blue-500/30"
                            : "text-gray-400 hover:text-gray-300 hover:bg-white/5"
                    )}
                >
                    Append to Existing Table
                </button>
            </div>

            {/* Table Name Section */}
            <div className="flex flex-col p-6 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                <div className="w-full grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="tableName" className="text-gray-400 flex items-center gap-2">
                            <Table2 className="w-4 h-4" /> Target Table Name
                        </Label>
                        {importMode === 'create' ? (
                            <Input
                                id="tableName"
                                value={tableName}
                                onChange={(e) => onTableNameChange(e.target.value)}
                                placeholder="Enter table name"
                                className="bg-black/20 border-white/10 h-11 text-lg font-medium placeholder:text-gray-600 focus-visible:ring-blue-500/50"
                            />
                        ) : (
                            <Select value={tableName} onValueChange={onTableNameChange}>
                                <SelectTrigger id="tableName" className="bg-black/20 border-white/10 h-11 text-lg font-medium focus-visible:ring-blue-500/50">
                                    <SelectValue placeholder="Select existing table" />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-900 border-white/10 text-gray-300">
                                    {existingTables.map(t => (
                                        <SelectItem key={t.name} value={t.name} className="focus:bg-blue-500/20 focus:text-blue-400">
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                    {existingTables.length === 0 && (
                                        <div className="p-2 text-sm text-gray-500 text-center">No tables found</div>
                                    )}
                                </SelectContent>
                            </Select>
                        )}
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
                            {importMode === 'create' ? (
                                <div className="grid grid-cols-[40px_2.5fr_1.5fr_50px_50px_2.5fr_1.5fr] gap-4 px-6 py-3 border-b border-white/10 text-[11px] font-semibold text-gray-400 uppercase tracking-wider bg-black/40">
                                    <div className="text-center">#</div>
                                    <div>Column Name</div>
                                    <div>Type</div>
                                    <div className="text-center" title="Nullable">Null</div>
                                    <div className="text-center" title="Sort Key">Key</div>
                                    <div>Description</div>
                                    <div>Sample Value</div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-[40px_2.5fr_1fr_2.5fr_2fr] gap-4 px-6 py-3 border-b border-white/10 text-[11px] font-semibold text-gray-400 uppercase tracking-wider bg-black/40">
                                    <div className="text-center">#</div>
                                    <div className="flex items-center gap-1">File Column</div>
                                    <div className="text-center"></div>
                                    <div>Map To Table Column</div>
                                    <div>Sample Value</div>
                                </div>
                            )}
                            <ScrollArea className="flex-1">
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
                                                                className="h-8 bg-black/20 border-white/10 hover:border-white/20 focus:bg-black/40 focus:border-blue-500/50 transition-all font-medium text-gray-200 rounded-md px-3 text-xs shadow-none"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Select
                                                                value={col.type}
                                                                onValueChange={(val) => onColumnChange(idx, 'type', val)}
                                                            >
                                                                <SelectTrigger className="h-8 border-white/10 bg-black/20 hover:bg-black/40 text-xs text-gray-300 rounded-md px-3 shadow-none">
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
                                                                        ? "bg-blue-500 text-white border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                                                                        : "bg-black/20 border-white/10 hover:border-white/20 text-transparent"
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
                                                                            ? "bg-purple-500 text-white border-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.3)]"
                                                                            : "bg-black/20 border-white/10 hover:border-white/20 text-transparent",
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
                                                                className="h-8 bg-black/20 border-white/10 hover:border-white/20 focus:bg-black/40 focus:border-blue-500/50 transition-all text-xs text-gray-400 rounded-md px-3 shadow-none"
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
                                                                <SelectTrigger className="h-8 border-white/10 bg-black/20 hover:bg-black/40 text-xs text-gray-300 rounded-md px-3 shadow-none">
                                                                    <SelectValue placeholder="Skip Column" />
                                                                </SelectTrigger>
                                                                <SelectContent className="bg-gray-900 border-white/10 text-gray-300">
                                                                    <SelectItem value="skip" className="text-gray-500 italic">-- Skip Column --</SelectItem>
                                                                    {tableSchema?.map(sc => (
                                                                        <SelectItem key={sc.name} value={sc.name} className="focus:bg-blue-500/20 focus:text-blue-400">
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
                            {/* Advanced Settings */}
                            {importMode === 'create' && onEngineChange && (
                                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-white/10 bg-black/20 shrink-0">
                                    <CollapsibleTrigger className="w-full">
                                        <div className={`flex items-center justify-between w-full p-3 px-6 transition-all hover:bg-white/5`}>
                                            <span className="flex items-center gap-2 font-medium text-xs text-gray-300">
                                                <Settings2 className={`h-4 w-4 ${advancedOpen ? "text-purple-400" : ""}`} />
                                                Advanced Settings
                                            </span>
                                            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${advancedOpen ? "rotate-180 text-purple-400" : ""}`} />
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="p-6 pt-2 space-y-5 border-t border-white/5">
                                            {/* Engine Selection */}
                                            <div className="space-y-2 text-left">
                                                <Label className="text-gray-300 text-xs">Table Engine</Label>
                                                <Select value={engine} onValueChange={onEngineChange}>
                                                    <SelectTrigger className="bg-black/20 border-white/10 h-9 focus:ring-1 focus:ring-purple-500">
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
                                                    className="bg-black/20 border-white/10 h-9 text-xs focus-visible:ring-1 focus-visible:ring-purple-500"
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
                                                <div className="space-y-2">
                                                    <Label className="text-gray-300 text-xs">TTL Expression</Label>
                                                    <Input
                                                        value={ttlExpression}
                                                        onChange={(e) => onTtlExpressionChange?.(e.target.value)}
                                                        placeholder="e.g., created_at + INTERVAL 30 DAY"
                                                        className="bg-black/20 border-white/10 h-9 text-xs focus-visible:ring-1 focus-visible:ring-purple-500"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-gray-300 text-xs">Table Comment</Label>
                                                    <Input
                                                        value={comment}
                                                        onChange={(e) => onCommentChange?.(e.target.value)}
                                                        placeholder="Optional description"
                                                        className="bg-black/20 border-white/10 h-9 text-xs focus-visible:ring-1 focus-visible:ring-purple-500"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
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
        </div >
    );
}
