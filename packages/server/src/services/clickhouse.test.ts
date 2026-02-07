
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ClickHouseService } from "./clickhouse";

// Mock dependencies
const mockJsonFn = mock();
const mockQueryFn = mock(async () => ({ json: mockJsonFn }));
const mockCommandFn = mock(async () => ({}));
const mockPingFn = mock(async () => ({ success: true }));
const mockCloseFn = mock(async () => { });

const mockClient = {
    query: mockQueryFn,
    command: mockCommandFn,
    ping: mockPingFn,
    close: mockCloseFn
};

mock.module("@clickhouse/client", () => ({
    createClient: () => mockClient
}));

describe("ClickHouse Service", () => {
    let service: ClickHouseService;
    const config = {
        url: "http://localhost:8123",
        username: "default",
        password: ""
    };

    beforeEach(() => {
        service = new ClickHouseService(config);
        mockQueryFn.mockReset(); // Reset history and interactions
        mockQueryFn.mockImplementation(async () => ({ json: mockJsonFn })); // Restore default behavior
        mockCommandFn.mockClear();
        mockJsonFn.mockClear();
        mockPingFn.mockClear();
    });

    describe("executeQuery", () => {
        it("should execute SELECT query", async () => {
            mockJsonFn.mockResolvedValueOnce({
                data: [{ id: 1 }],
                meta: [],
                statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 10 }
            });

            const result = await service.executeQuery("SELECT * FROM table");

            expect(mockQueryFn).toHaveBeenCalled();
            expect(result.data).toHaveLength(1);
            expect(result.rows).toBe(1);
        });

        it("should execute command query (INSERT)", async () => {
            const result = await service.executeQuery("INSERT INTO table VALUES (1)");

            expect(mockCommandFn).toHaveBeenCalled();
            expect(result.rows).toBe(0);
        });

        it("should execute command query (SET)", async () => {
            const result = await service.executeQuery("SET param = value");

            expect(mockCommandFn).toHaveBeenCalled();
            expect(result.rows).toBe(0);
        });

        it("should handle query errors", async () => {
            mockQueryFn.mockRejectedValue(new Error("DB Error"));
            // The service wraps the error but preserves the message if available
            expect(service.executeQuery("SELECT *")).rejects.toThrow("DB Error");
        });
    });

    describe("getSystemStats", () => {
        it("should fetch system stats", async () => {
            // Setup multiple mock responses for Promise.all
            // Order: version, uptime, dbCount, tableCount, size/rows, mem, cpu, conn, queries
            mockJsonFn
                .mockResolvedValueOnce({ data: [{ "version()": "23.8" }] })
                .mockResolvedValueOnce({ data: [{ "uptime()": 3600 }] })
                .mockResolvedValueOnce({ data: [{ "count()": 5 }] })
                .mockResolvedValueOnce({ data: [{ "count()": 20 }] })
                .mockResolvedValueOnce({ data: [{ size: "1GB", rows: "1000" }] })
                .mockResolvedValueOnce({ data: [{ mem: "100MB" }] })
                .mockResolvedValueOnce({ data: [{ value: 0.5 }] })
                .mockResolvedValueOnce({ data: [{ value: 10 }] })
                .mockResolvedValueOnce({ data: [{ cnt: 2 }] });

            const stats = await service.getSystemStats();

            expect(stats.version).toBe("23.8");
            expect(stats.databaseCount).toBe(5);
            // Verify all calls made
            expect(mockQueryFn).toHaveBeenCalledTimes(9);
        });
    });

    describe("getTopTablesBySize", () => {
        it("should return top tables from system.tables (non-system DBs only)", async () => {
            mockJsonFn.mockResolvedValue({
                data: [
                    { database: "default", table: "viz_test", rows: "1000", bytes_on_disk: "4096" },
                    { database: "default", table: "small_table", rows: "10", bytes_on_disk: "256" }
                ]
            });

            const result = await service.getTopTablesBySize(5);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                database: "default",
                table: "viz_test",
                rows: 1000,
                bytes_on_disk: 4096,
                compressed_size: "4.10 KiB", // 4096/1000 (decimal KiB in implementation)
                parts_count: 0
            });
            expect(result[1].compressed_size).toBe("256 B");
            expect(result[1].parts_count).toBe(0);
            expect(mockQueryFn).toHaveBeenCalledTimes(1);
            const call = mockQueryFn.mock.calls[0][0];
            expect(call.query).toContain("system.tables");
            expect(call.query).toContain("database NOT IN");
            expect(call.format).toBe("JSON");
        });

        it("should return empty array when no tables", async () => {
            mockJsonFn.mockResolvedValue({ data: [] });

            const result = await service.getTopTablesBySize(10);

            expect(result).toEqual([]);
        });
    });

    describe("ping", () => {
        it("should return true on success", async () => {
            const result = await service.ping();
            expect(result).toBe(true);
        });
    });

    describe("cleanup", () => {
        it("should close client", async () => {
            await service.close();
            expect(mockCloseFn).toHaveBeenCalled();
        });
    });
});
