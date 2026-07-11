/**
 * Tests for stores/workspace.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryApi } from '@/api';

import type { QueryHistoryItem } from './workspace';

const historyItem = (id: string): QueryHistoryItem => ({
    id,
    query: `SELECT '${id}'`,
    connectionId: 'connection-1',
    connectionName: 'Local',
    executedAt: 1,
    durationMs: 10,
    rows: 1,
    status: 'success',
});

describe('stores/workspace', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        localStorage.clear();
        const { useWorkspaceStore } = await import('./workspace');
        useWorkspaceStore.setState({
            queryHistory: [],
        });
    });

    it('should export useWorkspaceStore', async () => {
        const workspaceModule = await import('./workspace');
        expect(workspaceModule.useWorkspaceStore).toBeDefined();
        expect(typeof workspaceModule.useWorkspaceStore).toBe('function');
    });

    it('should export genTabId utility', async () => {
        const workspaceModule = await import('./workspace');
        expect(workspaceModule.genTabId).toBeDefined();
        expect(typeof workspaceModule.genTabId).toBe('function');
    });

    it('genTabId should generate unique IDs', async () => {
        const { genTabId } = await import('./workspace');
        const id1 = genTabId();
        const id2 = genTabId();

        expect(id1).toMatch(/^tab-/);
        expect(id2).toMatch(/^tab-/);
        expect(id1).not.toBe(id2);
    });

    it('records successful query executions in history', async () => {
        vi.spyOn(queryApi, 'executeQueryStream').mockImplementation(async (
            _query,
            _queryId,
            _signal,
            _maxResultRows,
            callbacks,
        ) => {
            callbacks.onMeta([{ name: 'value', type: 'UInt8' }], 'query-id');
            callbacks.onRows([{ value: 1 }]);
            callbacks.onEnd({ elapsed: 0.01, rows_read: 1, bytes_read: 1 }, 1);
        });

        const { useWorkspaceStore } = await import('./workspace');
        await useWorkspaceStore.getState().runQuery('SELECT 1');

        expect(useWorkspaceStore.getState().queryHistory).toEqual([
            expect.objectContaining({
                query: 'SELECT 1',
                rows: 1,
                status: 'success',
            }),
        ]);
    });

    it('records query errors in history', async () => {
        vi.spyOn(queryApi, 'executeQueryStream').mockImplementation(async (
            _query,
            _queryId,
            _signal,
            _maxResultRows,
            callbacks,
        ) => {
            callbacks.onError('Syntax error');
        });

        const { useWorkspaceStore } = await import('./workspace');
        await useWorkspaceStore.getState().runQuery('SELECT broken');

        expect(useWorkspaceStore.getState().queryHistory[0]).toEqual(
            expect.objectContaining({
                query: 'SELECT broken',
                status: 'error',
                error: 'Syntax error',
            }),
        );
    });

    it('removes one history item or clears all history', async () => {
        const { useWorkspaceStore } = await import('./workspace');
        useWorkspaceStore.setState({
            queryHistory: [historyItem('first'), historyItem('second')],
        });

        useWorkspaceStore.getState().removeQueryHistoryItem('first');
        expect(useWorkspaceStore.getState().queryHistory.map((item) => item.id)).toEqual(['second']);

        useWorkspaceStore.getState().clearQueryHistory();
        expect(useWorkspaceStore.getState().queryHistory).toEqual([]);
    });

    it('clears query history when the workspace session is reset', async () => {
        const { useWorkspaceStore } = await import('./workspace');
        useWorkspaceStore.setState({ queryHistory: [historyItem('private-query')] });

        useWorkspaceStore.getState().resetWorkspace();

        expect(useWorkspaceStore.getState().queryHistory).toEqual([]);
    });
});
