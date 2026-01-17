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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
      console.error('Failed to load data:', error);
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
      console.error('Failed to save rules:', error);
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
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-400" />
            <h3 className="text-lg font-medium text-white">Data Access Rules</h3>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-500" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p>User-specific rules that supplement role-based permissions. Higher priority rules are evaluated first.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openAddDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          )}
        </div>

        {/* Rules Table */}
        {rules.length === 0 ? (
          <div className="text-center py-8 rounded-lg bg-white/5 border border-white/10">
            <Shield className="h-10 w-10 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-400">No user-specific data access rules</p>
            <p className="text-sm text-gray-500 mt-1">
              Access is determined by role permissions only
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-white/5 hover:bg-white/5">
                  <TableHead className="text-gray-400">Connection</TableHead>
                  <TableHead className="text-gray-400">Database</TableHead>
                  <TableHead className="text-gray-400">Table</TableHead>
                  <TableHead className="text-gray-400 text-center">Allow/Deny</TableHead>
                  <TableHead className="text-gray-400 text-center">Priority</TableHead>
                  {canEdit && <TableHead className="text-gray-400 w-20"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, index) => (
                  <TableRow
                    key={rule.id}
                    className="hover:bg-white/5 cursor-pointer"
                    onClick={() => canEdit && openEditDialog(index)}
                  >
                    <TableCell className="font-medium text-white">
                      {getConnectionName(rule.connectionId)}
                    </TableCell>
                    <TableCell>
                      <code className="px-2 py-0.5 rounded bg-black/30 text-purple-300 text-sm">
                        {rule.databasePattern}
                      </code>
                    </TableCell>
                    <TableCell>
                      <code className="px-2 py-0.5 rounded bg-black/30 text-blue-300 text-sm">
                        {rule.tablePattern}
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      {rule.isAllowed ? (
                        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/30">
                          Allow
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30">
                          Deny
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-gray-400">
                      {rule.priority}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRule(index);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
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
              variant="outline"
              onClick={handleSaveAll}
              disabled={isSaving}
              className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Data Access Rules'
              )}
            </Button>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-400" />
                {editingIndex !== null ? 'Edit Rule' : 'Add Data Access Rule'}
              </DialogTitle>
              <DialogDescription>
                Configure database and table access for {userName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Connection */}
              <div className="space-y-2">
                <Label>Connection</Label>
                <Select
                  value={formData.connectionId || 'all'}
                  onValueChange={(v) => setFormData({ ...formData, connectionId: v === 'all' ? null : v })}
                >
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Connections</SelectItem>
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
                <Label className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-purple-400" />
                  Database Pattern
                </Label>
                <Input
                  value={formData.databasePattern}
                  onChange={(e) => setFormData({ ...formData, databasePattern: e.target.value })}
                  placeholder="e.g., * or production or /^prod_.*/"
                  className="bg-white/5 border-white/10"
                />
                <p className="text-xs text-gray-500">
                  Use <code className="bg-black/30 px-1 rounded">*</code> for all, exact name, or regex pattern
                </p>
              </div>

              {/* Table Pattern */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-blue-400" />
                  Table Pattern
                </Label>
                <Input
                  value={formData.tablePattern}
                  onChange={(e) => setFormData({ ...formData, tablePattern: e.target.value })}
                  placeholder="e.g., * or users or /^log_.*/"
                  className="bg-white/5 border-white/10"
                />
              </div>

              {/* Info about access type */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
                <p className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Access type (read/write/admin) is determined by the user's role permissions
                </p>
              </div>

              {/* Allow/Deny Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <div>
                  <Label>Rule Type</Label>
                  <p className="text-xs text-gray-500">
                    Deny rules take precedence over allow rules
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={formData.isAllowed ? 'text-gray-500' : 'text-red-400 font-medium'}>
                    Deny
                  </span>
                  <Switch
                    checked={formData.isAllowed}
                    onCheckedChange={(checked) => setFormData({ ...formData, isAllowed: checked })}
                  />
                  <span className={formData.isAllowed ? 'text-green-400 font-medium' : 'text-gray-500'}>
                    Allow
                  </span>
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                  className="bg-white/5 border-white/10"
                />
                <p className="text-xs text-gray-500">
                  Higher priority rules are evaluated first
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., Allow access to production logs"
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveRule}
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
              >
                {editingIndex !== null ? 'Update Rule' : 'Add Rule'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default UserDataAccess;
