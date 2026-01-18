
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { listConnections, createConnection, getConnectionById } from "./connections";

// Mock data
const mockConnection = {
    id: "123",
    name: "Test Connection",
    host: "localhost",
    port: 8123,
    username: "default",
    database: "default",
    sslEnabled: false,
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordEncrypted: null,
    metadata: null,
    createdBy: null,
};

// Builder for list query
const listQueryBuilder = {
    from: mock(() => listQueryBuilder),
    where: mock(() => listQueryBuilder),
    orderBy: mock(() => listQueryBuilder),
    limit: mock(() => listQueryBuilder),
    offset: mock(() => listQueryBuilder),
    then: mock((resolve: any) => resolve([mockConnection])),
};

// Builder for count query
const countQueryBuilder = {
    from: mock(() => countQueryBuilder),
    where: mock(() => countQueryBuilder),
    orderBy: mock(() => countQueryBuilder),
    then: mock((resolve: any) => resolve([{ count: 1 }])),
};

// Builder for get/insert/update
const genericBuilder = {
    from: mock(() => genericBuilder),
    where: mock(() => genericBuilder),
    limit: mock(() => genericBuilder),
    values: mock(() => genericBuilder),
    set: mock(() => genericBuilder),
    delete: mock(() => genericBuilder),
    then: mock((resolve: any) => resolve([mockConnection])),
};

// Mock database
const mockDb = {
    select: mock((args) => {
        if (args && args.count) return countQueryBuilder;
        return listQueryBuilder;
    }),
    insert: mock(() => genericBuilder),
    update: mock(() => genericBuilder),
    delete: mock(() => genericBuilder),
};

// Mock schema
const mockSchema = {
    clickhouseConnections: {
        id: "id",
        name: "name",
        isDefault: "isDefault",
        isActive: "isActive",
        host: "host",
        createdAt: "createdAt",
    },
};

// Mock the db module
mock.module("../db", () => ({
    getDatabase: () => mockDb,
    getSchema: () => mockSchema,
}));

describe("Connections Service", () => {
    beforeEach(() => {
        // Reset mocks
        mockDb.select.mockClear();
        listQueryBuilder.from.mockClear();
        listQueryBuilder.then.mockClear();
        countQueryBuilder.from.mockClear();
        countQueryBuilder.then.mockClear();
        genericBuilder.then.mockClear();

        // Reset implementations to default
        listQueryBuilder.then.mockImplementation((resolve: any) => resolve([mockConnection]));
        countQueryBuilder.then.mockImplementation((resolve: any) => resolve([{ count: 1 }]));
        genericBuilder.then.mockImplementation((resolve: any) => resolve([mockConnection]));

        // Reset db.select implementation
        mockDb.select.mockImplementation((args) => {
            if (args && args.count) return countQueryBuilder;
            return listQueryBuilder;
        });
    });

    describe("listConnections", () => {
        it("should list connections", async () => {
            const result = await listConnections();

            expect(result.connections).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.connections[0].id).toBe("123");
            expect(result.connections[0].name).toBe("Test Connection");

            // Verify calls
            expect(mockDb.select).toHaveBeenCalledTimes(2); // Count and List
        });

        it("should return empty list if no connections", async () => {
            // Override for this test
            listQueryBuilder.then.mockImplementation((resolve: any) => resolve([]));
            countQueryBuilder.then.mockImplementation((resolve: any) => resolve([{ count: 0 }]));

            const result = await listConnections();

            expect(result.connections).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    describe("getConnectionById", () => {
        it("should return connection by id", async () => {
            // Setup generic builder to return the mock connection
            genericBuilder.then.mockImplementation((resolve: any) => resolve([mockConnection]));
            mockDb.select.mockReturnValue(genericBuilder);

            const result = await getConnectionById("123");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("123");
        });

        it("should return null if not found", async () => {
            // Setup generic builder to return empty
            genericBuilder.then.mockImplementation((resolve: any) => resolve([]));
            mockDb.select.mockReturnValue(genericBuilder);

            const result = await getConnectionById("999");

            expect(result).toBeNull();
        });
    });
});
