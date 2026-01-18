/**
 * Tests for Explorer API
 */

import { describe, it, expect } from 'vitest';
import {
    getDatabases,
    getTableDetails,
    createDatabase,
    dropDatabase,
} from './explorer';

describe('Explorer API', () => {
    describe('getDatabases', () => {
        it('should fetch all databases', async () => {
            const databases = await getDatabases();

            expect(databases).toBeDefined();
            expect(databases).toHaveLength(1);
            expect(databases[0].name).toBe('default');
            expect(databases[0].type).toBe('database');
        });

        it('should return databases with tables', async () => {
            const databases = await getDatabases();

            expect(databases[0].children).toBeDefined();
            expect(databases[0].children).toHaveLength(2);
            expect(databases[0].children[0].name).toBe('users');
            expect(databases[0].children[0].type).toBe('table');
        });
    });

    describe('getTableDetails', () => {
        it('should fetch table details', async () => {
            const details = await getTableDetails('default', 'users');

            expect(details).toBeDefined();
            expect(details.database).toBe('default');
            expect(details.table).toBe('users');
            expect(details.engine).toBe('MergeTree');
        });

        it('should return table columns', async () => {
            const details = await getTableDetails('default', 'users');

            expect(details.columns).toBeDefined();
            expect(details.columns).toHaveLength(1);
            expect(details.columns[0].name).toBe('id');
            expect(details.columns[0].type).toBe('UInt64');
        });

        it('should return table statistics', async () => {
            const details = await getTableDetails('default', 'users');

            expect(details.total_rows).toBe('1000');
            expect(details.total_bytes).toBe('102400');
        });
    });

    describe('createDatabase', () => {
        it('should create a database', async () => {
            const result = await createDatabase({ name: 'test_db' });

            expect(result).toBeDefined();
            expect(result.message).toBe('Database created successfully');
        });

        it('should create database with engine and cluster', async () => {
            const result = await createDatabase({
                name: 'test_db',
                engine: 'Atomic',
                cluster: 'my_cluster'
            });

            expect(result.message).toBe('Database created successfully');
        });
    });

    describe('dropDatabase', () => {
        it('should drop a database', async () => {
            const result = await dropDatabase('test_db');

            expect(result).toBeDefined();
            expect(result.message).toBe('Database dropped successfully');
        });
    });
});
