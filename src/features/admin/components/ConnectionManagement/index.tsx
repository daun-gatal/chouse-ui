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
import { SkeletonRows } from '@/components/common/Skeletons';

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

  const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
  const INPUT_CLASS =
    "h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";
  const HELP_CLASS = "text-[11px] text-paper-faint";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[520px] rounded-xs border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="border-b border-ink-500 px-5 py-4">
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Server className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                {isEditing ? "Edit server" : "New server"}
              </span>
              <span className="text-[15px] font-semibold tracking-tight">
                {isEditing ? "Edit connection" : "Add connection"}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-[12px] text-paper-muted">
            {isEditing
              ? "Update the ClickHouse server credentials."
              : "Wire up a ClickHouse server — host, port, credentials."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 px-5 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className={LABEL_CLASS}>Connection name</FormLabel>
                  <FormControl>
                    <Input placeholder="Production cluster" className={INPUT_CLASS} {...field} />
                  </FormControl>
                  <FormMessage className="text-[11px] text-red-300" />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem className="col-span-2 space-y-1.5">
                    <FormLabel className={LABEL_CLASS}>Host</FormLabel>
                    <FormControl>
                      <Input placeholder="localhost" className={INPUT_CLASS} {...field} />
                    </FormControl>
                    <FormMessage className="text-[11px] text-red-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={LABEL_CLASS}>Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="8123"
                        className={INPUT_CLASS}
                        {...field}
                        value={field.value ?? 8123}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? 8123 : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage className="text-[11px] text-red-300" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={LABEL_CLASS}>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="default" className={INPUT_CLASS} {...field} />
                    </FormControl>
                    <FormMessage className="text-[11px] text-red-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={cn(LABEL_CLASS, "flex items-center gap-1.5")}>
                      Password
                      {isEditing && (
                        <span className="text-paper-faint normal-case tracking-normal">
                          (leave empty to keep)
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className={cn(INPUT_CLASS, "pr-9")}
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-dim hover:text-paper"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-[11px] text-red-300" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="database"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className={LABEL_CLASS}>Default database (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="default" className={INPUT_CLASS} {...field} />
                  </FormControl>
                  <FormDescription className={HELP_CLASS}>
                    Leave empty to use the server's default database.
                  </FormDescription>
                  <FormMessage className="text-[11px] text-red-300" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sslEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                      {field.value ? (
                        <Lock className="h-3.5 w-3.5 text-brand" aria-hidden />
                      ) : (
                        <Unlock className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <FormLabel className="text-[13px] font-medium text-paper">
                        SSL / TLS
                      </FormLabel>
                      <FormDescription className={HELP_CLASS}>
                        Use HTTPS for secure connections.
                      </FormDescription>
                    </div>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {testResult && (
              <div
                className={cn(
                  "flex flex-col gap-1.5 rounded-xs border px-3 py-2.5",
                  testResult.success
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/30"
                    : "border-red-200 bg-red-50 dark:border-red-500/40 dark:bg-red-950/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-700 dark:text-red-300" />
                  )}
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      testResult.success
                        ? "text-emerald-800 dark:text-emerald-200"
                        : "text-red-800 dark:text-red-200"
                    )}
                  >
                    {testResult.success ? "Connection successful" : "Connection failed"}
                  </span>
                </div>
                {testResult.success && testResult.version && (
                  <div className="flex items-center gap-3 pl-6 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                    <span>v{testResult.version}</span>
                    {testResult.latencyMs && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {testResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                )}
                {!testResult.success && testResult.error && (
                  <p className="pl-6 font-mono text-[11px] leading-[1.5] text-red-700 dark:text-red-300">{testResult.error}</p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 border-t border-ink-500 pt-4 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={isTesting || !form.watch("host") || !form.watch("username")}
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-300 disabled:opacity-50"
              >
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Test connection
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isEditing ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {isEditing ? "Update" : "Create"}
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Server className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">ClickHouse connections</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              Servers, credentials, who can reach them
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConnections}
            disabled={isLoading}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
          {canEdit && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              Add connection
            </Button>
          )}
        </div>
      </div>

      {/* Connections table */}
      {isLoading ? (
        <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
          <table className="w-full">
            <tbody>
              <SkeletonRows count={5} cols={5} />
            </tbody>
          </table>
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
            <Server className="h-5 w-5" aria-hidden />
          </div>
          <h3 className="text-[15px] font-medium text-paper">No connections yet</h3>
          <p className="mt-1 text-[13px] text-paper-muted">Wire up a ClickHouse server — host, port, credentials.</p>
          {canEdit && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="mt-4 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add connection
            </Button>
          )}
        </div>
      ) : (
        <TooltipProvider>
          <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <Table>
              <TableHeader>
                <TableRow className="border-b-ink-500 bg-ink-200 hover:bg-ink-200">
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Host</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">User</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Database</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Users</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id} className="border-ink-500">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-paper">{conn.name}</span>
                        {conn.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                            <Star className="h-3 w-3 fill-brand" />
                            Default
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-paper-muted">
                        {conn.sslEnabled && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            </TooltipTrigger>
                            <TooltipContent>SSL Enabled</TooltipContent>
                          </Tooltip>
                        )}
                        <span className="font-mono text-sm">
                          {conn.host}:{conn.port}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-paper-muted">{conn.username}</TableCell>
                    <TableCell className="text-paper-muted">
                      {conn.database || <span className="text-paper-faint">default</span>}
                    </TableCell>
                    <TableCell>
                      {conn.isActive ? (
                        <span className="status-pill status-success">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <span className="status-pill status-neutral">
                          <X className="h-3 w-3" />
                          Inactive
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openUserAccessDialog(conn)}
                            className="h-8 gap-1.5 text-paper-muted hover:bg-ink-200 hover:text-paper"
                          >
                            <Users className="w-4 h-4" />
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
                              className="h-8 w-8 text-paper-muted hover:bg-ink-200 hover:text-paper"
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
                                  className="h-8 w-8 text-paper-muted hover:bg-ink-200 hover:text-paper"
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
                                  className="h-8 w-8 text-paper-muted hover:bg-ink-200 hover:text-paper"
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
                                className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
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
