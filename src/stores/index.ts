/**
 * Stores Index
 * 
 * Re-exports all stores for convenient imports.
 */

// Auth store
export { useAuthStore, hasPermission } from './auth';
export type { AuthState } from './auth';

// Workspace store
export { useWorkspaceStore, genTabId } from './workspace';
export type { WorkspaceState, Tab } from './workspace';

// Explorer store
export { useExplorerStore } from './explorer';
export type { ExplorerState } from './explorer';

