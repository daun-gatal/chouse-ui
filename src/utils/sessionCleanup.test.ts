/**
 * Tests for utils/sessionCleanup.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClearIntellisenseCache = vi.fn();
vi.mock('@/features/workspace/editor/monacoConfig', () => ({
  clearIntellisenseCache: () => mockClearIntellisenseCache(),
}));

describe('utils/sessionCleanup', () => {
  beforeEach(() => {
    mockClearIntellisenseCache.mockClear();
  });

  it('should export cleanupUserSession', async () => {
    const module = await import('./sessionCleanup');
    expect(module.cleanupUserSession).toBeDefined();
    expect(typeof module.cleanupUserSession).toBe('function');
  });

  it('should export broadcastUserChange', async () => {
    const module = await import('./sessionCleanup');
    expect(module.broadcastUserChange).toBeDefined();
    expect(typeof module.broadcastUserChange).toBe('function');
  });

  it('should export listenForUserChanges', async () => {
    const module = await import('./sessionCleanup');
    expect(module.listenForUserChanges).toBeDefined();
    expect(typeof module.listenForUserChanges).toBe('function');
  });

  it('should call clearIntellisenseCache when cleanupUserSession runs', async () => {
    const { cleanupUserSession } = await import('./sessionCleanup');
    await cleanupUserSession(null);
    expect(mockClearIntellisenseCache).toHaveBeenCalled();
  });
});
