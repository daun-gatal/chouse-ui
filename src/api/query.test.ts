/**
 * Tests for Query API
 */

import { describe, it, expect } from 'vitest';
import {
    detectQueryType,
    executeSelect,
    executeInsert,
    getIntellisenseData,
} from './query';

describe('Query API', () => {
    describe('detectQueryType', () => {
        it('should detect SELECT queries', () => {
            expect(detectQueryType('SELECT * FROM users')).toBe('select');
            expect(detectQueryType('  select id from users  ')).toBe('select');
        });

        it('should detect WITH clauses as SELECT', () => {
            expect(detectQueryType('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('select');
        });

        it('should detect INSERT queries', () => {
            expect(detectQueryType('INSERT INTO users VALUES (1)')).toBe('insert');
        });

        it('should detect UPDATE queries', () => {
            expect(detectQueryType('UPDATE users SET name = "test"')).toBe('update');
        });

        it('should detect DELETE queries', () => {
            expect(detectQueryType('DELETE FROM users WHERE id = 1')).toBe('delete');
        });

        it('should detect CREATE queries', () => {
            expect(detectQueryType('CREATE TABLE users (id UInt64)')).toBe('create');
        });

        it('should detect DROP queries', () => {
            expect(detectQueryType('DROP TABLE users')).toBe('drop');
        });

        it('should detect SHOW queries', () => {
            expect(detectQueryType('SHOW DATABASES')).toBe('show');
        });

        it('should detect DESCRIBE as system query', () => {
            expect(detectQueryType('DESCRIBE users')).toBe('system');
            expect(detectQueryType('DESC users')).toBe('system');
        });
    });

    describe('executeSelect', () => {
        it('should execute SELECT query', async () => {
            const result = await executeSelect('SELECT * FROM users');

            expect(result).toBeDefined();
            expect(result.data).toBeDefined();
            expect(result.meta).toBeDefined();
        });
    });

    describe('executeInsert', () => {
        it('should execute INSERT query', async () => {
            const result = await executeInsert('INSERT INTO users VALUES (1, "test")');

            expect(result).toBeDefined();
            expect(result.rows).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getIntellisenseData', () => {
        it('should fetch intellisense data', async () => {
            const data = await getIntellisenseData();

            expect(data).toBeDefined();
            expect(data.columns).toBeDefined();
            expect(data.functions).toBeDefined();
            expect(data.keywords).toBeDefined();
        });
    });
});
