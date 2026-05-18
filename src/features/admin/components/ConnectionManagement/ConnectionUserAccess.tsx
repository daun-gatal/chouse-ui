/**
 * Connection User Access Component
 * 
 * Manages which users have access to a specific ClickHouse connection.
 */

import { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  UserX,
  X,
  Loader2,
  Shield,
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  rbacConnectionsApi,
  rbacUsersApi,
  type ClickHouseConnection,
  type RbacUser,
} from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';

interface ConnectionUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  roles: string[];
  hasDirectAccess: boolean;
  accessViaRoles: string[];
}

interface ConnectionUserAccessProps {
  connection: ClickHouseConnection;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export default function ConnectionUserAccess({
  connection,
  isOpen,
  onClose,
  onUpdate,
}: ConnectionUserAccessProps) {
  const [usersWithAccess, setUsersWithAccess] = useState<ConnectionUser[]>([]);
  const [allUsers, setAllUsers] = useState<RbacUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  
  const { hasPermission } = useRbacStore();
  const canUpdate = hasPermission(RBAC_PERMISSIONS.USERS_UPDATE);

  // Fetch users with access
  const fetchUsersWithAccess = async () => {
    setIsLoading(true);
    try {
      const users = await rbacConnectionsApi.getUsers(connection.id);
      setUsersWithAccess(users);
    } catch (error) {
      log.error('Failed to fetch users with access:', error);
      toast.error('Failed to load users with access');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch all users for the add dropdown
  const fetchAllUsers = async () => {
    try {
      const result = await rbacUsersApi.list({ limit: 1000 });
      setAllUsers(result.users);
    } catch (error) {
      log.error('Failed to fetch all users:', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsersWithAccess();
      fetchAllUsers();
      setSearchQuery('');
      setSelectedUserId('');
    }
  }, [isOpen, connection.id]);

  const handleGrantAccess = async () => {
    if (!selectedUserId || !canUpdate) return;

    setIsAdding(true);
    try {
      await rbacConnectionsApi.grantAccess(connection.id, selectedUserId);
      toast.success('User access granted');
      setSelectedUserId('');
      fetchUsersWithAccess();
      onUpdate?.();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to grant access';
      toast.error(errorMsg);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRevokeAccess = async (userId: string) => {
    if (!canUpdate) return;

    try {
      await rbacConnectionsApi.revokeAccess(connection.id, userId);
      toast.success('User access revoked');
      fetchUsersWithAccess();
      onUpdate?.();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to revoke access';
      toast.error(errorMsg);
    }
  };

  // Filter users for the add dropdown (exclude users who already have access)
  const availableUsers = allUsers.filter(
    (user) =>
      !usersWithAccess.some((u) => u.id === user.id) &&
      (searchQuery === '' ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.displayName &&
          user.displayName.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  // Filter users with access for display
  const filteredUsersWithAccess = usersWithAccess.filter(
    (user) =>
      searchQuery === '' ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.displayName &&
        user.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Users className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">User access</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                {connection.name}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-paper-muted">
            Manage which users can access this ClickHouse connection. Users can have direct access
            or access via roles through data access rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-dim" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xs border-ink-500 bg-ink-200 pl-10 text-paper"
            />
          </div>

          {/* Add User Section */}
          {canUpdate && (
            <div className="flex items-end gap-2 rounded-xs border border-ink-500 bg-ink-200 p-4">
              <div className="flex-1">
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Add user access</label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                    <SelectValue placeholder="Select a user…" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                    {availableUsers.length === 0 ? (
                      <div className="p-2 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
                        {allUsers.length === 0
                          ? 'No users available'
                          : 'All users already have access'}
                      </div>
                    ) : (
                      availableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          <div className="flex items-center gap-2">
                            <span>{user.displayName || user.username}</span>
                            <span className="text-[11px] text-paper-faint">({user.email})</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleGrantAccess}
                disabled={!selectedUserId || isAdding}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                {isAdding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Grant access
              </Button>
            </div>
          )}

          {/* Users with Access List */}
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
              </div>
            ) : filteredUsersWithAccess.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Users className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No users with access</h3>
                <p className="mt-2 text-[12px] text-paper-muted">
                  {searchQuery
                    ? 'No users match your search.'
                    : 'Grant access to users to allow them to use this connection.'}
                </p>
              </div>
            ) : (
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow className="border-ink-500 hover:bg-transparent">
                      <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">User</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Status</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Access type</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Roles</TableHead>
                      {canUpdate && (
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsersWithAccess.map((user) => (
                      <TableRow key={user.id} className="border-ink-500">
                        <TableCell>
                          <div>
                            <div className="font-medium text-paper">
                              {user.displayName || user.username}
                            </div>
                            <div className="text-[12px] text-paper-muted">{user.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {user.isActive ? (
                            <span className="inline-flex items-center gap-1 rounded-xs border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                              <AlertCircle className="h-3 w-3" />
                              Inactive
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {user.hasDirectAccess && (
                              <span className="w-fit rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                Direct access
                              </span>
                            )}
                            {user.accessViaRoles.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="inline-flex w-fit items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                                    <Shield className="h-3 w-3" />
                                    Via roles ({user.accessViaRoles.length})
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                  <div className="text-[12px]">
                                    Access via roles: {user.accessViaRoles.join(', ')}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {!user.hasDirectAccess && user.accessViaRoles.length === 0 && (
                              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">No direct access</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length > 0 ? (
                              user.roles.slice(0, 2).map((role) => (
                                <span
                                  key={role}
                                  className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted"
                                >
                                  {role}
                                </span>
                              ))
                            ) : (
                              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">No roles</span>
                            )}
                            {user.roles.length > 2 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                                    +{user.roles.length - 2} more
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                  <div className="text-[12px]">
                                    All roles: {user.roles.join(', ')}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        {canUpdate && (
                          <TableCell className="text-right">
                            {user.hasDirectAccess && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRevokeAccess(user.id)}
                                    className="h-8 w-8 rounded-xs text-red-400 hover:bg-red-950/40 hover:text-red-300"
                                  >
                                    <UserX className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">Revoke direct access</TooltipContent>
                              </Tooltip>
                            )}
                            {!user.hasDirectAccess && user.accessViaRoles.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                                    Access via roles only
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                  Remove data access rules to revoke access.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
            )}
          </div>

          {/* Info Note */}
          <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
            <p className="text-[12px] text-paper-muted">
              <strong className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Note: </strong>
              Users can have access through direct assignment or via roles through data access rules. Direct access can be revoked here, but role-based access must be managed through data access rules.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
