import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Lock, Unlock, CheckCircle2, Sliders, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';

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
            toast.error('Failed to update config status');
        }
    };

    const handleMakeDefault = async (item: AiConfig) => {
        try {
            await rbacAiConfigsApi.update(item.id, { isDefault: true });
            toast.success(`"${item.name}" is now the default model`);
            fetchData();
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            toast.error('Failed to update default config');
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
            toast.error('Failed to delete Config');
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
            toast.error(isEditing ? 'Failed to update' : 'Failed to create');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-white">Active Configurations</h3>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all text-white">
                        <Plus className="w-4 h-4 text-white" />
                        <span className="text-white">Add Configuration</span>
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
            ) : configs.length === 0 ? (
                <div className="text-center py-12 border border-gray-800 rounded-lg">
                    <Sliders className="w-12 h-12 mx-auto text-gray-600 mb-4" />
                    <h3 className="text-lg font-medium text-gray-300">No Configurations active</h3>
                    <p className="text-gray-500 mt-1">Expose base models for use</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="rounded-lg border border-gray-800 overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-gray-800 hover:bg-transparent">
                                    <TableHead className="text-gray-400">Deployment Name</TableHead>
                                    <TableHead className="text-gray-400">Base Model (SDK)</TableHead>
                                    <TableHead className="text-gray-400">Provider</TableHead>
                                    <TableHead className="text-gray-400">Status</TableHead>
                                    <TableHead className="text-gray-400 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {configs.map(item => (
                                    <TableRow key={item.id} className="border-gray-800">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white">{item.name}</span>
                                                {item.isDefault && (
                                                    <Badge className="bg-yellow-500/20 text-yellow-400 text-xs px-1">
                                                        <Star className="w-3 h-3 mr-1" /> Default
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-300 font-medium">{item.model?.name || item.modelId}</TableCell>
                                        <TableCell className="text-gray-400">{item.provider?.name}</TableCell>
                                        <TableCell>
                                            {item.isActive ? (
                                                <Badge className="bg-green-500/20 text-green-400"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>
                                            ) : (
                                                <Badge className="bg-gray-500/20 text-gray-400"><Lock className="w-3 h-3 mr-1" />Inactive</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {canEdit && (
                                                    <>
                                                        {!item.isDefault && item.isActive && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button variant="ghost" size="icon" onClick={() => handleMakeDefault(item)} className="h-8 w-8 text-yellow-500 hover:text-yellow-400">
                                                                        <Star className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Set as Default</TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" onClick={() => handleToggleActive(item)} className="h-8 w-8">
                                                                    {item.isActive ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>{item.isActive ? 'Deactivate' : 'Activate'}</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }} className="h-8 w-8">
                                                                    <Pencil className="w-4 h-4 text-white" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Edit</TooltipContent>
                                                        </Tooltip>
                                                    </>
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
                            <Sliders className="w-5 h-5" />
                            {isEditing ? 'Edit Configuration' : 'Add Configuration'}
                        </DialogTitle>
                        <DialogDescription>Create an active deployment pointing to a Base Model.</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {!isEditing && (
                                <FormField control={form.control} name="modelId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Base Model</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="bg-gray-800 border-gray-700">
                                                    <SelectValue placeholder="Select a Base Model" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-gray-800 border-gray-700 text-white">
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
                                    <FormLabel>Deployment Name</FormLabel>
                                    <FormControl><Input placeholder="Main AI Assistant" className="bg-gray-800 border-gray-700" {...field} /></FormControl>
                                    <FormDescription>Friendly name shown to app users.</FormDescription>
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
                title="Delete Configuration"
                description={`Delete <strong>${deleteItem?.name}</strong>? Users will no longer be able to use this configuration.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
