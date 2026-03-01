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
import { Badge } from '@/components/ui/badge';
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

    const dialogTitle = (
        <div className="flex items-center justify-between gap-3 w-full">
            <div className="space-y-1 min-w-0">
                <DialogTitle className="flex items-center gap-3 text-2xl font-semibold text-white tracking-tight">
                    <Sparkles className="w-6 h-6 text-indigo-400 shrink-0" />
                    <span>Query Analysis</span>
                </DialogTitle>
                <p className="text-sm text-gray-400 ml-9">
                    {result ? "We found an issue and have a fix ready." : "Analyzing your query logic..."}
                </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
                {result ? (
                    <Badge variant="outline" className="bg-indigo-500/10 text-indigo-300 border-indigo-500/20 px-3 py-1 font-medium rounded-full">
                        Fix Available
                    </Badge>
                ) : apiError ? (
                    <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 px-3 py-1 font-medium rounded-full">
                        Failed
                    </Badge>
                ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 px-3 py-1 font-medium rounded-full animate-pulse">
                        Analyzing...
                    </Badge>
                )}
                {!isDebugging && result && (
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 mr-2">
                        <span className="text-xs text-gray-400">Model:</span>
                        <span className="text-xs font-medium text-indigo-300 truncate max-w-[120px]">{aiModels.find(m => m.id === selectedModelId)?.name || 'AI Model'}</span>
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
            windowClassName="rounded-2xl shadow-2xl shadow-black/50 bg-[#0F1117] border-gray-800 text-white"
            headerClassName="px-8 py-5 border-white/10 bg-transparent"
            footerClassName="px-8 py-6 bg-gradient-to-t from-[#0F1117] via-[#0F1117] to-transparent border-white/10"
            closeButtonClassName="text-gray-400 hover:text-white hover:bg-white/10 rounded-lg -mr-2"
            contentClassName="bg-[#0F1117] text-white"
            footer={
                <DialogFooter className="px-0 py-0 border-0 bg-transparent">
                    <div className="flex w-full items-center justify-between">
                        <Button
                            variant="ghost"
                            onClick={handleCancel}
                            className="text-gray-500 hover:text-white hover:bg-white/5"
                        >
                            Dismiss
                        </Button>
                        {result && (
                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        navigator.clipboard.writeText(result.fixedQuery);
                                        toast.success('Copied to clipboard');
                                    }}
                                    className="gap-2 border-white/10 text-gray-300 hover:bg-white/5"
                                >
                                    <Copy className="w-4 h-4" />
                                    Copy Code
                                </Button>
                                <Button
                                    onClick={handleAccept}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2 shadow-lg shadow-indigo-500/20 px-6 rounded-lg font-medium"
                                >
                                    <Check className="w-4 h-4" />
                                    Apply Fix
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogFooter>
            }
        >
            <div className="flex-1 overflow-y-auto p-8 relative h-full min-h-0 bg-[#0F1117]">
                    {/* Subtle Background Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />

                    <div className="max-w-4xl mx-auto space-y-10 relative z-10">
                        {apiError ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                                <div className="max-w-md w-full">
                                    <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-left">
                                        <AlertTitle className="text-red-400 font-semibold flex items-center gap-2">
                                            Analysis Failed
                                        </AlertTitle>
                                        <AlertDescription className="text-red-300/80 mt-2">
                                            {apiError}
                                        </AlertDescription>
                                    </Alert>
                                </div>
                                <Button
                                    onClick={handleDebug}
                                    className="bg-white/5 hover:bg-white/10 text-white border border-white/10 gap-2 mt-4"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Try Again
                                </Button>
                            </div>
                        ) : !result && !isDebugging ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
                                <div className="space-y-4">
                                    <div className="inline-flex items-center justify-center p-4 rounded-full bg-indigo-500/10 mb-2">
                                        <Bug className="w-8 h-8 text-indigo-400" />
                                    </div>
                                    <h3 className="text-2xl font-semibold text-white tracking-tight">Debug this Query</h3>
                                    <p className="text-gray-400 max-w-md mx-auto leading-relaxed text-sm">Select an AI model to analyze your query for schema compliance, logic errors, and optimization opportunities.</p>
                                </div>

                                <div className="w-full max-w-lg space-y-5 text-left bg-white/5 border border-white/5 rounded-2xl p-6 shadow-xl shadow-black/20">
                                    <div className="space-y-3">
                                        <Label className="text-gray-300 font-medium ml-1">Select AI Model</Label>
                                        <Select
                                            value={selectedModelId}
                                            onValueChange={(value) => setSelectedModelId(value)}
                                        >
                                            <SelectTrigger className="w-full bg-[#0F1117] border-white/10 hover:bg-white/5 text-sm h-12 rounded-xl focus:ring-1 focus:ring-indigo-500/50 transition-colors">
                                                <SelectValue placeholder="Select an AI Model" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#0F1117] border-white/10 rounded-xl max-h-[220px]">
                                                {aiModels.length === 0 ? (
                                                    <div className="p-4 text-center text-sm text-gray-500">
                                                        No AI models configured.<br />Please add one in the Admin UI.
                                                    </div>
                                                ) : (
                                                    aiModels.map(m => (
                                                        <SelectItem key={m.id} value={m.id} className="focus:bg-indigo-500/10 focus:text-indigo-200 cursor-pointer py-3 rounded-lg mx-1 my-0.5">
                                                            <div className="flex flex-col gap-1 text-left">
                                                                <span className="font-medium text-sm text-gray-200">{m.name}</span>
                                                                <span className="text-[11px] text-gray-500 font-medium tracking-wide uppercase">{m.provider || 'AI Provider'}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button
                                        onClick={handleDebug}
                                        className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-base shadow-lg shadow-indigo-500/25 transition-all"
                                        disabled={!selectedModelId || aiModels.length === 0}
                                    >
                                        <Sparkles className="w-5 h-5 mr-2" />
                                        Analyze Query
                                    </Button>
                                </div>
                            </div>
                        ) : !result && isDebugging ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                                <div className="relative p-7 rounded-full bg-indigo-500/10 mb-2">
                                    <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full animate-pulse" />
                                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin relative" />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-xl font-medium text-white tracking-tight">Running Analysis</h3>
                                    <p className="text-gray-400 max-w-xs mx-auto text-sm">Checking schema compliance, logic errors, and optimization opportunities...</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* 1. Diagnosis Section (Clean, No Box) */}
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm font-medium text-red-300 ml-1">
                                        <AlertCircle className="w-4 h-4" />
                                        Diagnosis
                                    </div>
                                    <div className="text-lg text-gray-100 leading-relaxed font-light">
                                        {result?.errorAnalysis}
                                    </div>
                                </section>

                                {/* 2. Proposed Change (Rounded Editor, Shadow) */}
                                <section className="space-y-3">
                                    <div className="flex items-center justify-between ml-1 text-sm font-medium text-indigo-300">
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4" />
                                            Proposed Change
                                        </div>
                                        <div className="text-xs text-indigo-400/60 font-mono">
                                            Diff View
                                        </div>
                                    </div>
                                    <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/40 border border-white/5 bg-[#0a0a0c]">
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

                                {/* 3. Solution Summary (Soft Background) */}
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm font-medium text-green-300 ml-1">
                                        <Check className="w-4 h-4" />
                                        Why this fixes it
                                    </div>
                                    <div className="text-base text-gray-300 bg-white/5 border border-white/5 p-6 rounded-2xl leading-relaxed">
                                        {result?.summary}
                                    </div>
                                </section>

                                {/* 4. Technical Details (Accordion) */}
                                <section className="pt-4">
                                    <details className="group">
                                        <summary className="list-none flex items-center cursor-pointer text-sm text-gray-500 hover:text-gray-300 transition-colors py-2">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1 rounded bg-transparent group-hover:bg-white/5 transition-colors">
                                                    <ArrowRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                                </div>
                                                <span>Viewing Technical Details</span>
                                            </div>
                                        </summary>
                                        <div className="mt-4 pl-4 border-l border-white/10 group-open:animate-in group-open:slide-in-from-top-2">
                                            <div className="prose prose-invert prose-sm max-w-none">
                                                <ReactMarkdown
                                                    components={{
                                                        h1: ({ node, ...props }) => <h1 className="text-xl font-semibold text-white mt-6 mb-3 first:mt-0" {...props} />,
                                                        h2: ({ node, ...props }) => <h2 className="text-lg font-medium text-indigo-200 mt-5 mb-2" {...props} />,
                                                        h3: ({ node, ...props }) => <h3 className="text-base font-medium text-indigo-100 mt-4 mb-2" {...props} />,
                                                        p: ({ node, ...props }) => <p className="text-gray-300 leading-relaxed mb-4" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-5 mb-4 text-gray-300 space-y-1" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-5 mb-4 text-gray-300 space-y-1" {...props} />,
                                                        li: ({ node, ...props }) => <li className="pl-1 marker:text-indigo-400/50" {...props} />,
                                                        strong: ({ node, ...props }) => <strong className="font-semibold text-indigo-200" {...props} />,
                                                        code: ({ node, className, children, ...props }: any) => {
                                                            const match = /language-(\w+)/.exec(className || '');
                                                            const isInline = !match && !String(children).includes('\n');
                                                            return isInline ? (
                                                                <code className="bg-indigo-500/10 text-indigo-200 px-1.5 py-0.5 rounded text-[13px] font-mono border border-indigo-500/10" {...props}>
                                                                    {children}
                                                                </code>
                                                            ) : (
                                                                <div className="rounded-lg overflow-hidden my-4 border border-white/10 bg-[#0a0a0c] shadow-sm">
                                                                    {match && (
                                                                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 text-xs text-gray-500 font-mono flex items-center gap-2">
                                                                            <Terminal className="w-3 h-3" />
                                                                            {match[1]}
                                                                        </div>
                                                                    )}
                                                                    <pre className="p-4 overflow-x-auto text-sm text-gray-300 font-mono scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent" {...props}>
                                                                        <code>{children}</code>
                                                                    </pre>
                                                                </div>
                                                            )
                                                        },
                                                        blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-indigo-500/30 pl-4 italic text-gray-400 my-4 bg-white/5 py-2 pr-2 rounded-r" {...props} />,
                                                    }}
                                                >
                                                    {result?.explanation || ''}
                                                </ReactMarkdown>
                                            </div>

                                            {/* Context Input */}
                                            <div className="mt-8 pt-6">
                                                <div className="relative">
                                                    <Textarea
                                                        value={additionalPrompt}
                                                        onChange={(e) => setAdditionalPrompt(e.target.value)}
                                                        placeholder="Ask a question to refine this result..."
                                                        className="bg-[#14141a] border-white/10 rounded-xl text-sm p-4 min-h-[80px] focus:ring-1 focus:ring-indigo-500/50 transition-all"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="absolute right-3 bottom-3 h-7 text-xs text-indigo-300 hover:text-white hover:bg-indigo-500/20"
                                                        onClick={handleDebug}
                                                        disabled={isDebugging}
                                                    >
                                                        {isDebugging ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refine Result"}
                                                    </Button>
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
