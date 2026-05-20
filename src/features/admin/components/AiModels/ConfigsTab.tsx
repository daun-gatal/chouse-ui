import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Lock, Unlock, CheckCircle2, Sliders, Star } from 'lucide-react';
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
    rbacAiConfigsApi, rbacAiBaseModelsApi,
    type AiConfig, type AiBaseModel,
    type CreateAiConfigInput, type UpdateAiConfigInput
} from '@/api/rbac';
import { ApiError } from '@/api/client';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { SkeletonRows } from '@/components/common/Skeletons';

const configSchema = z.object({
    modelId: z.string().min(1, 'Model is required'),
    name: z.string().min(1, 'Name is required').max(255),
});

type ConfigFormData = z.infer<typeof configSchema>;

export default function ConfigsTab() {
    const [configs, setConfigs] = useState<AiConfig[]>([]);
    const [baseModels, setBaseModels] = useState<AiBaseModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<AiConfig | undefined>();
    const [deleteItem, setDeleteItem] = useState<AiConfig | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { hasPermission } = useRbacStore();
    const canEdit = hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE) || hasPermission(RBAC_PERMISSIONS.AI_MODELS_CREATE);
    const canDelete = hasPermission(RBAC_PERMISSIONS.AI_MODELS_DELETE);

    const form = useForm<ConfigFormData>({
        resolver: zodResolver(configSchema),
        defaultValues: { modelId: '', name: '' },
    });

    const isEditing = !!editingItem;

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [configsData, baseModelsData] = await Promise.all([
                rbacAiConfigsApi.list(),
                rbacAiBaseModelsApi.list()
            ]);
            setConfigs(configsData.configs);
            setBaseModels(baseModelsData);
        } catch (error) {
            toast.error('Failed to load Configurations');
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
                modelId: editingItem?.modelId || '',
                name: editingItem?.name || '',
            });
        }
    }, [isFormOpen, editingItem, form]);

    const handleToggleActive = async (item: AiConfig) => {
        try {
            await rbacAiConfigsApi.update(item.id, { isActive: !item.isActive });
            toast.success(`"${item.name}" is now ${!item.isActive ? 'active' : 'inactive'}`);
            fetchData();
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            const errorMessage = error instanceof ApiError ? error.message : 'Failed to update config status';
            toast.error(errorMessage);
        }
    };

    const handleMakeDefault = async (item: AiConfig) => {
        try {
            await rbacAiConfigsApi.update(item.id, { isDefault: true });
            toast.success(`"${item.name}" is now the default model`);
            fetchData();
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            const errorMessage = error instanceof ApiError ? error.message : 'Failed to update default config';
            toast.error(errorMessage);
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await rbacAiConfigsApi.delete(deleteItem.id);
            toast.success(`"${deleteItem.name}" deleted`);
            setDeleteItem(null);
            fetchData();
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            const errorMessage = error instanceof ApiError ? error.message : 'Failed to delete Config';
            toast.error(errorMessage);
        }
    };

    const onSubmit = async (values: ConfigFormData) => {
        setIsSubmitting(true);
        try {
            if (isEditing) {
                const updateData: UpdateAiConfigInput = { name: values.name };
                await rbacAiConfigsApi.update(editingItem.id, updateData);
                toast.success('Config updated');
            } else {
                const createData: CreateAiConfigInput = {
                    modelId: values.modelId,
                    name: values.name,
                };
                await rbacAiConfigsApi.create(createData);
                toast.success('Config created');
            }
            fetchData();
            setIsFormOpen(false);
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            const defaultMessage = isEditing ? 'Failed to update' : 'Failed to create';
            const errorMessage = error instanceof ApiError ? error.message : defaultMessage;
            toast.error(errorMessage);
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
                        <span>Active deployments</span>
                    </span>
                    <p className="text-[12px] text-paper-muted">User-facing configurations pointing to a base model.</p>
                </div>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add configuration</span>
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
            ) : configs.length === 0 ? (
                <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
                    <Sliders className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No configurations active</h3>
                    <p className="mt-2 text-[12px] text-paper-muted">Expose base models for use across the app.</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-ink-500 hover:bg-transparent">
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Deployment name</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Base model (SDK)</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider</TableHead>
                                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Status</TableHead>
                                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {configs.map(item => (
                                    <TableRow key={item.id} className="border-ink-500">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-paper">{item.name}</span>
                                                {item.isDefault && (
                                                    <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                                        <Star className="h-3 w-3" /> Default
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-paper-muted">{item.model?.name || item.modelId}</TableCell>
                                        <TableCell className="text-paper-dim">{item.provider?.name}</TableCell>
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
                                                        {!item.isDefault && item.isActive && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button variant="ghost" size="icon" onClick={() => handleMakeDefault(item)} className="h-8 w-8 rounded-xs text-brand hover:bg-brand/10 hover:text-brand-soft">
                                                                        <Star className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Set as default</TooltipContent>
                                                            </Tooltip>
                                                        )}
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
                            <Sliders className="h-4 w-4 text-paper-dim" />
                            {isEditing ? 'Edit configuration' : 'Add configuration'}
                        </DialogTitle>
                        <DialogDescription className="text-paper-muted">Create an active deployment pointing to a base model.</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {!isEditing && (
                                <FormField control={form.control} name="modelId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Base model</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                                                    <SelectValue placeholder="Select a base model" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                                {baseModels.map(bm => (
                                                    <SelectItem key={bm.id} value={bm.id}>{bm.name} ({bm.modelId})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            )}

                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Deployment name</FormLabel>
                                    <FormControl><Input placeholder="Main AI Assistant" className="rounded-xs border-ink-500 bg-ink-200 text-paper" {...field} /></FormControl>
                                    <FormDescription className="text-[11px] text-paper-faint">Friendly name shown to app users.</FormDescription>
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
                title="Delete Configuration"
                description={`Delete <strong>${deleteItem?.name}</strong>? Users will no longer be able to use this configuration.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
