import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Pencil, Trash2, Check, Loader2, Lock, Unlock, CheckCircle2, Server } from 'lucide-react';
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
import { rbacAiProvidersApi, type AiProvider, type CreateAiProviderInput, type UpdateAiProviderInput } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { PROVIDER_TYPES, formatProviderType, type ProviderType } from '@/constants/aiProviders';

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
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-white">Identity & Credentials</h3>
                {canEdit && (
                    <Button size="sm" onClick={() => { setEditingItem(undefined); setIsFormOpen(true); }} className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all">
                        <Plus className="w-4 h-4 text-white" />
                        <span className="text-white">Add Provider</span>
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
            ) : providers.length === 0 ? (
                <div className="text-center py-12 border border-gray-800 rounded-lg">
                    <Server className="w-12 h-12 mx-auto text-gray-600 mb-4" />
                    <h3 className="text-lg font-medium text-gray-300">No Providers configured</h3>
                    <p className="text-gray-500 mt-1">Configure OpenAI, Anthropic, or others</p>
                </div>
            ) : (
                <TooltipProvider>
                    <div className="rounded-lg border border-gray-800 overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-gray-800 hover:bg-transparent">
                                    <TableHead className="text-gray-400">Name</TableHead>
                                    <TableHead className="text-gray-400">Provider Type</TableHead>
                                    <TableHead className="text-gray-400">Base URL</TableHead>
                                    <TableHead className="text-gray-400">Status</TableHead>
                                    <TableHead className="text-gray-400 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {providers.map(item => (
                                    <TableRow key={item.id} className="border-gray-800">
                                        <TableCell className="font-medium text-white">{item.name}</TableCell>
                                        <TableCell className="text-gray-300">{formatProviderType(item.providerType)}</TableCell>
                                        <TableCell className="text-gray-400 font-mono text-sm max-w-xs truncate">{item.baseUrl || 'Default'}</TableCell>
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
                            <Server className="w-5 h-5" />
                            {isEditing ? 'Edit Provider' : 'Add Provider'}
                        </DialogTitle>
                        <DialogDescription>{isEditing ? 'Update API credentials' : 'Add a new API provider'}</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Provider Name</FormLabel>
                                    <FormControl><Input placeholder="OpenAI Production" className="bg-gray-800 border-gray-700" {...field} /></FormControl>
                                    <FormDescription>Display name for this provider (e.g., "OpenAI Production", "Anthropic Dev")</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="providerType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Provider Type</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isEditing}>
                                        <FormControl>
                                            <SelectTrigger className="bg-gray-800 border-gray-700">
                                                <SelectValue placeholder="Select a provider type" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="bg-gray-800 border-gray-700 text-white">
                                            {PROVIDER_TYPES.map(type => (
                                                <SelectItem key={type} value={type}>{formatProviderType(type)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>{isEditing ? 'Provider type cannot be changed after creation' : 'Select the AI provider SDK type'}</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="baseUrl" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Base URL (optional)</FormLabel>
                                    <FormControl><Input placeholder="https://api.openai.com/v1" className="bg-gray-800 border-gray-700" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="apiKey" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>API Key {isEditing && <span className="text-gray-500">(leave empty to keep current)</span>}</FormLabel>
                                    <FormControl><Input type="password" placeholder="sk-..." className="bg-gray-800 border-gray-700" {...field} /></FormControl>
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
                title="Delete Provider"
                description={`Delete <strong>${deleteItem?.name}</strong>? Cannot be undone.`}
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}
