import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Lock, Unlock, CheckCircle2, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import { rbacAiProvidersApi, type AiProvider, type CreateAiProviderInput, type UpdateAiProviderInput } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { PROVIDER_TYPES, formatProviderType, type ProviderType } from '@/constants/aiProviders';
import { SkeletonRows } from '@/components/common/Skeletons';

const providerSchema = z.object({
    name: z.string().min(1, 'Name is required').max(255),
    providerType: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
    baseUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    apiKey: z.string().optional(),
});

type ProviderFormData = z.infer<typeof providerSchema>;

export default function ProvidersTab() {
    const [providers, setProviders] = useState<AiProvider[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<AiProvider | undefined>();
    const [deleteItem, setDeleteItem] = useState<AiProvider | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { hasPermission } = useRbacStore();
    const canEdit = hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE) || hasPermission(RBAC_PERMISSIONS.AI_MODELS_CREATE);
    const canDelete = hasPermission(RBAC_PERMISSIONS.AI_MODELS_DELETE);

    const form = useForm<ProviderFormData>({
        resolver: zodResolver(providerSchema),
        defaultValues: { name: '', providerType: 'openai' as const, baseUrl: '', apiKey: '' },
    });

    const isEditing = !!editingItem;

    const fetchProviders = async () => {
        setIsLoading(true);
        try {
            const data = await rbacAiProvidersApi.list();
            setProviders(data);
        } catch (error) {
            toast.error('Failed to load AI Providers');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProviders();
    }, []);

    useEffect(() => {
        if (isFormOpen) {
            form.reset({
                name: editingItem?.name || '',
                providerType: editingItem?.providerType || 'openai' as const,
                baseUrl: editingItem?.baseUrl || '',
                apiKey: '',
            });
        }
    }, [isFormOpen, editingItem, form]);

    const handleToggleActive = async (item: AiProvider) => {
        try {
            await rbacAiProvidersApi.update(item.id, { isActive: !item.isActive });
            toast.success(`"${item.name}" is now ${!item.isActive ? 'active' : 'inactive'}`);
            fetchProviders();
        } catch (error) {
            toast.error('Failed to update Provider status');
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await rbacAiProvidersApi.delete(deleteItem.id);
            toast.success(`"${deleteItem.name}" deleted`);
            setDeleteItem(null);
            fetchProviders();
        } catch (error: any) {
            toast.error(error.message || 'Failed to delete Provider');
        }
    };

    const onSubmit = async (values: ProviderFormData) => {
        setIsSubmitting(true);
        try {
            if (isEditing) {
                const updateData: UpdateAiProviderInput = {
                    name: values.name,
                    providerType: values.providerType as ProviderType,
                    baseUrl: values.baseUrl || null,
                };
                if (values.apiKey) updateData.apiKey = values.apiKey;
                await rbacAiProvidersApi.update(editingItem.id, updateData);
                toast.success('Provider updated');
            } else {
                if (!values.apiKey) {
                    toast.error('API Key is required for new providers');
                    setIsSubmitting(false);
                    return;
                }
                const createData: CreateAiProviderInput = {
                    name: values.name,
                    providerType: values.providerType as ProviderType,
                    baseUrl: values.baseUrl || null,
                    apiKey: values.apiKey
                };
                await rbacAiProvidersApi.create(createData);
                toast.success('Provider created');
            }
            fetchProviders();
            setIsFormOpen(false);
        } catch (error) {
            toast.error(isEditing ? 'Failed to update' : 'Failed to create');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>Identity & credentials</span>
                    </span>
                    <p className="text-[12px] text-paper-muted">API providers, endpoints, and stored secrets.</p>
                </div>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add provider</span>
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                    <table className="w-full">
                        <tbody>
                            <SkeletonRows count={5} cols={5} />
                        </tbody>
                    </table>
                </div>
            ) : providers.length === 0 ? (
                <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
                    <Server className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No providers configured</h3>
                    <p className="mt-2 text-[12px] text-paper-muted">Configure OpenAI, Anthropic, or other compatible APIs.</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-ink-500 hover:bg-transparent">
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider type</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Base URL</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Status</TableHead>
                                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {providers.map(item => (
                                    <TableRow key={item.id} className="border-ink-500">
                                        <TableCell className="font-medium text-paper">{item.name}</TableCell>
                                        <TableCell className="text-paper-muted">{formatProviderType(item.providerType)}</TableCell>
                                        <TableCell className="max-w-xs truncate font-mono text-[12px] text-paper-dim">{item.baseUrl || 'Default'}</TableCell>
                                        <TableCell>
                                            {item.isActive ? (
                                                <span className="inline-flex items-center gap-1 rounded-xs border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                    <CheckCircle2 className="h-3 w-3" />Active
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                                    <Lock className="h-3 w-3" />Inactive
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {canEdit && (
                                                    <>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" onClick={() => handleToggleActive(item)} className="h-8 w-8 rounded-xs text-paper-muted hover:bg-ink-200 hover:text-paper">
                                                                    {item.isActive ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>{item.isActive ? 'Deactivate' : 'Activate'}</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }} className="h-8 w-8 rounded-xs text-paper-muted hover:bg-ink-200 hover:text-paper">
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Edit</TooltipContent>
                                                        </Tooltip>
                                                    </>
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
                <DialogContent className="sm:max-w-[500px] rounded-xs border-ink-500 bg-ink-100">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-paper">
                            <Server className="h-4 w-4 text-paper-dim" />
                            {isEditing ? 'Edit provider' : 'Add provider'}
                        </DialogTitle>
                        <DialogDescription className="text-paper-muted">{isEditing ? 'Update API credentials.' : 'Add a new API provider.'}</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider name</FormLabel>
                                    <FormControl><Input placeholder="OpenAI Production" className="rounded-xs border-ink-500 bg-ink-200 text-paper" {...field} /></FormControl>
                                    <FormDescription className="text-[11px] text-paper-faint">Display name for this provider (e.g., "OpenAI Production", "Anthropic Dev").</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="providerType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider type</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isEditing}>
                                        <FormControl>
                                            <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                                                <SelectValue placeholder="Select a provider type" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                            {PROVIDER_TYPES.map(type => (
                                                <SelectItem key={type} value={type}>{formatProviderType(type)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription className="text-[11px] text-paper-faint">{isEditing ? 'Provider type cannot be changed after creation.' : 'Select the AI provider SDK type.'}</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="baseUrl" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Base URL <span className="text-paper-faint">(optional)</span></FormLabel>
                                    <FormControl><Input placeholder="https://api.openai.com/v1" className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="apiKey" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">API key {isEditing && <span className="text-paper-faint normal-case tracking-normal">(leave empty to keep current)</span>}</FormLabel>
                                    <FormControl><Input type="password" placeholder="sk-..." className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
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
                title="Delete Provider"
                description={`Delete <strong>${deleteItem?.name}</strong>? Cannot be undone.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
