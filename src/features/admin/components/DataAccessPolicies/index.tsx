/**
 * Data Access Policies Management
 *
 * Admin UI for creating and managing named, reusable data access policies.
 * A policy groups database/table pattern rules and is scoped to connections;
 * roles attach policies to grant their users access.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Database, Shield, Loader2, Info, X } from 'lucide-react';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  rbacDataAccessPoliciesApi,
  rbacConnectionsApi,
  type DataAccessPolicy,
  type DataAccessPolicyRule,
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';

interface RuleDraft {
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  description: string;
}

interface PolicyDraft {
  name: string;
  description: string;
  allConnections: boolean;
  connectionIds: string[];
  rules: RuleDraft[];
}

const emptyRule: RuleDraft = {
  databasePattern: '*',
  tablePattern: '*',
  isAllowed: true,
  priority: 0,
  description: '',
};

const emptyPolicy: PolicyDraft = {
  name: '',
  description: '',
  allConnections: true,
  connectionIds: [],
  rules: [{ ...emptyRule }],
};

function toDraft(policy: DataAccessPolicy): PolicyDraft {
  return {
    name: policy.name,
    description: policy.description ?? '',
    allConnections: policy.allConnections,
    connectionIds: policy.connectionIds,
    rules: policy.rules.map((r) => ({
      databasePattern: r.databasePattern,
      tablePattern: r.tablePattern,
      isAllowed: r.isAllowed,
      priority: r.priority,
      description: r.description ?? '',
    })),
  };
}

export const DataAccessPolicies: React.FC = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useRbacStore();
  const canCreate = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_DELETE);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(emptyPolicy);

  const { data: policies, isLoading } = useQuery({
    queryKey: ['rbac-data-access-policies'],
    queryFn: () => rbacDataAccessPoliciesApi.list(),
  });

  const { data: connections } = useQuery({
    queryKey: ['rbac-connections'],
    queryFn: () => rbacConnectionsApi.list().then((r) => r.connections),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['rbac-data-access-policies'] });

  const saveMutation = useMutation({
    mutationFn: async (d: PolicyDraft) => {
      const payload = {
        name: d.name.trim(),
        description: d.description.trim() || null,
        allConnections: d.allConnections,
        connectionIds: d.allConnections ? [] : d.connectionIds,
        rules: d.rules.map((r) => ({
          databasePattern: r.databasePattern || '*',
          tablePattern: r.tablePattern || '*',
          isAllowed: r.isAllowed,
          priority: r.priority,
          description: r.description.trim() || null,
        })) as Omit<DataAccessPolicyRule, 'id'>[],
      };
      return editingId
        ? rbacDataAccessPoliciesApi.update(editingId, payload)
        : rbacDataAccessPoliciesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(editingId ? 'Policy updated' : 'Policy created');
      setShowDialog(false);
      invalidate();
    },
    onError: (error: Error) => {
      log.error('Failed to save policy', error);
      toast.error(`Failed to save policy: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rbacDataAccessPoliciesApi.delete(id),
    onSuccess: () => {
      toast.success('Policy deleted');
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete policy');
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setDraft({ ...emptyPolicy, rules: [{ ...emptyRule }] });
    setShowDialog(true);
  };

  const openEdit = (policy: DataAccessPolicy) => {
    setEditingId(policy.id);
    setDraft(toDraft(policy));
    setShowDialog(true);
  };

  const connectionName = (id: string) => connections?.find((c) => c.id === id)?.name ?? 'Unknown';

  const toggleConnection = (id: string) => {
    setDraft((d) => ({
      ...d,
      connectionIds: d.connectionIds.includes(id)
        ? d.connectionIds.filter((c) => c !== id)
        : [...d.connectionIds, id],
    }));
  };

  const updateRule = (index: number, patch: Partial<RuleDraft>) => {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const draftValid =
    draft.name.trim().length >= 2 &&
    draft.rules.length >= 1 &&
    (draft.allConnections || draft.connectionIds.length > 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
            <span className="h-px w-6 bg-ink-700" />
            <span>Data access policies</span>
          </span>
          <p className="text-[12px] text-paper-muted">
            Reusable database/table access rules attached to roles.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
            <Plus className="h-3.5 w-3.5" />
            New policy
          </Button>
        )}
      </div>

      {!policies || policies.length === 0 ? (
        <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
          <Shield className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No data access policies</p>
          <p className="mt-2 text-[12px] text-paper-muted">Create a policy and attach it to roles to grant database access.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
          <Table>
            <TableHeader>
              <TableRow className="border-ink-500 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Connections</TableHead>
                <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Rules</TableHead>
                <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Roles</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id} className="border-ink-500 hover:bg-ink-200">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-paper">{policy.name}</span>
                      {policy.isSystem && (
                        <span className="inline-flex items-center rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-muted">System</span>
                      )}
                    </div>
                    {policy.description && <p className="mt-0.5 text-[11px] text-paper-faint">{policy.description}</p>}
                  </TableCell>
                  <TableCell className="text-[12px] text-paper-muted">
                    {policy.allConnections ? 'All connections' : policy.connectionIds.map(connectionName).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-center font-mono text-[12px] tabular-nums text-paper-dim">{policy.rules.length}</TableCell>
                  <TableCell className="text-center font-mono text-[12px] tabular-nums text-paper-dim">{policy.roleIds.length}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {canUpdate && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-300 hover:text-paper" onClick={() => openEdit(policy)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && !policy.isSystem && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                          disabled={policy.roleIds.length > 0 || deleteMutation.isPending}
                          title={policy.roleIds.length > 0 ? 'Detach from all roles before deleting' : 'Delete policy'}
                          onClick={() => deleteMutation.mutate(policy.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-paper">
              <Database className="h-4 w-4 text-paper-dim" />
              {editingId ? 'Edit policy' : 'New data access policy'}
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              Define which databases and tables this policy grants, and on which connections.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g., Prod Analytics — Read Only"
                className="rounded-xs border-ink-500 bg-ink-200 text-paper"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Description (optional)</Label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="rounded-xs border-ink-500 bg-ink-200 text-paper"
              />
            </div>

            {/* Connections */}
            <div className="space-y-2 rounded-xs border border-ink-500 bg-ink-200 p-3">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">All connections</Label>
                <Switch
                  checked={draft.allConnections}
                  onCheckedChange={(checked) => setDraft({ ...draft, allConnections: checked })}
                />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-paper-faint">
                <Info className="h-3 w-3" />
                Scoping a policy to a connection does not grant access to that connection — that is managed separately.
              </p>
              {!draft.allConnections && (
                <div className="space-y-1 pt-1">
                  {(connections ?? []).map((conn) => (
                    <label key={conn.id} className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-1 hover:bg-ink-300">
                      <Checkbox
                        checked={draft.connectionIds.includes(conn.id)}
                        onCheckedChange={() => toggleConnection(conn.id)}
                        className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                      />
                      <span className="text-[12px] text-paper">{conn.name}</span>
                    </label>
                  ))}
                  {(connections ?? []).length === 0 && (
                    <p className="text-[11px] text-paper-faint">No connections available.</p>
                  )}
                </div>
              )}
            </div>

            {/* Rules */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Pattern rules</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, { ...emptyRule }] }))}
                  className="h-7 gap-1 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
                >
                  <Plus className="h-3 w-3" /> Add rule
                </Button>
              </div>
              {draft.rules.map((rule, index) => (
                <div key={index} className="space-y-2 rounded-xs border border-ink-500 bg-ink-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Rule {index + 1}</span>
                    {draft.rules.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 rounded-xs text-red-400 hover:bg-red-950/40"
                        onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">Database</Label>
                      <Input
                        value={rule.databasePattern}
                        onChange={(e) => updateRule(index, { databasePattern: e.target.value })}
                        placeholder="* or name or /regex/"
                        className="h-8 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">Table</Label>
                      <Input
                        value={rule.tablePattern}
                        onChange={(e) => updateRule(index, { tablePattern: e.target.value })}
                        placeholder="* or name or /regex/"
                        className="h-8 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${rule.isAllowed ? 'text-paper-faint' : 'text-red-300'}`}>Deny</span>
                      <Switch checked={rule.isAllowed} onCheckedChange={(checked) => updateRule(index, { isAllowed: checked })} />
                      <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${rule.isAllowed ? 'text-emerald-300' : 'text-paper-faint'}`}>Allow</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">Priority</Label>
                      <Input
                        type="number"
                        value={rule.priority}
                        onChange={(e) => updateRule(index, { priority: parseInt(e.target.value) || 0 })}
                        className="h-8 w-20 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-paper-faint">
                Deny rules take precedence over allow rules. Higher priority is evaluated first.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDialog(false)}
              className="h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate(draft)}
              disabled={!draftValid || saveMutation.isPending}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {editingId ? 'Save policy' : 'Create policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataAccessPolicies;
