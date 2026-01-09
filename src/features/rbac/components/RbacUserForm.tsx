/**
 * RBAC User Form Component
 * 
 * Form for creating and editing RBAC users.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  Shield,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from '@/components/ui/glass-card';

import { rbacUsersApi, rbacRolesApi, type RbacUser, type RbacRole } from '@/api/rbac';
import { cn } from '@/lib/utils';

// ============================================
// Types
// ============================================

interface RbacUserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: RbacUser | null; // If provided, we're editing
  onSuccess?: () => void;
}

// ============================================
// Password Generator
// ============================================

function generatePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  const all = uppercase + lowercase + numbers + special;

  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// ============================================
// Role Colors
// ============================================

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  super_admin: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30' },
  admin: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  developer: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  analyst: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30' },
  viewer: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
};

const getRoleColor = (role: string) => {
  return ROLE_COLORS[role] || { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30' };
};

// ============================================
// Component
// ============================================

export const RbacUserForm: React.FC<RbacUserFormProps> = ({
  open,
  onOpenChange,
  user,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const isEditing = !!user;

  // Form state
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [generatePasswordOnCreate, setGeneratePasswordOnCreate] = useState(true);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);

  // Queries
  const { data: roles = [] } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacRolesApi.list(),
  });

  // Reset form when dialog opens/closes or user changes
  useEffect(() => {
    if (open) {
      if (user) {
        setEmail(user.email);
        setUsername(user.username);
        setDisplayName(user.displayName || '');
        setPassword('');
        setIsActive(user.isActive);
        // Find role IDs by matching role names
        const roleIds = roles
          .filter(r => user.roles.includes(r.name))
          .map(r => r.id);
        setSelectedRoleIds(roleIds);
      } else {
        // Reset for new user
        setEmail('');
        setUsername('');
        setDisplayName('');
        setPassword('');
        setSelectedRoleIds([]);
        setIsActive(true);
        setGeneratePasswordOnCreate(true);
      }
    }
  }, [open, user, roles]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof rbacUsersApi.create>[0]) => rbacUsersApi.create(data),
    onSuccess: (result) => {
      if (result.generatedPassword) {
        toast.success(
          <div className="space-y-2">
            <p>User created successfully!</p>
            <div className="bg-black/30 rounded p-2">
              <p className="text-xs text-gray-400">Generated Password:</p>
              <code className="text-sm font-mono">{result.generatedPassword}</code>
            </div>
            <p className="text-xs text-gray-400">Copy this password now. It won't be shown again.</p>
          </div>,
          { duration: 20000 }
        );
      } else {
        toast.success('User created successfully');
      }
      queryClient.invalidateQueries({ queryKey: ['rbac-users'] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to create user: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof rbacUsersApi.update>[1] }) =>
      rbacUsersApi.update(id, data),
    onSuccess: () => {
      toast.success('User updated successfully');
      queryClient.invalidateQueries({ queryKey: ['rbac-users'] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user: ${error.message}`);
    },
  });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  // Handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditing && user) {
      updateMutation.mutate({
        id: user.id,
        data: {
          email,
          username,
          displayName: displayName || undefined,
          isActive,
          roleIds: selectedRoleIds,
        },
      });
    } else {
      createMutation.mutate({
        email,
        username,
        displayName: displayName || undefined,
        password: generatePasswordOnCreate ? undefined : password,
        generatePassword: generatePasswordOnCreate,
        roleIds: selectedRoleIds,
      });
    }
  };

  const handleGeneratePassword = () => {
    setPassword(generatePassword());
    setShowPassword(true);
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-gray-900/95 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <User className="h-5 w-5 text-blue-400" />
            {isEditing ? 'Edit User' : 'Create New User'}
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            {isEditing
              ? 'Update user information and role assignments.'
              : 'Create a new user account with role assignments.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-white">
                Username
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="username"
                  required
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-white">
              Display Name
            </Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John Doe"
              className="bg-white/5 border-white/10"
            />
          </div>

          {/* Password (only for new users) */}
          {!isEditing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-white">Password</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="generatePassword"
                    checked={generatePasswordOnCreate}
                    onCheckedChange={(checked) => setGeneratePasswordOnCreate(!!checked)}
                  />
                  <label
                    htmlFor="generatePassword"
                    className="text-sm text-gray-400 cursor-pointer"
                  >
                    Generate random password
                  </label>
                </div>
              </div>

              {!generatePasswordOnCreate && (
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required={!generatePasswordOnCreate}
                    className="pl-10 pr-20 bg-white/5 border-white/10"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={handleGeneratePassword}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Roles */}
          <div className="space-y-3">
            <Label className="text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-400" />
              Roles
            </Label>
            <ScrollArea className="h-[200px] rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="space-y-2">
                {roles.map((role) => {
                  const isSelected = selectedRoleIds.includes(role.id);
                  const colors = getRoleColor(role.name);

                  return (
                    <motion.div
                      key={role.id}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors',
                        isSelected
                          ? `${colors.bg} ${colors.border} border`
                          : 'bg-white/5 border border-transparent hover:bg-white/10'
                      )}
                      onClick={() => toggleRole(role.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRole(role.id)}
                        />
                        <div>
                          <p className={cn('font-medium', isSelected ? colors.text : 'text-white')}>
                            {role.displayName}
                          </p>
                          {role.description && (
                            <p className="text-xs text-gray-400">{role.description}</p>
                          )}
                        </div>
                      </div>
                      {role.isSystem && (
                        <Badge variant="outline" className="text-xs">
                          System
                        </Badge>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </ScrollArea>
            <p className="text-xs text-gray-400">
              {selectedRoleIds.length} role(s) selected
            </p>
          </div>

          {/* Active Status (only for editing) */}
          {isEditing && (
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
              <div>
                <Label className="text-white">Account Status</Label>
                <p className="text-sm text-gray-400">
                  Inactive users cannot log in
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="gap-2">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEditing ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {isEditing ? 'Update User' : 'Create User'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RbacUserForm;
