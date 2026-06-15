
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
            // Mock responses in .json() CONSUMPTION order. The CPU-load query is
            // issued on its own and resolves BEFORE the Promise.all batch, so its
            // mock is consumed first. Order:
            // cpu, version, uptime, dbCount, tableCount, size/rows, mem, conn, queries
            mockJsonFn
                .mockResolvedValueOnce({ data: [{ cpu_load: 0.5 }] })
                .mockResolvedValueOnce({ data: [{ "version()": "23.8" }] })
                .mockResolvedValueOnce({ data: [{ "uptime()": 3600 }] })
                .mockResolvedValueOnce({ data: [{ "count()": 5 }] })
                .mockResolvedValueOnce({ data: [{ "count()": 20 }] })
                .mockResolvedValueOnce({ data: [{ size: "1GB", rows: "1000" }] })
                .mockResolvedValueOnce({ data: [{ mem: "100MB" }] })
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
            const calls = (mockQueryFn as any).mock.calls;
            const call = calls[0];
            if (!call) throw new Error("mockQueryFn not called");
            const queryParams = call[0] as any;
            expect(queryParams.query).toContain("system.tables");
            expect(queryParams.query).toContain("database NOT IN");
            expect(queryParams.format).toBe("JSON");
        });

        it("should return empty array when no tables", async () => {
            mockJsonFn.mockResolvedValue({ data: [] });

            const result = await service.getTopTablesBySize(10);

            expect(result).toEqual([]);
        });
    });

    describe("getPartsPressure", () => {
        it("should map per-table parts pressure rows and coerce numbers", async () => {
            mockJsonFn.mockResolvedValue({
                data: [
                    {
                        database: "default",
                        table: "events",
                        active_parts: "250",
                        max_parts_in_partition: "240",
                        rows: "1000000",
                        bytes: "5000000",
                        merges_running: "1",
                        insert_parts_per_min: 12,
                        merge_parts_per_min: 4,
                        parts_threshold: 300,
                        net_parts_per_min: 8,
                        eta_minutes: 7.5,
                    },
                ],
            });

            const result = await service.getPartsPressure(10);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                database: "default",
                table: "events",
                active_parts: 250,
                max_parts_in_partition: 240,
                rows: 1000000,
                bytes: 5000000,
                merges_running: 1,
                insert_parts_per_min: 12,
                merge_parts_per_min: 4,
                parts_threshold: 300,
                net_parts_per_min: 8,
                eta_minutes: 7.5,
            });

            const call = (mockQueryFn as any).mock.calls[0];
            const queryParams = call[0] as any;
            expect(queryParams.query).toContain("system.parts");
            expect(queryParams.query).toContain("parts_to_throw_insert");
            expect(queryParams.query).toContain("system.part_log");
            expect(queryParams.format).toBe("JSON");
        });

        it("should preserve a negative eta (-1 = converging) rather than zeroing it", async () => {
            mockJsonFn.mockResolvedValue({
                data: [
                    {
                        database: "default",
                        table: "calm",
                        active_parts: 10,
                        max_parts_in_partition: 5,
                        rows: 100,
                        bytes: 200,
                        merges_running: 0,
                        insert_parts_per_min: 1,
                        merge_parts_per_min: 3,
                        parts_threshold: 300,
                        net_parts_per_min: -2,
                        eta_minutes: -1,
                    },
                ],
            });

            const result = await service.getPartsPressure();

            expect(result[0].eta_minutes).toBe(-1);
            expect(result[0].net_parts_per_min).toBe(-2);
        });

        it("should return empty array when no parts", async () => {
            mockJsonFn.mockResolvedValue({ data: [] });

            const result = await service.getPartsPressure(10);

            expect(result).toEqual([]);
        });
    });

    describe("getDdlImpact", () => {
        const parsed = { database: "demo", table: "events", kind: "update" as const, where: "id < 5" };

        it("estimates rows, parts, duration, and disk sufficiency (read-only)", async () => {
            // Consumed in order: affected-rows, parts agg, throughput, disk free.
            mockJsonFn
                .mockResolvedValueOnce({ data: [{ c: 159 }] })
                .mockResolvedValueOnce({ data: [{ parts: 300, rows: 1000, bytes: 5_000_000 }] })
                .mockResolvedValueOnce({ data: [{ bytes: 10_000_000, ms: 2000 }] })
                .mockResolvedValueOnce({ data: [{ free: 9_000_000_000 }] });

            const r = await service.getDdlImpact(parsed, "demo");

            expect(r.affected_rows).toBe(159);
            expect(r.total_rows).toBe(1000);
            expect(r.parts_to_rewrite).toBe(300);
            expect(r.bytes_to_rewrite).toBe(5_000_000);
            // throughput = 10MB / 2s = 5MB/s; duration = 5MB / 5MB/s = 1s
            expect(r.est_duration_seconds).toBeCloseTo(1, 5);
            expect(r.disk_sufficient).toBe(true);

            // First query must be the read-only count against the table — never an ALTER.
            const firstQuery = (mockQueryFn as any).mock.calls[0][0].query as string;
            expect(firstQuery).toContain("count()");
            expect(firstQuery).toContain("`demo`.`events`");
            expect(firstQuery.toUpperCase()).not.toContain("ALTER");
        });

        it("reports unknown duration (-1) when there is no mutation/merge history", async () => {
            mockJsonFn
                .mockResolvedValueOnce({ data: [{ c: 10 }] })
                .mockResolvedValueOnce({ data: [{ parts: 5, rows: 100, bytes: 1000 }] })
                .mockResolvedValueOnce({ data: [{ bytes: 0, ms: 0 }] })
                .mockResolvedValueOnce({ data: [{ free: 500 }] });

            const r = await service.getDdlImpact(parsed, "demo");

            expect(r.est_duration_seconds).toBe(-1);
            expect(r.disk_sufficient).toBe(false); // free 500 < 1000 bytes to rewrite
        });

        it("rejects an invalid table reference", async () => {
            await expect(
                service.getDdlImpact({ database: "demo", table: "bad table", kind: "delete", where: "1" }, "demo"),
            ).rejects.toThrow();
        });
    });

    describe("ping", () => {
        it("should return true on success", async () => {
            const result = await service.ping();
            expect(result).toBe(true);
        });
    });

    describe("cleanup", () => {
        it("should not close client automatically (managed by ClientManager)", async () => {
            await service.close();
            expect(mockCloseFn).not.toHaveBeenCalled();
        });
    });
});
