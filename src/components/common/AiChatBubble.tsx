/**
 * AI Chat Bubble
 * 
 * Floating chat assistant that appears as a bubble in the bottom-right corner.
 * Expands into a full chat window with thread sidebar.
 * Only renders if the user has ai:chat permission and AI is enabled.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/github-dark.min.css';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import {
    getChatStatus,
    listThreads,
    createThread,
    getThread,
    deleteThread,
    streamChatMessage,
    type ChatThread,
    type ChatMessage,
    type StreamDelta,
} from '@/api/ai-chat';
import {
    MessageSquare,
    X,
    Plus,
    Trash2,
    Send,
    Loader2,
    Bot,
    User,
    ChevronLeft,
    Sparkles,
    Database,
    Table2,
    Zap,
    Clock,
    PanelLeftClose,
} from 'lucide-react';

// Register highlight.js languages
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);

// ============================================
// Types
// ============================================

interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    isStreaming?: boolean;
    toolStatus?: string;
}

// Suggested prompt chips for the welcome screen
const SUGGESTED_PROMPTS = [
    { icon: Database, label: 'Show my databases', prompt: 'What databases do I have access to?' },
    { icon: Table2, label: 'Explore tables', prompt: 'List all tables with their row counts' },
    { icon: Zap, label: 'Performance tips', prompt: 'Show me any slow or heavy queries and suggest optimizations' },
    { icon: MessageSquare, label: 'Schema overview', prompt: 'Give me an overview of the database schema' },
];

// Relative time helper
function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}

// Custom renderers for ReactMarkdown
const markdownComponents = {
    // Tables: wrap in scrollable container
    table: ({ children, ...props }: any) => (
        <div className="overflow-x-auto my-2 rounded-lg border border-white/10">
            <table className="min-w-full text-xs" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: any) => (
        <thead className="bg-white/5" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }: any) => (
        <th className="px-3 py-1.5 text-left font-medium text-white/80 border-b border-white/10 whitespace-nowrap" {...props}>{children}</th>
    ),
    td: ({ children, ...props }: any) => (
        <td className="px-3 py-1.5 text-white/70 border-b border-white/5 whitespace-nowrap" {...props}>{children}</td>
    ),
    // Code blocks with syntax highlighting
    code: ({ className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const lang = match?.[1];
        const codeStr = String(children).replace(/\n$/, '');
        if (lang || codeStr.includes('\n')) {
            let highlighted = codeStr;
            try {
                if (lang && hljs.getLanguage(lang)) {
                    highlighted = hljs.highlight(codeStr, { language: lang }).value;
                }
            } catch { /* fallback to plain */ }
            return (
                <code
                    className={`${className || ''} text-xs`}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                    {...props}
                />
            );
        }
        // Inline code
        return <code className="bg-white/10 px-1.5 py-0.5 rounded text-violet-300 text-xs" {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: any) => (
        <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto my-2 text-xs" {...props}>{children}</pre>
    ),
    // Paragraphs
    p: ({ children, ...props }: any) => (
        <p className="my-1.5 leading-relaxed" {...props}>{children}</p>
    ),
    // Lists
    ul: ({ children, ...props }: any) => (
        <ul className="list-disc list-inside my-1.5 space-y-0.5" {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: any) => (
        <ol className="list-decimal list-inside my-1.5 space-y-0.5" {...props}>{children}</ol>
    ),
    // Headers
    h1: ({ children, ...props }: any) => <h1 className="text-base font-bold text-white/90 mt-3 mb-1" {...props}>{children}</h1>,
    h2: ({ children, ...props }: any) => <h2 className="text-sm font-bold text-white/90 mt-3 mb-1" {...props}>{children}</h2>,
    h3: ({ children, ...props }: any) => <h3 className="text-sm font-semibold text-white/90 mt-2 mb-1" {...props}>{children}</h3>,
    // Links
    a: ({ children, ...props }: any) => (
        <a className="text-violet-400 hover:text-violet-300 underline" target="_blank" rel="noopener" {...props}>{children}</a>
    ),
    // Blockquotes
    blockquote: ({ children, ...props }: any) => (
        <blockquote className="border-l-2 border-violet-500/40 pl-3 my-2 text-white/60 italic" {...props}>{children}</blockquote>
    ),
};

// ============================================
// Component
// ============================================

export default function AiChatBubble() {
    const hasPermission = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_CHAT));
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);


    // Thread state
    const [threads, setThreads] = useState<ChatThread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [isLoadingThreads, setIsLoadingThreads] = useState(false);

    // Input state
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [toolStatus, setToolStatus] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Check AI status on mount
    useEffect(() => {
        if (!hasPermission) return;
        getChatStatus()
            .then((status) => setAiEnabled(status.enabled))
            .catch(() => setAiEnabled(false));
    }, [hasPermission]);

    // Load threads when chat opens
    useEffect(() => {
        if (isOpen && hasPermission && aiEnabled) {
            loadThreads();
        }
    }, [isOpen, hasPermission, aiEnabled]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when thread loads
    useEffect(() => {
        if (activeThreadId && !isStreaming) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [activeThreadId, isStreaming]);

    const loadThreads = useCallback(async () => {
        setIsLoadingThreads(true);
        try {
            const result = await listThreads();
            setThreads(result);
        } catch (err) {
            console.error('[AiChat] Failed to load threads:', err);
        } finally {
            setIsLoadingThreads(false);
        }
    }, []);

    const loadThread = useCallback(async (threadId: string) => {
        try {
            const data = await getThread(threadId);
            setActiveThreadId(threadId);
            setMessages(
                data.messages.map((m: ChatMessage) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    createdAt: m.createdAt,
                }))
            );
            setShowSidebar(false);
        } catch (err) {
            console.error('[AiChat] Failed to load thread:', err);
        }
    }, []);

    const handleNewThread = useCallback(async () => {
        try {
            const thread = await createThread();
            setThreads((prev) => [thread, ...prev]);
            setActiveThreadId(thread.id);
            setMessages([]);
            setShowSidebar(false);
        } catch (err) {
            console.error('[AiChat] Failed to create thread:', err);
        }
    }, []);

    const handleDeleteThread = useCallback(async (threadId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteThread(threadId);
            setThreads((prev) => prev.filter((t) => t.id !== threadId));
            if (activeThreadId === threadId) {
                setActiveThreadId(null);
                setMessages([]);
            }
        } catch (err) {
            console.error('[AiChat] Failed to delete thread:', err);
        }
    }, [activeThreadId]);

    const handleSend = useCallback(async (e?: FormEvent) => {
        e?.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || isStreaming || !activeThreadId) return;

        // Create thread if none active
        let threadId = activeThreadId;

        // Add user message to UI
        const userMsg: UIMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: trimmed,
            createdAt: new Date().toISOString(),
        };

        // Add placeholder assistant message
        const assistantMsg: UIMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            isStreaming: true,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInput('');
        setIsStreaming(true);

        // Prepare messages for API
        const messageHistory = messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));
        messageHistory.push({ role: 'user', content: trimmed });

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const stream = streamChatMessage(
                threadId,
                trimmed,
                messageHistory,
                controller.signal
            );

            for await (const delta of stream) {
                if (delta.type === 'text-delta' && delta.text) {
                    // Text arrived — clear tool status
                    setToolStatus(null);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            updated[updated.length - 1] = {
                                ...last,
                                content: last.content + delta.text!,
                                toolStatus: undefined,
                            };
                        }
                        return updated;
                    });
                } else if (delta.type === 'status' && delta.tool) {
                    // Tool is being called — show status
                    const label = delta.tool.replace(/_/g, ' ');
                    setToolStatus(`Querying ${label}...`);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant' && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                toolStatus: `Querying ${label}...`,
                            };
                        }
                        return updated;
                    });
                } else if (delta.type === 'error') {
                    setToolStatus(null);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            updated[updated.length - 1] = {
                                ...last,
                                content: `Error: ${delta.error || 'Unknown error'}`,
                                isStreaming: false,
                                toolStatus: undefined,
                            };
                        }
                        return updated;
                    });
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== 'AbortError') {
                setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                        updated[updated.length - 1] = {
                            ...last,
                            content: `Error: ${err instanceof Error ? err.message : 'Connection failed'}`,
                            isStreaming: false,
                        };
                    }
                    return updated;
                });
            }
        } finally {
            // Mark streaming complete
            setToolStatus(null);
            setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.isStreaming) {
                    updated[updated.length - 1] = { ...last, isStreaming: false, toolStatus: undefined };
                }
                return updated;
            });
            setIsStreaming(false);
            abortRef.current = null;

            // Refresh threads to get updated title
            loadThreads();
        }
    }, [input, isStreaming, activeThreadId, messages, loadThreads]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const handleStop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    // Helper to send a suggested prompt (auto-creates thread if needed)
    const handleSuggestedPrompt = useCallback(async (prompt: string) => {
        if (isStreaming) return;
        let threadId = activeThreadId;
        if (!threadId) {
            try {
                const thread = await createThread();
                setThreads((prev) => [thread, ...prev]);
                setActiveThreadId(thread.id);
                threadId = thread.id;
                setMessages([]);
            } catch (err) {
                console.error('[AiChat] Failed to create thread:', err);
                return;
            }
        }
        setInput(prompt);
        setTimeout(() => {
            const userMsg: UIMessage = {
                id: `user_${Date.now()}`,
                role: 'user',
                content: prompt,
                createdAt: new Date().toISOString(),
            };
            const assistantMsg: UIMessage = {
                id: `assistant_${Date.now()}`,
                role: 'assistant',
                content: '',
                createdAt: new Date().toISOString(),
                isStreaming: true,
            };
            setMessages((prev) => [...prev, userMsg, assistantMsg]);
            setInput('');
            setIsStreaming(true);

            const controller = new AbortController();
            abortRef.current = controller;

            (async () => {
                try {
                    const stream = streamChatMessage(
                        threadId!,
                        prompt,
                        [{ role: 'user', content: prompt }],
                        controller.signal
                    );
                    for await (const delta of stream) {
                        if (delta.type === 'text-delta' && delta.text) {
                            setToolStatus(null);
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant') {
                                    updated[updated.length - 1] = { ...last, content: last.content + delta.text!, toolStatus: undefined };
                                }
                                return updated;
                            });
                        } else if (delta.type === 'status' && delta.tool) {
                            const label = delta.tool.replace(/_/g, ' ');
                            setToolStatus(`Querying ${label}...`);
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant' && last.isStreaming) {
                                    updated[updated.length - 1] = { ...last, toolStatus: `Querying ${label}...` };
                                }
                                return updated;
                            });
                        } else if (delta.type === 'error') {
                            setToolStatus(null);
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant') {
                                    updated[updated.length - 1] = { ...last, content: `Error: ${delta.error || 'Unknown error'}`, isStreaming: false, toolStatus: undefined };
                                }
                                return updated;
                            });
                        }
                    }
                } catch (err: unknown) {
                    if (err instanceof Error && err.name !== 'AbortError') {
                        setMessages((prev) => {
                            const updated = [...prev];
                            const last = updated[updated.length - 1];
                            if (last && last.role === 'assistant') {
                                updated[updated.length - 1] = { ...last, content: `Error: ${err instanceof Error ? err.message : 'Connection failed'}`, isStreaming: false };
                            }
                            return updated;
                        });
                    }
                } finally {
                    setToolStatus(null);
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.isStreaming) {
                            updated[updated.length - 1] = { ...last, isStreaming: false, toolStatus: undefined };
                        }
                        return updated;
                    });
                    setIsStreaming(false);
                    abortRef.current = null;
                    loadThreads();
                }
            })();
        }, 0);
    }, [isStreaming, activeThreadId, loadThreads]);

    // Don't render if no permission or AI is not enabled
    if (!hasPermission || aiEnabled === false) return null;
    if (aiEnabled === null) return null;

    return (
        <>
            {/* Floating Bubble / Collapsed Tab */}
            {!isOpen && (
                <div
                    className={`fixed z-50 transition-all duration-300`}
                    style={{
                        // Collapsed: middle-right edge.
                        top: '50%',
                        right: 0,
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 48,
                        height: 120,
                    }}
                >
                    <button
                        onClick={() => setIsOpen(true)}
                        className={`flex items-center justify-center 
                                     transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform-gpu
                                     w-10 h-24 rounded-l-xl opacity-60 hover:opacity-100 group gap-1.5 shadow-black/80 ring-white/20 shadow-xl cursor-pointer bg-black/50 hover:bg-black border-y border-l border-white/10`}
                        title="Open AI Chat"
                    >
                        <div className="flex flex-col items-center gap-1.5 py-3">
                            <Sparkles className="w-4 h-4 text-violet-200" />
                            <span className="text-xs md:text-sm font-semibold text-white/90 tracking-wide" style={{ writingMode: 'vertical-lr' }}>Ask AI</span>
                        </div>
                    </button>
                </div>
            )}

            {/* Chat Window */}
            {isOpen && (
                <div
                    className="fixed z-50 w-[1040px] h-[740px] max-h-[88vh] 
                               rounded-2xl overflow-hidden flex flex-col
                               bg-[#0c0c12] border border-white/[0.08]
                               shadow-2xl shadow-black/70 animate-in zoom-in-95 duration-200"
                    style={{
                        // Center vertically and horizontally, biased towards the right half
                        top: '50%',
                        transform: 'translateY(-50%)',
                        right: 20,
                        // Animate zooming from the right-middle edge
                        transformOrigin: `100% 50%`
                    }}
                >

                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3 
                                  bg-gradient-to-r from-violet-950/60 via-indigo-950/40 to-[#0c0c12]
                                  border-b border-white/[0.06]">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowSidebar(!showSidebar)}
                                className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors text-white/50 hover:text-white/80"
                                title={showSidebar ? 'Close sidebar' : 'Thread history'}
                            >
                                {showSidebar ? <PanelLeftClose className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                            </button>
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Bot className="w-5 h-5 text-violet-400" />
                                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0c0c12]" />
                                </div>
                                <div>
                                    <span className="text-sm font-semibold text-white/90">CHouse AI</span>
                                    <span className="text-[10px] text-white/30 ml-2">Online</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={handleNewThread}
                                className="p-2 rounded-lg hover:bg-white/[0.08] transition-colors text-white/50 hover:text-white/80"
                                title="New chat"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 rounded-lg hover:bg-white/[0.08] transition-colors text-white/50 hover:text-white/80"
                                title="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex flex-1 min-h-0">
                        {/* Thread Sidebar */}
                        {showSidebar && (
                            <div className="w-64 flex-shrink-0 bg-[#09090f] border-r border-white/[0.06] overflow-y-auto">
                                <div className="p-3">
                                    <div className="flex items-center justify-between mb-3 px-1">
                                        <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                                            Conversations
                                        </h3>
                                        <span className="text-[10px] text-white/20">{threads.length}</span>
                                    </div>
                                    {isLoadingThreads ? (
                                        <div className="flex items-center justify-center py-8">
                                            <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
                                        </div>
                                    ) : threads.length === 0 ? (
                                        <p className="text-xs text-white/25 text-center py-8">No conversations yet</p>
                                    ) : (
                                        <div className="space-y-0.5">
                                            {threads.map((thread) => (
                                                <button
                                                    key={thread.id}
                                                    onClick={() => loadThread(thread.id)}
                                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px]
                                                              flex items-center justify-between group transition-all duration-150
                                                              ${activeThreadId === thread.id
                                                            ? 'bg-violet-600/15 text-white border border-violet-500/10'
                                                            : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70 border border-transparent'
                                                        }`}
                                                >
                                                    <div className="flex-1 min-w-0 mr-2">
                                                        <span className="block truncate">{thread.title || 'New Thread'}</span>
                                                        <span className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
                                                            <Clock className="w-2.5 h-2.5" />
                                                            {timeAgo(thread.updatedAt)}
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleDeleteThread(thread.id, e)}
                                                        className="p-1 rounded opacity-0 group-hover:opacity-100 
                                                                 hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                            {!activeThreadId ? (
                                /* Welcome screen */
                                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/20 
                                                  flex items-center justify-center mb-5 ring-1 ring-white/10">
                                        <Sparkles className="w-8 h-8 text-violet-400" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white/90 mb-2">CHouse AI</h3>
                                    <p className="text-sm text-white/40 mb-8 leading-relaxed max-w-md">
                                        Your intelligent ClickHouse assistant. Explore schemas, write queries,
                                        analyze performance, and get instant insights from your data.
                                    </p>
                                    {/* Suggested prompts */}
                                    <div className="grid grid-cols-2 gap-3 w-full max-w-lg mb-6">
                                        {SUGGESTED_PROMPTS.map((sp) => (
                                            <button
                                                key={sp.label}
                                                onClick={() => handleSuggestedPrompt(sp.prompt)}
                                                className="flex items-center gap-3 px-4 py-3 rounded-xl 
                                                         bg-white/[0.03] border border-white/[0.06]
                                                         hover:bg-violet-600/10 hover:border-violet-500/20
                                                         text-left transition-all duration-200 group"
                                            >
                                                <sp.icon className="w-4 h-4 text-violet-400/60 group-hover:text-violet-400 flex-shrink-0" />
                                                <span className="text-xs text-white/50 group-hover:text-white/70">{sp.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={handleNewThread}
                                        className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 
                                                 text-white text-sm font-medium transition-colors
                                                 flex items-center gap-2 shadow-lg shadow-violet-600/20"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Start New Chat
                                    </button>
                                </div>
                            ) : messages.length === 0 ? (
                                /* Thread selected but empty — show prompts here too */
                                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                                    <Bot className="w-10 h-10 text-violet-400/40 mb-3" />
                                    <p className="text-sm text-white/40 mb-6">
                                        Ask me anything about your ClickHouse databases
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                                        {SUGGESTED_PROMPTS.map((sp) => (
                                            <button
                                                key={sp.label}
                                                onClick={() => handleSuggestedPrompt(sp.prompt)}
                                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg 
                                                         bg-white/[0.03] border border-white/[0.06]
                                                         hover:bg-violet-600/10 hover:border-violet-500/20
                                                         text-left transition-all duration-200 group"
                                            >
                                                <sp.icon className="w-3.5 h-3.5 text-violet-400/50 group-hover:text-violet-400 flex-shrink-0" />
                                                <span className="text-xs text-white/45 group-hover:text-white/70">{sp.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                /* Message list */
                                <>
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                                            {msg.role === 'assistant' && (
                                                <div className="w-7 h-7 rounded-lg bg-violet-600/15 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-violet-500/10">
                                                    <Bot className="w-4 h-4 text-violet-400" />
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-0.5 min-w-0" style={{ maxWidth: msg.role === 'user' ? '75%' : '100%' }}>
                                                <div
                                                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed overflow-hidden
                                                              ${msg.role === 'user'
                                                            ? 'bg-violet-600/25 text-white/90 border border-violet-500/15'
                                                            : 'bg-white/[0.03] text-white/80 border border-white/[0.06]'
                                                        }`}
                                                >
                                                    {msg.role === 'assistant' ? (
                                                        <>
                                                            {msg.isStreaming && msg.toolStatus && !msg.content && (
                                                                <div className="flex items-center gap-2 text-violet-400/70 text-xs py-1">
                                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                                    <span>{msg.toolStatus}</span>
                                                                </div>
                                                            )}
                                                            <div className="overflow-x-auto max-w-full">
                                                                <ReactMarkdown
                                                                    remarkPlugins={[remarkGfm]}
                                                                    components={markdownComponents}
                                                                >
                                                                    {msg.content + (msg.isStreaming && !msg.toolStatus ? ' ▊' : '')}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <span className="whitespace-pre-wrap">{msg.content}</span>
                                                    )}
                                                </div>
                                                {/* Timestamp */}
                                                <span className={`text-[10px] text-white/20 px-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                                                    {timeAgo(msg.createdAt)}
                                                </span>
                                            </div>
                                            {msg.role === 'user' && (
                                                <div className="w-7 h-7 rounded-lg bg-indigo-600/15 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-indigo-500/10">
                                                    <User className="w-4 h-4 text-indigo-400" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Input Area */}
                    {activeThreadId && (
                        <div className="px-5 py-3 border-t border-white/[0.06] bg-[#09090f]/80">
                            <form onSubmit={handleSend} className="flex items-end gap-3">
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask about your databases, schemas, queries..."
                                    disabled={isStreaming}
                                    rows={1}
                                    className="flex-1 resize-none rounded-xl px-4 py-3 text-sm 
                                             bg-white/[0.04] border border-white/[0.08] text-white/90 
                                             placeholder:text-white/20 
                                             focus:outline-none focus:border-violet-500/30 focus:ring-1 focus:ring-violet-500/15
                                             disabled:opacity-40 transition-all
                                             max-h-[120px] min-h-[44px]"
                                    style={{ height: 'auto' }}
                                    onInput={(e) => {
                                        const target = e.target as HTMLTextAreaElement;
                                        target.style.height = 'auto';
                                        target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                                    }}
                                />
                                {isStreaming ? (
                                    <button
                                        type="button"
                                        onClick={handleStop}
                                        className="p-3 rounded-xl bg-red-500/15 hover:bg-red-500/25 
                                                 text-red-400 transition-colors flex-shrink-0"
                                        title="Stop generating"
                                    >
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={!input.trim()}
                                        className="p-3 rounded-xl bg-violet-600 hover:bg-violet-500 
                                                 disabled:bg-white/[0.04] disabled:text-white/15
                                                 text-white transition-all flex-shrink-0
                                                 shadow-lg shadow-violet-600/20 disabled:shadow-none"
                                        title="Send message"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                )}
                            </form>
                            <div className="flex items-center justify-between mt-1.5 px-1">
                                <span className="text-[10px] text-white/15">Shift+Enter for new line</span>
                                {isStreaming && toolStatus && (
                                    <span className="text-[10px] text-violet-400/50 flex items-center gap-1">
                                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                        {toolStatus}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
