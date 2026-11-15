import { createHash } from "node:crypto";
import { createClient, ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import type { ConnectionConfig } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Which pooled client a request uses. Parse, stop and health requests get their
 * own client so they never wait behind long statements (ADR 0033 §2).
 */
export type ClientLane = "statements" | "service";

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
     * Get an existing client or create a new one for a login and lane.
     * Identity, `log_comment` and the query id are sent per request by the
     * executor, so one client serves every actor.
     */
    public getClient(config: ConnectionConfig, lane: ClientLane = "statements"): ClickHouseClient {
        const key = this.getConfigKey(config, lane);
        const entry = this.clients.get(key);

        if (entry) {
            entry.lastUsed = Date.now();
            return entry.client;
        }

        logger.debug({ module: "ClientManager" }, "No existing client found, creating new one");

        const baseSettings: Record<string, unknown> = {
            max_result_rows: "10000",
            max_result_bytes: "10000000",
            result_overflow_mode: "break",
        };

        const client = this.clientFactory({
            url: config.url,
            username: config.username,
            password: config.password || "",
            database: config.database,
            request_timeout: 300000,
            clickhouse_settings: baseSettings as ClickHouseSettings,
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
                    logger.debug({ module: "ClientManager", url: entry.config.url }, "Closed idle client");
                } catch (error) {
                    logger.error({ module: "ClientManager", url: entry.config.url, err: error instanceof Error ? error.message : String(error) }, "Failed to close idle client");
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
     * Pool key: a digest, so the stored password is not kept as a map key. A
     * changed password or login gives a new key, and the old client idles out.
     */
    private getConfigKey(config: ConnectionConfig, lane: ClientLane): string {
        return createHash("sha256")
            .update(JSON.stringify([config.url, config.username, config.password ?? "", config.database ?? "", lane]))
            .digest("hex");
    }

    private startCleanupInterval() {
        if (this.cleanupInterval) return;

        // Use unref to allow process to exit even if interval is running
        this.cleanupInterval = setInterval(() => {
            this.cleanup().catch(err => {
                logger.error({ module: "ClientManager", err: err instanceof Error ? err.message : String(err) }, "Cleanup failed");
            });
        }, this.CLEANUP_CHECK_MS);

        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
}
