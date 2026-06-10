import React, { useState, useEffect, useRef } from 'react';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveDraggableDialog } from '@/components/common/ResponsiveDraggableDialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, Check, Copy, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import { optimizeQuery, optimizeQueryFromLog } from '@/api/query';
import { fetchAiModels, type AiModelOption, type QueryOptimization } from '@/api/ai';
import { OptimizationAnalysis } from '@/features/fleet/components/DoctorReportView';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { log } from '@/lib/log';
import { useWindowSize } from '@/hooks/useWindowSize';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffEditor } from './DiffEditor';
import ReactMarkdown from 'react-markdown';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface OptimizeQueryDialogProps {
    isOpen: boolean;
    onClose: () => void;
    query: string;
    database?: string;
    onAccept: (optimizedQuery: string) => void;
    initialResult?: QueryOptimization | null;
    autoStart?: boolean;
    initialPrompt?: string;
    /**
     * When set, the dialog runs in "log mode": it optimizes the full query
     * resolved from system.query_log by this id (capability optimize-log) and
     * renders the richer cause/tables/EXPLAIN analysis instead of the
     * explanation/tips view. Used by Query Logs.
     */
    queryId?: string;
    /** Label for the accept button (e.g. "Open in Explorer" from Query Logs). */
    acceptLabel?: string;
}

const DEFAULT_OPTIMIZATION_PROMPT = "Explain your changes deeply using markdown, summarize the improvements in one line, and provide a list of performance tips. Focus on index usage, partition pruning, and efficient data retrieval.";

export function OptimizeQueryDialog({
    isOpen,
    onClose,
    query,
    database,
    onAccept,
    initialResult,
    autoStart = false,
    initialPrompt,
    queryId,
    acceptLabel = 'Apply Changes',
}: OptimizeQueryDialogProps) {
    const isLogMode = Boolean(queryId);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [result, setResult] = useState<QueryOptimization | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [additionalPrompt, setAdditionalPrompt] = useState(initialPrompt || DEFAULT_OPTIMIZATION_PROMPT);
    const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const { breakpoint } = useWindowSize();
    const isNarrow = breakpoint === 'mobile' || breakpoint === 'tablet';

    // Fetch AI Models
    useEffect(() => {
        if (isOpen) {
            fetchAiModels().then(models => {
                setAiModels(models);
                const defaultModel = models.find(m => m.isDefault);
                if (defaultModel) {
                    setSelectedModelId(defaultModel.id);
                } else if (models.length > 0) {
                    setSelectedModelId(models[0].id);
                }
            }).catch((e) => log.error('Failed to fetch AI models', e));
        }
    }, [isOpen]);



    // Reset or Initialize when dialog opens
    useEffect(() => {
        if (isOpen) {
            if (initialResult) {
                setResult(initialResult);
            } else {
                setResult(null);
            }
            setError(null);

            // Respect initialPrompt if provided, otherwise default
            if (initialPrompt) {
                setAdditionalPrompt(initialPrompt + "\n\n" + DEFAULT_OPTIMIZATION_PROMPT);
            } else {
                setAdditionalPrompt(DEFAULT_OPTIMIZATION_PROMPT);
            }

            setIsOptimizing(false);
        } else {
            // Cleanup on close
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        }
    }, [isOpen, initialResult, initialPrompt]);

    // Auto-start optimization if requested
    useEffect(() => {
        if (isOpen && autoStart && !result && !isOptimizing && !initialResult) {
            handleOptimize();
        }
    }, [isOpen, autoStart, result, isOptimizing, initialResult]);

    const handleOptimize = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsOptimizing(true);
        // We keep the previous result visible while optimizing for better UX, or clear it?
        // Let's clear it to show we are working on new data, or keep it as "stale"?
        // Clearing is safer to avoid confusion.
        setResult(null);
        setError(null);

        try {
            // Both capabilities return the same unified QueryOptimization shape; use
            // the AI's SQL as-is (already pretty + valid) — never client-reformat, as
            // sql-formatter's keywordCase:"upper" breaks case-sensitive CH identifiers.
            const response = (isLogMode && queryId)
                // Query Logs path — backend pulls the full query by id (optimize-log).
                ? await optimizeQueryFromLog(queryId, selectedModelId || undefined, controller.signal)
                : await optimizeQuery(query, database, additionalPrompt, selectedModelId || undefined, controller.signal);
            setResult(response);
        } catch (error: any) {
            if (error.name === 'CanceledError' || error.name === 'AbortError') return;
            setError(error.message || 'Optimization failed');
        } finally {
            if (abortControllerRef.current === controller) {
                setIsOptimizing(false);
                abortControllerRef.current = null;
            }
        }
    };

    const handleAccept = () => {
        if (result) {
            onAccept(result.optimizedQuery);
            toast.success('Query optimized successfully');
            onClose();
        }
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        onClose();
    };

    // Auto-optimize on first open if no result
    useEffect(() => {
        if (isOpen && !result && !isOptimizing && query?.trim()) {
            // Optional: Auto-start optimization?
            // handleOptimize();
            // Let's wait for user to click "Optimize" to allow them to adjust prompt first?
            // Or maybe just run it. The previous implementation had it commented out.
            // Let's stick to manual trigger for now to give users control over the prompt.
        }
    }, [isOpen]);

    const dialogTitle = (
        <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-9 w-9 place-items-center rounded-xs border border-brand/40 bg-brand/5 text-brand shrink-0" aria-hidden>
                    <Sparkles className="w-4 h-4" />
                </span>
                <DialogHeader className="space-y-0.5 min-w-0">
                    <DialogTitle className="text-[16px] font-semibold tracking-tight text-paper">
                        AI Query Optimizer
                    </DialogTitle>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                        Optimize ClickHouse queries with intelligent analysis
                    </p>
                </DialogHeader>
            </div>
            {!isOptimizing && result && (
                <div className="hidden sm:flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-1.5 shrink-0">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Model</span>
                    <span className="text-[11px] font-medium text-paper truncate max-w-[120px]">{aiModels.find(m => m.id === selectedModelId)?.label || 'AI Model'}</span>
                </div>
            )}
        </div>
    );

    return (
        <ResponsiveDraggableDialog
            open={isOpen}
            onOpenChange={(open) => { if (!open) handleCancel(); }}
            dialogId="aiOptimizer"
            title={dialogTitle}
            windowClassName="rounded-xs border border-ink-500 bg-ink-100 text-paper shadow-xl"
            headerClassName="px-6 py-4 border-b border-ink-500 bg-ink-100"
            footerClassName="px-6 py-4 border-t border-ink-500 bg-ink-100"
            closeButtonClassName="text-paper-dim hover:text-paper hover:bg-ink-200 rounded-xs -mr-1"
            contentClassName="bg-ink-100 text-paper"
            footer={
                <DialogFooter className="px-0 py-0 border-0 bg-transparent">
                    <Button
                        variant="outline"
                        onClick={handleCancel}
                        className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                    >
                        Close
                    </Button>
                    {result && (
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    navigator.clipboard.writeText(result.optimizedQuery);
                                    toast.success('Copied to clipboard');
                                }}
                                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                            >
                                <Copy className="w-3.5 h-3.5" />
                                Copy Code
                            </Button>
                            <Button
                                onClick={handleAccept}
                                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                            >
                                <Check className="w-3.5 h-3.5" />
                                {acceptLabel}
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            }
        >
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col bg-ink-100">
                <ResizablePanelGroup direction={isNarrow ? "vertical" : "horizontal"} className="flex-1 min-h-0 min-w-0">

                        {/* Left Panel: Diff Editor */}
                        <ResizablePanel defaultSize={65} minSize={25} className="bg-ink-200 flex flex-col min-h-0 min-w-0">
                            <div className="flex-1 relative min-h-0 min-w-0">
                                {result ? (
                                    <DiffEditor
                                        original={result.originalQuery || query}
                                        modified={result.optimizedQuery}
                                        language="sql"
                                        className="absolute inset-0"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center bg-ink-100">
                                        {isOptimizing ? (
                                            <div className="flex flex-col items-center gap-4 text-center p-8">
                                                <div className="grid h-12 w-12 place-items-center rounded-xs border border-brand/40 bg-brand/5">
                                                    <Loader2 className="w-5 h-5 text-brand animate-spin" />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-[14px] font-semibold text-paper tracking-tight">Analyzing Query Structure</h3>
                                                    <p className="text-[12px] text-paper-muted max-w-xs">
                                                        Examining schema, indexes, and execution plan to find improvements.
                                                    </p>
                                                </div>
                                            </div>
                                        ) : error ? (
                                            <div className="text-center p-8 max-w-md">
                                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xs border border-red-900/60 bg-red-950/40 mb-4">
                                                    <AlertCircle className="w-5 h-5 text-red-300" />
                                                </div>
                                                <h3 className="text-[14px] font-semibold text-paper mb-2 tracking-tight">Optimization Failed</h3>
                                                <p className="text-[12px] text-paper-muted mb-6">{error}</p>
                                                <Button
                                                    onClick={handleOptimize}
                                                    className="h-9 gap-2 rounded-xs border border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                                                >
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                    Retry Optimization
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 max-w-md">
                                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xs border border-brand/40 bg-brand/5 mb-4">
                                                    <Sparkles className="w-5 h-5 text-brand" />
                                                </div>
                                                <h3 className="text-[14px] font-semibold text-paper mb-2 tracking-tight">Ready to Optimize</h3>
                                                <p className="text-[12px] text-paper-muted mb-6">
                                                    Click "Optimize Query" to analyze your SQL and get performance recommendations.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Right Panel: Controls & Analysis */}
                        <ResizablePanel defaultSize={35} minSize={25} className="bg-ink-100 flex flex-col border-l border-ink-500 min-h-0 min-w-0">
                            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">

                                {/* Controls Section */}
                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                            AI Model
                                        </Label>
                                        <Select
                                            value={selectedModelId}
                                            onValueChange={(value) => setSelectedModelId(value)}
                                        >
                                            <SelectTrigger className="w-full h-10 rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper focus-visible:border-brand focus-visible:ring-0 transition-colors">
                                                <SelectValue placeholder="Select an AI Model" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                                                {aiModels.length === 0 ? (
                                                    <div className="p-4 text-center text-[12px] text-paper-dim">
                                                        No AI models configured.<br />Please add one in the Admin UI.
                                                    </div>
                                                ) : (
                                                    aiModels.map(m => (
                                                        <SelectItem key={m.id} value={m.id} className="focus:bg-ink-200 focus:text-paper cursor-pointer py-2 rounded-xs mx-1 my-0.5">
                                                            <div className="flex flex-col gap-0.5 text-left">
                                                                <span className="font-medium text-[12px] text-paper">{m.label}</span>
                                                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim leading-none">{m.provider || 'AI Provider'}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {!isLogMode && (
                                        <div className="space-y-2">
                                            <Label htmlFor="prompt" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                                Optimization Goal
                                            </Label>
                                            <Textarea
                                                id="prompt"
                                                value={additionalPrompt}
                                                onChange={(e) => setAdditionalPrompt(e.target.value)}
                                                placeholder="Specific instructions (e.g., 'Use PREWHERE', 'Avoid JOINs')..."
                                                className="rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper placeholder:text-paper-faint min-h-[80px] focus-visible:border-brand focus-visible:ring-0 transition-colors"
                                            />
                                        </div>
                                    )}

                                    <Button
                                        onClick={handleOptimize}
                                        disabled={isOptimizing}
                                        className={cn(
                                            "w-full h-10 gap-2 rounded-xs font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
                                            isOptimizing
                                                ? "bg-ink-200 text-paper-muted border border-ink-500"
                                                : "bg-brand text-ink-50 hover:bg-brand-soft"
                                        )}
                                    >
                                        {isOptimizing ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                Optimizing
                                            </>
                                        ) : (
                                            <>
                                                {result ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                                                {result ? "Re-Optimize" : "Optimize Query"}
                                            </>
                                        )}
                                    </Button>
                                </div>

                                {/* Analysis Results */}
                                {result && (
                                    <div className="space-y-6">

                                        {/* Log-mode context chip (peak memory / user) */}
                                        {(result.peakMemory || result.user) && (
                                            <div className="flex flex-wrap items-center gap-2">
                                                {result.peakMemory && (
                                                    <span className="rounded-xs border border-red-500/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-red-700 dark:text-red-400">
                                                        {result.peakMemory}
                                                    </span>
                                                )}
                                                {result.user && <span className="font-mono text-[10px] text-paper-faint">{result.user}</span>}
                                            </div>
                                        )}

                                        {/* Richer analysis (cause / tables / suggestions / EXPLAIN estimate) — log mode */}
                                        {(result.cause || result.tables?.length || result.suggestions?.length || result.estimate) && (
                                            <OptimizationAnalysis
                                                cause={result.cause}
                                                tables={result.tables}
                                                suggestions={result.suggestions}
                                                estimate={result.estimate}
                                            />
                                        )}

                                        {/* Summary Card */}
                                        {result.summary && (
                                        <div className="rounded-xs border border-brand/40 bg-brand/5 p-4 space-y-2">
                                            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                                <Sparkles className="w-3.5 h-3.5" />
                                                <span>Summary</span>
                                            </div>
                                            <p className="text-[13px] text-paper leading-relaxed">
                                                {result.summary}
                                            </p>
                                        </div>
                                        )}

                                        {/* Detailed Explanation */}
                                        {result.explanation && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                                <FileText className="w-3.5 h-3.5" />
                                                Changes Explanation
                                            </div>
                                            <div className="prose prose-invert prose-sm max-w-none text-[13px] text-paper-muted leading-relaxed">
                                                <ReactMarkdown components={{
                                                    h1: ({ node, ...props }) => <h1 className="text-[16px] font-semibold text-paper mt-4 mb-2" {...props} />,
                                                    h2: ({ node, ...props }) => <h2 className="text-[14px] font-semibold text-paper mt-3 mb-2" {...props} />,
                                                    h3: ({ node, ...props }) => <h3 className="text-[13px] font-semibold text-paper mt-3 mb-1" {...props} />,
                                                    p: ({ node, ...props }) => <p className="text-[13px] text-paper-muted leading-relaxed mb-3 last:mb-0" {...props} />,
                                                    ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1" {...props} />,
                                                    ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1" {...props} />,
                                                    li: ({ node, ...props }) => <li className="text-[13px] text-paper-muted marker:text-brand/60" {...props} />,
                                                    strong: ({ node, ...props }) => <strong className="text-paper font-semibold" {...props} />,
                                                    code({ node, className, children, ...props }) {
                                                        const match = /language-(\w+)/.exec(className || '')
                                                        return match ? (
                                                            <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 text-paper font-mono text-[12px]" {...props}>
                                                                {children}
                                                            </code>
                                                        ) : (
                                                            <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 text-paper font-mono text-[12px]" {...props}>
                                                                {children}
                                                            </code>
                                                        )
                                                    }
                                                }}>
                                                    {result.explanation}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </ResponsiveDraggableDialog>
    );
}
