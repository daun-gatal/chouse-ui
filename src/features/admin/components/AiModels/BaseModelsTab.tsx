import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import {
    rbacAiBaseModelsApi, rbacAiProvidersApi,
    type AiBaseModel, type AiProvider,
    type CreateAiBaseModelInput, type UpdateAiBaseModelInput
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { SkeletonRows } from '@/components/common/Skeletons';

const baseModelSchema = z.object({
    providerId: z.string().min(1, 'Provider is required'),
    name: z.string().min(1, 'Name is required').max(255),
    modelId: z.string().min(1, 'Model ID is required').max(255),
});

type BaseModelFormData = z.infer<typeof baseModelSchema>;

export default function BaseModelsTab() {
    const [models, setModels] = useState<AiBaseModel[]>([]);
    const [providers, setProviders] = useState<AiProvider[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<AiBaseModel | undefined>();
    const [deleteItem, setDeleteItem] = useState<AiBaseModel | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { hasPermission } = useRbacStore();
    const canEdit = hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE) || hasPermission(RBAC_PERMISSIONS.AI_MODELS_CREATE);
    const canDelete = hasPermission(RBAC_PERMISSIONS.AI_MODELS_DELETE);

    const form = useForm<BaseModelFormData>({
        resolver: zodResolver(baseModelSchema),
        defaultValues: { providerId: '', name: '', modelId: '' },
    });

    const isEditing = !!editingItem;

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
        }
    }, [isFormOpen, editingItem, form]);

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
        setIsSubmitting(true);
        try {
            if (isEditing) {
                const updateData: UpdateAiBaseModelInput = {
                    name: values.name,
                    modelId: values.modelId,
                };
                await rbacAiBaseModelsApi.update(editingItem.id, updateData);
                toast.success('Base Model updated');
            } else {
                const createData: CreateAiBaseModelInput = {
                    providerId: values.providerId,
                    name: values.name,
                    modelId: values.modelId,
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

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>SDK models</span>
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
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">SDK model ID</TableHead>
                                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {models.map(item => (
                                    <TableRow key={item.id} className="border-ink-500">
                                        <TableCell className="font-medium text-paper">{item.name}</TableCell>
                                        <TableCell className="text-paper-muted">{getProviderName(item.providerId)}</TableCell>
                                        <TableCell className="max-w-xs font-mono text-[12px] text-paper-dim">{item.modelId}</TableCell>
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
                <DialogContent className="sm:max-w-[500px] rounded-xs border-ink-500 bg-ink-100">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-paper">
                            <Bot className="h-4 w-4 text-paper-dim" />
                            {isEditing ? 'Edit base model' : 'Add base model'}
                        </DialogTitle>
                        <DialogDescription className="text-paper-muted">Define an underlying SDK model identifier.</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {!isEditing && (
                                <FormField control={form.control} name="providerId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
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
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</FormLabel>
                                    <FormControl><Input placeholder="GPT-4o" className="rounded-xs border-ink-500 bg-ink-200 text-paper" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="modelId" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">SDK model ID</FormLabel>
                                    <FormControl><Input placeholder="gpt-4o" className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper" {...field} /></FormControl>
                                    <FormDescription className="text-[11px] text-paper-faint">The exact ID string expected by the provider (e.g. gpt-4o).</FormDescription>
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
                title="Delete Base Model"
                description={`Delete <strong>${deleteItem?.name}</strong>? Cannot be undone.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
