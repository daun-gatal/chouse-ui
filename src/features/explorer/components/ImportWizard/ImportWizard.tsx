import { getSessionId, api } from '@/api/client';
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { StepUpload } from './StepUpload';
import { StepPreview, ColumnDefinition } from './StepPreview';
import { StepProgress } from './StepProgress';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, ChevronRight, Upload, Table2, CheckCircle2, Database as DatabaseIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useDatabases } from '@/hooks';

interface ImportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    database: string;
}

export type ImportMode = 'create' | 'append';

const STEPS = [
    { id: 'upload', label: 'Upload File', icon: Upload },
    { id: 'preview', label: 'Preview Schema', icon: Table2 },
    { id: 'progress', label: 'Import Data', icon: CheckCircle2 },
] as const;

export const ENGINES = [
    { value: "MergeTree", label: "MergeTree", description: "Default engine for analytics", requiresOrderBy: true },
    { value: "ReplacingMergeTree", label: "ReplacingMergeTree", description: "Deduplicates by ORDER BY", requiresOrderBy: true },
    { value: "SummingMergeTree", label: "SummingMergeTree", description: "Pre-aggregates numeric columns", requiresOrderBy: true },
    { value: "AggregatingMergeTree", label: "AggregatingMergeTree", description: "Stores aggregate states", requiresOrderBy: true },
    { value: "CollapsingMergeTree", label: "CollapsingMergeTree", description: "For collapsing rows", requiresOrderBy: true },
    { value: "Log", label: "Log", description: "Simple append-only", requiresOrderBy: false },
    { value: "TinyLog", label: "TinyLog", description: "Minimal storage", requiresOrderBy: false },
    { value: "Memory", label: "Memory", description: "In-memory only", requiresOrderBy: false },
];

export function ImportWizard({ isOpen, onClose, database }: ImportWizardProps) {
    const [step, setStep] = useState<'upload' | 'preview' | 'progress'>('upload');
    const [importMode, setImportMode] = useState<ImportMode>('create');
    const [file, setFile] = useState<File | null>(null);
    const [columns, setColumns] = useState<ColumnDefinition[]>([]);
    const [previewData, setPreviewData] = useState<any[]>([]);

    // Advanced settings state
    const [engine, setEngine] = useState('MergeTree');
    const [orderByColumns, setOrderByColumns] = useState<string[]>([]);
    const [partitionBy, setPartitionBy] = useState('');
    const [ttlExpression, setTtlExpression] = useState('');
    const [comment, setComment] = useState('');

    // Database selection state
    const { data: databases = [] } = useDatabases();
    const [selectedDb, setSelectedDb] = useState(database);

    const [tableName, setTableName] = useState('');
    const [importStatus, setImportStatus] = useState<'uploading' | 'creating_table' | 'success' | 'error' | null>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const queryClient = useQueryClient();

    // Sync prop changes to state
    useEffect(() => {
        if (isOpen) {
            if (database) {
                setSelectedDb(database);
            } else if (databases.length > 0) {
                // Only set default if no database is selected OR if the current selection is invalid
                setSelectedDb(current => current || databases[0].name);
            }
        }
    }, [isOpen, database, databases]);

    const reset = () => {
        setStep('upload');
        setImportMode('create');
        setFile(null);
        setColumns([]);
        setPreviewData([]);
        setTableName('');
        setImportStatus(null);
        setErrorDetails(null);
        setEngine('MergeTree');
        setOrderByColumns([]);
        setPartitionBy('');
        setTtlExpression('');
        setComment('');
    };

    const handleClose = () => {
        if (importStatus === 'uploading' || importStatus === 'creating_table') {
            return; // Prevent closing while busy
        }
        reset();
        onClose();
    };

    const normalizeColumnName = (name: string) => {
        return name
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')      // Replace whitespace with underscore
            .replace(/[^a-z0-9_]/g, ''); // Remove other special chars
    };

    const [hasHeader, setHasHeader] = useState(true);

    const analyzeFile = async (selectedFile: File, headerBool: boolean) => {
        setIsAnalyzing(true);
        const formData = new FormData();
        formData.append('file', selectedFile);

        // Detect format
        let format = 'CSV';
        if (selectedFile.name.toLowerCase().endsWith('.tsv')) format = 'TSV';
        else if (selectedFile.name.toLowerCase().endsWith('.json')) format = 'JSON';

        formData.append('format', format);
        formData.append('hasHeader', String(headerBool));

        try {
            const response = await fetch('/api/upload/preview', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`Preview failed: ${response.statusText}`);
            }

            const result = await response.json();
            if (!result.success) throw new Error(result.error?.message || 'Preview failed');

            // Normalize column names
            const normalizedColumns = result.data.columns.map((col: any) => ({
                ...col,
                name: normalizeColumnName(col.name),
                mappedTo: normalizeColumnName(col.name)
            }));

            setColumns(normalizedColumns);
            setPreviewData(result.data.preview);
            setStep('preview');
        } catch (err) {
            toast.error('Failed to analyze file', { description: String(err) });
            // Don't reset file here if it's just a toggle change failing
            if (step === 'upload') setFile(null);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setTableName(selectedFile.name.split('.')[0].replace(/[^a-zA-Z0-9_]/g, '_'));
        await analyzeFile(selectedFile, hasHeader);
    };

    const handleHasHeaderChange = async (checked: boolean) => {
        setHasHeader(checked);
        if (file) {
            await analyzeFile(file, checked);
        }
    };

    const handleColumnChange = (index: number, field: keyof ColumnDefinition, value: any) => {
        const newCols = [...columns];
        newCols[index] = { ...newCols[index], [field]: value };
        setColumns(newCols);
    };

    const handleToggleOrderBy = (columnName: string) => {
        if (orderByColumns.includes(columnName)) {
            setOrderByColumns(orderByColumns.filter(c => c !== columnName));
        } else {
            setOrderByColumns([...orderByColumns, columnName]);
        }
    };

    const handleImport = async () => {
        if (!file || !tableName || !selectedDb) return;

        if (importMode === 'create') {
            const selectedEngine = ENGINES.find(e => e.value === engine);
            if (selectedEngine?.requiresOrderBy && orderByColumns.length === 0) {
                toast.error(`${engine} engine requires at least one ORDER BY column`);
                return;
            }
        }

        setStep('progress');
        setImportStatus('creating_table');
        setErrorDetails(null);

        try {
            if (importMode === 'create') {
                // 1. Create Table via Query API
                const createTableQuery = generateCreateTableQuery(
                    selectedDb,
                    tableName,
                    columns,
                    engine,
                    orderByColumns,
                    partitionBy,
                    ttlExpression,
                    comment
                );

                // Use api client which handles session and RBAC headers automatically
                await api.post('/query/execute', { query: createTableQuery });
            }

            // 2. Upload Data
            setImportStatus('uploading');

            // Detect format for upload
            let format = 'CSV';
            if (file.name.toLowerCase().endsWith('.tsv')) format = 'TSV';
            else if (file.name.toLowerCase().endsWith('.json')) format = 'JSON';

            let uploadUrl = `/api/upload/create?database=${encodeURIComponent(selectedDb)}&table=${encodeURIComponent(tableName)}&format=${format}&hasHeader=${hasHeader}`;

            if (importMode === 'append') {
                const mappedColumns = columns
                    .filter(c => c.mappedTo)
                    .map(c => c.mappedTo);

                if (mappedColumns.length > 0) {
                    uploadUrl += `&columns=${encodeURIComponent(mappedColumns.join(','))}`;
                }
            }

            const session = getSessionId();
            const rbacToken = localStorage.getItem('rbac_access_token');

            const uploadHeaders: Record<string, string> = {
                'X-Requested-With': 'XMLHttpRequest'
            };

            if (session) {
                uploadHeaders['x-clickhouse-session-id'] = session;
                uploadHeaders['X-Session-ID'] = session;
            }

            if (rbacToken) {
                uploadHeaders['Authorization'] = `Bearer ${rbacToken}`;
            }

            const uploadRes = await fetch(uploadUrl, {
                method: 'POST',
                headers: uploadHeaders,
                body: file
            });

            if (!uploadRes.ok) {
                const err = await uploadRes.json();
                throw new Error(err.error?.message || 'Failed to upload data');
            }

            setImportStatus('success');
            queryClient.invalidateQueries({ queryKey: ['tables', selectedDb] });

        } catch (err: any) {
            setImportStatus('error');
            setErrorDetails(err.message || String(err));
        }
    };

    // Helper to check if step is active or completed
    const getStepState = (stepId: string) => {
        const stepOrder = ['upload', 'preview', 'progress'];
        const currentIndex = stepOrder.indexOf(step);
        const stepIndex = stepOrder.indexOf(stepId);

        if (stepIndex < currentIndex) return 'completed';
        if (stepIndex === currentIndex) return 'active';
        return 'pending';
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950 border-white/10">
                <DialogHeader className="p-6 pb-4 border-b border-white/10 flex-none space-y-4">
                    <DialogTitle className="flex items-center gap-3 text-xl font-normal text-white">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-white/10 shadow-inner">
                            <FileUp className="h-5 w-5 text-blue-400 shadow-sm" />
                        </div>
                        <div className="flex flex-col">
                            <span>Import Data</span>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm font-normal text-gray-400">Target Database:</span>
                                <Select value={selectedDb} onValueChange={setSelectedDb}>
                                    <SelectTrigger className="h-7 w-[180px] text-xs bg-white/5 border-white/10 text-gray-300 focus:ring-1 focus:ring-blue-500/50">
                                        <SelectValue placeholder="Select Database" />
                                    </SelectTrigger>
                                    <SelectContent className="z-[100] border-white/10 bg-gray-900 text-gray-300">
                                        {databases.map(db => (
                                            <SelectItem key={db.name} value={db.name} className="focus:bg-blue-500/20 focus:text-blue-400">
                                                <div className="flex items-center gap-2">
                                                    <DatabaseIcon className="w-3 h-3 text-blue-400" />
                                                    <span>{db.name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </DialogTitle>

                    {/* Stepper */}
                    <div className="flex items-center gap-2 pt-2">
                        {STEPS.map((s, i) => {
                            const state = getStepState(s.id);
                            return (
                                <div key={s.id} className="flex items-center">
                                    <div className={cn(
                                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors",
                                        state === 'active' && "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20",
                                        state === 'completed' && "text-green-400",
                                        state === 'pending' && "text-gray-600"
                                    )}>
                                        <s.icon className={cn("w-4 h-4",
                                            state === 'active' && "animate-pulse",
                                            state === 'completed' && "text-green-400"
                                        )} />
                                        <span className="font-medium">{s.label}</span>
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className="w-8 h-[1px] bg-white/10 mx-2" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-hidden relative">
                    {step === 'upload' && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            className="h-full"
                        >
                            <StepUpload onFileSelect={handleFileSelect} />
                            {isAnalyzing && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10 transition-all">
                                    <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-gray-900 border border-white/10 shadow-2xl">
                                        <div className="relative">
                                            <div className="w-12 h-12 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                            </div>
                                        </div>
                                        <p className="text-gray-300 font-medium">Analyzing file structure...</p>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                    {step === 'preview' && (
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="h-full"
                        >
                            <StepPreview
                                importMode={importMode}
                                onImportModeChange={setImportMode}
                                selectedDb={selectedDb}
                                columns={columns}
                                previewData={previewData}
                                tableName={tableName}
                                onTableNameChange={setTableName}
                                onColumnChange={handleColumnChange}
                                hasHeader={hasHeader}
                                onHasHeaderChange={handleHasHeaderChange}
                                format={file?.name.toLowerCase().endsWith('.json') ? 'JSON' :
                                    file?.name.toLowerCase().endsWith('.tsv') ? 'TSV' : 'CSV'}
                                engine={engine}
                                orderByColumns={orderByColumns}
                                onToggleOrderBy={handleToggleOrderBy}
                                onEngineChange={setEngine}
                                partitionBy={partitionBy}
                                onPartitionByChange={setPartitionBy}
                                ttlExpression={ttlExpression}
                                onTtlExpressionChange={setTtlExpression}
                                comment={comment}
                                onCommentChange={setComment}
                            />
                        </motion.div>
                    )}
                    {step === 'progress' && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="h-full"
                        >
                            <StepProgress
                                status={importStatus as any}
                                error={errorDetails}
                                onClose={handleClose}
                                onReset={reset}
                            />
                        </motion.div>
                    )}
                </div>

                <DialogFooter className="p-6 pt-4 border-t border-white/10 bg-black/20 backdrop-blur-sm">
                    {step === 'upload' && (
                        <Button variant="ghost" className="text-gray-400 hover:text-white hover:bg-white/5" onClick={handleClose}>
                            Cancel
                        </Button>
                    )}
                    {step === 'preview' && (
                        <div className="flex w-full justify-between items-center">
                            <Button variant="ghost" onClick={reset} className="text-gray-400 hover:text-white hover:bg-white/5 gap-2">
                                <ChevronRight className="w-4 h-4 rotate-180" /> Back
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={!tableName || !selectedDb || columns.length === 0}
                                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg shadow-blue-900/20"
                            >
                                Import Data <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function generateCreateTableQuery(
    db: string,
    table: string,
    columns: ColumnDefinition[],
    engine: string,
    orderByColumns: string[],
    partitionBy: string,
    ttlExpression: string,
    comment: string
): string {
    const colDefs = columns.map(c => {
        let type = c.type;
        if (c.nullable) type = `Nullable(${type})`;
        let def = `\`${c.name}\` ${type}`;
        if (c.description) {
            def += ` COMMENT '${c.description.replace(/'/g, "\\'")}'`;
        }
        return def;
    }).join(',\n  ');

    let query = `CREATE TABLE \`${db}\`.\`${table}\` (
  ${colDefs}
) ENGINE = ${engine}`;

    const selectedEngine = ENGINES.find(e => e.value === engine);
    if (selectedEngine?.requiresOrderBy && orderByColumns.length > 0) {
        query += `\nORDER BY (${orderByColumns.map(c => `\`${c}\``).join(', ')})`;
    } else if (engine === 'MergeTree' && orderByColumns.length === 0) {
        query += `\nORDER BY tuple()`;
    }

    if (partitionBy) {
        query += `\nPARTITION BY ${partitionBy}`;
    }

    if (ttlExpression) {
        query += `\nTTL ${ttlExpression}`;
    }

    if (comment) {
        query += `\nCOMMENT '${comment.replace(/'/g, "\\'")}'`;
    }

    return query;
}
