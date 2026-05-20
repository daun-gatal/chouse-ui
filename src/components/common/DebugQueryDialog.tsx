import React, { useState, useEffect, useRef } from 'react';
import { DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveDraggableDialog } from '@/components/common/ResponsiveDraggableDialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, Check, Copy, AlertCircle, RefreshCw, FileText, ArrowRight, Bug, Terminal } from 'lucide-react';
import { debugQuery } from '@/api/query';
import { getAiModels, type AiModelSimple } from '@/api/ai-chat';
import { toast } from 'sonner';
import { formatClickHouseSQL } from '@/lib/formatSql';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { log } from '@/lib/log';
import { DiffEditor } from './DiffEditor';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface DebugQueryDialogProps {
    isOpen: boolean;
    onClose: () => void;
    query: string;
    error: string;
    database?: string;
    onAccept: (fixedQuery: string) => void;
}

const DEFAULT_DEBUG_PROMPT = "";

export function DebugQueryDialog({
    isOpen,
    onClose,
    query,
    error: queryError,
    database,
    onAccept,
}: DebugQueryDialogProps) {
    const [isDebugging, setIsDebugging] = useState(false);
    const [result, setResult] = useState<{
        fixedQuery: string;
        explanation: string;
        summary: string;
        errorAnalysis: string;
        originalQuery: string;
    } | null>(null);
    const [apiError, setApiError] = useState<string | null>(null);
    const [additionalPrompt, setAdditionalPrompt] = useState(DEFAULT_DEBUG_PROMPT);
    const [aiModels, setAiModels] = useState<AiModelSimple[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);

    // Fetch AI Models
    useEffect(() => {
        if (isOpen) {
            getAiModels().then(models => {
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

    // Reset when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setResult(null);
            setApiError(null);
            setAdditionalPrompt(DEFAULT_DEBUG_PROMPT);
            setIsDebugging(false);
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        }
    }, [isOpen]);

    const handleDebug = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsDebugging(true);
        setResult(null);
        setApiError(null);

        try {
            const response = await debugQuery(query, queryError, database, additionalPrompt, selectedModelId || undefined, controller.signal);
            setResult({
                fixedQuery: formatClickHouseSQL(response.fixedQuery),
                explanation: response.explanation,
                summary: response.summary,
                errorAnalysis: response.errorAnalysis,
                originalQuery: response.originalQuery,
            });
        } catch (error: any) {
            if (error.name === 'CanceledError' || error.name === 'AbortError') return;
            setApiError(error.message || 'Debugging failed');
        } finally {
            if (abortControllerRef.current === controller) {
                setIsDebugging(false);
                abortControllerRef.current = null;
            }
        }
    };

    const handleAccept = () => {
        if (result) {
            onAccept(result.fixedQuery);
            toast.success('Fixed query applied');
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

    // Clean up on unmount or close
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const statusPill = result ? (
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-brand/40 bg-brand/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
            Fix Available
        </span>
    ) : apiError ? (
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-red-300 bg-red-50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            Failed
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-amber-900/60 bg-amber-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
            Analyzing
        </span>
    );

    const dialogTitle = (
        <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-9 w-9 place-items-center rounded-xs border border-brand/40 bg-brand/5 text-brand shrink-0" aria-hidden>
                    <Sparkles className="w-4 h-4" />
                </span>
                <div className="space-y-0.5 min-w-0">
                    <DialogTitle className="text-[16px] font-semibold tracking-tight text-paper">
                        Query Analysis
                    </DialogTitle>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                        {result ? "Issue found — fix ready" : "Analyzing query logic"}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
                {statusPill}
                {!isDebugging && result && (
                    <div className="hidden sm:flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Model</span>
                        <span className="text-[11px] font-medium text-paper truncate max-w-[120px]">{aiModels.find(m => m.id === selectedModelId)?.name || 'AI Model'}</span>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <ResponsiveDraggableDialog
            open={isOpen}
            onOpenChange={(open) => { if (!open) handleCancel(); }}
            dialogId="aiDebugger"
            title={dialogTitle}
            windowClassName="rounded-xs border border-ink-500 bg-ink-100 text-paper shadow-xl"
            headerClassName="px-6 py-4 border-b border-ink-500 bg-ink-100"
            footerClassName="px-6 py-4 border-t border-ink-500 bg-ink-100"
            closeButtonClassName="text-paper-dim hover:text-paper hover:bg-ink-200 rounded-xs -mr-1"
            contentClassName="bg-ink-100 text-paper"
            footer={
                <DialogFooter className="px-0 py-0 border-0 bg-transparent">
                    <div className="flex w-full items-center justify-between gap-2">
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                        >
                            Dismiss
                        </Button>
                        {result && (
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        navigator.clipboard.writeText(result.fixedQuery);
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
                                    Apply Fix
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogFooter>
            }
        >
            <div className="flex-1 overflow-y-auto p-8 relative h-full min-h-0 bg-ink-100">
                    <div className="max-w-4xl mx-auto space-y-8 relative">
                        {apiError ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                                <div className="max-w-md w-full rounded-xs border border-red-900/60 bg-red-950/40 p-4 text-left">
                                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        Analysis Failed
                                    </div>
                                    <p className="mt-2 text-[12px] text-red-200">
                                        {apiError}
                                    </p>
                                </div>
                                <Button
                                    onClick={handleDebug}
                                    className="h-9 gap-2 rounded-xs border border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Try Again
                                </Button>
                            </div>
                        ) : !result && !isDebugging ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-8">
                                <div className="space-y-4">
                                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-xs border border-brand/40 bg-brand/5 text-brand">
                                        <Bug className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-[18px] font-semibold text-paper tracking-tight">Debug this Query</h3>
                                    <p className="text-[12px] text-paper-muted max-w-md mx-auto leading-relaxed">Select an AI model to analyze your query for schema compliance, logic errors, and optimization opportunities.</p>
                                </div>

                                <div className="w-full max-w-lg space-y-5 text-left rounded-xs border border-ink-500 bg-ink-200 p-5">
                                    <div className="space-y-2">
                                        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Select AI Model</Label>
                                        <Select
                                            value={selectedModelId}
                                            onValueChange={(value) => setSelectedModelId(value)}
                                        >
                                            <SelectTrigger className="w-full h-10 rounded-xs border-ink-500 bg-ink-100 text-[12px] text-paper hover:bg-ink-200 focus-visible:border-brand focus-visible:ring-0 transition-colors">
                                                <SelectValue placeholder="Select an AI Model" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xs border-ink-500 bg-ink-100 max-h-[220px]">
                                                {aiModels.length === 0 ? (
                                                    <div className="p-4 text-center text-[12px] text-paper-dim">
                                                        No AI models configured.<br />Please add one in the Admin UI.
                                                    </div>
                                                ) : (
                                                    aiModels.map(m => (
                                                        <SelectItem key={m.id} value={m.id} className="focus:bg-ink-200 focus:text-paper cursor-pointer py-2 rounded-xs mx-1 my-0.5">
                                                            <div className="flex flex-col gap-0.5 text-left">
                                                                <span className="font-medium text-[12px] text-paper">{m.name}</span>
                                                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{m.provider || 'AI Provider'}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button
                                        onClick={handleDebug}
                                        className="w-full h-10 rounded-xs bg-brand font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                                        disabled={!selectedModelId || aiModels.length === 0}
                                    >
                                        <Sparkles className="w-3.5 h-3.5 mr-2" />
                                        Analyze Query
                                    </Button>
                                </div>
                            </div>
                        ) : !result && isDebugging ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                                <div className="grid h-12 w-12 place-items-center rounded-xs border border-brand/40 bg-brand/5">
                                    <Loader2 className="w-5 h-5 text-brand animate-spin" />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-[16px] font-semibold text-paper tracking-tight">Running Analysis</h3>
                                    <p className="text-[12px] text-paper-muted max-w-xs mx-auto">Checking schema compliance, logic errors, and optimization opportunities...</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* 1. Diagnosis Section */}
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        Diagnosis
                                    </div>
                                    <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-4 text-[13px] leading-relaxed text-red-100">
                                        {result?.errorAnalysis}
                                    </div>
                                </section>

                                {/* 2. Proposed Change (Diff editor) */}
                                <section className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                            <FileText className="w-3.5 h-3.5" />
                                            Proposed Change
                                        </div>
                                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                            Diff View
                                        </div>
                                    </div>
                                    <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-200">
                                        <DiffEditor
                                            original={query}
                                            modified={result?.fixedQuery || ''}
                                            language="sql"
                                            className="h-[320px] w-full"
                                            options={{
                                                renderSideBySide: false,
                                                minimap: { enabled: false },
                                                scrollBeyondLastLine: false,
                                                lineNumbers: "off",
                                                folding: false,
                                                padding: { top: 20, bottom: 20 },
                                                fontSize: 13,
                                            }}
                                        />
                                    </div>
                                </section>

                                {/* 3. Solution Summary */}
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                                        <Check className="w-3.5 h-3.5" />
                                        Why this fixes it
                                    </div>
                                    <div className="rounded-xs border border-emerald-900/60 bg-emerald-950/40 p-4 text-[13px] leading-relaxed text-emerald-100">
                                        {result?.summary}
                                    </div>
                                </section>

                                {/* 4. Technical Details (Accordion) */}
                                <section className="pt-2">
                                    <details className="group">
                                        <summary className="list-none flex items-center cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:text-paper transition-colors py-2">
                                            <div className="flex items-center gap-2">
                                                <ArrowRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                                <span>Technical Details</span>
                                            </div>
                                        </summary>
                                        <div className="mt-4 pl-4 border-l border-ink-500">
                                            <div className="prose prose-invert prose-sm max-w-none">
                                                <ReactMarkdown
                                                    components={{
                                                        h1: ({ node, ...props }) => <h1 className="text-[16px] font-semibold text-paper mt-6 mb-3 first:mt-0" {...props} />,
                                                        h2: ({ node, ...props }) => <h2 className="text-[14px] font-semibold text-paper mt-5 mb-2" {...props} />,
                                                        h3: ({ node, ...props }) => <h3 className="text-[13px] font-medium text-paper mt-4 mb-2" {...props} />,
                                                        p: ({ node, ...props }) => <p className="text-[13px] text-paper-muted leading-relaxed mb-4" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-5 mb-4 text-[13px] text-paper-muted space-y-1" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-5 mb-4 text-[13px] text-paper-muted space-y-1" {...props} />,
                                                        li: ({ node, ...props }) => <li className="pl-1 marker:text-brand/60" {...props} />,
                                                        strong: ({ node, ...props }) => <strong className="font-semibold text-paper" {...props} />,
                                                        code: ({ node, className, children, ...props }: any) => {
                                                            const match = /language-(\w+)/.exec(className || '');
                                                            const isInline = !match && !String(children).includes('\n');
                                                            return isInline ? (
                                                                <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[12px] text-paper" {...props}>
                                                                    {children}
                                                                </code>
                                                            ) : (
                                                                <div className="my-4 overflow-hidden rounded-xs border border-ink-500 bg-ink-200">
                                                                    {match && (
                                                                        <div className="flex items-center gap-2 border-b border-ink-500 bg-ink-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                                                            <Terminal className="w-3 h-3" />
                                                                            {match[1]}
                                                                        </div>
                                                                    )}
                                                                    <pre className="p-4 overflow-x-auto font-mono text-[12px] text-paper" {...props}>
                                                                        <code>{children}</code>
                                                                    </pre>
                                                                </div>
                                                            )
                                                        },
                                                        blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-brand/40 pl-4 italic text-[13px] text-paper-muted my-4 bg-ink-200 py-2 pr-2 rounded-r-xs" {...props} />,
                                                    }}
                                                >
                                                    {result?.explanation || ''}
                                                </ReactMarkdown>
                                            </div>

                                            {/* Context Input */}
                                            <div className="mt-8 pt-6 border-t border-ink-500">
                                                <div className="space-y-2">
                                                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Refine</Label>
                                                    <div className="relative">
                                                        <Textarea
                                                            value={additionalPrompt}
                                                            onChange={(e) => setAdditionalPrompt(e.target.value)}
                                                            placeholder="Ask a question to refine this result..."
                                                            className="rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper placeholder:text-paper-faint p-3 min-h-[80px] focus-visible:border-brand focus-visible:ring-0 transition-colors"
                                                        />
                                                        <Button
                                                            size="sm"
                                                            className="absolute right-2 bottom-2 h-7 rounded-xs bg-brand px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                                                            onClick={handleDebug}
                                                            disabled={isDebugging}
                                                        >
                                                            {isDebugging ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refine"}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </details>
                                </section>
                            </>
                        )}
                    </div>
                </div>
        </ResponsiveDraggableDialog>
    );
}
