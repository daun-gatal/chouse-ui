/**
 * ClickHouse Roles Management
 *
 * Lists native ClickHouse roles and opens the create/edit wizard. ClickHouse is
 * the source of truth; grants are read from system.grants and edits reconciled
 * diff-based on the server.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Shield, Lock, PlugZap, Power, PowerOff } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { log } from "@/lib/log";
import {
  rbacClickHouseRolesApi,
  type CHPrivilegeCatalogEntry,
  type ClickHouseRole,
} from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClickHouseRoleWizard } from "../clickhouse/ClickHouseRoleWizard";
import { useChReconnect, isNoSessionError } from "../clickhouse/useChReconnect";

const outlineBtn =
  "h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200";
const brandBtn =
  "h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft";
const thCls = "px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";

export default function ClickHouseRolesManagement() {
  const { hasPermission } = useRbacStore();
  const canCreate = hasPermission(RBAC_PERMISSIONS.CH_ROLES_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.CH_ROLES_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.CH_ROLES_DELETE);

  const [roles, setRoles] = useState<ClickHouseRole[]>([]);
  const [privileges, setPrivileges] = useState<CHPrivilegeCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const reconnect = useChReconnect();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadRoles = useCallback(async (isRetry = false) => {
    setLoading(true);
    try {
      const [list, catalog] = await Promise.all([
        rbacClickHouseRolesApi.list(),
        privileges.length === 0 ? rbacClickHouseRolesApi.getPrivileges() : Promise.resolve(privileges),
      ]);
      setRoles(list);
      if (privileges.length === 0) setPrivileges(catalog);
      setDisconnected(false);
    } catch (error) {
      // Stale/expired session → reconnect once and retry before surfacing it.
      if (!isRetry && isNoSessionError(error) && (await reconnect())) {
        return loadRoles(true);
      }
      if (isNoSessionError(error)) {
        setDisconnected(true);
      } else {
        log.error("Failed to load ClickHouse roles", error);
        toast.error(error instanceof Error ? error.message : "Failed to load ClickHouse roles");
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnect]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const openCreate = () => {
    setEditingName(null);
    setWizardOpen(true);
  };
  const openEdit = (name: string) => {
    setEditingName(name);
    setWizardOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await rbacClickHouseRolesApi.delete(deleteTarget);
      toast.success(`Role "${deleteTarget}" deleted`);
      setDeleteTarget(null);
      await loadRoles();
    } catch (error) {
      log.error("Failed to delete ClickHouse role", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete ClickHouse role");
    }
  };

  const handleToggleDisabled = async (role: ClickHouseRole) => {
    try {
      if (role.disabled) {
        await rbacClickHouseRolesApi.enable(role.name);
        toast.success(`Role "${role.name}" enabled`);
      } else {
        await rbacClickHouseRolesApi.disable(role.name);
        toast.success(`Role "${role.name}" disabled`);
      }
      await loadRoles();
    } catch (error) {
      log.error("Failed to toggle ClickHouse role", error);
      toast.error(error instanceof Error ? error.message : "Failed to toggle ClickHouse role");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Shield className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[16px] font-semibold tracking-tight text-paper">ClickHouse roles</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {roles.length} role{roles.length === 1 ? "" : "s"} · native privileges
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadRoles()} disabled={loading} className={outlineBtn}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreate} className={brandBtn}>
              <Plus className="h-3.5 w-3.5" /> Create role
            </Button>
          )}
        </div>
      </div>

      {disconnected ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <PlugZap className="h-5 w-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-[14px] font-semibold text-paper">Not connected to ClickHouse</p>
            <p className="text-[12px] text-paper-muted">
              The ClickHouse session expired or the server restarted. Reconnect to manage roles.
            </p>
          </div>
          <Button size="sm" onClick={() => void loadRoles()} disabled={loading} className={brandBtn}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Reconnect
          </Button>
        </div>
      ) : (
      /* Table */
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-ink-500 bg-ink-200/40">
              <th className={thCls}>Name</th>
              <th className={thCls}>Storage</th>
              <th className={thCls}>Grants</th>
              <th className={thCls}>Assigned</th>
              <th className={`${thCls} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-paper-dim" />
                </td>
              </tr>
            ) : roles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[12px] text-paper-faint">
                  No ClickHouse roles found.
                </td>
              </tr>
            ) : (
              roles.map((role) => (
                <tr key={role.name} className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[13px] ${role.disabled ? "text-paper-faint line-through" : "text-paper"}`}>{role.name}</span>
                      {role.disabled && (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300" title="Disabled — grants are stashed and revoked; enable to restore">
                          <PowerOff className="h-2.5 w-2.5" /> Disabled
                        </span>
                      )}
                      {role.readonly && (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint" title="Managed in ClickHouse config (read-only)">
                          <Lock className="h-2.5 w-2.5" /> Read-only
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-paper-muted">{role.storage ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                      {role.grantCount ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] ${(role.assignedCount ?? 0) > 0 ? "border-brand/40 text-brand" : "border-ink-500 bg-ink-200 text-paper-muted"}`}
                      title={(role.assignedCount ?? 0) > 0 ? `Assigned to ${role.assignedCount} grantee(s)` : "Not assigned"}
                    >
                      {role.assignedCount ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {canUpdate && !role.readonly && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 rounded-xs hover:bg-ink-200 ${role.disabled ? "text-emerald-400 hover:text-emerald-300" : "text-paper-dim hover:text-amber-300"}`}
                          title={role.disabled ? "Enable role (restore its grants)" : "Disable role (stash its grants)"}
                          onClick={() => void handleToggleDisabled(role)}
                          aria-label={role.disabled ? "Enable role" : "Disable role"}
                        >
                          {role.disabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                        </Button>
                      )}
                      {canUpdate && !role.readonly && !role.disabled && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper" onClick={() => openEdit(role.name)} aria-label="Edit role">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && !role.readonly && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={(role.assignedCount ?? 0) > 0}
                          className="h-8 w-8 rounded-xs text-paper-faint hover:bg-ink-200 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-paper-faint"
                          title={(role.assignedCount ?? 0) > 0 ? "Role is assigned to users/roles — revoke it first" : "Delete role"}
                          onClick={() => setDeleteTarget(role.name)}
                          aria-label="Delete role"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      <ClickHouseRoleWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={loadRoles}
        privileges={privileges}
        editingName={editingName}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-paper">Delete role "{deleteTarget}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">
              This drops the role in ClickHouse. Users that had this role lose the privileges it granted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={outlineBtn}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-9 rounded-xs bg-rose-600 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-rose-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
