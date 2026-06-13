/**
 * ClickHouse Users Management
 *
 * Lists native ClickHouse users and opens the create/edit wizard. Access is
 * granted by assigning native roles (with optional direct grants). The
 * "Extract to role" action turns a legacy user's direct grants into a reusable
 * role and re-points the user at it. ClickHouse is the source of truth.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Users, Wand2, Lock, PlugZap } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { log } from "@/lib/log";
import {
  rbacClickHouseUsersApi,
  rbacClickHouseRolesApi,
  type ClickHouseUser,
  type ClickHouseRole,
} from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClickHouseUserWizard } from "../clickhouse/ClickHouseUserWizard";
import { useChReconnect, isNoSessionError } from "../clickhouse/useChReconnect";

const outlineBtn =
  "h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200";
const brandBtn =
  "h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft";
const inputCls =
  "rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";
const thCls = "px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";

export default function ClickHouseUsersManagement() {
  const { hasPermission } = useRbacStore();
  const canCreate = hasPermission(RBAC_PERMISSIONS.CH_USERS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.CH_USERS_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.CH_USERS_DELETE);
  const canExtractRole = hasPermission(RBAC_PERMISSIONS.CH_ROLES_CREATE);

  const [users, setUsers] = useState<ClickHouseUser[]>([]);
  const [availableRoles, setAvailableRoles] = useState<ClickHouseRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const reconnect = useChReconnect();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [extractTarget, setExtractTarget] = useState<string | null>(null);
  const [extractRoleName, setExtractRoleName] = useState("");

  const loadAll = useCallback(async (isRetry = false) => {
    setLoading(true);
    try {
      const [list, roles] = await Promise.all([
        rbacClickHouseUsersApi.list(),
        rbacClickHouseRolesApi.list().catch(() => [] as ClickHouseRole[]),
      ]);
      setUsers(list);
      setAvailableRoles(roles);
      setDisconnected(false);
    } catch (error) {
      // Stale/expired session → reconnect once and retry before surfacing it.
      if (!isRetry && isNoSessionError(error) && (await reconnect())) {
        return loadAll(true);
      }
      if (isNoSessionError(error)) {
        setDisconnected(true);
      } else {
        log.error("Failed to load ClickHouse users", error);
        toast.error(error instanceof Error ? error.message : "Failed to load ClickHouse users");
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnect]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openCreate = () => {
    setEditingUser(null);
    setWizardOpen(true);
  };
  const openEdit = (username: string) => {
    setEditingUser(username);
    setWizardOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await rbacClickHouseUsersApi.delete(deleteTarget);
      toast.success(`User "${deleteTarget}" deleted`);
      setDeleteTarget(null);
      await loadAll();
    } catch (error) {
      log.error("Failed to delete ClickHouse user", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete ClickHouse user");
    }
  };

  const handleExtractRole = async () => {
    if (!extractTarget || !extractRoleName.trim()) return;
    try {
      await rbacClickHouseUsersApi.extractRole(extractTarget, extractRoleName.trim());
      toast.success(`Created role "${extractRoleName.trim()}" from ${extractTarget}'s grants`);
      setExtractTarget(null);
      setExtractRoleName("");
      await loadAll();
    } catch (error) {
      log.error("Failed to extract role", error);
      toast.error(error instanceof Error ? error.message : "Failed to extract role");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[16px] font-semibold tracking-tight text-paper">ClickHouse users</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {users.length} user{users.length === 1 ? "" : "s"} · native accounts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading} className={outlineBtn}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreate} className={brandBtn}>
              <Plus className="h-3.5 w-3.5" /> Create user
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
              The ClickHouse session expired or the server restarted. Reconnect to manage users.
            </p>
          </div>
          <Button size="sm" onClick={() => void loadAll()} disabled={loading} className={brandBtn}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Reconnect
          </Button>
        </div>
      ) : (
      /* Table */
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-ink-500 bg-ink-200/40">
              <th className={thCls}>Username</th>
              <th className={thCls}>Roles</th>
              <th className={thCls}>Auth</th>
              <th className={thCls}>Host</th>
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
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[12px] text-paper-faint">
                  No ClickHouse users found.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.name} className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-paper">{user.name}</span>
                      {user.readonly && (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint" title="Managed in ClickHouse config (read-only)">
                          <Lock className="h-2.5 w-2.5" /> Read-only
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(user.roles ?? []).length === 0 ? (
                        <span className="text-[12px] text-paper-faint">—</span>
                      ) : (
                        (user.roles ?? []).map((r) => (
                          <span key={r} className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                            {r}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-paper-muted">{user.auth_type ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-paper-muted">{user.host_ip || user.host_names || "any"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {canExtractRole && user.readonly && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper" title="Capture this read-only user's grants into a reusable role (user is left unchanged)" onClick={() => { setExtractTarget(user.name); setExtractRoleName(`${user.name}_role`); }} aria-label="Extract to role">
                          <Wand2 className="h-4 w-4" />
                        </Button>
                      )}
                      {canUpdate && !user.readonly && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper" onClick={() => openEdit(user.name)} aria-label="Edit user">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && !user.readonly && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xs text-paper-faint hover:bg-ink-200 hover:text-rose-400" onClick={() => setDeleteTarget(user.name)} aria-label="Delete user">
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

      <ClickHouseUserWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={loadAll}
        availableRoles={availableRoles}
        editingUser={editingUser}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-paper">Delete user "{deleteTarget}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">This drops the user in ClickHouse and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={outlineBtn}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-9 rounded-xs bg-rose-600 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-rose-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Extract-to-role dialog */}
      <Dialog open={extractTarget !== null} onOpenChange={(open) => { if (!open) { setExtractTarget(null); setExtractRoleName(""); } }}>
        <DialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-semibold tracking-tight text-paper">Extract role from "{extractTarget}"</DialogTitle>
            <DialogDescription className="text-[12px] text-paper-muted">
              Captures this read-only user's grants into a new reusable role. The user itself is config-managed and is left unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">New role name</Label>
            <Input value={extractRoleName} onChange={(e) => setExtractRoleName(e.target.value)} placeholder="role_name" className={inputCls} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExtractTarget(null); setExtractRoleName(""); }} className={outlineBtn}>Cancel</Button>
            <Button onClick={handleExtractRole} disabled={!extractRoleName.trim()} className={brandBtn}>
              <Wand2 className="h-3.5 w-3.5" /> Extract role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
