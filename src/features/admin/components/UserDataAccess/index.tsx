/**
 * User Data Access Component
 * 
 * Allows configuring database/table access rules for a specific user.
 * These rules are user-specific and supplement role-based rules.
 */

import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Database,
  Table2,
  Shield,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  rbacDataAccessApi,
  rbacConnectionsApi,
  type DataAccessRule,
  type ClickHouseConnection,
} from '@/api/rbac';

interface UserDataAccessProps {
  userId: string;
  userName: string;
  canEdit?: boolean;
  onRulesChange?: (count: number) => void;
}

interface RuleFormData {
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  description: string;
}

const defaultFormData: RuleFormData = {
  connectionId: null,
  databasePattern: '*',
  tablePattern: '*',
  isAllowed: true,
  priority: 0,
  description: '',
};

export const UserDataAccess: React.FC<UserDataAccessProps> = ({
  userId,
  userName,
  canEdit = true,
  onRulesChange,
}) => {
  const [rules, setRules] = useState<DataAccessRule[]>([]);
  const [connections, setConnections] = useState<ClickHouseConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(defaultFormData);

  // Load rules and connections
  useEffect(() => {
    loadData();
  }, [userId]);

  // Notify parent when rules count changes
  useEffect(() => {
    onRulesChange?.(rules.length);
  }, [rules.length, onRulesChange]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rulesData, connectionsData] = await Promise.all([
        rbacDataAccessApi.getRulesForUser(userId),
        rbacConnectionsApi.list().then(r => r.connections),
      ]);
      setRules(rulesData);
      setConnections(connectionsData);
    } catch (error) {
      log.error('Failed to load data:', error);
      toast.error('Failed to load data access rules');
    } finally {
      setIsLoading(false);
    }
  };

  const openAddDialog = () => {
    setEditingIndex(null);
    setFormData(defaultFormData);
    setShowDialog(true);
  };

  const openEditDialog = (index: number) => {
    const rule = rules[index];
    setEditingIndex(index);
    setFormData({
      connectionId: rule.connectionId,
      databasePattern: rule.databasePattern,
      tablePattern: rule.tablePattern,
      isAllowed: rule.isAllowed,
      priority: rule.priority,
      description: rule.description || '',
    });
    setShowDialog(true);
  };

  const handleSaveRule = () => {
    const newRule = {
      connectionId: formData.connectionId,
      databasePattern: formData.databasePattern || '*',
      tablePattern: formData.tablePattern || '*',
      accessType: 'read' as const, // Access type is determined by role permissions
      isAllowed: formData.isAllowed,
      priority: formData.priority,
      description: formData.description,
    };

    if (editingIndex !== null) {
      // Update existing rule
      const updated = [...rules];
      updated[editingIndex] = { ...updated[editingIndex], ...newRule };
      setRules(updated);
    } else {
      // Add new rule (with temporary ID)
      setRules([...rules, { ...newRule, id: `temp-${Date.now()}` } as DataAccessRule]);
    }

    setShowDialog(false);
  };

  const handleDeleteRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      // Convert rules to the format expected by the API
      const rulesToSave = rules.map(rule => ({
        connectionId: rule.connectionId,
        databasePattern: rule.databasePattern,
        tablePattern: rule.tablePattern,
        accessType: rule.accessType,
        isAllowed: rule.isAllowed,
        priority: rule.priority,
        description: rule.description || undefined,
      }));

      const savedRules = await rbacDataAccessApi.bulkSetForUser(userId, rulesToSave);
      setRules(savedRules);
      toast.success('Data access rules saved successfully');
    } catch (error) {
      log.error('Failed to save rules:', error);
      toast.error('Failed to save data access rules');
    } finally {
      setIsSaving(false);
    }
  };

  const getConnectionName = (connectionId: string | null) => {
    if (!connectionId) return 'All Connections';
    const conn = connections.find(c => c.id === connectionId);
    return conn ? conn.name : 'Unknown';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
              <span className="h-px w-6 bg-ink-700" />
              <span>Data access rules</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-paper-faint" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm rounded-xs border-ink-500 bg-ink-100 text-paper">
                  <p>User-specific rules that supplement role-based permissions. Higher priority rules are evaluated first.</p>
                </TooltipContent>
              </Tooltip>
            </span>
            <p className="text-[12px] text-paper-muted">{rules.length} {rules.length === 1 ? 'rule' : 'rules'} for {userName}.</p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openAddDialog} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </Button>
          )}
        </div>

        {/* Rules Table */}
        {rules.length === 0 ? (
          <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
            <Shield className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No user-specific data access rules</p>
            <p className="mt-2 text-[12px] text-paper-muted">
              Access is determined by role permissions only.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <Table>
              <TableHeader>
                <TableRow className="border-ink-500 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Connection</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Database</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Table</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Allow/Deny</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Priority</TableHead>
                  {canEdit && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, index) => (
                  <TableRow
                    key={rule.id}
                    className="cursor-pointer border-ink-500 hover:bg-ink-200"
                    onClick={() => canEdit && openEditDialog(index)}
                  >
                    <TableCell className="font-medium text-paper">
                      {getConnectionName(rule.connectionId)}
                    </TableCell>
                    <TableCell>
                      <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[12px] text-paper-muted">
                        {rule.databasePattern}
                      </code>
                    </TableCell>
                    <TableCell>
                      <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[12px] text-paper-muted">
                        {rule.tablePattern}
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      {rule.isAllowed ? (
                        <span className="inline-flex items-center rounded-xs border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                          Allow
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                          Deny
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-[12px] tabular-nums text-paper-dim">
                      {rule.priority}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-xs text-red-400 hover:bg-red-950/40 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRule(index);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Save Button */}
        {canEdit && rules.length > 0 && (
          <div className="flex justify-end">
            <Button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save data access rules'
              )}
            </Button>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg rounded-xs border-ink-500 bg-ink-100">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-paper">
                <Database className="h-4 w-4 text-paper-dim" />
                {editingIndex !== null ? 'Edit rule' : 'Add data access rule'}
              </DialogTitle>
              <DialogDescription className="text-paper-muted">
                Configure database and table access for {userName}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Connection */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Connection</Label>
                <Select
                  value={formData.connectionId || 'all'}
                  onValueChange={(v) => setFormData({ ...formData, connectionId: v === 'all' ? null : v })}
                >
                  <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                    <SelectItem value="all">All connections</SelectItem>
                    {connections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        {conn.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Database Pattern */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  <Database className="h-3.5 w-3.5 text-paper-faint" />
                  Database pattern
                </Label>
                <Input
                  value={formData.databasePattern}
                  onChange={(e) => setFormData({ ...formData, databasePattern: e.target.value })}
                  placeholder="e.g., * or production or /^prod_.*/"
                  className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper"
                />
                <p className="text-[11px] text-paper-faint">
                  Use <code className="rounded-xs border border-ink-500 bg-ink-100 px-1 font-mono">*</code> for all, exact name, or regex pattern.
                </p>
              </div>

              {/* Table Pattern */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  <Table2 className="h-3.5 w-3.5 text-paper-faint" />
                  Table pattern
                </Label>
                <Input
                  value={formData.tablePattern}
                  onChange={(e) => setFormData({ ...formData, tablePattern: e.target.value })}
                  placeholder="e.g., * or users or /^log_.*/"
                  className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper"
                />
              </div>

              {/* Info about access type */}
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-3 text-[12px] text-paper-muted">
                <p className="flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-paper-dim" />
                  Access type (read/write/admin) is determined by the user's role permissions.
                </p>
              </div>

              {/* Allow/Deny Toggle */}
              <div className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 p-3">
                <div>
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Rule type</Label>
                  <p className="text-[11px] text-paper-faint">
                    Deny rules take precedence over allow rules.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${formData.isAllowed ? 'text-paper-faint' : 'text-red-300'}`}>
                    Deny
                  </span>
                  <Switch
                    checked={formData.isAllowed}
                    onCheckedChange={(checked) => setFormData({ ...formData, isAllowed: checked })}
                  />
                  <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${formData.isAllowed ? 'text-emerald-300' : 'text-paper-faint'}`}>
                    Allow
                  </span>
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Priority</Label>
                <Input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                  className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper"
                />
                <p className="text-[11px] text-paper-faint">
                  Higher priority rules are evaluated first.
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Description (optional)</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., Allow access to production logs"
                  className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                />
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
                onClick={handleSaveRule}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                {editingIndex !== null ? 'Update rule' : 'Add rule'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default UserDataAccess;
