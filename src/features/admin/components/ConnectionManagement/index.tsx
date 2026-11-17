/**
 * Connection Management: the list of ClickHouse connections, with who can
 * query each one, and the connection panel for creating and editing them.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Star,
  Play,
  Loader2,
  Lock,
  Unlock,
  CheckCircle2,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { rbacConnectionsApi, type ClickHouseConnection } from "@/api/rbac";
import { IDENTITY_MODE_SHARED, identityKind, identityKindLabel } from "@/api/connectionIdentity";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { SkeletonRows } from "@/components/common/Skeletons";
import { CollectorSchedule } from "@/features/observe/CollectorSchedule";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { ConnectionPanel } from "./ConnectionPanel";
import { connectionEnvironment, loginPill, readinessPill, type PanelTab } from "./loginForm";
import { KindBadge, StatusPill } from "./panelParts";
import { optionalSummary, privilegeSummary } from "./PrivilegeReport";

/** Which connection the panel shows, on which tab; a new `seq` remounts it. */
interface PanelRequest {
  /** Null creates a connection. */
  connectionId: string | null;
  tab: PanelTab;
  seq: number;
}

/** The health of a role-ceiling or personal login; one that does not pass opens the ClickHouse login tab. */
function LoginCell({ connection, onOpen }: { connection: ClickHouseConnection; onOpen?: () => void }) {
  const pill = loginPill(connection);
  if (!pill) return <span className="text-paper-faint">—</span>;
  // Nobody can query until the login passes, so a failing or unchecked one leads to where it is fixed.
  const opens = pill.tone !== "ok" && onOpen !== undefined;
  const reason = connection.identityHealthReason ?? (pill.tone === "bad" ? "The ClickHouse login is failing its checks." : undefined);
  return (
    <StatusPill
      pill={pill}
      dot
      title={reason}
      onClick={opens ? onOpen : undefined}
      ariaLabel={opens ? `ClickHouse login of ${connection.name}: ${pill.label}` : undefined}
    />
  );
}

/** Who can query, in a few words; opens the Who can query tab. */
function ReadinessCell({ connection, onOpen }: { connection: ClickHouseConnection; onOpen?: () => void }) {
  const pill = readinessPill(connection);
  if (!pill) return <span className="text-paper-faint">—</span>;
  return <StatusPill pill={pill} onClick={onOpen} ariaLabel={onOpen ? `Who can query ${connection.name}: ${pill.label}` : undefined} />;
}

// ============================================
// Main Component
// ============================================

export default function ConnectionManagement() {
  const [connections, setConnections] = useState<ClickHouseConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConnection, setDeleteConnection] = useState<ClickHouseConnection | null>(null);
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /** By id, so the panel follows the list when a save refreshes it. */
  const [panel, setPanel] = useState<PanelRequest | null>(null);
  /** The connection Create just made, shown until the reloaded list carries it. */
  const [created, setCreated] = useState<ClickHouseConnection | null>(null);

  const { hasPermission } = useRbacStore();
  const canView = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canEdit = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_EDIT);
  const canDelete = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_DELETE);

  /** Reloads the list without blanking the table, and resolves to it (empty when the read failed). */
  const reloadConnections = useCallback(async (): Promise<ClickHouseConnection[]> => {
    try {
      const result = await rbacConnectionsApi.list();
      setConnections(result.connections);
      return result.connections;
    } catch (error) {
      log.error("[ConnectionManagement] Failed to load connections", { errorMessage: error instanceof Error ? error.message : String(error) });
      toast.error("Failed to load connections");
      return [];
    }
  }, []);

  const fetchConnections = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await reloadConnections();
    setIsLoading(false);
  }, [reloadConnections]);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

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
      void reloadConnections();
    } catch (error) {
      toast.error("Failed to update connection", { description: error instanceof Error ? error.message : undefined });
    }
  };

  const handleDelete = async () => {
    if (!deleteConnection) return;

    try {
      await rbacConnectionsApi.delete(deleteConnection.id);
      toast.success(`"${deleteConnection.name}" has been deleted`);
      setDeleteConnection(null);
      void reloadConnections();
    } catch (error) {
      toast.error("Failed to delete connection");
    }
  };

  const handleTest = async (connection: ClickHouseConnection) => {
    setTestingConnectionId(connection.id);
    try {
      const result = await rbacConnectionsApi.testSaved(connection.id);
      if (result.success && result.privileges && !result.privileges.ok) {
        toast.warning(`"${connection.name}" is reachable, but privileges are missing`, {
          description: `${privilegeSummary(result.privileges)} Open Edit and test it to see the grants.`,
        });
      } else if (result.success && result.privileges && optionalSummary(result.privileges)) {
        toast.warning(`"${connection.name}" is reachable`, {
          description: `${optionalSummary(result.privileges)} Open Edit and test it to see the grants.`,
        });
      } else if (result.success) {
        toast.success(`"${connection.name}" is reachable`, {
          description: `Version: ${result.version}, Latency: ${result.latencyMs}ms`,
        });
      } else {
        toast.error(`"${connection.name}" is unreachable`, {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error("Connection test failed");
    } finally {
      setTestingConnectionId(null);
    }
  };

  const openPanel = (connectionId: string | null, tab: PanelTab): void => {
    setCreated(null);
    setPanel((previous) => ({ connectionId, tab, seq: (previous?.seq ?? 0) + 1 }));
  };

  /** After Create the panel edits the new connection, on Who can query. It is not selected in the app. */
  const handleCreated = (connection: ClickHouseConnection): void => {
    setCreated(connection);
    setPanel((previous) => ({ connectionId: connection.id, tab: "who", seq: (previous?.seq ?? 0) + 1 }));
    void reloadConnections();
  };

  const panelConnection = panel?.connectionId
    ? connections.find((conn) => conn.id === panel.connectionId) ?? (created?.id === panel.connectionId ? created : null)
    : null;

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
          {canView && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScheduleOpen(true)}
              className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
            >
              <Timer className="h-3.5 w-3.5" />
              Collection schedule
            </Button>
          )}
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
              onClick={() => openPanel(null, "general")}
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
              <SkeletonRows count={5} cols={8} />
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
              onClick={() => openPanel(null, "general")}
              className="mt-4 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add connection
            </Button>
          )}
        </div>
      ) : (
        <TooltipProvider>
          <div className="overflow-x-auto rounded-md border border-ink-500 bg-ink-100">
            <Table>
              <TableHeader>
                <TableRow className="border-b-ink-500 bg-ink-200 hover:bg-ink-200">
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Host</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">User</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Database</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Login</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Who can query</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Status</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id} className="border-ink-500">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-paper">{conn.name}</span>
                        {connectionEnvironment(conn) === 'production' && (
                          <span title="AI changes on this connection are checked one step harder" className="inline-flex items-center rounded-xs border border-red-400/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-400">
                            Production
                          </span>
                        )}
                        {conn.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                            <Star className="h-3 w-3 fill-brand" />
                            Default
                          </span>
                        )}
                        {identityKind(conn.identityMode) !== IDENTITY_MODE_SHARED && <KindBadge label={identityKindLabel(conn.identityMode)} />}
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
                      <LoginCell connection={conn} onOpen={canEdit ? () => openPanel(conn.id, "login") : undefined} />
                    </TableCell>
                    <TableCell>
                      <ReadinessCell connection={conn} onOpen={canEdit ? () => openPanel(conn.id, "who") : undefined} />
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTest(conn)}
                              aria-label={`Test ${conn.name}`}
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
                                  aria-label={conn.isActive ? `Deactivate ${conn.name}` : `Activate ${conn.name}`}
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
                                  onClick={() => openPanel(conn.id, "general")}
                                  aria-label={`Edit ${conn.name}`}
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
                                aria-label={`Delete ${conn.name}`}
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

      {/* Create and edit: General, ClickHouse login, Who can query */}
      {/* A connection removed meanwhile closes its panel rather than turning it into a new one. */}
      {panel && (panel.connectionId === null || panelConnection) && (
        <ConnectionPanel
          key={panel.seq}
          connection={panelConnection}
          initialTab={panel.tab}
          onClose={() => setPanel(null)}
          onReload={reloadConnections}
          onCreated={handleCreated}
        />
      )}

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

      {/* Collection schedule: the defaults for every connection (issue #380) */}
      <Sheet open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>Collection schedule</SheetTitle>
            <SheetDescription>
              How often the observability collectors read every connection, and what they read per day. A connection can set its own schedule on the General tab of its panel.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {scheduleOpen && <CollectorSchedule connectionId={null} canEdit={canEdit} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
