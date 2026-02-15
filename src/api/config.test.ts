/**
 * Tests for Config API
 */

import { describe, it, expect } from 'vitest';
import { getConfig } from './config';

describe('Config API', () => {
    it('should fetch configuration successfully', async () => {
        const config = await getConfig();

        expect(config).toBeDefined();
        expect(config.clickhouse).toBeDefined();
        expect(config.app).toBeDefined();
    });

    it('should return clickhouse configuration', async () => {
        const config = await getConfig();

        expect(config.clickhouse.defaultUrl).toBe('http://localhost:8123');
        expect(config.clickhouse.defaultUser).toBe('default');
        expect(config.clickhouse.presetUrls).toEqual(['http://localhost:8123']);
    });

    it('should return app configuration', async () => {
        const config = await getConfig();

        expect(config.app.name).toBe('CHouse UI');
        expect(config.app.version).toBe('2.7.5');
        expect(config.features?.aiOptimizer).toBe(true);
    });
});
