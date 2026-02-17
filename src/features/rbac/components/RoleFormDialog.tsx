/**
 * Role Form Dialog Component
 * 
 * Dialog for creating and editing RBAC roles with permission selection.
 * Beautiful, interactive UI with smooth animations.
 */

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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Lock,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Search,
  X,
  ChevronsDown,
  ChevronsUp,
  Users,
  Info,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  rbacRolesApi,
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
  role?: RbacRole | null; // null = create mode, RbacRole = edit mode
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

  // Permissions
  const canCreate = hasPermission(RBAC_PERMISSIONS.ROLES_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.ROLES_UPDATE);

  // State
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [isDefault, setIsDefault] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch permissions
  const { data: permissionsByCategory, isLoading: loadingPermissions } = useQuery({
    queryKey: ['rbac-permissions-by-category'],
    queryFn: () => rbacRolesApi.getPermissionsByCategory(),
    enabled: isOpen,
  });

  // Create a mapping from permission names to IDs
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

  // Initialize form when role changes
  useEffect(() => {
    if (isOpen) {
      if (role) {
        // Edit mode
        setName(role.name);
        setDisplayName(role.displayName);
        setDescription(role.description || '');

        // Map permission names to IDs
        // role.permissions contains permission names, but we need IDs
        const permissionIds = role.permissions
          .map((permName) => permissionNameToIdMap.get(permName))
          .filter((id): id is string => id !== undefined);

        setSelectedPermissionIds(new Set(permissionIds));
        setIsDefault(role.isDefault);
      } else {
        // Create mode
        setName('');
        setDisplayName('');
        setDescription('');
        setSelectedPermissionIds(new Set());
        setIsDefault(false);
      }
      setSearchQuery('');
      // Expand all categories by default
      if (permissionsByCategory) {
        setExpandedCategories(new Set(Object.keys(permissionsByCategory)));
      }
    }
  }, [isOpen, role, permissionsByCategory, permissionNameToIdMap]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (input: CreateRoleInput) => rbacRolesApi.create(input),
    onSuccess: () => {
      toast.success('Role created successfully', {
        icon: <CheckCircle2 className="h-5 w-5 text-green-400" />,
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
        icon: <CheckCircle2 className="h-5 w-5 text-green-400" />,
      });
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to update role: ${error.message}`);
    },
  });

  // Validation
  const isEditing = !!role;
  const isSystemRole = role?.isSystem || false;
  const canEditSystemRole = isSuperAdmin();
  const canModify = isEditing ? (isSystemRole ? canEditSystemRole : canUpdate) : canCreate;

  const isValid =
    (isEditing ? true : name.trim().length >= 2) &&
    displayName.trim().length >= 2 &&
    selectedPermissionIds.size > 0;

  // Filter permissions by search query
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
      if (matching.length > 0) {
        filtered[category] = matching;
      }
    });

    return filtered;
  }, [permissionsByCategory, searchQuery]);

  // Handlers
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const togglePermission = (permissionId: string) => {
    if (!canModify) return;
    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(permissionId)) {
        newSet.delete(permissionId);
      } else {
        newSet.add(permissionId);
      }
      return newSet;
    });
  };

  const handleSelectAllInCategory = (category: string) => {
    if (!canModify || !filteredCategories) return;
    const categoryPermissions = filteredCategories[category] || [];
    const allSelected = categoryPermissions.every((p) => selectedPermissionIds.has(p.id));

    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        categoryPermissions.forEach((p) => newSet.delete(p.id));
      } else {
        categoryPermissions.forEach((p) => newSet.add(p.id));
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!canModify || !filteredCategories) return;
    const allPermissions = Object.values(filteredCategories).flat();
    const allSelected = allPermissions.every((p) => selectedPermissionIds.has(p.id));

    setSelectedPermissionIds((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        allPermissions.forEach((p) => newSet.delete(p.id));
      } else {
        allPermissions.forEach((p) => newSet.add(p.id));
      }
      return newSet;
    });
  };

  const handleToggleExpandAll = () => {
    if (!filteredCategories) return;
    const categoryKeys = Object.keys(filteredCategories);
    const allExpanded = categoryKeys.every((key) => expandedCategories.has(key));

    if (allExpanded) {
      // Collapse all
      setExpandedCategories(new Set());
    } else {
      // Expand all
      setExpandedCategories(new Set(categoryKeys));
    }
  };

  const handleSubmit = () => {
    if (!isValid || !canModify) return;

    const permissionIds = Array.from(selectedPermissionIds);

    if (isEditing && role) {
      // Update role
      const input: UpdateRoleInput = {
        displayName: displayName.trim(),
        description: description.trim() || null,
        permissionIds,
        isDefault,
      };
      updateMutation.mutate({ id: role.id, input });
    } else {
      // Create role
      const input: CreateRoleInput = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        permissionIds,
        isDefault,
      };
      createMutation.mutate(input);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const totalPermissions = Object.values(filteredCategories || {}).flat().length;
  const selectedCount = selectedPermissionIds.size;
  const allSelected = totalPermissions > 0 && selectedCount === totalPermissions;

  // Determine if all categories are expanded
  const categoryKeys = filteredCategories ? Object.keys(filteredCategories) : [];
  const allExpanded = categoryKeys.length > 0 && categoryKeys.every((key) => expandedCategories.has(key));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 border-gray-800/50 shadow-2xl overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-purple-500/10 border-b border-white/5">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30"
            >
              <Shield className="h-5 w-5 text-purple-300" />
            </motion.div>
            <span className="bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              {isEditing ? 'Edit Role' : 'Create Role'}
            </span>
            {isEditing && isSystemRole && (
              <Badge variant="outline" className="ml-2 bg-amber-500/20 text-amber-300 border-amber-500/30">
                <Lock className="h-3 w-3 mr-1" />
                System Role
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-gray-400 mt-2">
            {isEditing
              ? 'Update role details and permissions. System roles can only be modified by super admins.'
              : 'Create a new custom role with specific permissions.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6">
          <div className="py-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-6"
            >
              {/* System Role Warning */}
              <AnimatePresence>
                {isEditing && isSystemRole && !canEditSystemRole && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
                      <AlertDescription className="text-red-300">
                        This is a system role. Only super admins can modify system roles.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Basic Information */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Info className="h-4 w-4 text-purple-400" />
                    Basic Information
                  </h3>
                  {isEditing && role && (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/20 gap-1.5 pl-2 pr-2.5 py-0.5">
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        {role.userCount || 0} users assigned
                      </span>
                    </Badge>
                  )}
                </div>

                {/* Name (only for create) */}
                {!isEditing && (
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-gray-300">
                      Role Name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., custom_role"
                      disabled={!canModify}
                      className="bg-white/5 border-white/10 focus:border-purple-500/50 focus:ring-purple-500/20 transition-all"
                    />
                    <p className="text-xs text-gray-400">
                      Must start with a letter and contain only letters, numbers, underscores, and hyphens.
                      This cannot be changed after creation.
                    </p>
                  </div>
                )}

                {/* Display Name */}
                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-gray-300">
                    Display Name <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Custom Role"
                    disabled={!canModify}
                    className="bg-white/5 border-white/10 focus:border-purple-500/50 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-gray-300">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the role's purpose and responsibilities..."
                    disabled={!canModify}
                    rows={3}
                    className="bg-white/5 border-white/10 focus:border-purple-500/50 focus:ring-purple-500/20 resize-none transition-all"
                  />
                </div>

                {/* Is Default */}
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <Checkbox
                    id="isDefault"
                    checked={isDefault}
                    onCheckedChange={(checked) => setIsDefault(checked === true)}
                    disabled={!canModify}
                    className="data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                  />
                  <Label htmlFor="isDefault" className="cursor-pointer text-gray-300">
                    Set as default role for new users
                  </Label>
                </div>
              </motion.div>

              {/* Permissions */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-400" />
                    Permissions <span className="text-red-400">*</span>
                  </h3>
                  <div className="flex items-center gap-3">
                    {selectedCount > 0 && (
                      <Badge variant="outline" className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border-purple-500/30 text-purple-300">
                        {selectedCount} selected
                      </Badge>
                    )}
                    {categoryKeys.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleToggleExpandAll}
                        className="h-7 text-xs hover:bg-white/10 gap-1.5"
                        title={allExpanded ? "Collapse all categories" : "Expand all categories"}
                      >
                        {allExpanded ? (
                          <>
                            <ChevronsUp className="h-3.5 w-3.5" />
                            Collapse All
                          </>
                        ) : (
                          <>
                            <ChevronsDown className="h-3.5 w-3.5" />
                            Expand All
                          </>
                        )}
                      </Button>
                    )}
                    {canModify && totalPermissions > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleSelectAll}
                        className="h-7 text-xs hover:bg-white/10"
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Search */}
                {!loadingPermissions && totalPermissions > 5 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search permissions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-9 bg-white/5 border-white/10 focus:border-purple-500/50 focus:ring-purple-500/20"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}

                {loadingPermissions ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full rounded-lg bg-white/5" />
                    ))}
                  </div>
                ) : !filteredCategories || Object.keys(filteredCategories).length === 0 ? (
                  <Alert className="border-gray-700 bg-gray-800/50">
                    <AlertDescription>
                      {searchQuery ? 'No permissions found matching your search.' : 'No permissions available'}
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
                        const allSelected = categorySelected.length === permissions.length;
                        const someSelected = categorySelected.length > 0 && !allSelected;

                        return (
                          <motion.div
                            key={category}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            <Collapsible
                              open={isExpanded}
                              onOpenChange={() => toggleCategory(category)}
                            >
                              <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] overflow-hidden backdrop-blur-sm hover:border-white/20 transition-all">
                                <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors group">
                                  <div className="flex items-center gap-3">
                                    <motion.div
                                      animate={{ rotate: isExpanded ? 90 : 0 }}
                                      transition={{ duration: 0.2 }}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-purple-400" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-purple-400 transition-colors" />
                                      )}
                                    </motion.div>
                                    <span className="font-semibold text-white">{category}</span>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        'text-xs transition-colors',
                                        allSelected
                                          ? 'bg-green-500/20 text-green-300 border-green-500/30'
                                          : someSelected
                                            ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                                            : 'bg-white/5 text-gray-400 border-white/10'
                                      )}
                                    >
                                      {categorySelected.length}/{permissions.length}
                                    </Badge>
                                  </div>
                                  {canModify && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelectAllInCategory(category);
                                      }}
                                      className="h-7 text-xs hover:bg-white/10"
                                    >
                                      {allSelected ? 'Deselect All' : 'Select All'}
                                    </Button>
                                  )}
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="px-4 pb-4 pt-2 space-y-2"
                                  >
                                    {permissions.map((permission) => {
                                      const isSelected = selectedPermissionIds.has(permission.id);
                                      return (
                                        <motion.div
                                          key={permission.id}
                                          whileHover={{ scale: 1.01 }}
                                          whileTap={{ scale: 0.99 }}
                                          className={cn(
                                            'flex items-start space-x-3 p-3 rounded-lg cursor-pointer transition-all',
                                            isSelected
                                              ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 shadow-lg shadow-purple-500/10'
                                              : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/20'
                                          )}
                                          onClick={() => togglePermission(permission.id)}
                                        >
                                          <Checkbox
                                            id={permission.id}
                                            checked={isSelected}
                                            onCheckedChange={() => togglePermission(permission.id)}
                                            disabled={!canModify}
                                            className="mt-0.5 data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                                          />
                                          <div className="flex-1 min-w-0">
                                            <Label
                                              htmlFor={permission.id}
                                              className={cn(
                                                'text-sm cursor-pointer block',
                                                isSelected ? 'text-white font-medium' : 'text-gray-300'
                                              )}
                                            >
                                              {permission.displayName}
                                            </Label>
                                            {permission.description && (
                                              <p className="text-xs text-gray-400 mt-1">
                                                {permission.description}
                                              </p>
                                            )}
                                          </div>
                                          {isSelected && (
                                            <motion.div
                                              initial={{ scale: 0 }}
                                              animate={{ scale: 1 }}
                                              className="text-purple-400"
                                            >
                                              <CheckCircle2 className="h-4 w-4" />
                                            </motion.div>
                                          )}
                                        </motion.div>
                                      );
                                    })}
                                  </motion.div>
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
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
                      <AlertDescription className="text-red-300">
                        At least one permission is required for the role.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </motion.div>
            </motion.div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 px-6 py-4 border-t border-white/10 bg-gradient-to-r from-gray-900/50 to-gray-900/30 backdrop-blur-sm">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="hover:bg-white/10"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleSubmit}
            disabled={!isValid || !canModify || isLoading}
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="h-4 w-4 rounded-full border-2 border-white border-t-transparent"
                />
                {isEditing ? 'Updating...' : 'Creating...'}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {isEditing ? 'Update Role' : 'Create Role'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RoleFormDialog;
