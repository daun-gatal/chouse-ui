/**
 * Stores Index
 * 
 * Re-exports all stores for convenient imports.
 */

// Auth store (ClickHouse connection)
export { useAuthStore, hasPermission } from './auth';
export type { AuthState } from './auth';

// RBAC store (Role-Based Access Control)
export { 
  useRbacStore, 
  RBAC_PERMISSIONS,
  selectRbacUser,
  selectRbacRoles,
  selectRbacPermissions,
  selectIsRbacAuthenticated,
  selectIsRbacLoading,
} from './rbac';
export type { RbacState, RbacPermission } from './rbac';

// Workspace store
export { useWorkspaceStore, genTabId } from './workspace';
export type { WorkspaceState, Tab } from './workspace';

// Explorer store
export { useExplorerStore } from './explorer';
export type { ExplorerState } from './explorer';

