import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Shield,
  ChevronRight,
  Lock,
  CheckCircle2,
  Search,
  X,
  ChevronsDown,
  ChevronsUp,
  Users,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Database,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  rbacRolesApi,
  rbacDataAccessPoliciesApi,
  type RbacRole,
  type RbacPermission,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';

// ============================================
// Types
// ============================================

interface RoleFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  role?: RbacRole | null;
  onSuccess?: () => void;
}

// ============================================
// Component
// ============================================

export const RoleFormDialog: React.FC<RoleFormDialogProps> = ({
  isOpen,
  onClose,
  role,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const { hasPermission, isSuperAdmin } = useRbacStore();

  const canCreate = hasPermission(RBAC_PERMISSIONS.ROLES_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.ROLES_UPDATE);

  // Step state (1 = Details, 2 = Permissions, 3 = Data Access & Review)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form state
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<Set<string>>(new Set());
  const [isDefault, setIsDefault] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const { data: permissionsByCategory, isLoading: loadingPermissions } = useQuery({
    queryKey: ['rbac-permissions-by-category'],
    queryFn: () => rbacRolesApi.getPermissionsByCategory(),
    enabled: isOpen,
  });

  const { data: policies } = useQuery({
    queryKey: ['rbac-data-access-policies'],
    queryFn: () => rbacDataAccessPoliciesApi.list(),
    enabled: isOpen,
  });

  const permissionNameToIdMap = useMemo(() => {
    if (!permissionsByCategory) return new Map<string, string>();
    const map = new Map<string, string>();
    Object.values(permissionsByCategory).forEach((permissions) => {
      permissions.forEach((perm) => {
        map.set(perm.name, perm.id);
      });
    });
    return map;
  }, [permissionsByCategory]);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      if (role) {
        setName(role.name);
        setDisplayName(role.displayName);
        setDescription(role.description || '');
        const permissionIds = role.permissions
          .map((permName) => permissionNameToIdMap.get(permName))
          .filter((id): id is string => id !== undefined);
        setSelectedPermissionIds(new Set(permissionIds));
        setSelectedPolicyIds(new Set(role.dataAccessPolicyIds || []));
        setIsDefault(role.isDefault);
      } else {
        setName('');
        setDisplayName('');
        setDescription('');
        setSelectedPermissionIds(new Set());
        setSelectedPolicyIds(new Set());
        setIsDefault(false);
      }
      setSearchQuery('');
      if (permissionsByCategory) {
        setExpandedCategories(new Set(Object.keys(permissionsByCategory)));
      }
    }
  }, [isOpen, role, permissionsByCategory, permissionNameToIdMap]);

  const createMutation = useMutation({
    mutationFn: (input: CreateRoleInput) => rbacRolesApi.create(input),
    onSuccess: () => {
      toast.success('Role created successfully', {
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
      });
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create role: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoleInput }) =>
      rbacRolesApi.update(id, input),
    onSuccess: () => {
      toast.success('Role updated successfully', {
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
      });
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to update role: ${error.message}`);
    },
  });

  const isEditing = !!role;
  const isSystemRole = role?.isSystem || false;
  const canEditSystemRole = isSuperAdmin();
  const canModify = isEditing ? (isSystemRole ? canEditSystemRole : canUpdate) : canCreate;
  const requiresPolicy = !isSystemRole;

  // Per-step validation
  const step1Valid = isEditing
    ? displayName.trim().length >= 2
    : name.trim().length >= 2 && displayName.trim().length >= 2;
  const step2Valid = selectedPermissionIds.size > 0;
  const step3Valid = !requiresPolicy || selectedPolicyIds.size > 0;

  const filteredCategories = React.useMemo(() => {
    if (!permissionsByCategory || !searchQuery.trim()) {
      return permissionsByCategory || {};
    }
    const query = searchQuery.toLowerCase();
    const filtered: Record<string, RbacPermission[]> = {};
    Object.entries(permissionsByCategory).forEach(([category, permissions]) => {
      const matching = permissions.filter(
        (p) =>
          p.displayName.toLowerCase().includes(query) ||
          p.name.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query))
      );
      if (matching.length > 0) filtered[category] = matching;
    });
    return filtered;
  }, [permissionsByCategory, searchQuery]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) newSet.delete(category);
      else newSet.add(category);
      return newSet;
    });
  };

  const togglePermission = (permissionId: string) => {
    if (!canModify) return;
    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(permissionId)) newSet.delete(permissionId);
      else newSet.add(permissionId);
      return newSet;
    });
  };

  const togglePolicy = (policyId: string) => {
    if (!canModify) return;
    setSelectedPolicyIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(policyId)) newSet.delete(policyId);
      else newSet.add(policyId);
      return newSet;
    });
  };

  const handleSelectAllInCategory = (category: string) => {
    if (!canModify || !filteredCategories) return;
    const categoryPermissions = filteredCategories[category] || [];
    const allSelected = categoryPermissions.every((p) => selectedPermissionIds.has(p.id));
    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (allSelected) categoryPermissions.forEach((p) => newSet.delete(p.id));
      else categoryPermissions.forEach((p) => newSet.add(p.id));
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!canModify || !filteredCategories) return;
    const allPermissions = Object.values(filteredCategories).flat();
    const allSelected = allPermissions.every((p) => selectedPermissionIds.has(p.id));
    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (allSelected) allPermissions.forEach((p) => newSet.delete(p.id));
      else allPermissions.forEach((p) => newSet.add(p.id));
      return newSet;
    });
  };

  const handleToggleExpandAll = () => {
    if (!filteredCategories) return;
    const categoryKeys = Object.keys(filteredCategories);
    const allExpanded = categoryKeys.every((key) => expandedCategories.has(key));
    setExpandedCategories(allExpanded ? new Set() : new Set(categoryKeys));
  };

  const handleSubmit = () => {
    if (!step3Valid || !canModify) return;

    const permissionIds = Array.from(selectedPermissionIds);
    const dataAccessPolicyIds = Array.from(selectedPolicyIds);

    if (isEditing && role) {
      const input: UpdateRoleInput = {
        displayName: displayName.trim(),
        description: description.trim() || null,
        permissionIds,
        isDefault,
        dataAccessPolicyIds,
      };
      updateMutation.mutate({ id: role.id, input });
    } else {
      const input: CreateRoleInput = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        permissionIds,
        dataAccessPolicyIds,
        isDefault,
      };
      createMutation.mutate(input);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const totalPermissions = Object.values(filteredCategories || {}).flat().length;
  const selectedCount = selectedPermissionIds.size;
  const allSelected = totalPermissions > 0 && selectedCount === totalPermissions;
  const categoryKeys = filteredCategories ? Object.keys(filteredCategories) : [];
  const allExpanded = categoryKeys.length > 0 && categoryKeys.every((key) => expandedCategories.has(key));

  // Summary for step 3 review
  const permissionSummaryByCategory = useMemo(() => {
    if (!permissionsByCategory) return [];
    return Object.entries(permissionsByCategory)
      .map(([category, perms]) => ({
        category,
        selected: perms.filter((p) => selectedPermissionIds.has(p.id)).length,
        total: perms.length,
      }))
      .filter((c) => c.selected > 0);
  }, [permissionsByCategory, selectedPermissionIds]);

  const STEPS = ['Details', 'Permissions', 'Data Access'];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-ink-500">
          <DialogTitle asChild>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <Shield className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-0.5 text-left">
                <h2 className="text-[16px] font-semibold tracking-tight text-paper">
                  {isEditing ? 'Edit role' : 'Create role'}
                </h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {isEditing ? 'Update role and permissions' : 'Role-based access control'}
                </p>
              </div>
              {isEditing && isSystemRole && (
                <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                  <Lock className="h-3 w-3" aria-hidden />
                  System
                </span>
              )}
            </div>
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-paper-muted">
            {step === 1 && 'Step 1 of 3 — set the role name and basic details.'}
            {step === 2 && 'Step 2 of 3 — choose which permissions this role grants.'}
            {step === 3 && 'Step 3 of 3 — assign data access policies and review.'}
          </DialogDescription>

          {/* Stepper */}
          <div className="mt-3 flex items-center gap-2 px-1">
            {STEPS.map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full font-mono text-[10px]',
                      step === n
                        ? 'bg-brand text-ink-50'
                        : step > n
                          ? 'bg-emerald-600 text-ink-50'
                          : 'bg-ink-300 text-paper-faint'
                    )}
                  >
                    {step > n ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-[10px] uppercase tracking-[0.14em]',
                      step === n ? 'text-paper' : 'text-paper-faint'
                    )}
                  >
                    {label}
                  </span>
                  {n < 3 && <span className="mx-1 h-px w-4 bg-ink-500" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        {/* Step content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">

          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <AnimatePresence>
                {isEditing && isSystemRole && !canEditSystemRole && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Alert variant="destructive" className="rounded-xs border-red-500/40 bg-red-500/10">
                      <AlertDescription className="font-mono text-[11px] uppercase tracking-[0.14em] text-red-300">
                        This is a system role. Only super admins can modify system roles.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              {isEditing && role && (
                <div className="flex items-center justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                    <Users className="h-3 w-3 text-paper-dim" aria-hidden />
                    <span>{role.userCount || 0} users assigned</span>
                  </span>
                </div>
              )}

              {!isEditing && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                    Role name <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., custom_role"
                    disabled={!canModify}
                    className="rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                  />
                  <p className="text-[11px] text-paper-faint">
                    Must start with a letter and contain only letters, numbers, underscores, and hyphens.
                    Cannot be changed after creation.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="displayName" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  Display name <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Custom Role"
                  disabled={!canModify}
                  className="rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the role's purpose and responsibilities..."
                  disabled={!canModify}
                  rows={3}
                  className="resize-none rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                />
              </div>

              <div className="flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                <Checkbox
                  id="isDefault"
                  checked={isDefault}
                  onCheckedChange={(checked) => setIsDefault(checked === true)}
                  disabled={!canModify}
                  className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                />
                <Label htmlFor="isDefault" className="cursor-pointer text-[12px] text-paper">
                  Set as default role for new users
                </Label>
              </div>
            </div>
          )}

          {/* ── Step 2: Permissions ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                  <span className="h-px w-6 bg-ink-700" aria-hidden />
                  <span>Permissions</span>
                  <span className="text-red-400">*</span>
                </span>
                <div className="flex items-center gap-2">
                  {selectedCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                      {selectedCount} selected
                    </span>
                  )}
                  {categoryKeys.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleToggleExpandAll}
                      className="h-7 gap-1.5 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
                    >
                      {allExpanded ? (
                        <><ChevronsUp className="h-3.5 w-3.5" /> Collapse all</>
                      ) : (
                        <><ChevronsDown className="h-3.5 w-3.5" /> Expand all</>
                      )}
                    </Button>
                  )}
                  {canModify && totalPermissions > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAll}
                      className="h-7 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
                    >
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </Button>
                  )}
                </div>
              </div>

              {!loadingPermissions && totalPermissions > 5 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-paper-faint" aria-hidden />
                  <Input
                    placeholder="Search permissions"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-xs border-ink-500 bg-ink-200 pl-9 pr-9 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-faint transition-colors hover:text-paper"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {loadingPermissions ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-xs bg-ink-200" />
                  ))}
                </div>
              ) : !filteredCategories || Object.keys(filteredCategories).length === 0 ? (
                <Alert className="rounded-xs border-ink-500 bg-ink-100">
                  <AlertDescription className="text-[12px] text-paper-muted">
                    {searchQuery ? 'No permissions found matching your search.' : 'No permissions available.'}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {Object.entries(filteredCategories).map(([category, permissions], index) => {
                      const isExpanded = expandedCategories.has(category);
                      const categorySelected = permissions.filter((p) =>
                        selectedPermissionIds.has(p.id)
                      );
                      const catAllSelected = categorySelected.length === permissions.length;
                      const someSelected = categorySelected.length > 0 && !catAllSelected;

                      return (
                        <motion.div
                          key={category}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ delay: index * 0.03 }}
                        >
                          <Collapsible
                            open={isExpanded}
                            onOpenChange={() => toggleCategory(category)}
                          >
                            <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100 transition-colors hover:border-ink-700">
                              <div className="flex items-center justify-between transition-colors hover:bg-ink-200">
                                <CollapsibleTrigger className="group flex flex-1 items-center gap-3 p-4 text-left">
                                  <motion.div
                                    animate={{ rotate: isExpanded ? 90 : 0 }}
                                    transition={{ duration: 0.2 }}
                                  >
                                    <ChevronRight className="h-4 w-4 text-paper-dim transition-colors group-hover:text-paper" />
                                  </motion.div>
                                  <span className="text-[13px] font-semibold text-paper">{category}</span>
                                  <span
                                    className={cn(
                                      'inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors',
                                      catAllSelected
                                        ? 'border-brand/40 text-brand'
                                        : someSelected
                                          ? 'border-brand/30 text-brand/80'
                                          : 'border-ink-500 bg-ink-200 text-paper-muted'
                                    )}
                                  >
                                    {categorySelected.length}/{permissions.length}
                                  </span>
                                </CollapsibleTrigger>
                                {canModify && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSelectAllInCategory(category)}
                                    className="mr-2 h-7 shrink-0 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-300 hover:text-paper"
                                  >
                                    {catAllSelected ? 'Deselect all' : 'Select all'}
                                  </Button>
                                )}
                              </div>
                              <CollapsibleContent>
                                <div className="px-4 pb-4 pt-2 space-y-2">
                                  {permissions.map((permission) => {
                                    const isSelected = selectedPermissionIds.has(permission.id);
                                    return (
                                      <div
                                        key={permission.id}
                                        role="checkbox"
                                        aria-checked={isSelected}
                                        aria-label={permission.displayName}
                                        aria-disabled={canModify ? undefined : true}
                                        tabIndex={canModify ? 0 : -1}
                                        onClick={() => togglePermission(permission.id)}
                                        onKeyDown={(e) => {
                                          if (!canModify) return;
                                          if (e.key === ' ' || e.key === 'Enter') {
                                            e.preventDefault();
                                            togglePermission(permission.id);
                                          }
                                        }}
                                        className={cn(
                                          'flex items-start gap-3 rounded-xs border p-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
                                          canModify ? 'cursor-pointer' : 'cursor-default opacity-70',
                                          isSelected
                                            ? 'border-brand/40 bg-ink-200'
                                            : 'border-ink-500 bg-ink-100',
                                          !isSelected && canModify && 'hover:border-ink-700 hover:bg-ink-200'
                                        )}
                                      >
                                        <Checkbox
                                          checked={isSelected}
                                          disabled={!canModify}
                                          tabIndex={-1}
                                          aria-hidden
                                          className="pointer-events-none mt-0.5 border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <span
                                            className={cn(
                                              'block text-[12px]',
                                              isSelected ? 'font-medium text-paper' : 'text-paper-muted'
                                            )}
                                          >
                                            {permission.displayName}
                                          </span>
                                          {permission.description && (
                                            <p className="mt-1 text-[11px] text-paper-faint">
                                              {permission.description}
                                            </p>
                                          )}
                                        </div>
                                        {isSelected && (
                                          <span className="text-brand" aria-hidden>
                                            <CheckCircle2 className="h-4 w-4" />
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {selectedPermissionIds.size === 0 && (
                <Alert variant="destructive" className="rounded-xs border-red-500/40 bg-red-500/10">
                  <AlertDescription className="font-mono text-[11px] uppercase tracking-[0.14em] text-red-300">
                    At least one permission is required for the role.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* ── Step 3: Data Access & Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Permissions summary */}
              {permissionSummaryByCategory.length > 0 && (
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                    <span>Permissions summary</span>
                    <span className="rounded-xs border border-brand/40 px-1.5 py-0.5 text-brand">
                      {selectedPermissionIds.size} selected
                    </span>
                  </span>
                  <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {permissionSummaryByCategory.map(({ category, selected, total }) => (
                        <span
                          key={category}
                          className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-paper-muted"
                        >
                          <span className="text-brand">{selected}</span>
                          <span className="text-paper-faint">/{total}</span>
                          <span className="ml-1 text-paper-dim">{category}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Data Access Policies */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                    <span>Data access policies</span>
                    {requiresPolicy && <span className="text-red-400">*</span>}
                  </span>
                  {selectedPolicyIds.size > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                      {selectedPolicyIds.size} selected
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-paper-muted">
                  Which databases and tables this role can access, on which connections. Manage policies in the Data Access tab.
                </p>

                {!policies || policies.length === 0 ? (
                  <Alert className="rounded-xs border-ink-500 bg-ink-100">
                    <AlertDescription className="text-[12px] text-paper-muted">
                      No data access policies exist yet. Create one in the Data Access tab first.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {policies.map((policy) => {
                      const isSelected = selectedPolicyIds.has(policy.id);
                      return (
                        <div
                          key={policy.id}
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={policy.name}
                          tabIndex={canModify ? 0 : -1}
                          onClick={() => togglePolicy(policy.id)}
                          onKeyDown={(e) => {
                            if (!canModify) return;
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              togglePolicy(policy.id);
                            }
                          }}
                          className={cn(
                            'flex items-start gap-3 rounded-xs border p-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
                            canModify ? 'cursor-pointer' : 'cursor-default opacity-70',
                            isSelected ? 'border-brand/40 bg-ink-200' : 'border-ink-500 bg-ink-100',
                            !isSelected && canModify && 'hover:border-ink-700 hover:bg-ink-200'
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={!canModify}
                            tabIndex={-1}
                            aria-hidden
                            className="pointer-events-none mt-0.5 border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                          />
                          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <span className={cn('block text-[12px]', isSelected ? 'font-medium text-paper' : 'text-paper-muted')}>
                              {policy.name}
                            </span>
                            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                              {policy.rules.some((r) => (r.connectionId ?? null) === null)
                                ? 'All connections'
                                : `${new Set(policy.rules.map((r) => r.connectionId).filter(Boolean)).size} connection(s)`}
                              {' · '}{policy.rules.length} rule(s)
                            </p>
                            {policy.description && (
                              <p className="mt-1 text-[11px] text-paper-faint">{policy.description}</p>
                            )}
                          </div>
                          {isSelected && (
                            <span className="text-brand" aria-hidden>
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {requiresPolicy && selectedPolicyIds.size === 0 && (
                  <Alert variant="destructive" className="rounded-xs border-red-500/40 bg-red-500/10">
                    <AlertDescription className="font-mono text-[11px] uppercase tracking-[0.14em] text-red-300">
                      At least one data access policy is required for this role.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-ink-500 px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep((step - 1) as 1 | 2 | 3))}
            disabled={isLoading}
            className="h-9 gap-1 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            {step === 1 ? 'Cancel' : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
          </Button>

          {step < 3 ? (
            <Button
              onClick={() => setStep((step + 1) as 2 | 3)}
              disabled={step === 1 ? !step1Valid : !step2Valid}
              className="h-9 gap-1 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!step3Valid || !canModify || isLoading}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {isEditing ? 'Updating' : 'Creating'}</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5" /> {isEditing ? 'Update role' : 'Create role'}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RoleFormDialog;
