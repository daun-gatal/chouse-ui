import { useMemo, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Bot, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import {
    rbacAiBaseModelsApi, rbacAiProvidersApi,
    type AiBaseModel, type AiProvider,
    type CreateAiBaseModelInput, type UpdateAiBaseModelInput
} from '@/api/rbac';
import {
    NUMBER_PARAM_FIELDS,
    PROVIDER_PARAM_KEYS,
    REASONING_EFFORT_OPTIONS,
    VERBOSITY_OPTIONS,
    hasAnyParams,
    validateAiModelParams,
    type AiModelParamKey,
    type AiModelParams,
    type ParamGroup,
    type ReasoningEffort,
    type Verbosity,
} from '@/constants/aiModelParams';
import type { ProviderType } from '@/constants/aiProviders';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { SkeletonRows } from '@/components/common/Skeletons';

const baseModelSchema = z.object({
    providerId: z.string().min(1, 'Provider is required'),
    name: z.string().min(1, 'Name is required').max(255),
    modelId: z.string().min(1, 'Model ID is required').max(255),
});

type BaseModelFormData = z.infer<typeof baseModelSchema>;

const PARAM_GROUPS: ParamGroup[] = ['Sampling', 'Output', 'Reasoning', 'Reliability & agent'];

const UNSET = '__unset__';

/** Scalar param draft: numbers and enums held as raw input strings until submit. */
type ParamsDraft = Partial<Record<AiModelParamKey, string>>;

function draftFromParams(params: AiModelParams | null | undefined): ParamsDraft {
    const draft: ParamsDraft = {};
    if (!params) return draft;
    for (const field of NUMBER_PARAM_FIELDS) {
        const value = params[field.key];
        if (typeof value === 'number') draft[field.key] = String(value);
    }
    if (params.reasoningEffort) draft.reasoningEffort = params.reasoningEffort;
    if (params.verbosity) draft.verbosity = params.verbosity;
    if (params.apiVersion) draft.apiVersion = params.apiVersion;
    return draft;
}

function paramsCount(params: AiModelParams | null): number {
    if (!params) return 0;
    return Object.values(params).filter((v) => v !== undefined && v !== null).length;
}

const fieldLabelClass = 'font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim';
const inputClass = 'rounded-xs border-ink-500 bg-ink-200 text-paper';

export default function BaseModelsTab() {
    const [models, setModels] = useState<AiBaseModel[]>([]);
    const [providers, setProviders] = useState<AiProvider[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<AiBaseModel | undefined>();
    const [deleteItem, setDeleteItem] = useState<AiBaseModel | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Runtime params state (kept outside react-hook-form: fields are dynamic per provider).
    const [paramsOpen, setParamsOpen] = useState(false);
    const [paramsDraft, setParamsDraft] = useState<ParamsDraft>({});
    const [stopSeqText, setStopSeqText] = useState('');
    const [extraJson, setExtraJson] = useState('');
    const [safetyJson, setSafetyJson] = useState('');
    const [paramsError, setParamsError] = useState<string | null>(null);

    const { hasPermission } = useRbacStore();
    const canEdit = hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE) || hasPermission(RBAC_PERMISSIONS.AI_MODELS_CREATE);
    const canDelete = hasPermission(RBAC_PERMISSIONS.AI_MODELS_DELETE);

    const form = useForm<BaseModelFormData>({
        resolver: zodResolver(baseModelSchema),
        defaultValues: { providerId: '', name: '', modelId: '' },
    });

    const isEditing = !!editingItem;
    const watchedProviderId = form.watch('providerId');

    const providerType: ProviderType | undefined = useMemo(() => {
        const providerId = isEditing ? editingItem.providerId : watchedProviderId;
        return providers.find(p => p.id === providerId)?.providerType;
    }, [isEditing, editingItem, watchedProviderId, providers]);

    const allowedKeys = providerType ? PROVIDER_PARAM_KEYS[providerType] : [];
    const isAllowed = (key: AiModelParamKey): boolean => allowedKeys.includes(key);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [modelsData, providersData] = await Promise.all([
                rbacAiBaseModelsApi.list(),
                rbacAiProvidersApi.list()
            ]);
            setModels(modelsData);
            setProviders(providersData);
        } catch (error) {
            toast.error('Failed to load Base Models');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (isFormOpen) {
            form.reset({
                providerId: editingItem?.providerId || '',
                name: editingItem?.name || '',
                modelId: editingItem?.modelId || '',
            });
            const params = editingItem?.params ?? null;
            setParamsDraft(draftFromParams(params));
            setStopSeqText(params?.stopSequences?.join('\n') ?? '');
            setExtraJson(params?.extra ? JSON.stringify(params.extra, null, 2) : '');
            setSafetyJson(params?.safetySettings ? JSON.stringify(params.safetySettings, null, 2) : '');
            setParamsError(null);
            setParamsOpen(hasAnyParams(params));
        }
    }, [isFormOpen, editingItem, form]);

    const setDraftValue = (key: AiModelParamKey, value: string) => {
        setParamsDraft(prev => {
            const next = { ...prev };
            if (value === '' || value === UNSET) {
                delete next[key];
            } else {
                next[key] = value;
            }
            return next;
        });
    };

    /**
     * Assemble and validate the params payload from the draft state.
     * Returns `params: null` when every field is empty (clears stored params).
     */
    const buildParams = (): { params?: AiModelParams | null; error?: string } => {
        if (!providerType) return { params: null };

        const built: AiModelParams = {};

        for (const field of NUMBER_PARAM_FIELDS) {
            const raw = paramsDraft[field.key];
            if (raw === undefined || !isAllowed(field.key)) continue;
            const num = Number(raw);
            if (!Number.isFinite(num)) return { error: `'${field.label}' must be a number` };
            built[field.key] = num;
        }

        const effort = paramsDraft.reasoningEffort;
        if (effort && isAllowed('reasoningEffort') && (REASONING_EFFORT_OPTIONS[providerType] as readonly string[]).includes(effort)) {
            built.reasoningEffort = effort as ReasoningEffort;
        }
        const verbosity = paramsDraft.verbosity;
        if (verbosity && isAllowed('verbosity') && (VERBOSITY_OPTIONS as readonly string[]).includes(verbosity)) {
            built.verbosity = verbosity as Verbosity;
        }
        const apiVersion = paramsDraft.apiVersion?.trim();
        if (apiVersion && isAllowed('apiVersion')) {
            built.apiVersion = apiVersion;
        }

        if (isAllowed('stopSequences')) {
            const sequences = stopSeqText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
            if (sequences.length > 0) built.stopSequences = sequences;
        }

        if (isAllowed('extra') && extraJson.trim()) {
            try {
                const parsed: unknown = JSON.parse(extraJson);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return { error: 'Extra params must be a JSON object' };
                }
                built.extra = parsed as Record<string, unknown>;
            } catch {
                return { error: 'Extra params must be valid JSON' };
            }
        }

        if (isAllowed('safetySettings') && safetyJson.trim()) {
            try {
                const parsed: unknown = JSON.parse(safetyJson);
                if (!Array.isArray(parsed) || parsed.some(entry =>
                    !entry || typeof entry !== 'object'
                    || typeof (entry as Record<string, unknown>).category !== 'string'
                    || typeof (entry as Record<string, unknown>).threshold !== 'string')) {
                    return { error: 'Safety settings must be a JSON array of { "category", "threshold" } objects' };
                }
                built.safetySettings = parsed as AiModelParams['safetySettings'];
            } catch {
                return { error: 'Safety settings must be valid JSON' };
            }
        }

        const errors = validateAiModelParams(built, providerType);
        if (errors.length > 0) return { error: errors.join('; ') };

        return { params: hasAnyParams(built) ? built : null };
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await rbacAiBaseModelsApi.delete(deleteItem.id);
            toast.success(`"${deleteItem.name}" deleted`);
            setDeleteItem(null);
            fetchData();
        } catch (error: any) {
            toast.error(error.message || 'Failed to delete Base Model');
        }
    };

    const onSubmit = async (values: BaseModelFormData) => {
        const { params, error } = buildParams();
        if (error) {
            setParamsError(error);
            setParamsOpen(true);
            return;
        }
        setParamsError(null);

        setIsSubmitting(true);
        try {
            if (isEditing) {
                const updateData: UpdateAiBaseModelInput = {
                    name: values.name,
                    modelId: values.modelId,
                    params: params ?? null,
                };
                await rbacAiBaseModelsApi.update(editingItem.id, updateData);
                toast.success('Base Model updated');
            } else {
                const createData: CreateAiBaseModelInput = {
                    providerId: values.providerId,
                    name: values.name,
                    modelId: values.modelId,
                    ...(params ? { params } : {}),
                };
                await rbacAiBaseModelsApi.create(createData);
                toast.success('Base Model created');
            }
            fetchData();
            setIsFormOpen(false);
        } catch (error) {
            toast.error(isEditing ? 'Failed to update' : 'Failed to create');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getProviderName = (id: string) => {
        return providers.find(p => p.id === id)?.name || 'Unknown';
    };

    const numberFieldsFor = (group: ParamGroup) =>
        NUMBER_PARAM_FIELDS.filter(field => field.group === group && isAllowed(field.key));

    const renderEnumSelect = (
        key: AiModelParamKey,
        label: string,
        options: readonly string[],
        description: string,
    ) => (
        <label className="flex flex-col gap-1" key={key}>
            <span className={fieldLabelClass}>{label}</span>
            <Select value={paramsDraft[key] ?? UNSET} onValueChange={(v) => setDraftValue(key, v)}>
                <SelectTrigger className={`h-9 ${inputClass}`}>
                    <SelectValue placeholder="Provider default" />
                </SelectTrigger>
                <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                    <SelectItem value={UNSET}>Provider default</SelectItem>
                    {options.map(option => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <span className="text-[11px] text-paper-faint">{description}</span>
        </label>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>Provider models</span>
                    </span>
                    <p className="text-[12px] text-paper-muted">Underlying provider model identifiers used by deployments.</p>
                </div>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add base model</span>
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                    <table className="w-full">
                        <tbody>
                            <SkeletonRows count={5} cols={4} />
                        </tbody>
                    </table>
                </div>
            ) : models.length === 0 ? (
                <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
                    <Bot className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No base models configured</h3>
                    <p className="mt-2 text-[12px] text-paper-muted">Add underlying provider models (e.g. gpt-4o, claude-3-5-sonnet-20240620).</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-ink-500 hover:bg-transparent">
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider model ID</TableHead>
                                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {models.map(item => (
                                    <TableRow key={item.id} className="border-ink-500">
                                        <TableCell className="font-medium text-paper">{item.name}</TableCell>
                                        <TableCell className="text-paper-muted">{getProviderName(item.providerId)}</TableCell>
                                        <TableCell className="max-w-xs font-mono text-[12px] text-paper-dim">
                                            <span className="inline-flex items-center gap-2">
                                                {item.modelId}
                                                {paramsCount(item.params) > 0 && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 text-[10px] text-paper-muted">
                                                                <SlidersHorizontal className="h-2.5 w-2.5" />
                                                                {paramsCount(item.params)}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>{paramsCount(item.params)} runtime parameter{paramsCount(item.params) === 1 ? '' : 's'} set</TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {canEdit && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }} className="h-8 w-8 rounded-xs text-paper-muted hover:bg-ink-200 hover:text-paper">
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Edit</TooltipContent>
                                                    </Tooltip>
                                                )}
                                                {canDelete && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" onClick={() => setDeleteItem(item)} className="h-8 w-8 rounded-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Delete</TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TooltipProvider>
            )}

            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="sm:max-w-[640px] rounded-xs border-ink-500 bg-ink-100">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-paper">
                            <Bot className="h-4 w-4 text-paper-dim" />
                            {isEditing ? 'Edit base model' : 'Add base model'}
                        </DialogTitle>
                        <DialogDescription className="text-paper-muted">Define an underlying provider model identifier.</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                                {!isEditing && (
                                    <FormField control={form.control} name="providerId" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className={fieldLabelClass}>Provider</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className={inputClass}>
                                                        <SelectValue placeholder="Select a provider" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                                    {providers.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                )}

                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className={fieldLabelClass}>Name</FormLabel>
                                        <FormControl><Input placeholder="GPT-4o" className={inputClass} {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="modelId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className={fieldLabelClass}>Provider model ID</FormLabel>
                                        <FormControl><Input placeholder="gpt-4o" className={`${inputClass} font-mono`} {...field} /></FormControl>
                                        <FormDescription className="text-[11px] text-paper-faint">The exact ID string expected by the provider (e.g. gpt-4o).</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )} />

                                {providerType && (
                                    <Collapsible open={paramsOpen} onOpenChange={setParamsOpen} className="rounded-xs border border-ink-500 bg-ink-50/30">
                                        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5">
                                            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                                Runtime parameters
                                            </span>
                                            <ChevronDown className={`h-3.5 w-3.5 text-paper-faint transition-transform ${paramsOpen ? 'rotate-180' : ''}`} />
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                            <div className="space-y-5 border-t border-ink-500 px-3 py-4">
                                                <p className="text-[11px] text-paper-faint">
                                                    Optional. Empty fields keep the built-in defaults. Applies to all deployments using this model.
                                                </p>

                                                {PARAM_GROUPS.map(group => {
                                                    const fields = numberFieldsFor(group);
                                                    const showReasoningEnums = group === 'Reasoning';
                                                    const reasoningOptions = REASONING_EFFORT_OPTIONS[providerType];
                                                    const hasEnums = showReasoningEnums && (
                                                        (isAllowed('reasoningEffort') && reasoningOptions.length > 0) || isAllowed('verbosity')
                                                    );
                                                    if (fields.length === 0 && !hasEnums) return null;
                                                    return (
                                                        <div key={group} className="space-y-2.5">
                                                            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">{group}</span>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                {fields.map(field => (
                                                                    <label className="flex flex-col gap-1" key={field.key}>
                                                                        <span className={fieldLabelClass}>{field.label}</span>
                                                                        <Input
                                                                            type="number"
                                                                            min={field.min}
                                                                            max={field.max}
                                                                            step={field.step}
                                                                            placeholder={field.placeholder}
                                                                            value={paramsDraft[field.key] ?? ''}
                                                                            onChange={(e) => setDraftValue(field.key, e.target.value)}
                                                                            className={`h-9 ${inputClass} text-right font-mono text-[13px]`}
                                                                        />
                                                                        <span className="text-[11px] text-paper-faint">{field.description}</span>
                                                                    </label>
                                                                ))}
                                                                {showReasoningEnums && isAllowed('reasoningEffort') && reasoningOptions.length > 0 &&
                                                                    renderEnumSelect('reasoningEffort', 'Reasoning effort', reasoningOptions, 'Reasoning depth for capable models.')}
                                                                {showReasoningEnums && isAllowed('verbosity') &&
                                                                    renderEnumSelect('verbosity', 'Verbosity', VERBOSITY_OPTIONS, 'Response verbosity (GPT-5 family).')}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {isAllowed('stopSequences') && (
                                                    <label className="flex flex-col gap-1">
                                                        <span className={fieldLabelClass}>Stop sequences</span>
                                                        <Textarea
                                                            rows={2}
                                                            placeholder={'One sequence per line'}
                                                            value={stopSeqText}
                                                            onChange={(e) => setStopSeqText(e.target.value)}
                                                            className={`${inputClass} font-mono text-[12px]`}
                                                        />
                                                        <span className="text-[11px] text-paper-faint">Generation stops when any sequence appears.</span>
                                                    </label>
                                                )}

                                                {isAllowed('apiVersion') && (
                                                    <label className="flex flex-col gap-1">
                                                        <span className={fieldLabelClass}>API version</span>
                                                        <Input
                                                            placeholder={providerType === 'azure-openai' ? '2024-10-21' : 'v1beta'}
                                                            value={paramsDraft.apiVersion ?? ''}
                                                            onChange={(e) => setDraftValue('apiVersion', e.target.value)}
                                                            className={`h-9 ${inputClass} font-mono text-[13px]`}
                                                        />
                                                        <span className="text-[11px] text-paper-faint">{providerType === 'azure-openai' ? 'Azure OpenAI api-version (defaults to 2024-10-21).' : 'Google API version override.'}</span>
                                                    </label>
                                                )}

                                                {isAllowed('safetySettings') && (
                                                    <label className="flex flex-col gap-1">
                                                        <span className={fieldLabelClass}>Safety settings (JSON)</span>
                                                        <Textarea
                                                            rows={3}
                                                            placeholder={'[{ "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" }]'}
                                                            value={safetyJson}
                                                            onChange={(e) => setSafetyJson(e.target.value)}
                                                            className={`${inputClass} font-mono text-[12px]`}
                                                        />
                                                        <span className="text-[11px] text-paper-faint">Gemini safety settings, an array of category/threshold pairs.</span>
                                                    </label>
                                                )}

                                                {isAllowed('extra') && (
                                                    <label className="flex flex-col gap-1">
                                                        <span className={fieldLabelClass}>Extra params (JSON)</span>
                                                        <Textarea
                                                            rows={3}
                                                            placeholder={'{ "seed": 42 }'}
                                                            value={extraJson}
                                                            onChange={(e) => setExtraJson(e.target.value)}
                                                            className={`${inputClass} font-mono text-[12px]`}
                                                        />
                                                        <span className="text-[11px] text-paper-faint">
                                                            Advanced: merged into the provider request body (e.g. seed, logit_bias). Reserved keys like model and stream are rejected.
                                                        </span>
                                                    </label>
                                                )}

                                                {paramsError && (
                                                    <p className="rounded-xs border border-red-900/50 bg-red-950/30 px-2.5 py-2 text-[11px] text-red-400">{paramsError}</p>
                                                )}
                                            </div>
                                        </CollapsibleContent>
                                    </Collapsible>
                                )}
                            </div>
                            <DialogFooter className="mt-6">
                                <Button type="submit" disabled={isSubmitting} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
                                    {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isEditing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                    {isEditing ? 'Update' : 'Create'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                isOpen={!!deleteItem}
                onClose={() => setDeleteItem(null)}
                onConfirm={handleDelete}
                title="Delete Base Model"
                description={`Delete <strong>${deleteItem?.name}</strong>? Cannot be undone.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
