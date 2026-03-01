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
import { Badge } from '@/components/ui/badge';
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
      <DialogContent className="sm:max-w-[800px] bg-gray-900 border-gray-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Users className="w-5 h-5" />
            User Access: {connection.name}
          </DialogTitle>
          <DialogDescription>
            Manage which users can access this ClickHouse connection. Users can have direct access
            or access via roles through data access rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-gray-800 border-gray-700"
            />
          </div>

          {/* Add User Section */}
          {canUpdate && (
            <div className="flex gap-2 items-end p-4 rounded-lg bg-gray-800/50 border border-gray-700">
              <div className="flex-1">
                <label className="text-sm text-gray-400 mb-2 block">Add User Access</label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="bg-gray-800 border-gray-700">
                    <SelectValue placeholder="Select a user..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {availableUsers.length === 0 ? (
                      <div className="p-2 text-sm text-gray-400 text-center">
                        {allUsers.length === 0
                          ? 'No users available'
                          : 'All users already have access'}
                      </div>
                    ) : (
                      availableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          <div className="flex items-center gap-2">
                            <span>{user.displayName || user.username}</span>
                            <span className="text-xs text-gray-500">({user.email})</span>
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
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isAdding ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                Grant Access
              </Button>
            </div>
          )}

          {/* Users with Access List */}
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : filteredUsersWithAccess.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto text-gray-600 mb-4" />
                <h3 className="text-lg font-medium text-gray-300">No users with access</h3>
                <p className="text-gray-500 mt-1">
                  {searchQuery
                    ? 'No users match your search'
                    : 'Grant access to users to allow them to use this connection'}
                </p>
              </div>
            ) : (
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-400">User</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-gray-400">Access Type</TableHead>
                      <TableHead className="text-gray-400">Roles</TableHead>
                      {canUpdate && (
                        <TableHead className="text-gray-400 text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsersWithAccess.map((user) => (
                      <TableRow key={user.id} className="border-gray-800">
                        <TableCell>
                          <div>
                            <div className="font-medium text-white">
                              {user.displayName || user.username}
                            </div>
                            <div className="text-sm text-gray-400">{user.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {user.isActive ? (
                            <Badge className="bg-green-500/20 text-green-400">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-500/20 text-gray-400">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {user.hasDirectAccess && (
                              <Badge className="bg-blue-500/20 text-blue-400 text-xs w-fit">
                                Direct Access
                              </Badge>
                            )}
                            {user.accessViaRoles.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge className="bg-purple-500/20 text-purple-400 text-xs w-fit">
                                    <Shield className="w-3 h-3 mr-1" />
                                    Via Roles ({user.accessViaRoles.length})
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-sm">
                                    Access via roles: {user.accessViaRoles.join(', ')}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {!user.hasDirectAccess && user.accessViaRoles.length === 0 && (
                              <span className="text-xs text-gray-500">No direct access</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length > 0 ? (
                              user.roles.slice(0, 2).map((role) => (
                                <Badge
                                  key={role}
                                  variant="outline"
                                  className="text-xs border-gray-700 text-gray-300"
                                >
                                  {role}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-gray-500">No roles</span>
                            )}
                            {user.roles.length > 2 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge
                                    variant="outline"
                                    className="text-xs border-gray-700 text-gray-300"
                                  >
                                    +{user.roles.length - 2} more
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-sm">
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
                                    className="h-8 w-8 text-red-400 hover:text-red-300"
                                  >
                                    <UserX className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Revoke Direct Access</TooltipContent>
                              </Tooltip>
                            )}
                            {!user.hasDirectAccess && user.accessViaRoles.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="text-xs text-gray-500">
                                    Access via roles only
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Remove data access rules to revoke access
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
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-blue-200">
              <strong>Note:</strong> Users can have access through direct assignment or via roles
              through data access rules. Direct access can be revoked here, but role-based access
              must be managed through data access rules.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
