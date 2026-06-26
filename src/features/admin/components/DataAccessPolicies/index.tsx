/**
 * Data Access Policies Management
 *
 * Admin UI for creating and managing named, reusable data access policies.
 * A policy is a set of rules; each rule is scoped to a specific connection or to
 * all connections (global, connectionId = null). Roles attach policies to grant
 * their users access.
 *
 * Create/edit is a 5-step wizard: Connections -> Scope -> Operations -> Exceptions -> Review.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Pencil, Database, Shield, Loader2, Info, X, ChevronRight, ChevronDown,
  Table2, Server, Globe, Check, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  type ClickHouseConnection,
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';

// A rule in the editor. connectionId null = all connections (global).
interface RuleDraft {
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  permissions: string[];
  isAllowed: boolean;
  priority: number;
  description: string;
}

const DATA_PERMISSION_GROUPS = [
  {
    label: 'Database',
    permissions: [
      ['database:view', 'View'],
      ['database:create', 'Create'],
      ['database:drop', 'Drop'],
    ],
  },
  {
    label: 'Query',
    permissions: [
      ['query:execute', 'Execute'],
      ['query:execute:ddl', 'DDL'],
      ['query:execute:dml', 'DML'],
      ['query:execute:misc', 'Misc'],
    ],
  },
  {
    label: 'Table',
    permissions: [
      ['table:view', 'View'],
      ['table:select', 'Select'],
      ['table:insert', 'Insert'],
      ['table:update', 'Update'],
      ['table:delete', 'Delete'],
      ['table:create', 'Create'],
      ['table:alter', 'Alter'],
      ['table:drop', 'Drop'],
    ],
  },
] as const;

const DEFAULT_RULE_PERMISSIONS = ['database:view', 'table:view', 'table:select', 'query:execute'];

const OPERATION_PRESETS = [
  {
    id: 'read',
    label: 'Read only',
    permissions: ['database:view', 'table:view', 'table:select', 'query:execute'],
  },
  {
    id: 'write',
    label: 'Read/write',
    permissions: ['database:view', 'table:view', 'table:select', 'table:insert', 'table:update', 'table:delete', 'query:execute', 'query:execute:dml'],
  },
  {
    id: 'schema',
    label: 'Schema editor',
    permissions: ['database:view', 'database:create', 'table:view', 'table:select', 'table:create', 'table:alter', 'table:drop', 'query:execute', 'query:execute:ddl'],
  },
] as const;

function policyToRules(policy: DataAccessPolicy): RuleDraft[] {
  return policy.rules.map((r) => ({
    connectionId: r.connectionId ?? null,
    databasePattern: r.databasePattern,
    tablePattern: r.tablePattern,
    permissions: r.permissions.length > 0 ? r.permissions : DEFAULT_RULE_PERMISSIONS,
    isAllowed: r.isAllowed,
    priority: r.priority,
    description: r.description ?? '',
  }));
}

export const DataAccessPolicies: React.FC = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useRbacStore();
  const canCreate = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_DELETE);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  // Wizard fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopeConns, setScopeConns] = useState<string[]>([]); // connections this policy configures
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [expandedExceptionGroups, setExpandedExceptionGroups] = useState<Set<string>>(new Set());

  // Schema browse state (keyed by connectionId, and `${connId}:${db}` for tables)
  const [dbsByConn, setDbsByConn] = useState<Record<string, string[]>>({});
  const [loadingDbs, setLoadingDbs] = useState<Record<string, boolean>>({});
  const [expandedDb, setExpandedDb] = useState<Record<string, boolean>>({});
  const [tablesByKey, setTablesByKey] = useState<Record<string, string[]>>({});
  const [loadingTables, setLoadingTables] = useState<Record<string, boolean>>({});

  const { data: policies, isLoading } = useQuery({
    queryKey: ['rbac-data-access-policies'],
    queryFn: () => rbacDataAccessPoliciesApi.list(),
  });
  const { data: connections } = useQuery({
    queryKey: ['rbac-connections'],
    queryFn: () => rbacConnectionsApi.list().then((r) => r.connections),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['rbac-data-access-policies'] });
  const connectionName = (id: string | null) => (id === null ? 'All connections' : connections?.find((c) => c.id === id)?.name ?? 'Unknown');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        rules: rules.map((r) => ({
          connectionId: r.connectionId,
          databasePattern: r.databasePattern || '*',
          tablePattern: r.tablePattern || '*',
          permissions: r.permissions,
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
    onSuccess: () => { toast.success('Policy deleted'); invalidate(); },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete policy'),
  });

  const resetBrowse = () => {
    setDbsByConn({}); setLoadingDbs({}); setExpandedDb({}); setTablesByKey({}); setLoadingTables({});
  };

  const openCreate = () => {
    setEditingId(null);
    setName(''); setDescription('');
    setScopeConns([]); setRules([]);
    setExpandedExceptionGroups(new Set());
    setStep(1); resetBrowse();
    setShowDialog(true);
  };

  const openEdit = (policy: DataAccessPolicy) => {
    setEditingId(policy.id);
    setName(policy.name); setDescription(policy.description ?? '');
    const drafts = policyToRules(policy);
    setRules(drafts);
    // Scope = the connections named by the policy's rules. Any global (null) rules
    // an existing/system policy carries are preserved on save but not edited here.
    setScopeConns(Array.from(new Set(drafts.map((r) => r.connectionId).filter((c): c is string => c !== null))));
    setExpandedExceptionGroups(new Set());
    setStep(1); resetBrowse();
    setShowDialog(true);
  };

  // Toggle a connection in scope; removing one prunes its rules.
  const toggleScopeConn = (connId: string) => {
    setScopeConns((s) => {
      if (s.includes(connId)) {
        setRules((rs) => rs.filter((r) => r.connectionId !== connId));
        return s.filter((x) => x !== connId);
      }
      return [...s, connId];
    });
  };

  const allConnIds = (connections ?? []).map((c) => c.id);
  const allSelected = allConnIds.length > 0 && allConnIds.every((id) => scopeConns.includes(id));
  const toggleSelectAll = () => {
    if (allSelected) {
      setScopeConns([]);
      setRules((rs) => rs.filter((r) => r.connectionId === null));
    } else {
      setScopeConns(allConnIds);
    }
  };

  // The connections whose schema we browse / configure in Step 2.
  const browseConns: ClickHouseConnection[] = useMemo(
    () => (connections ?? []).filter((c) => scopeConns.includes(c.id)),
    [connections, scopeConns],
  );

  // Each connection is configured independently; null rules are preserved for old/global policies.
  const ruleGroups: Array<string | null> = [
    ...scopeConns,
    ...(rules.some((r) => r.connectionId === null) ? [null] : []),
  ];

  const exceptionGroupKey = (group: string | null) => group ?? '__global__';
  const toggleExceptionGroup = (group: string | null) => {
    const key = exceptionGroupKey(group);
    setExpandedExceptionGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ---- Schema browsing ----
  const loadDatabases = async (connId: string) => {
    setLoadingDbs((l) => ({ ...l, [connId]: true }));
    try {
      const dbs = await rbacDataAccessPoliciesApi.listDatabases(connId);
      setDbsByConn((d) => ({ ...d, [connId]: dbs }));
    } catch (error) {
      toast.error(`Failed to load databases for ${connectionName(connId)}: ${(error as Error).message}`);
      setDbsByConn((d) => ({ ...d, [connId]: [] }));
    } finally {
      setLoadingDbs((l) => ({ ...l, [connId]: false }));
    }
  };

  // Auto-list databases for every in-scope connection when entering Step 2.
  useEffect(() => {
    if (step !== 2) return;
    for (const conn of browseConns) {
      if (dbsByConn[conn.id] === undefined && !loadingDbs[conn.id]) {
        void loadDatabases(conn.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, browseConns]);

  const toggleDb = async (connId: string, db: string) => {
    const key = `${connId}:${db}`;
    const open = !expandedDb[key];
    setExpandedDb((e) => ({ ...e, [key]: open }));
    if (open && tablesByKey[key] === undefined) {
      setLoadingTables((l) => ({ ...l, [key]: true }));
      try {
        const tbls = await rbacDataAccessPoliciesApi.listTables(connId, db);
        setTablesByKey((t) => ({ ...t, [key]: tbls }));
      } catch (error) {
        toast.error(`Failed to load tables: ${(error as Error).message}`);
      } finally {
        setLoadingTables((l) => ({ ...l, [key]: false }));
      }
    }
  };

  // ---- Rule helpers ----
  const hasRule = (connId: string | null, db: string, table: string) =>
    rules.some((r) => r.connectionId === connId && r.databasePattern === db && r.tablePattern === table);

  const toggleAllowRule = (connId: string | null, db: string, table: string) => {
    setRules((rs) => {
      const i = rs.findIndex((r) => r.connectionId === connId && r.databasePattern === db && r.tablePattern === table);
      if (i >= 0) return rs.filter((_, idx) => idx !== i);
      return [...rs, { connectionId: connId, databasePattern: db, tablePattern: table, permissions: DEFAULT_RULE_PERMISSIONS, isAllowed: true, priority: 0, description: '' }];
    });
  };

  const addPatternRule = (connId: string | null) => {
    setRules((rs) => [...rs, { connectionId: connId, databasePattern: '*', tablePattern: '*', permissions: DEFAULT_RULE_PERMISSIONS, isAllowed: true, priority: 0, description: '' }]);
  };

  const updateRuleAt = (globalIndex: number, patch: Partial<RuleDraft>) =>
    setRules((rs) => rs.map((r, i) => (i === globalIndex ? { ...r, ...patch } : r)));
  const removeRuleAt = (globalIndex: number) => setRules((rs) => rs.filter((_, i) => i !== globalIndex));
  const toggleRulePermission = (globalIndex: number, permission: string) =>
    setRules((rs) => rs.map((r, i) => {
      if (i !== globalIndex) return r;
      const permissions = r.permissions.includes(permission)
        ? r.permissions.filter((p) => p !== permission)
        : [...r.permissions, permission];
      return { ...r, permissions: permissions.length > 0 ? permissions : [permission] };
    }));
  const applyPermissionsToAllowRules = (permissions: readonly string[]) =>
    setRules((rs) => rs.map((r) => (r.isAllowed ? { ...r, permissions: Array.from(permissions) } : r)));
  const togglePermissionForAllowRules = (permission: string) =>
    setRules((rs) => {
      const allowRules = rs.filter((r) => r.isAllowed);
      const everyAllowRuleHasPermission = allowRules.length > 0 && allowRules.every((r) => r.permissions.includes(permission));
      return rs.map((r) => {
        if (!r.isAllowed) return r;
        const permissions = everyAllowRuleHasPermission
          ? r.permissions.filter((p) => p !== permission)
          : Array.from(new Set([...r.permissions, permission]));
        return { ...r, permissions: permissions.length > 0 ? permissions : [permission] };
      });
    });

  const step1Valid = scopeConns.length > 0;
  const step2Valid = rules.length > 0;
  const step3Valid = rules.every((r) => r.permissions.length > 0);
  const step4Valid = rules.length > 0;
  const step5Valid = name.trim().length >= 2;
  const selectedRules = rules.filter((r) => r.isAllowed);
  const selectedRuleCount = selectedRules.length;
  const allowRulePermissions = Array.from(new Set(selectedRules.flatMap((r) => r.permissions)));

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-paper-dim" /></div>;
  }

  // Render a database/table tree for one connection. Picks toggle a rule scoped to `ruleConn`.
  const renderTree = (conn: ClickHouseConnection, ruleConn: string | null) => {
    const dbs = dbsByConn[conn.id];
    return (
      <div className="rounded-xs border border-ink-500 bg-ink-100 p-2">
        <div className="mb-1 flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-paper-faint" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">{conn.name}</span>
        </div>
        {loadingDbs[conn.id] && <div className="flex items-center gap-2 py-1 text-[11px] text-paper-faint"><Loader2 className="h-3 w-3 animate-spin" /> Loading databases…</div>}
        {dbs && dbs.length === 0 && !loadingDbs[conn.id] && <p className="py-1 text-[11px] text-paper-faint">No databases.</p>}
        {dbs && dbs.length > 0 && (
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {dbs.map((db) => {
              const key = `${conn.id}:${db}`;
              const open = !!expandedDb[key];
              return (
                <div key={db}>
                  <div className="flex items-center gap-1.5 py-0.5">
                    <button type="button" onClick={() => toggleDb(conn.id, db)} className="text-paper-faint hover:text-paper">
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <Checkbox checked={hasRule(ruleConn, db, '*')} onCheckedChange={() => toggleAllowRule(ruleConn, db, '*')}
                      className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50" />
                    <Database className="h-3.5 w-3.5 text-paper-faint" />
                    <button type="button" onClick={() => toggleDb(conn.id, db)} className="font-mono text-[12px] text-paper hover:text-brand">{db}</button>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">(all tables)</span>
                  </div>
                  {open && (
                    <div className="ml-7 space-y-0.5 border-l border-ink-500 pl-2">
                      {loadingTables[key] ? (
                        <div className="flex items-center gap-2 py-1 text-[11px] text-paper-faint"><Loader2 className="h-3 w-3 animate-spin" /> Loading tables…</div>
                      ) : (tablesByKey[key] ?? []).length === 0 ? (
                        <p className="py-1 text-[11px] text-paper-faint">No tables.</p>
                      ) : (tablesByKey[key] ?? []).map((tbl) => (
                        <label key={tbl} className="flex cursor-pointer items-center gap-1.5 rounded-xs px-1 py-0.5 hover:bg-ink-200">
                          <Checkbox checked={hasRule(ruleConn, db, tbl)} onCheckedChange={() => toggleAllowRule(ruleConn, db, tbl)}
                            className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50" />
                          <Table2 className="h-3 w-3 text-paper-faint" />
                          <span className="font-mono text-[12px] text-paper-muted">{tbl}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Render the editable rule list for one group (connectionId) with a wildcard add row.
  const renderRuleGroup = (groupConn: string | null) => {
    const groupRules = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.connectionId === groupConn);
    return (
      <div className="space-y-1">
        {groupRules.map(({ r, i }) => (
          <div key={i} className="space-y-2 rounded-xs border border-ink-500 bg-ink-100 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Input value={r.databasePattern} onChange={(e) => updateRuleAt(i, { databasePattern: e.target.value })}
                placeholder="db / * / /regex/" className="h-7 flex-1 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper" />
              <span className="text-paper-faint">.</span>
              <Input value={r.tablePattern} onChange={(e) => updateRuleAt(i, { tablePattern: e.target.value })}
                placeholder="table / *" className="h-7 flex-1 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper" />
              <button type="button" onClick={() => updateRuleAt(i, { isAllowed: !r.isAllowed })}
                className={cn('rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]',
                  r.isAllowed ? 'border-emerald-700 text-emerald-300' : 'border-red-700 text-red-300')}>
                {r.isAllowed ? 'Allow' : 'Deny'}
              </button>
              <Button size="icon" variant="ghost" className="h-6 w-6 rounded-xs text-red-400 hover:bg-red-950/40" onClick={() => removeRuleAt(i)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {DATA_PERMISSION_GROUPS.map((group) => (
                <div key={group.label} className="rounded-xs border border-ink-500 bg-ink-200 p-1.5">
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">{group.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.permissions.map(([permission, label]) => (
                      <button
                        key={permission}
                        type="button"
                        onClick={() => toggleRulePermission(i, permission)}
                        className={cn(
                          'rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]',
                          r.permissions.includes(permission)
                            ? 'border-brand/60 bg-brand/15 text-brand'
                            : 'border-ink-500 text-paper-faint hover:text-paper',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => addPatternRule(groupConn)}
          className="h-7 gap-1 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-100 hover:text-paper">
          <Plus className="h-3 w-3" /> Add wildcard / pattern rule
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
            <Database className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Data access policies</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {policies?.length ?? 0} polic{(policies?.length ?? 0) === 1 ? 'y' : 'ies'} defined
            </p>
          </div>
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
            <Plus className="h-3.5 w-3.5" /> New policy
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
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Scope</TableHead>
                <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Rules</TableHead>
                <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Roles</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy) => {
                const hasGlobal = policy.rules.some((r) => (r.connectionId ?? null) === null);
                const conns = Array.from(new Set(policy.rules.map((r) => r.connectionId).filter((c): c is string => !!c)));
                const scope = [hasGlobal ? 'All connections' : null, ...conns.map((c) => connectionName(c))].filter(Boolean).join(', ');
                return (
                  <TableRow key={policy.id} className="border-ink-500 hover:bg-ink-200">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-paper">{policy.name}</span>
                        {policy.isSystem && <span className="inline-flex items-center rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-muted">System</span>}
                      </div>
                      {policy.description && <p className="mt-0.5 text-[11px] text-paper-faint">{policy.description}</p>}
                    </TableCell>
                    <TableCell className="text-[12px] text-paper-muted">{scope || '—'}</TableCell>
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
                          <Button size="icon" variant="ghost"
                            className="h-8 w-8 rounded-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                            disabled={policy.roleIds.length > 0 || deleteMutation.isPending}
                            title={policy.roleIds.length > 0 ? 'Detach from all roles before deleting' : 'Delete policy'}
                            onClick={() => deleteMutation.mutate(policy.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Wizard */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-paper">
              <Database className="h-4 w-4 text-paper-dim" />
              {editingId ? 'Edit policy' : 'New data access policy'}
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              {step === 1 && 'Step 1 of 5 — choose which connections this policy covers.'}
              {step === 2 && 'Step 2 of 5 — select databases and tables.'}
              {step === 3 && 'Step 3 of 5 — apply the operation profile.'}
              {step === 4 && 'Step 4 of 5 — add exceptions or custom patterns.'}
              {step === 5 && 'Step 5 of 5 — name the policy and review.'}
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
            {['Connections', 'Scope', 'Operations', 'Exceptions', 'Review'].map((label, i) => {
              const n = i + 1;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className={cn('grid h-5 w-5 place-items-center rounded-full font-mono text-[10px]',
                    step === n ? 'bg-brand text-ink-50' : step > n ? 'bg-emerald-600 text-ink-50' : 'bg-ink-300 text-paper-faint')}>
                    {step > n ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={cn('font-mono text-[10px] uppercase tracking-[0.14em]', step === n ? 'text-paper' : 'text-paper-faint')}>{label}</span>
                  {n < 5 && <span className="mx-1 h-px w-4 bg-ink-500" />}
                </div>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
            {/* STEP 1 — Connections */}
            {step === 1 && (
              <>
                <p className="text-[12px] text-paper-muted">Select the connections this policy configures. Each is set up independently in the next step.</p>
                {(connections ?? []).length > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll}
                      className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50" />
                    <Globe className="h-3.5 w-3.5 text-paper-faint" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper">Select all connections</span>
                  </label>
                )}
                <div className="space-y-1">
                  {(connections ?? []).map((conn) => (
                    <label key={conn.id} className="flex cursor-pointer items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-3 py-2 hover:bg-ink-200">
                      <Checkbox checked={scopeConns.includes(conn.id)} onCheckedChange={() => toggleScopeConn(conn.id)}
                        className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50" />
                      <Server className="h-3.5 w-3.5 text-paper-faint" />
                      <span className="text-[12px] text-paper">{conn.name}</span>
                    </label>
                  ))}
                  {(connections ?? []).length === 0 && <p className="text-[11px] text-paper-faint">No connections available. Add one under Admin → Connections first.</p>}
                </div>
              </>
            )}

            {/* STEP 2 — Scope */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-3">
                    {browseConns.map((conn) => (
                      <div key={conn.id} className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                        {renderTree(conn, conn.id)}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Selected scope</p>
                    {rules.length === 0 ? (
                      <p className="text-[11px] text-paper-faint">No scope selected.</p>
                    ) : (
                      <div className="max-h-72 space-y-2 overflow-y-auto">
                        {ruleGroups.map((group) => {
                          const groupRules = rules.filter((r) => r.connectionId === group);
                          if (groupRules.length === 0) return null;
                          return (
                            <div key={group ?? '__global__'}>
                              <p className="mb-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{connectionName(group)}</p>
                              <div className="space-y-1">
                                {groupRules.map((r, i) => (
                                  <div key={`${r.databasePattern}.${r.tablePattern}.${i}`} className="flex items-center justify-between gap-2 rounded-xs border border-ink-500 bg-ink-100 px-2 py-1">
                                    <span className="truncate font-mono text-[11px] text-paper-muted">{r.databasePattern}.{r.tablePattern}</span>
                                    <button type="button" onClick={() => setRules((rs) => rs.filter((candidate) => candidate !== r))} className="text-paper-faint hover:text-red-300">
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-3 border-t border-ink-500 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                      {rules.length} rule(s)
                    </div>
                  </div>
                </div>

                {!step2Valid && (
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-300"><Info className="h-3 w-3" /> Tick at least one table/database or add a pattern rule to continue.</p>
                )}
              </div>
            )}

            {/* STEP 3 — Operations */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {OPERATION_PRESETS.map((preset) => {
                    const selected = selectedRules.length > 0 && selectedRules.every((r) =>
                      r.permissions.length === preset.permissions.length &&
                      preset.permissions.every((p) => r.permissions.includes(p))
                    );
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPermissionsToAllowRules(preset.permissions)}
                        className={cn(
                          'rounded-xs border p-3 text-left',
                          selected ? 'border-brand/70 bg-brand/10' : 'border-ink-500 bg-ink-200 hover:bg-ink-300',
                        )}
                      >
                        <span className={cn('block font-mono text-[10px] uppercase tracking-[0.14em]', selected ? 'text-brand' : 'text-paper')}>
                          {preset.label}
                        </span>
                        <span className="mt-2 block text-[11px] leading-4 text-paper-faint">{preset.permissions.join(', ')}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Custom operations</p>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{selectedRuleCount} allow rule(s)</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {DATA_PERMISSION_GROUPS.map((group) => (
                      <div key={group.label} className="rounded-xs border border-ink-500 bg-ink-100 p-2">
                        <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">{group.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {group.permissions.map(([permission, label]) => (
                            <button
                              key={permission}
                              type="button"
                              onClick={() => togglePermissionForAllowRules(permission)}
                              className={cn(
                                'rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]',
                                allowRulePermissions.includes(permission)
                                  ? 'border-brand/60 bg-brand/15 text-brand'
                                  : 'border-ink-500 text-paper-faint hover:text-paper',
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4 — Exceptions */}
            {step === 4 && (
              <div className="space-y-4">
                {ruleGroups.map((group) => {
                  const groupRules = rules.filter((r) => r.connectionId === group);
                  const groupKey = exceptionGroupKey(group);
                  const isExpanded = expandedExceptionGroups.has(groupKey);
                  const denyCount = groupRules.filter((r) => !r.isAllowed).length;
                  if (groupRules.length === 0 && group !== null) return null;
                  return (
                    <div key={groupKey} className="rounded-xs border border-ink-500 bg-ink-200">
                      <button
                        type="button"
                        onClick={() => toggleExceptionGroup(group)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                        aria-expanded={isExpanded}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                          )}
                          <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                            {connectionName(group)}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
                          {groupRules.length} rule{groupRules.length === 1 ? '' : 's'} · {denyCount} den{denyCount === 1 ? 'y' : 'ies'}
                        </span>
                      </button>

                      {isExpanded ? (
                        <div className="border-t border-ink-500 p-3">
                          {renderRuleGroup(group)}
                        </div>
                      ) : (
                        <div className="border-t border-ink-500 px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {groupRules.slice(0, 4).map((r, i) => (
                              <span
                                key={`${r.databasePattern}.${r.tablePattern}.${i}`}
                                className={cn(
                                  'rounded-xs border px-1.5 py-0.5 font-mono text-[10px]',
                                  r.isAllowed
                                    ? 'border-emerald-700/60 text-emerald-300'
                                    : 'border-red-700/60 text-red-300',
                                )}
                              >
                                {r.isAllowed ? 'allow' : 'deny'} {r.databasePattern}.{r.tablePattern}
                              </span>
                            ))}
                            {groupRules.length > 4 && (
                              <span className="rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] text-paper-faint">
                                +{groupRules.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* STEP 5 — Details & Review */}
            {step === 5 && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Prod Analytics — Read Only"
                    className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                </div>
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Description (optional)</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                </div>
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Review ({rules.length} rule(s))</Label>
                  <div className="space-y-2">
                    {ruleGroups.map((g) => {
                      const groupRules = rules.filter((r) => r.connectionId === g);
                      if (groupRules.length === 0) return null;
                      return (
                        <div key={g ?? '__all__'} className="rounded-xs border border-ink-500 bg-ink-200 p-2">
                          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{connectionName(g)}</p>
                          {groupRules.map((r, i) => (
                            <div key={i} className="py-0.5 text-[12px]">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-paper-muted">{r.databasePattern}.{r.tablePattern}</span>
                                <span className={cn('font-mono text-[10px] uppercase', r.isAllowed ? 'text-emerald-300' : 'text-red-300')}>{r.isAllowed ? 'allow' : 'deny'} · p{r.priority}</span>
                              </div>
                              <p className="mt-0.5 break-words font-mono text-[10px] text-paper-faint">{r.permissions.join(', ')}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 border-t border-ink-500 pt-3">
            <Button variant="ghost" onClick={() => (step === 1 ? setShowDialog(false) : setStep(step - 1))}
              className="h-9 gap-1 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper">
              {step === 1 ? 'Cancel' : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
            </Button>
            {step < 5 ? (
              <Button onClick={() => setStep(step + 1)} disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid) || (step === 3 && !step3Valid) || (step === 4 && !step4Valid)}
                className="h-9 gap-1 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50">
                Next <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button onClick={() => saveMutation.mutate()} disabled={!step5Valid || saveMutation.isPending}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50">
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {editingId ? 'Save policy' : 'Create policy'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataAccessPolicies;
