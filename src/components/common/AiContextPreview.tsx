import { useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface AiContextPreviewProps {
    content: string;
    label?: string;
    language?: string;
    metadata?: string[];
    note?: string;
    className?: string;
}

export function AiContextPreview({
    content,
    label = 'Attached query',
    language = 'sql',
    metadata = [],
    note,
    className,
}: AiContextPreviewProps): React.ReactElement {
    const [copied, setCopied] = useState(false);

    const copy = async (): Promise<void> => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <section className={`overflow-hidden rounded-xs border border-ink-500 bg-ink-200 ${className ?? ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-500 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{label}</span>
                    {metadata.map((item) => (
                        <span key={item} className="max-w-[180px] truncate rounded-xs bg-ink-300 px-1.5 py-0.5 font-mono text-[9px] text-paper-faint">
                            {item}
                        </span>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={copy}
                    className="h-7 gap-1.5 rounded-xs px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim hover:bg-ink-300 hover:text-paper"
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </div>
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.65] text-paper">
                <code data-language={language}>{content.trim() || 'No query text attached.'}</code>
            </pre>
            {note && (
                <p className="border-t border-ink-500 px-3 py-2 text-[10px] leading-relaxed text-paper-faint">{note}</p>
            )}
        </section>
    );
}
