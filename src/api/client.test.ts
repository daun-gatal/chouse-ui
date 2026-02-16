
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { ApiClient, setRbacTokens, clearRbacTokens, setSessionId, clearSession } from './client';
import { server } from '../test/mocks/server';

// Stop MSW integration for this test suite as we want to mock fetch directly
beforeAll(() => server.close());
// Restart it afterwards to not affect other tests if run in parallel (though verify runs singly)
afterAll(() => server.listen());

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock as any;
window.fetch = fetchMock as any;

// Mock localStorage and sessionStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};
const sessionStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock window.dispatchEvent
const dispatchEventMock = vi.fn();
window.dispatchEvent = dispatchEventMock;

describe('ApiClient', () => {
    let client: ApiClient;

    beforeEach(() => {
        client = new ApiClient('/api');
        fetchMock.mockReset();
        localStorageMock.getItem.mockReset();
        localStorageMock.setItem.mockReset();
        localStorageMock.removeItem.mockReset();
        sessionStorageMock.getItem.mockReset();
        sessionStorageMock.setItem.mockReset();
        sessionStorageMock.removeItem.mockReset();
        dispatchEventMock.mockReset();
    });

    it('should retry request after successful token refresh on 401', async () => {
        // Setup initial state
        localStorageMock.getItem.mockImplementation((key) => {
            if (key === 'rbac_refresh_token') return 'valid-refresh-token';
            if (key === 'rbac_access_token') return 'expired-token';
            return null;
        });

        // Mock responses
        // 1. Initial request -> 401
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve(JSON.stringify({ error: { message: 'Unauthorized' } })),
        });

        // 2. Refresh token request -> 200
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                success: true,
                data: {
                    tokens: {
                        accessToken: 'new-access-token',
                        refreshToken: 'new-refresh-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }
                }
            }),
        });

        // 3. Retry request -> 200
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({ success: true, data: { foo: 'bar' } })),
        });

        // Execute request
        const result = await client.get('/test');

        // Verification
        expect(result).toEqual({ foo: 'bar' });
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // Check refresh call
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/rbac/auth/refresh', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
        }));

        // Check retry call used new token
        // We can't easily check the headers of the 3rd call because we rely on localStorage.getItem
        // But we can check that setRbacTokens was called (implied by localStorage.setItem)
        expect(localStorageMock.setItem).toHaveBeenCalledWith('rbac_access_token', 'new-access-token');
    });

    it('should dispatch auth:unauthorized if refresh fails', async () => {
        // Setup initial state
        localStorageMock.getItem.mockImplementation((key) => {
            if (key === 'rbac_refresh_token') return 'invalid-refresh-token';
            return null;
        });

        // Mock responses
        // 1. Initial request -> 401
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve(JSON.stringify({ error: { message: 'Unauthorized' } })),
        });

        // 2. Refresh token request -> 401 (Refresh failed)
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve(JSON.stringify({ error: { message: 'Invalid refresh token' } })),
        });

        // Execute request and expect failure
        await expect(client.get('/test')).rejects.toThrow('Unauthorized');

        expect(fetchMock).toHaveBeenCalledTimes(2); // Initial + Refresh

        // Check logout dispatch
        expect(dispatchEventMock).toHaveBeenCalledWith(expect.any(CustomEvent));
        expect(dispatchEventMock.mock.calls[0][0].type).toBe('auth:unauthorized');

        // Check tokens cleared
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rbac_access_token');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('rbac_refresh_token');
    });

    it('should dispatch auth:unauthorized if no refresh token exists', async () => {
        // Setup initial state (no refresh token)
        localStorageMock.getItem.mockReturnValue(null);

        // Mock responses
        // 1. Initial request -> 401
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve(JSON.stringify({ error: { message: 'Unauthorized' } })),
        });

        // Execute request and expect failure
        await expect(client.get('/test')).rejects.toThrow('Unauthorized');

        expect(fetchMock).toHaveBeenCalledTimes(1); // Only initial request

        // Check logout dispatch
        expect(dispatchEventMock).toHaveBeenCalledWith(expect.any(CustomEvent));
        expect(dispatchEventMock.mock.calls[0][0].type).toBe('auth:unauthorized');
    });
});
