import React, { useState, useEffect, useRef } from 'react';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveDraggableDialog } from '@/components/common/ResponsiveDraggableDialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, Check, Copy, AlertCircle, RefreshCw, Lightbulb, FileText } from 'lucide-react';
import { optimizeQuery } from '@/api/query';
import { getAiModels, type AiModelSimple } from '@/api/ai-chat';
import { toast } from 'sonner';
import { formatClickHouseSQL } from '@/lib/formatSql';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { log } from '@/lib/log';
import { useWindowSize } from '@/hooks/useWindowSize';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffEditor } from './DiffEditor';
import { Badge } from '@/components/ui/badge';
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
    initialResult?: {
        optimizedQuery: string;
        explanation: string;
        summary: string;
        tips: string[];
        originalQuery: string;
    } | null;
    autoStart?: boolean;
    initialPrompt?: string;
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
}: OptimizeQueryDialogProps) {
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [result, setResult] = useState<{
        optimizedQuery: string;
        explanation: string;
        summary: string;
        tips: string[];
        originalQuery: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [additionalPrompt, setAdditionalPrompt] = useState(initialPrompt || DEFAULT_OPTIMIZATION_PROMPT);
    const [aiModels, setAiModels] = useState<AiModelSimple[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const { breakpoint } = useWindowSize();
    const isNarrow = breakpoint === 'mobile' || breakpoint === 'tablet';

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
            const response = await optimizeQuery(query, database, additionalPrompt, selectedModelId || undefined, controller.signal);
            setResult({
                optimizedQuery: formatClickHouseSQL(response.optimizedQuery),
                explanation: response.explanation,
                summary: response.summary,
                tips: response.tips,
                originalQuery: response.originalQuery,
            });
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
            <DialogHeader className="space-y-1 min-w-0">
                <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-white">
                    <div className="p-1.5 rounded-md bg-purple-500/10 border border-purple-500/20 shrink-0">
                        <Sparkles className="w-5 h-5 text-purple-400" />
                    </div>
                    AI Query Optimizer
                </DialogTitle>
                <p className="text-sm text-gray-400 font-normal">
                    Optimize your ClickHouse queries with intelligent analysis and recommendations.
                </p>
            </DialogHeader>
            {!isOptimizing && result && (
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 shrink-0">
                    <span className="text-xs text-gray-400">Model:</span>
                    <span className="text-xs font-medium text-purple-300 truncate max-w-[120px]">{aiModels.find(m => m.id === selectedModelId)?.name || 'AI Model'}</span>
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
            windowClassName="rounded-2xl shadow-2xl bg-[#0F1117] border-gray-800 text-white"
            headerClassName="px-6 py-4 border-white/10 bg-[#14141a]"
            footerClassName="px-6 py-4 border-white/10 bg-[#14141a]"
            closeButtonClassName="text-gray-400 hover:text-white hover:bg-white/10 rounded-lg -mr-2"
            contentClassName="bg-[#0F1117] text-white"
            footer={
                <DialogFooter className="px-0 py-0 border-0 bg-transparent">
                    <Button
                        variant="ghost"
                        onClick={handleCancel}
                        className="text-gray-400 hover:text-white hover:bg-white/5"
                    >
                        Close
                    </Button>
                    {result && (
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    navigator.clipboard.writeText(result.optimizedQuery);
                                    toast.success('Copied to clipboard');
                                }}
                                className="gap-2"
                            >
                                <Copy className="w-4 h-4" />
                                Copy Code
                            </Button>
                            <Button
                                onClick={handleAccept}
                                className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-lg shadow-green-500/20"
                            >
                                <Check className="w-4 h-4" />
                                Apply Changes
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            }
        >
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col bg-[#0F1117]">
                <ResizablePanelGroup direction={isNarrow ? "vertical" : "horizontal"} className="flex-1 min-h-0 min-w-0">

                        {/* Left Panel: Diff Editor */}
                        <ResizablePanel defaultSize={65} minSize={25} className="bg-[#1e1e1e] flex flex-col min-h-0 min-w-0">
                            <div className="flex-1 relative min-h-0 min-w-0">
                                {result ? (
                                    <DiffEditor
                                        original={query}
                                        modified={result.optimizedQuery}
                                        language="sql"
                                        className="absolute inset-0"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center bg-[#0F1117]">
                                        {isOptimizing ? (
                                            <div className="flex flex-col items-center gap-4 text-center p-8">
                                                <div className="relative">
                                                    <div className="absolute inset-0 bg-purple-500 blur-xl opacity-20 animate-pulse rounded-full"></div>
                                                    <Loader2 className="w-12 h-12 text-purple-500 animate-spin relative z-10" />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-lg font-medium text-white">Analyzing Query Structure...</h3>
                                                    <p className="text-sm text-gray-400 max-w-xs">
                                                        Examining schema, indexes, and execution plan to find improvements.
                                                    </p>
                                                </div>
                                            </div>
                                        ) : error ? (
                                            <div className="text-center p-8 max-w-md">
                                                <div className="inline-flex p-3 rounded-full bg-red-500/10 mb-4">
                                                    <AlertCircle className="w-8 h-8 text-red-500" />
                                                </div>
                                                <h3 className="text-lg font-medium text-white mb-2">Optimization Failed</h3>
                                                <p className="text-sm text-gray-400 mb-6">{error}</p>
                                                <Button onClick={handleOptimize} variant="secondary">
                                                    Retry Optimization
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 max-w-md">
                                                <div className="inline-flex p-3 rounded-full bg-slate-800 mb-4">
                                                    <Sparkles className="w-8 h-8 text-slate-400" />
                                                </div>
                                                <h3 className="text-lg font-medium text-white mb-2">Ready to Optimize</h3>
                                                <p className="text-sm text-gray-400 mb-6">
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
                        <ResizablePanel defaultSize={35} minSize={25} className="bg-[#0F1117] flex flex-col border-l border-white/5 min-h-0 min-w-0">
                            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">

                                {/* Controls Section */}
                                <div className="space-y-5">
                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            AI Model
                                        </Label>
                                        <Select
                                            value={selectedModelId}
                                            onValueChange={(value) => setSelectedModelId(value)}
                                        >
                                            <SelectTrigger className="w-full bg-[#1a1c24] border-white/10 text-sm focus:ring-1 focus:ring-purple-500/50 transition-colors h-11">
                                                <SelectValue placeholder="Select an AI Model" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#14141a] border-white/10 rounded-lg">
                                                {aiModels.length === 0 ? (
                                                    <div className="p-4 text-center text-[13px] text-gray-500">
                                                        No AI models configured.<br />Please add one in the Admin UI.
                                                    </div>
                                                ) : (
                                                    aiModels.map(m => (
                                                        <SelectItem key={m.id} value={m.id} className="focus:bg-purple-500/10 focus:text-purple-200 cursor-pointer py-2.5 rounded-md mx-1 my-0.5">
                                                            <div className="flex flex-col gap-0.5 text-left">
                                                                <span className="font-medium text-[13px] text-gray-200">{m.name}</span>
                                                                <span className="text-[10px] text-gray-500 font-medium tracking-wide uppercase leading-none">{m.provider || 'AI Provider'}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-3">
                                        <Label htmlFor="prompt" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            Optimization Goal
                                        </Label>
                                        <Textarea
                                            id="prompt"
                                            value={additionalPrompt}
                                            onChange={(e) => setAdditionalPrompt(e.target.value)}
                                            placeholder="Specific instructions (e.g., 'Use PREWHERE', 'Avoid JOINs')..."
                                            className="bg-[#1a1c24] border-white/10 text-sm min-h-[80px] focus:border-purple-500/50 transition-colors"
                                        />
                                    </div>

                                    <Button
                                        onClick={handleOptimize}
                                        disabled={isOptimizing}
                                        className={cn(
                                            "w-full font-medium transition-all",
                                            isOptimizing
                                                ? "bg-purple-500/10 text-purple-400"
                                                : "bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20"
                                        )}
                                    >
                                        {isOptimizing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Optimizing...
                                            </>
                                        ) : (
                                            <>
                                                {result ? <RefreshCw className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                                                {result ? "Re-Optimize" : "Optimize Query"}
                                            </>
                                        )}
                                    </Button>
                                </div>

                                {/* Analysis Results */}
                                {result && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                                        {/* Summary Card */}
                                        <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 space-y-2">
                                            <div className="flex items-center gap-2 text-purple-400 font-medium text-sm">
                                                <Sparkles className="w-4 h-4" />
                                                <span>Summary</span>
                                            </div>
                                            <p className="text-sm text-gray-200 leading-relaxed font-medium">
                                                {result.summary}
                                            </p>
                                        </div>

                                        {/* Detailed Explanation */}
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wider">
                                                <FileText className="w-3.5 h-3.5" />
                                                Changes Explanation
                                            </div>
                                            <div className="prose prose-invert prose-sm max-w-none text-gray-300 text-sm leading-relaxed">
                                                <ReactMarkdown components={{
                                                    h1: ({ node, ...props }) => <h1 className="text-lg font-bold text-purple-400 mt-4 mb-2" {...props} />,
                                                    h2: ({ node, ...props }) => <h2 className="text-base font-bold text-purple-300 mt-3 mb-2" {...props} />,
                                                    h3: ({ node, ...props }) => <h3 className="text-sm font-bold text-white mt-3 mb-1" {...props} />,
                                                    p: ({ node, ...props }) => <p className="text-gray-300 leading-relaxed mb-3 last:mb-0" {...props} />,
                                                    ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1" {...props} />,
                                                    ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1" {...props} />,
                                                    li: ({ node, ...props }) => <li className="text-gray-300" {...props} />,
                                                    strong: ({ node, ...props }) => <strong className="text-purple-200 font-semibold" {...props} />,
                                                    code({ node, className, children, ...props }) {
                                                        const match = /language-(\w+)/.exec(className || '')
                                                        return match ? (
                                                            <code className="bg-black/30 rounded px-1.5 py-0.5 text-purple-300 font-mono text-xs" {...props}>
                                                                {children}
                                                            </code>
                                                        ) : (
                                                            <code className="bg-black/30 rounded px-1.5 py-0.5 text-purple-300 font-mono text-xs" {...props}>
                                                                {children}
                                                            </code>
                                                        )
                                                    }
                                                }}>
                                                    {result.explanation}
                                                </ReactMarkdown>
                                            </div>
                                        </div>

                                        {/* Performance Tips */}
                                        {result.tips?.length > 0 && (
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wider">
                                                    <Lightbulb className="w-3.5 h-3.5" />
                                                    Performance Tips
                                                </div>
                                                <ul className="space-y-2">
                                                    {result.tips?.map((tip, idx) => (
                                                        <li key={idx} className="flex gap-3 text-sm text-gray-400 bg-white/5 p-3 rounded-lg border border-white/5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50 mt-1.5 shrink-0" />
                                                            <span>{tip}</span>
                                                        </li>
                                                    ))}
                                                </ul>
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
