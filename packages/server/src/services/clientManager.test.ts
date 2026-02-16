import { ClientManager } from "./clientManager";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ConnectionConfig } from "../types";
import type { ClickHouseClient } from "@clickhouse/client";

describe("ClientManager", () => {
    const config1: ConnectionConfig = {
        url: "http://localhost:8123",
        username: "default",
        password: "",
        database: "default",
    };

    const config2: ConnectionConfig = {
        url: "http://localhost:8123",
        username: "other",
        password: "password",
        database: "default",
    };

    // Simple factory that returns a unique mock object each time
    const mockFactory = vi.fn((_config) => ({
        query: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        ping: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as ClickHouseClient));

    beforeEach(async () => {
        // Reset singleton instance to ensure fresh start with our mock factory
        // @ts-ignore - Accessing private static property for testing
        ClientManager.instance = undefined;
        vi.clearAllMocks();
    });

    afterEach(async () => {
        // Clean up
        const manager = ClientManager.getInstance(mockFactory);
        await manager.closeAll();
    });

    it("should return the same client for identical config", () => {
        const manager = ClientManager.getInstance(mockFactory);
        const client1 = manager.getClient(config1);
        const client2 = manager.getClient(config1);

        expect(client1).toBe(client2);
        expect(mockFactory).toHaveBeenCalledTimes(1);
    });

    it("should return different clients for different configs", () => {
        const manager = ClientManager.getInstance(mockFactory);
        const client1 = manager.getClient(config1);
        const client2 = manager.getClient(config2);

        expect(client1).not.toBe(client2);
        expect(mockFactory).toHaveBeenCalledTimes(2);
    });

    it("should reuse client even if config object is new but content is same", () => {
        const manager = ClientManager.getInstance(mockFactory);
        const client1 = manager.getClient(config1);

        const config1Copy = { ...config1 };
        const client2 = manager.getClient(config1Copy);

        expect(client1).toBe(client2);
        expect(mockFactory).toHaveBeenCalledTimes(1);
    });

    it("should close idle clients during cleanup", async () => {
        const manager = ClientManager.getInstance(mockFactory);
        const client = manager.getClient(config1);
        const closeSpy = vi.spyOn(client, 'close');

        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Re-access client to update lastUsed (though getClient sets it to now)
        // But test logic:
        // 1. getClient (t = now)
        // 2. advance time
        // 3. cleanup

        // Advance time past idle timeout (10 mins + 1 sec)
        vi.setSystemTime(now + 10 * 60 * 1000 + 1000);

        const closedCount = await manager.cleanup();
        expect(closedCount).toBe(1);
        expect(closeSpy).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it("should not close active clients during cleanup", async () => {
        const manager = ClientManager.getInstance(mockFactory);
        const client = manager.getClient(config1);
        const closeSpy = vi.spyOn(client, 'close');

        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Advance time only 5 mins
        vi.setSystemTime(now + 5 * 60 * 1000);

        const closedCount = await manager.cleanup();
        expect(closedCount).toBe(0);
        expect(closeSpy).not.toHaveBeenCalled();

        vi.useRealTimers();
    });
});
