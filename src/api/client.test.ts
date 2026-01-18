/**
 * Tests for API Client
 * 
 * Tests the core API client functionality including:
 * - HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * - Session management
 * - Error handling
 * - Authentication
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    ApiClient,
    ApiError,
    getSessionId,
    setSessionId,
    clearSession
} from './client';
import { server } from '@/test/mocks/server';
import { http, HttpResponse } from 'msw';

describe('ApiClient', () => {
    let client: ApiClient;

    beforeEach(() => {
        client = new ApiClient();
    });

    describe('HTTP Methods', () => {
        it('should make GET requests', async () => {
            const data = await client.get('/config');

            expect(data).toEqual({
                clickhouse: {
                    defaultUrl: 'http://localhost:8123',
                    defaultUser: 'default',
                    presetUrls: ['http://localhost:8123']
                },
                app: {
                    name: 'CHouse UI',
                    version: '2.7.5'
                }
            });
        });

        it('should make POST requests', async () => {
            const result = await client.post('/rbac/auth/login', {
                username: 'testuser',
                password: 'testpass'
            });

            expect(result).toHaveProperty('accessToken');
            expect(result).toHaveProperty('user');
        });

        it('should make PUT requests', async () => {
            server.use(
                http.put('/api/test', () => {
                    return HttpResponse.json({ success: true, data: { updated: true } });
                })
            );

            const result = await client.put('/test', { name: 'test' });
            expect(result).toEqual({ updated: true });
        });

        it('should make DELETE requests', async () => {
            server.use(
                http.delete('/api/test/123', () => {
                    return HttpResponse.json({ success: true, data: { deleted: true } });
                })
            );

            const result = await client.delete('/test/123');
            expect(result).toEqual({ deleted: true });
        });

        it('should make PATCH requests', async () => {
            server.use(
                http.patch('/api/test/123', () => {
                    return HttpResponse.json({ success: true, data: { patched: true } });
                })
            );

            const result = await client.patch('/test/123', { status: 'active' });
            expect(result).toEqual({ patched: true });
        });
    });

    describe('Query Parameters', () => {
        it('should append query parameters', async () => {
            server.use(
                http.get('/api/test', ({ request }) => {
                    const url = new URL(request.url);
                    expect(url.searchParams.get('page')).toBe('1');
                    expect(url.searchParams.get('limit')).toBe('10');

                    return HttpResponse.json({ success: true, data: { page: 1, limit: 10 } });
                })
            );

            await client.get('/test', { params: { page: 1, limit: 10 } });
        });

        it('should skip undefined parameters', async () => {
            server.use(
                http.get('/api/test', ({ request }) => {
                    const url = new URL(request.url);
                    expect(url.searchParams.has('undefined')).toBe(false);

                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test', { params: { page: 1, undefined: undefined } });
        });
    });

    describe('Error Handling', () => {
        it('should throw ApiError on failed requests', async () => {
            await expect(client.post('/rbac/auth/login', {
                username: 'wrong',
                password: 'wrong'
            })).rejects.toThrow(ApiError);
        });

        it('should include error details', async () => {
            try {
                await client.post('/rbac/auth/login', {
                    username: 'wrong',
                    password: 'wrong'
                });
            } catch (error) {
                expect(error).toBeInstanceOf(ApiError);
                expect((error as ApiError).code).toBe('INVALID_CREDENTIALS');
                expect((error as ApiError).statusCode).toBe(401);
                expect((error as ApiError).category).toBe('authentication');
            }
        });

        it('should handle 404 errors', async () => {
            try {
                await client.get('/nonexistent');
            } catch (error) {
                expect(error).toBeInstanceOf(ApiError);
                expect((error as ApiError).statusCode).toBe(404);
            }
        });

        it('should dispatch auth:unauthorized event on 401', async () => {
            const eventSpy = vi.fn();
            window.addEventListener('auth:unauthorized', eventSpy);

            try {
                await client.post('/rbac/auth/login', {
                    username: 'wrong',
                    password: 'wrong'
                });
            } catch {
                // Expected to throw
            }

            expect(eventSpy).toHaveBeenCalled();
            window.removeEventListener('auth:unauthorized', eventSpy);
        });
    });

    describe('Session Management', () => {
        beforeEach(() => {
            clearSession();
        });

        it('should store session ID', () => {
            setSessionId('test-session-123');
            expect(getSessionId()).toBe('test-session-123');
            expect(sessionStorage.getItem('ch_session_id')).toBe('test-session-123');
        });

        it('should retrieve session ID', () => {
            sessionStorage.setItem('ch_session_id', 'stored-session');
            expect(getSessionId()).toBe('stored-session');
        });

        it('should clear session', () => {
            setSessionId('test-session');
            clearSession();

            expect(getSessionId()).toBeNull();
            expect(sessionStorage.getItem('ch_session_id')).toBeNull();
        });

        it('should include session ID in request headers', async () => {
            setSessionId('my-session-123');

            server.use(
                http.get('/api/test', ({ request }) => {
                    expect(request.headers.get('X-Session-ID')).toBe('my-session-123');
                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test');
        });
    });

    describe('Authentication', () => {
        it('should include Authorization header when token exists', async () => {
            localStorage.setItem('rbac_access_token', 'test-token-123');

            server.use(
                http.get('/api/test', ({ request }) => {
                    expect(request.headers.get('Authorization')).toBe('Bearer test-token-123');
                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test');
        });

        it('should work without Authorization header when no token', async () => {
            localStorage.removeItem('rbac_access_token');

            server.use(
                http.get('/api/test', ({ request }) => {
                    expect(request.headers.get('Authorization')).toBeNull();
                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test');
        });
    });

    describe('Request Headers', () => {
        it('should include X-Requested-With header', async () => {
            server.use(
                http.get('/api/test', ({ request }) => {
                    expect(request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test');
        });

        it('should allow custom headers', async () => {
            server.use(
                http.get('/api/test', ({ request }) => {
                    expect(request.headers.get('X-Custom')).toBe('custom-value');
                    return HttpResponse.json({ success: true, data: {} });
                })
            );

            await client.get('/test', {
                headers: { 'X-Custom': 'custom-value' }
            });
        });
    });
});

describe('ApiError', () => {
    it('should create error with all properties', () => {
        const error = new ApiError('Test error', 400, 'TEST_CODE', 'validation', { field: 'name' });

        expect(error.message).toBe('Test error');
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('TEST_CODE');
        expect(error.category).toBe('validation');
        expect(error.details).toEqual({ field: 'name' });
        expect(error.name).toBe('ApiError');
    });

    it('should use default values', () => {
        const error = new ApiError('Test error');

        expect(error.statusCode).toBe(500);
        expect(error.code).toBe('UNKNOWN_ERROR');
        expect(error.category).toBe('unknown');
    });
});
