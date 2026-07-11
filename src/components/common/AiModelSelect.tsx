import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Loader2 } from 'lucide-react';

import { fetchAiModels, type AiModelOption } from '@/api/ai';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function useAiModelSelection(enabled: boolean): {
    models: AiModelOption[];
    selectedModelId: string;
    setSelectedModelId: (id: string) => void;
    isLoading: boolean;
    error: Error | null;
} {
    const [selectedModelId, setSelectedModelId] = useState('');
    const query = useQuery({
        queryKey: ['ai-models'],
        queryFn: fetchAiModels,
        enabled,
        staleTime: 5 * 60_000,
    });
    const models = query.data ?? [];

    useEffect(() => {
        if (models.length === 0) {
            setSelectedModelId('');
            return;
        }
        setSelectedModelId((current) => {
            if (models.some((model) => model.id === current)) return current;
            return models.find((model) => model.isDefault)?.id ?? models[0].id;
        });
    }, [models]);

    return {
        models,
        selectedModelId,
        setSelectedModelId,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error : null,
    };
}

interface AiModelSelectProps {
    models: AiModelOption[];
    value: string;
    onValueChange: (id: string) => void;
    disabled?: boolean;
    isLoading?: boolean;
    error?: Error | null;
    label?: string;
    className?: string;
}

export function AiModelSelect({
    models,
    value,
    onValueChange,
    disabled = false,
    isLoading = false,
    error,
    label = 'AI model',
    className,
}: AiModelSelectProps): React.ReactElement {
    return (
        <div className={cn('space-y-2', className)}>
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                {label}
            </Label>
            <Select value={value} onValueChange={onValueChange} disabled={disabled || isLoading || models.length === 0}>
                <SelectTrigger className="h-10 w-full rounded-xs border-ink-500 bg-ink-200 text-[12px] text-paper transition-colors hover:bg-ink-300 focus-visible:border-brand focus-visible:ring-0">
                    <div className="flex min-w-0 items-center gap-2">
                        {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" aria-hidden />
                        ) : (
                            <Bot className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                        )}
                        <SelectValue placeholder={isLoading ? 'Loading AI models…' : 'Select an AI model'} />
                    </div>
                </SelectTrigger>
                <SelectContent className="max-h-[260px] rounded-xs border-ink-500 bg-ink-100">
                    {models.map((model) => (
                        <SelectItem
                            key={model.id}
                            value={model.id}
                            className="mx-1 my-0.5 cursor-pointer rounded-xs py-2 focus:bg-ink-200 focus:text-paper"
                        >
                            <div className="flex min-w-0 flex-col gap-0.5 text-left">
                                <span className="flex items-center gap-2 text-[12px] font-medium text-paper">
                                    <span className="truncate">{model.label}</span>
                                    {model.isDefault && (
                                        <span className="rounded-xs border border-brand/30 bg-brand/10 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-brand">
                                            Default
                                        </span>
                                    )}
                                </span>
                                <span className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">
                                    {model.provider || 'AI provider'} · {model.model}
                                </span>
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {!isLoading && models.length === 0 && (
                <p className="text-[11px] leading-relaxed text-paper-faint">
                    {error?.message ?? 'No AI models are configured. Add one in Admin → AI models.'}
                </p>
            )}
        </div>
    );
}
