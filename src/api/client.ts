/**
 * API Client for CHouse UI Backend
 * 
 * This module provides a type-safe API client for communicating with the backend server.
 * It handles authentication, error handling, and request/response transformation.
 */

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

export async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRbacRefreshToken();
  if (!refreshToken) return false;

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
  }
}

// ============================================
// API Client
// ============================================

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
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

    // Add RBAC access token if available (for data access filtering)
    // SECURITY WARNING: Storing tokens in localStorage is vulnerable to XSS attacks.
    // If an XSS vulnerability exists, attackers can steal tokens from localStorage.
    // Consider migrating to httpOnly cookies for better security (requires server-side changes).
    // For now, we rely on XSS prevention measures (DOMPurify, CSP headers) to protect tokens.
    const rbacToken = getRbacAccessToken();
    if (rbacToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${rbacToken}`;
    }

    // Retry logic for 429 Too Many Requests and 401 Unauthorized (Refresh)
    const maxRetries = 3;
    let attempt = 0;
    let isRetryAfterRefresh = false;

    while (attempt <= maxRetries) {
      try {
        const url = this.buildUrl(path, params);

        // If this is a retry after refresh, make sure we use the new token
        if (isRetryAfterRefresh) {
          const newToken = getRbacAccessToken();
          if (newToken) {
            (headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
          }
        }

        const response = await fetch(url, {
          method,
          headers,
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
          // If response is not JSON, we'll handle it below based on status code
          // This happens for 429s or other errors that return plain text
        }

        if (!response.ok || !data || !data.success) {
          // Handle 401 Unauthorized with Token Refresh
          // Skip if this request was already a retry after refresh to prevent infinite loops
          if (response.status === 401 && !isRetryAfterRefresh) {
            const refreshed = await refreshTokens();
            if (refreshed) {
              isRetryAfterRefresh = true;
              // Don't increment attempt count for refresh retry, or do? 
              // Let's treat it as a special retry.
              continue;
            }
            // If refresh failed, fall through to error handling which triggers logout
          }

          // Handle 429 Too Many Requests with backoff
          if (response.status === 429 && attempt < maxRetries) {
            const retryAfterHeader = response.headers.get('Retry-After');
            let waitTime = 1000 * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s

            if (retryAfterHeader) {
              const retryAfter = parseInt(retryAfterHeader, 10);
              if (!isNaN(retryAfter)) {
                // If header is seconds, convert to ms
                waitTime = retryAfter * 1000;
              }
            }

            console.warn(`[ApiClient] 429 rate limit exceeded. Retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
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

          // Handle authentication errors
          if (response.status === 401) {
            clearSession();
            clearRbacTokens();
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }

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

    // Should not reach here, but TS needs a return or throw
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

