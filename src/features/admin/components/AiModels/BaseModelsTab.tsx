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
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-white">SDK Models</h3>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all text-white">
                        <Plus className="w-4 h-4 text-white" />
                        <span className="text-white">Add Base Model</span>
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
            ) : models.length === 0 ? (
                <div className="text-center py-12 border border-gray-800 rounded-lg">
                    <Bot className="w-12 h-12 mx-auto text-gray-600 mb-4" />
                    <h3 className="text-lg font-medium text-gray-300">No Base Models configured</h3>
                    <p className="text-gray-500 mt-1">Add underlying provider models (e.g. gpt-4o, claude-3-5-sonnet-20240620)</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="rounded-lg border border-gray-800 overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-gray-800 hover:bg-transparent">
                                    <TableHead className="text-gray-400">Name</TableHead>
                                    <TableHead className="text-gray-400">Provider</TableHead>
                                    <TableHead className="text-gray-400">SDK Model ID</TableHead>
                                    <TableHead className="text-gray-400 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {models.map(item => (
                                    <TableRow key={item.id} className="border-gray-800">
                                        <TableCell className="font-medium text-white">{item.name}</TableCell>
                                        <TableCell className="text-gray-300 font-medium">{getProviderName(item.providerId)}</TableCell>
                                        <TableCell className="text-gray-400 font-mono text-sm max-w-xs">{item.modelId}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {canEdit && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }} className="h-8 w-8">
                                                                <Pencil className="w-4 h-4 text-white" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Edit</TooltipContent>
                                                    </Tooltip>
                                                )}
                                                {canDelete && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" onClick={() => setDeleteItem(item)} className="h-8 w-8 text-red-400 hover:text-red-300">
                                                                <Trash2 className="w-4 h-4" />
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
                <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-800">
                    <DialogHeader>
                        <DialogTitle className="text-white flex items-center gap-2">
                            <Bot className="w-5 h-5" />
                            {isEditing ? 'Edit Base Model' : 'Add Base Model'}
                        </DialogTitle>
                        <DialogDescription>Define an underlying SDK model identifier</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {!isEditing && (
                                <FormField control={form.control} name="providerId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Provider</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="bg-gray-800 border-gray-700">
                                                    <SelectValue placeholder="Select a Provider" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-gray-800 border-gray-700 text-white">
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
                                    <FormLabel>Name</FormLabel>
                                    <FormControl><Input placeholder="GPT-4o" className="bg-gray-800 border-gray-700" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="modelId" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>SDK Model ID</FormLabel>
                                    <FormControl><Input placeholder="gpt-4o" className="bg-gray-800 border-gray-700 font-mono" {...field} /></FormControl>
                                    <FormDescription>The exact ID string expected by the provider (e.g. gpt-4o)</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <DialogFooter className="mt-6">
                                <Button type="submit" disabled={isSubmitting} className="bg-white/10 hover:bg-white/20 text-white">
                                    {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : isEditing ? <Check className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
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
