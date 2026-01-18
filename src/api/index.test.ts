/**
 * Tests for API Index
 */

import { describe, it, expect } from 'vitest';
import * as apiIndex from './index';

describe('API Index', () => {
    it('should export client functions', () => {
        expect(apiIndex.api).toBeDefined();
        expect(apiIndex.getSessionId).toBeDefined();
        expect(apiIndex.setSessionId).toBeDefined();
        expect(apiIndex.clearSession).toBeDefined();
    });

    it('should export queryApi namespace', () => {
        expect(apiIndex.queryApi).toBeDefined();
        expect(apiIndex.queryApi.executeSelect).toBeDefined();
        expect(apiIndex.queryApi.detectQueryType).toBeDefined();
    });

    it('should export explorerApi namespace', () => {
        expect(apiIndex.explorerApi).toBeDefined();
        expect(apiIndex.explorerApi.getDatabases).toBeDefined();
        expect(apiIndex.explorerApi.getTableDetails).toBeDefined();
    });

    it('should export metricsApi namespace', () => {
        expect(apiIndex.metricsApi).toBeDefined();
        expect(apiIndex.metricsApi.getSystemStats).toBeDefined();
    });

    it('should export savedQueriesApi namespace', () => {
        expect(apiIndex.savedQueriesApi).toBeDefined();
        expect(apiIndex.savedQueriesApi.getSavedQueries).toBeDefined();
    });

    it('should export configApi namespace', () => {
        expect(apiIndex.configApi).toBeDefined();
        expect(apiIndex.configApi.getConfig).toBeDefined();
    });

    it('should export RBAC functions', () => {
        expect(apiIndex.rbacAuthApi).toBeDefined();
        expect(apiIndex.rbacUsersApi).toBeDefined();
        expect(apiIndex.rbacRolesApi).toBeDefined();
    });
});
