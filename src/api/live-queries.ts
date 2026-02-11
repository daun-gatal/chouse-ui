/**
 * Live Queries API
 * 
 * API client for managing running ClickHouse queries.
 * Restricted to super_admin and admin roles only.
 */

import { api } from './client';

// ============================================
// Types
// ============================================

export interface LiveQuery {
    query_id: string;
    user: string;
    query: string;
    elapsed_seconds: number;
    read_rows: number;
    read_bytes: number;
    memory_usage: number;
    is_initial_query: number;
    client_name: string;
    rbac_user_id?: string;
    rbac_user?: string;
    rbac_user_display_name?: string;
}

export interface LiveQueriesResponse {
    queries: LiveQuery[];
    connectionId?: string;
    total: number;
}

export interface KillQueryResponse {
    message: string;
    queryId: string;
}

// ============================================
// API Functions
// ============================================

/**
 * Get all running queries from system.processes
 */
export async function getLiveQueries(): Promise<LiveQueriesResponse> {
    return api.get<LiveQueriesResponse>('/live-queries');
}

/**
 * Kill a running query by query ID
 */
export async function killQuery(queryId: string): Promise<KillQueryResponse> {
    return api.post<KillQueryResponse>('/live-queries/kill', { queryId });
}

// ============================================
// Aggregated API Object (for consistency)
// ============================================

export const liveQueriesApi = {
    getLiveQueries,
    killQuery,
};
