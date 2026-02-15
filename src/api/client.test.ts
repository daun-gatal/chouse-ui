/**
 * Tests for API Client
 * 
 * Tests the core API client functionality including:
 * - HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * - Session management
 * - Error handling
 * - Authentication
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
                },
                features: {
                    aiOptimizer: true
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

        it('should handle non-JSON error responses gracefully', async () => {
            server.use(
                http.get('/api/service-unavailable', () => {
                    return new HttpResponse('Service Unavailable', {
                        status: 503,
                        headers: {
                            'Content-Type': 'text/plain',
                        },
                    });
                })
            );

            try {
                await client.get('/service-unavailable');
            } catch (error) {
                expect(error).toBeInstanceOf(ApiError);
                expect((error as ApiError).statusCode).toBe(503);
                expect((error as ApiError).message).toBe('Service Unavailable');
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
    describe('Retry Logic', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should retry on 429 errors', async () => {
            let attempts = 0;
            server.use(
                http.get('/api/retry-test', () => {
                    attempts++;
                    if (attempts < 3) {
                        return new HttpResponse('Too many requests', {
                            status: 429,
                            headers: { 'Retry-After': '1' }
                        });
                    }
                    return HttpResponse.json({ success: true, data: { status: 'ok' } });
                })
            );

            const promise = client.get('/retry-test');

            // Fast-forward timers for backoff
            await vi.advanceTimersByTimeAsync(1000); // 1st retry
            await vi.advanceTimersByTimeAsync(2000); // 2nd retry

            const result = await promise;
            expect(result).toEqual({ status: 'ok' });
            expect(attempts).toBe(3); // Initial + 2 retries
        });

        it('should respect Retry-After header', async () => {
            let attempts = 0;
            server.use(
                http.get('/api/retry-after', () => {
                    attempts++;
                    if (attempts === 1) {
                        return new HttpResponse('rate limited', {
                            status: 429,
                            headers: { 'Retry-After': '5' } // 5 seconds
                        });
                    }
                    return HttpResponse.json({ success: true, data: { status: 'ok' } });
                })
            );

            const promise = client.get('/retry-after');

            // Advance by 2s - should not be enough
            await vi.advanceTimersByTimeAsync(2000);
            expect(attempts).toBe(1); // Still waiting

            // Advance by remaining 3s
            await vi.advanceTimersByTimeAsync(3000);

            const result = await promise;
            expect(result).toEqual({ status: 'ok' });
            expect(attempts).toBe(2);
        });

        it('should fail after max retries', async () => {
            server.use(
                http.get('/api/max-retries', () => {
                    return new HttpResponse('Too many requests', {
                        status: 429,
                        headers: { 'Retry-After': '1' }
                    });
                })
            );

            // Catch the error immediately to prevent "Unhandled Rejection" during timer advancement
            const promise = client.get('/max-retries').catch(e => e);

            // Advance timers for all retries (1s, 2s, 4s)
            await vi.advanceTimersByTimeAsync(10000);

            const result = await promise;
            expect(result).toBeInstanceOf(ApiError);
            expect((result as ApiError).statusCode).toBe(429);
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
