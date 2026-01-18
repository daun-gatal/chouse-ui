/**
 * Tests for hooks/index.ts
 */

import { describe, it, expect } from 'vitest';
import * as hooks from './index';

describe('hooks/index', () => {
  it('should export useDebounce', () => {
    expect(hooks.useDebounce).toBeDefined();
  });

  it('should export auth hooks', () => {
    expect(hooks.useAuth).toBeDefined();
    expect(hooks.useRequireAuth).toBeDefined();
  });

  it('should export query hooks', () => {
    expect(hooks.useConfig).toBeDefined();
    expect(hooks.useDatabases).toBeDefined();
  });

  it('should export queryKeys', () => {
    expect(hooks.queryKeys).toBeDefined();
  });

  it('should export preference hooks', () => {
    expect(hooks.usePaginationPreference).toBeDefined();
    expect(hooks.useLogsPreferences).toBeDefined();
    expect(hooks.useUserManagementPreferences).toBeDefined();
  });
});
