/**
 * Config API - Fetch public configuration from server
 */

import { api } from './client';

export interface AppConfig {
  clickhouse: {
    defaultUrl: string;
    defaultUser: string;
    presetUrls: string[];
  };
  app: {
    name: string;
    version: string;
  };
  features?: {
    aiOptimizer: boolean;
    /** MCP server (ADR 0013) — enabled state; absent on older backends. */
    mcpEnabled?: boolean;
  };
}

/**
 * Fetch public configuration
 * This is used to get server-side environment variables for the frontend
 */
export async function getConfig(): Promise<AppConfig> {
  return api.get<AppConfig>('/config');
}

