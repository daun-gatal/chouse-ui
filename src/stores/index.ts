/**
 * Stores Index
 * 
 * Re-exports all stores for convenient imports.
 */

// Connection info store (ClickHouse connection metadata)
export { useAuthStore } from './auth';
export type { AuthState, ConnectionInfoState } from './auth';

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

// Preferences store
export {
  usePreferencesStore,
  RESULT_ROWS_MIN,
  RESULT_ROWS_MAX,
  RESULT_ROWS_DEFAULT,
} from './preferences';
export type { PreferencesState } from './preferences';

