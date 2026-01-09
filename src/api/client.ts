/**
 * API Client for ClickHouse Studio Backend
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
const RBAC_ACCESS_TOKEN_KEY = 'rbac_access_token';

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
    const rbacToken = localStorage.getItem(RBAC_ACCESS_TOKEN_KEY);
    if (rbacToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${rbacToken}`;
    }

    const url = this.buildUrl(path, params);

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      ...rest,
    });

    const data: ApiResponse<T> = await response.json();

    if (!response.ok || !data.success) {
      const error = new ApiError(
        data.error?.message || 'Request failed',
        response.status,
        data.error?.code || 'UNKNOWN_ERROR',
        data.error?.category || 'unknown',
        data.error?.details
      );

      // Handle authentication errors
      if (response.status === 401) {
        clearSession();
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }

      throw error;
    }

    return data.data as T;
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

