import { getSessionId, api } from '@/api/client';
import React, { useState, useEffect } from 'react';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ResponsiveDraggableDialog } from '@/components/common/ResponsiveDraggableDialog';
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
import { useWorkspaceStore, genTabId } from '@/stores/workspace';
import { useNavigate } from 'react-router-dom';

interface ImportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    database: string;
}

export type ImportMode = 'create' | 'append';

const TABLE_NAME_REGEX = /^[a-zA-Z0-9_]*$/;

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
    const { addTab } = useWorkspaceStore();
    const navigate = useNavigate();

    // Fetch schema for existing table to validate mappings
    const isTableExisting = databases.find(db => db.name === selectedDb)?.children?.some(t => t.name === tableName) ?? false;

    // We import this at the top:
    // import { useDatabases, useTableSchema } from '@/hooks';

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

    const handleViewTable = () => {
        if (!selectedDb || !tableName) return;
        addTab({
            id: genTabId(),
            title: `Query ${tableName}`,
            type: 'sql',
            content: `SELECT * FROM \`${selectedDb}\`.\`${tableName}\` LIMIT 10`,
            isDirty: false,
        });
        navigate('/explorer');
        handleClose();
    };

    const handleTryAgain = () => {
        setStep('preview');
        setImportStatus(null);
        setErrorDetails(null);
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

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setTableName(selectedFile.name.split('.')[0].replace(/[^a-zA-Z0-9_]/g, '_'));
    };

    const handleRemoveFile = () => {
        setFile(null);
        setColumns([]);
        setPreviewData([]);
    };

    const handleContinueFromUpload = async () => {
        if (!file) return;
        await analyzeFile(file, hasHeader);
    };

    const handleHasHeaderChange = async (checked: boolean) => {
        setHasHeader(checked);
        if (step === 'preview' && file) {
            await analyzeFile(file, checked);
        }
    };

    const handleColumnChange = (index: number, field: keyof ColumnDefinition, value: any) => {
        const newCols = [...columns];
        newCols[index] = { ...newCols[index], [field]: value };
        setColumns(newCols);
    };

    const handleColumnsChange = (newColumns: ColumnDefinition[]) => {
        setColumns(newColumns);
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

    const stepOrder = ['upload', 'preview', 'progress'] as const;
    const currentStepIndex = stepOrder.indexOf(step) + 1;
    const stepProgressPercent = (currentStepIndex / STEPS.length) * 100;

    const dialogTitle = (
        <DialogHeader className="p-0 border-0 flex-none min-w-0" aria-label="Import wizard">
            <div className="flex items-center gap-4 min-w-0">
                <div className="flex items-center gap-2 min-w-0 shrink">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400" aria-hidden>
                        <FileUp className="h-4 w-4" />
                    </div>
                    <DialogTitle className="text-base font-semibold text-white truncate">Import data</DialogTitle>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {STEPS.map((s, i) => (
                        <span
                            key={s.id}
                            className={cn(
                                "h-1.5 w-1.5 rounded-full transition-colors",
                                i + 1 === currentStepIndex ? "bg-emerald-400" : i + 1 < currentStepIndex ? "bg-emerald-400/60" : "bg-white/20"
                            )}
                            aria-hidden
                        />
                    ))}
                </div>
                <div className="flex-1 min-w-0 flex justify-end">
                    <Select value={selectedDb} onValueChange={setSelectedDb}>
                        <SelectTrigger className="h-8 w-[130px] text-xs bg-white/5 border-white/10 text-gray-300 focus:ring-1 focus:ring-emerald-500/50 rounded-lg">
                            <DatabaseIcon className="h-3.5 w-3.5 text-gray-500 mr-1.5 shrink-0" />
                            <SelectValue placeholder="Database" />
                        </SelectTrigger>
                        <SelectContent className="z-[100] border-white/10 bg-gray-900 text-gray-300">
                            {databases.map(db => (
                                <SelectItem key={db.name} value={db.name} className="focus:bg-emerald-500/15 focus:text-emerald-400 text-sm">
                                    {db.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </DialogHeader>
    );

    return (
        <ResponsiveDraggableDialog
            open={isOpen}
            onOpenChange={(open) => { if (!open) handleClose(); }}
            dialogId="uploadFile"
            title={dialogTitle}
            windowClassName="rounded-2xl border border-white/10 bg-gray-900 text-white shadow-2xl shadow-black/40"
            headerClassName="px-5 py-3 border-b border-white/10 bg-gray-900/80"
            footerClassName="px-5 py-4 border-t border-white/10 bg-gray-900/95"
            closeButtonClassName="text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"
            contentClassName="bg-gray-900 text-gray-100"
            footer={
                <DialogFooter className="p-0 border-0 bg-transparent gap-3 flex-wrap sm:flex-nowrap">
                    {step === 'upload' && (
                        <Button variant="ghost" className="text-gray-400 hover:text-white hover:bg-white/10" onClick={handleClose} aria-label="Cancel">
                            Cancel
                        </Button>
                    )}
                    {step === 'preview' && (
                        <>
                            <Button variant="ghost" onClick={reset} className="text-gray-400 hover:text-white hover:bg-white/10 gap-2 order-2 sm:order-1" aria-label="Back">
                                <ChevronRight className="h-4 w-4 rotate-180" /> Back
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={!tableName || !selectedDb || columns.length === 0 || (tableName.length > 0 && !TABLE_NAME_REGEX.test(tableName))}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 order-1 sm:order-2 flex-1 sm:flex-initial min-w-[120px]"
                                aria-label="Import data"
                            >
                                Import <ChevronRight className="h-4 w-4" />
                            </Button>
                        </>
                    )}
                </DialogFooter>
            }
        >
            <div
                className="flex-1 min-h-0 overflow-auto relative bg-gray-900"
                role="region"
                aria-label={step === 'upload' ? 'Upload file' : step === 'preview' ? 'Preview schema' : 'Import progress'}
            >
                    {step === 'upload' && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            className="w-full flex flex-col"
                        >
                            <StepUpload
                                file={file}
                                onFileSelect={handleFileSelect}
                                onRemoveFile={handleRemoveFile}
                                onContinue={handleContinueFromUpload}
                                hasHeader={hasHeader}
                                onHasHeaderChange={handleHasHeaderChange}
                                isAnalyzing={isAnalyzing}
                            />
                            {isAnalyzing && (
                                <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-10" aria-live="polite" aria-busy="true">
                                    <div className="flex flex-col items-center gap-4 rounded-xl bg-gray-800/90 border border-white/10 px-8 py-6">
                                        <div className="h-10 w-10 rounded-full border-2 border-emerald-500/40 border-t-emerald-400 animate-spin" />
                                        <p className="text-sm text-gray-300">Analyzing file…</p>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                    {step === 'preview' && (
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="min-h-full"
                        >
                            <StepPreview
                                fileName={file?.name}
                                importMode={importMode}
                                onImportModeChange={setImportMode}
                                selectedDb={selectedDb}
                                columns={columns}
                                previewData={previewData}
                                tableName={tableName}
                                onTableNameChange={setTableName}
                                onColumnChange={handleColumnChange}
                                onColumnsChange={handleColumnsChange}
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
                            className="min-h-full"
                        >
                            <StepProgress
                                status={importStatus as any}
                                error={errorDetails}
                                database={selectedDb}
                                tableName={tableName}
                                onClose={handleClose}
                                onViewTable={handleViewTable}
                                onTryAgain={handleTryAgain}
                            />
                        </motion.div>
                    )}
                </div>
        </ResponsiveDraggableDialog>
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
