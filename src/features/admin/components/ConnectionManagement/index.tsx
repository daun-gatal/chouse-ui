/**
 * Connection Management Component
 * 
 * Manages ClickHouse server connections with CRUD operations.
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from "@/lib/utils";
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Check,
  X,
  Star,
  Play,
  Loader2,
  Eye,
  EyeOff,
  Database,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import {
  rbacConnectionsApi,
  type ClickHouseConnection,
  type CreateConnectionInput,
  type TestConnectionResult,
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import ConnectionUserAccess from './ConnectionUserAccess';

// ============================================
// Validation Schema
// ============================================

const connectionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  host: z.string().min(1, 'Host is required').max(255),
  port: z.coerce.number().int().default(8123),
  username: z.string().min(1, 'Username is required').max(255),
  password: z.string().optional(),
  database: z.string().max(255).optional(),
  sslEnabled: z.boolean(),
});

type ConnectionFormData = z.output<typeof connectionSchema>;

// ============================================
// Connection Form Dialog
// ============================================

interface ConnectionFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connection?: ClickHouseConnection;
  onSuccess: () => void;
}

function ConnectionFormDialog({
  isOpen,
  onClose,
  connection,
  onSuccess,
}: ConnectionFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!connection;

  const form = useForm<ConnectionFormData>({
    resolver: zodResolver(connectionSchema) as any,
    defaultValues: {
      name: connection?.name || '',
      host: connection?.host || '',
      port: connection?.port || 8123,
      username: connection?.username || '',
      password: '',
      database: connection?.database || '',
      sslEnabled: connection?.sslEnabled || false,
    },
  });

  // Reset form when dialog opens/closes or connection changes
  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: connection?.name || '',
        host: connection?.host || '',
        port: connection?.port || 8123,
        username: connection?.username || '',
        password: '',
        database: connection?.database || '',
        sslEnabled: connection?.sslEnabled || false,
      });
      setTestResult(null);
    }
  }, [isOpen, connection, form]);

  const handleTest = async () => {
    const values = form.getValues();
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await rbacConnectionsApi.test({
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        sslEnabled: values.sslEnabled,
      });
      setTestResult(result);

      if (result.success) {
        toast.success('Connection successful!', {
          description: `Version: ${result.version}`,
        });
      } else {
        toast.error('Connection failed', {
          description: result.error,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Test failed';
      setTestResult({ success: false, error: errorMsg });
      toast.error('Connection test failed', { description: errorMsg });
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (values: ConnectionFormData) => {
    setIsSubmitting(true);

    try {
      if (isEditing) {
        // Only include password if it was changed
        const updateData: Partial<CreateConnectionInput> = {
          name: values.name,
          host: values.host,
          port: values.port,
          username: values.username,
          database: values.database || undefined,
          sslEnabled: values.sslEnabled,
        };
        if (values.password) {
          updateData.password = values.password;
        }
        await rbacConnectionsApi.update(connection.id, updateData);
        toast.success('Connection updated successfully');
      } else {
        await rbacConnectionsApi.create(values);
        toast.success('Connection created successfully');
      }
      onSuccess();
      onClose();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Operation failed';
      toast.error(isEditing ? 'Failed to update connection' : 'Failed to create connection', {
        description: errorMsg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-800">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Server className="w-5 h-5" />
            {isEditing ? 'Edit Connection' : 'Add Connection'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the ClickHouse connection details.'
              : 'Add a new ClickHouse server connection.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Connection Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Production Cluster"
                      className="bg-gray-800 border-gray-700"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Host</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="localhost"
                        className="bg-gray-800 border-gray-700"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="8123"
                        className="bg-gray-800 border-gray-700"
                        {...field}
                        value={field.value ?? 8123}
                        onChange={(e) => field.onChange(e.target.value === '' ? 8123 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="default"
                        className="bg-gray-800 border-gray-700"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Password {isEditing && <span className="text-gray-500">(leave empty to keep)</span>}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          className="bg-gray-800 border-gray-700 pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2 top-2.5 text-gray-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="database"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Database (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="default"
                      className="bg-gray-800 border-gray-700"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Leave empty to use the server's default database
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sslEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border border-gray-700 p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      SSL/TLS Enabled
                    </FormLabel>
                    <FormDescription>
                      Use HTTPS for secure connections
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Test Result */}
            {testResult && (
              <div
                className={`p-3 rounded-lg border ${testResult.success
                  ? 'bg-green-500/10 border-green-500/20'
                  : 'bg-red-500/10 border-red-500/20'
                  }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className={testResult.success ? 'text-green-300' : 'text-red-300'}>
                    {testResult.success ? 'Connection successful' : 'Connection failed'}
                  </span>
                </div>
                {testResult.success && testResult.version && (
                  <div className="mt-2 text-sm text-gray-400">
                    <span>Version: {testResult.version}</span>
                    {testResult.latencyMs && (
                      <span className="ml-3">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {testResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                )}
                {!testResult.success && testResult.error && (
                  <p className="mt-1 text-sm text-red-400">{testResult.error}</p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={isTesting || !form.watch('host') || !form.watch('username')}
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                type="submit"
                variant="outline"
                disabled={isSubmitting}
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : isEditing ? (
                  <Check className="w-4 h-4 mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                {isEditing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Main Component
// ============================================

export default function ConnectionManagement() {
  const [connections, setConnections] = useState<ClickHouseConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ClickHouseConnection | undefined>();
  const [deleteConnection, setDeleteConnection] = useState<ClickHouseConnection | null>(null);
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null);
  const [userAccessConnection, setUserAccessConnection] = useState<ClickHouseConnection | null>(null);

  const { hasPermission } = useRbacStore();
  const canEdit = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_EDIT);
  const canDelete = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_DELETE);

  const fetchConnections = async () => {
    setIsLoading(true);
    try {
      const result = await rbacConnectionsApi.list();
      setConnections(result.connections);
    } catch (error) {
      toast.error('Failed to load connections');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);



  const handleToggleActive = async (connection: ClickHouseConnection) => {
    try {
      await rbacConnectionsApi.update(connection.id, {
        isActive: !connection.isActive,
      });
      toast.success(
        connection.isActive
          ? `"${connection.name}" has been deactivated`
          : `"${connection.name}" has been activated`
      );
      fetchConnections();
    } catch (error) {
      toast.error('Failed to update connection');
    }
  };

  const handleDelete = async () => {
    if (!deleteConnection) return;

    try {
      await rbacConnectionsApi.delete(deleteConnection.id);
      toast.success(`"${deleteConnection.name}" has been deleted`);
      setDeleteConnection(null);
      fetchConnections();
    } catch (error) {
      toast.error('Failed to delete connection');
    }
  };

  const handleTest = async (connection: ClickHouseConnection) => {
    setTestingConnectionId(connection.id);
    try {
      const result = await rbacConnectionsApi.testSaved(connection.id);
      if (result.success) {
        toast.success(`"${connection.name}" is reachable`, {
          description: `Version: ${result.version}, Latency: ${result.latencyMs}ms`,
        });
      } else {
        toast.error(`"${connection.name}" is unreachable`, {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error('Connection test failed');
    } finally {
      setTestingConnectionId(null);
    }
  };

  const openCreateDialog = () => {
    setEditingConnection(undefined);
    setIsFormOpen(true);
  };

  const openEditDialog = (connection: ClickHouseConnection) => {
    setEditingConnection(connection);
    setIsFormOpen(true);
  };

  const openUserAccessDialog = (connection: ClickHouseConnection) => {
    setUserAccessConnection(connection);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">ClickHouse Connections</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage your ClickHouse server connections
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConnections}
            disabled={isLoading}
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={openCreateDialog}
              className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Connection
            </Button>
          )}
        </div>
      </div>

      {/* Connections Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-12">
          <Server className="w-12 h-12 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-300">No connections configured</h3>
          <p className="text-gray-500 mt-1">Add your first ClickHouse connection to get started</p>
          {canEdit && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="mt-4 bg-purple-600 hover:bg-purple-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Connection
            </Button>
          )}
        </div>
      ) : (
        <TooltipProvider>
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Name</TableHead>
                  <TableHead className="text-gray-400">Host</TableHead>
                  <TableHead className="text-gray-400">User</TableHead>
                  <TableHead className="text-gray-400">Database</TableHead>
                  <TableHead className="text-gray-400">Status</TableHead>
                  <TableHead className="text-gray-400">Users</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id} className="border-gray-800">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{conn.name}</span>
                        {conn.isDefault && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                            <Star className="w-3 h-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-gray-300">
                        {conn.sslEnabled && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Lock className="w-3 h-3 text-green-400" />
                            </TooltipTrigger>
                            <TooltipContent>SSL Enabled</TooltipContent>
                          </Tooltip>
                        )}
                        <span className="font-mono text-sm">
                          {conn.host}:{conn.port}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-300">{conn.username}</TableCell>
                    <TableCell className="text-gray-400">
                      {conn.database || <span className="text-gray-600">default</span>}
                    </TableCell>
                    <TableCell>
                      {conn.isActive ? (
                        <Badge className="bg-green-500/20 text-green-400">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-500/20 text-gray-400">
                          <X className="w-3 h-3 mr-1" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openUserAccessDialog(conn)}
                            className="h-8 text-gray-300 hover:text-white"
                          >
                            <Users className="w-4 h-4 mr-1" />
                            Manage Access
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Manage user access to this connection</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTest(conn)}
                              disabled={testingConnectionId === conn.id}
                              className="h-8 w-8"
                            >
                              {testingConnectionId === conn.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Play className="w-4 h-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Test Connection</TooltipContent>
                        </Tooltip>

                        {canEdit && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleToggleActive(conn)}
                                  className="h-8 w-8"
                                >
                                  {conn.isActive ? (
                                    <Unlock className="w-4 h-4" />
                                  ) : (
                                    <Lock className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {conn.isActive ? 'Deactivate' : 'Activate'}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditDialog(conn)}
                                  className="h-8 w-8"
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                          </>
                        )}

                        {canDelete && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteConnection(conn)}
                                className="h-8 w-8 text-red-400 hover:text-red-300"
                              >
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

      {/* Create/Edit Dialog */}
      <ConnectionFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        connection={editingConnection}
        onSuccess={fetchConnections}
      />

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={!!deleteConnection}
        onClose={() => setDeleteConnection(null)}
        onConfirm={handleDelete}
        title="Delete Connection"
        description={`Are you sure you want to delete <strong>${deleteConnection?.name}</strong>? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      {/* User Access Dialog */}
      {userAccessConnection && (
        <ConnectionUserAccess
          connection={userAccessConnection}
          isOpen={!!userAccessConnection}
          onClose={() => setUserAccessConnection(null)}
          onUpdate={fetchConnections}
        />
      )}
    </div>
  );
}
