/**
 * Authentication API
 */

import { api, setSessionId, clearSession } from './client';

// ============================================
// Types
// ============================================

export interface LoginCredentials {
  url: string;
  username: string;
  password?: string;
  database?: string;
}

export interface LoginResponse {
  sessionId: string;
  username: string;
  isAdmin: boolean;
  version: string;
  permissions: string[];
}

export interface SessionInfo {
  sessionId: string;
  username: string;
  isAdmin: boolean;
  permissions: string[];
  version: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface RefreshResponse {
  isConnected: boolean;
  isAdmin: boolean;
  permissions: string[];
}

// ============================================
// API Functions
// ============================================

/**
 * Login to ClickHouse server
 */
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/login', credentials);
  
  // Store session ID
  setSessionId(response.sessionId);
  
  return response;
}

/**
 * Logout and destroy session
 */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    clearSession();
  }
}

/**
 * Get current session info
 */
export async function getSession(): Promise<SessionInfo> {
  return api.get<SessionInfo>('/auth/session');
}

/**
 * Refresh session and check connection health
 */
export async function refreshSession(): Promise<RefreshResponse> {
  return api.post<RefreshResponse>('/auth/refresh');
}

/**
 * Check if user is authenticated
 */
export async function checkAuth(): Promise<boolean> {
  try {
    await getSession();
    return true;
  } catch {
    return false;
  }
}

