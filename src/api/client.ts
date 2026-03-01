/**
 * API Client for CHouse UI Backend
 * 
 * This module provides a type-safe API client for communicating with the backend server.
 * It handles authentication, error handling, and request/response transformation.
 */

import { log } from '@/lib/log';

// ============================================
// Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    category?: string;
    details?: unknown;
  };
}

export interface ApiErrorData {
  code: string;
  category: string;
  details?: unknown;
  statusCode: number;
}

export class ApiError extends Error implements ApiErrorData {
  code: string;
  category: string;
  details?: unknown;
  statusCode: number;

  constructor(message: string, statusCode: number = 500, code: string = 'UNKNOWN_ERROR', category: string = 'unknown', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

// ============================================
// Configuration
// ============================================


const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const SESSION_STORAGE_KEY = 'ch_session_id';
export const RBAC_ACCESS_TOKEN_KEY = 'rbac_access_token';
export const RBAC_REFRESH_TOKEN_KEY = 'rbac_refresh_token';

// ============================================
// Session Management
// ============================================

let sessionId: string | null = null;

export function getSessionId(): string | null {
  if (sessionId) return sessionId;
  sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  return sessionId;
}

export function setSessionId(id: string): void {
  sessionId = id;
  sessionStorage.setItem(SESSION_STORAGE_KEY, id);
}

export function clearSession(): void {
  sessionId = null;
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// ============================================
// Token Management
// ============================================

export interface RbacTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export function setRbacTokens(tokens: RbacTokens): void {
  localStorage.setItem(RBAC_ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(RBAC_REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function getRbacAccessToken(): string | null {
  return localStorage.getItem(RBAC_ACCESS_TOKEN_KEY);
}

export function getRbacRefreshToken(): string | null {
  return localStorage.getItem(RBAC_REFRESH_TOKEN_KEY);
}

export function clearRbacTokens(): void {
  localStorage.removeItem(RBAC_ACCESS_TOKEN_KEY);
  localStorage.removeItem(RBAC_REFRESH_TOKEN_KEY);
}

let globalRefreshPromise: Promise<boolean> | null = null;

export async function refreshTokens(): Promise<boolean> {
  // Return existing promise if refresh is already in progress
  if (globalRefreshPromise) {
    return globalRefreshPromise;
  }

  const refreshToken = getRbacRefreshToken();
  if (!refreshToken) return false;

  globalRefreshPromise = (async () => {
    try {
      const response = await fetch('/api/rbac/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearRbacTokens();
        return false;
      }

      const data = await response.json();
      if (data.success && data.data?.tokens) {
        setRbacTokens(data.data.tokens);
        return true;
      }
      return false;
    } catch {
      clearRbacTokens();
      return false;
    } finally {
      // Clear the promise after completion so future calls can refresh again
      globalRefreshPromise = null;
    }
  })();

  return globalRefreshPromise;
}

// ============================================
// API Client
// ============================================

class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;
  private sessionExpiredHandler: (() => void) | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  public setOnSessionExpired(handler: () => void) {
    this.sessionExpiredHandler = handler;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { body, params, headers: customHeaders, ...rest } = options;

    const getHeaders = () => {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        // Required header to prove request comes from JavaScript, not direct browser navigation
        'X-Requested-With': 'XMLHttpRequest',
        ...customHeaders,
      };

      // Add session ID if available
      const currentSessionId = getSessionId();
      if (currentSessionId) {
        (headers as Record<string, string>)['X-Session-ID'] = currentSessionId;
      }

      // Add RBAC access token if available
      const rbacToken = getRbacAccessToken();
      if (rbacToken) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${rbacToken}`;
      }
      return headers;
    };

    // Retry logic for 429 Too Many Requests and 401 Unauthorized (Refresh)
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const url = this.buildUrl(path, params);

        // Wait if a refresh is in progress
        if (this.isRefreshing && this.refreshPromise) {
          await this.refreshPromise;
        }

        const response = await fetch(url, {
          method,
          headers: getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
          ...rest,
        });

        const text = await response.text();
        let data: ApiResponse<T> | undefined;

        try {
          if (text) {
            data = JSON.parse(text);
          }
        } catch (e) {
          // If response is not JSON, handle based on status code
        }

        if (!response.ok || !data || !data.success) {
          // Handle 401 Unauthorized with Token Refresh (Concurrency Safe)
          if (response.status === 401) {
            // If we already tried refreshing in this request loop, don't try again
            // But we need to check if a refresh happened while we were waiting?
            // Simplified: try to refresh if not already refreshing

            if (!this.isRefreshing) {
              this.isRefreshing = true;
              this.refreshPromise = refreshTokens().finally(() => {
                this.isRefreshing = false;
                this.refreshPromise = null;
              });
            }

            const refreshed = await this.refreshPromise;
            if (refreshed) {
              // Retry the request with new token
              // The next iteration will pick up the new token via getHeaders()
              // We increment attempt to avoid infinite loops if refresh succeeds but request still fails
              attempt++;
              continue;
            } else {
              // Refresh failed - logout
              clearSession();
              clearRbacTokens();
              window.dispatchEvent(new CustomEvent('auth:unauthorized'));
              throw new ApiError('Session expired', 401, 'UNAUTHORIZED', 'authentication');
            }
          }

          // Handle Session Not Found (400 NO_SESSION)
          // If we get a NO_SESSION error, it means RBAC is fine but ClickHouse session is gone
          if (data?.error?.code === 'NO_SESSION' && this.sessionExpiredHandler) {
            // Trigger transparent reconnection
            // We throw a special error that the UI/Store can catch if needed, 
            // but mostly we rely on the handler to fix it background
            this.sessionExpiredHandler();
            // We could retry here, but reconnection might take time.
            // For now, let's throw and let the store retry or UI show loading
            // Actually, better to retry if possible?
            // Let's just throw for now to avoid complexity in this loop
          }

          // Handle 429 Too Many Requests with backoff
          if (response.status === 429 && attempt < maxRetries) {
            const retryAfterHeader = response.headers.get('Retry-After');
            let waitTime = 1000 * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s

            if (retryAfterHeader) {
              const retryAfter = parseInt(retryAfterHeader, 10);
              if (!isNaN(retryAfter)) {
                waitTime = retryAfter * 1000;
              }
            }

            log.warn('[ApiClient] 429 rate limit exceeded, retrying', { waitMs: waitTime, attempt: attempt + 1, maxRetries });
            await new Promise(resolve => setTimeout(resolve, waitTime));
            attempt++;
            continue;
          }

          const error = new ApiError(
            data?.error?.message || (typeof data === 'string' ? data : text) || 'Request failed',
            response.status,
            data?.error?.code || 'UNKNOWN_ERROR',
            data?.error?.category || 'unknown',
            data?.error?.details
          );

          throw error;
        }

        return data.data as T;
      } catch (error) {
        // If it's an ApiError (handled above), rethrow
        if (error instanceof ApiError) {
          throw error;
        }

        // If it's a network error or other fetch error, we might want to retry?
        // For now, only retrying on 429 as per requirements
        throw error;
      }
    }

    throw new ApiError('Max retries exceeded', 429, 'RATE_LIMIT_EXCEEDED', 'network');
  }

  // HTTP Methods
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export class for testing
export { ApiClient };

