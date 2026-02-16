import { createClient, ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import type { ConnectionConfig } from "../types";

type ClientFactory = (config: Parameters<typeof createClient>[0]) => ClickHouseClient;

interface ClientEntry {
    client: ClickHouseClient;
    lastUsed: number;
    config: ConnectionConfig;
}

export class ClientManager {
    private static instance: ClientManager;
    private clients: Map<string, ClientEntry> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    private readonly CLEANUP_CHECK_MS = 5 * 60 * 1000; // 5 minutes
    private clientFactory: ClientFactory;

    private constructor(clientFactory: ClientFactory = createClient) {
        this.clientFactory = clientFactory;
        this.startCleanupInterval();
    }

    public static getInstance(clientFactory?: ClientFactory): ClientManager {
        if (!ClientManager.instance) {
            ClientManager.instance = new ClientManager(clientFactory);
        }
        return ClientManager.instance;
    }

    /**
     * Get an existing client or create a new one for the given configuration
     */
    public getClient(config: ConnectionConfig): ClickHouseClient {
        const key = this.getConfigKey(config);
        const entry = this.clients.get(key);

        if (entry) {
            entry.lastUsed = Date.now();
            return entry.client;
        }

        console.log(`[ClientManager] No existing client found, creating new one`);

        const client = this.clientFactory({
            url: config.url,
            username: config.username,
            password: config.password || "",
            database: config.database,
            request_timeout: 300000,
            clickhouse_settings: {
                max_result_rows: "10000",
                max_result_bytes: "10000000",
                result_overflow_mode: "break",
            } as ClickHouseSettings,
        });

        this.clients.set(key, {
            client,
            lastUsed: Date.now(),
            config,
        });

        return client;
    }

    /**
     * Close all clients and stop cleanup interval
     * Useful for graceful shutdown
     */
    public async closeAll(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        const closePromises: Promise<void>[] = [];
        for (const entry of this.clients.values()) {
            closePromises.push(entry.client.close());
        }
        await Promise.all(closePromises);
        this.clients.clear();
    }

    /**
     * Manually trigger cleanup of idle clients
     */
    public async cleanup(): Promise<number> {
        const now = Date.now();
        let closedCount = 0;
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.clients.entries()) {
            if (now - entry.lastUsed > this.IDLE_TIMEOUT_MS) {
                try {
                    await entry.client.close();
                    console.log(`[ClientManager] Closed idle client for ${entry.config.url} (user: ${entry.config.username})`);
                } catch (error) {
                    console.error(`[ClientManager] Failed to close idle client for ${entry.config.url}:`, error);
                }
                keysToDelete.push(key);
                closedCount++;
            }
        }

        for (const key of keysToDelete) {
            this.clients.delete(key);
        }

        return closedCount;
    }

    /**
     * Generate a unique key for the connection configuration
     */
    private getConfigKey(config: ConnectionConfig): string {
        // Sort keys to ensure consistent order
        return JSON.stringify({
            url: config.url,
            u: config.username,
            p: config.password, // Include password in key to isolate different users
            d: config.database,
        });
    }

    private startCleanupInterval() {
        if (this.cleanupInterval) return;

        // Use unref to allow process to exit even if interval is running
        this.cleanupInterval = setInterval(() => {
            this.cleanup().catch(err => {
                console.error("[ClientManager] Cleanup failed:", err);
            });
        }, this.CLEANUP_CHECK_MS);

        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
}
