/**
 * Tests for Saved Queries API
 */

import { describe, it, expect } from 'vitest';
import {
    getSavedQueries,
    getQueryConnectionNames,
    getSavedQueryById,
    saveQuery,
    updateSavedQuery,
    deleteSavedQuery,
} from './saved-queries';

describe('Saved Queries API', () => {
    describe('getSavedQueries', () => {
        it('should fetch all saved queries', async () => {
            const queries = await getSavedQueries();

            expect(queries).toBeDefined();
            expect(queries).toHaveLength(1);
            expect(queries[0].id).toBe('query-1');
            expect(queries[0].name).toBe('User Stats');
        });

        it('should include query details', async () => {
            const queries = await getSavedQueries();
            const query = queries[0];

            expect(query.query).toBe('SELECT * FROM users');
            expect(query.description).toBe('Get user statistics');
            expect(query.userId).toBe('user-123');
            expect(query.connectionName).toBe('Production');
        });

        it('should filter by connectionId', async () => {
            const queries = await getSavedQueries('conn-1');

            expect(queries).toBeDefined();
            expect(queries[0].connectionId).toBe('conn-1');
        });
    });

    describe('getQueryConnectionNames', () => {
        it('should fetch connection names', async () => {
            const connections = await getQueryConnectionNames();

            expect(connections).toBeDefined();
            expect(connections).toHaveLength(2);
            expect(connections).toContain('Production');
            expect(connections).toContain('Staging');
        });
    });

    describe('getSavedQueryById', () => {
        it('should fetch a specific query', async () => {
            const query = await getSavedQueryById('query-1');

            expect(query).toBeDefined();
            expect(query.id).toBe('query-1');
            expect(query.name).toBe('User Stats');
        });
    });

    describe('saveQuery', () => {
        it('should save a new query', async () => {
            const input = {
                name: 'New Query',
                query: 'SELECT 1',
                description: 'Test query',
                connectionId: 'conn-1',
                connectionName: 'Production'
            };

            const result = await saveQuery(input);

            expect(result).toBeDefined();
            expect(result.id).toBe('new-query-id');
            expect(result.name).toBe('New Query');
            expect(result.query).toBe('SELECT 1');
        });

        it('should save query without connection', async () => {
            const input = {
                name: 'Shared Query',
                query: 'SELECT * FROM system.metrics'
            };

            const result = await saveQuery(input);

            expect(result).toBeDefined();
            expect(result.name).toBe('Shared Query');
        });
    });

    describe('updateSavedQuery', () => {
        it('should update an existing query', async () => {
            const updates = {
                name: 'Updated Name',
                query: 'SELECT 2'
            };

            const result = await updateSavedQuery('query-1', updates);

            expect(result).toBeDefined();
            expect(result.id).toBe('query-1');
            expect(result.name).toBe('Updated Name');
            expect(result.query).toBe('SELECT 2');
        });

        it('should update query description', async () => {
            const updates = {
                description: 'New description'
            };

            const result = await updateSavedQuery('query-1', updates);

            expect(result.description).toBe('New description');
        });
    });

    describe('deleteSavedQuery', () => {
        it('should delete a query', async () => {
            const result = await deleteSavedQuery('query-1');

            expect(result).toBeDefined();
            expect(result.message).toBe('Query deleted successfully');
        });
    });
});
