
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { getSavedQueries, getSavedQueryById, createSavedQuery, updateSavedQuery, deleteSavedQuery, getQueryConnectionNames } from "./savedQueries";

// Mock data
const mockQuery = {
    id: "query-123",
    userId: "user-123",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    name: "Top Users",
    query: "SELECT * FROM users LIMIT 10",
    description: "Get top 10 users",
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
};

// Builder
const queryBuilder = {
    from: mock(() => queryBuilder),
    where: mock(() => queryBuilder),
    orderBy: mock(() => queryBuilder),
    limit: mock(() => queryBuilder),
    insert: mock(() => queryBuilder),
    values: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
    set: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
    then: mock((resolve: any) => resolve([mockQuery])),
};

// Mock database
const mockDb = {
    select: mock(() => queryBuilder),
    insert: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
};

const mockSchema = {
    savedQueries: {
        id: "id",
        userId: "userId",
        connectionId: "connectionId",
        connectionName: "connectionName",
        updatedAt: "updatedAt",
        isPublic: "isPublic",
        name: "name"
    },
};

mock.module("../db", () => ({
    getDatabase: () => mockDb,
    getSchema: () => mockSchema,
}));

describe("Saved Queries Service", () => {
    beforeEach(() => {
        mockDb.select.mockClear();
        mockDb.insert.mockClear();
        mockDb.update.mockClear();
        mockDb.delete.mockClear();
        queryBuilder.then.mockClear();

        // Reset default implementation
        queryBuilder.then.mockImplementation((resolve: any) => resolve([mockQuery]));
        mockDb.select.mockReturnValue(queryBuilder);
    });

    describe("getSavedQueries", () => {
        it("should return saved queries", async () => {
            const result = await getSavedQueries("user-123");
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("query-123");
        });

        it("should filter by connectionId", async () => {
            // Mock returning multiple queries
            const queries = [
                { ...mockQuery, id: "q1", connectionId: "conn-1" },
                { ...mockQuery, id: "q2", connectionId: "conn-2" },
                { ...mockQuery, id: "q3", connectionId: null },
            ];
            queryBuilder.then.mockImplementation((resolve: any) => resolve(queries));

            const result = await getSavedQueries("user-123", "conn-1");

            // conn-1 and null should match
            expect(result).toHaveLength(2);
            expect(result.map(r => r.id)).toContain("q1");
            expect(result.map(r => r.id)).toContain("q3");
        });
    });

    describe("createSavedQuery", () => {
        it("should create a query", async () => {
            const input = {
                name: "New Query",
                query: "SELECT 1",
                connectionId: "conn-1"
            };

            const result = await createSavedQuery("user-123", input);
            expect(result.name).toBe("New Query");
            expect(mockDb.insert).toHaveBeenCalled();
        });
    });

    describe("updateSavedQuery", () => {
        it("should update query if exists", async () => {
            // Mock existing check returns query
            // Mock update returns updated query
            // Since we use logic: select -> check -> update -> select
            // We can just rely on default returning [mockQuery]

            const result = await updateSavedQuery("query-123", "user-123", { name: "Updated" });

            expect(result).not.toBeNull();
            expect(mockDb.update).toHaveBeenCalled();
        });

        it("should return null if not found", async () => {
            queryBuilder.then.mockImplementation((resolve: any) => resolve([]));

            const result = await updateSavedQuery("query-123", "user-123", { name: "Updated" });

            expect(result).toBeNull();
            expect(mockDb.update).not.toHaveBeenCalled();
        });
    });

    describe("deleteSavedQuery", () => {
        it("should delete query if exists", async () => {
            const result = await deleteSavedQuery("query-123", "user-123");

            expect(result).toBe(true);
            expect(mockDb.delete).toHaveBeenCalled();
        });

        it("should return false if not found", async () => {
            queryBuilder.then.mockImplementation((resolve: any) => resolve([]));

            const result = await deleteSavedQuery("query-123", "user-123");

            expect(result).toBe(false);
            expect(mockDb.delete).not.toHaveBeenCalled();
        });
    });

    describe("getQueryConnectionNames", () => {
        it("should return unique sorted connection names", async () => {
            const rows = [
                { connectionName: "Prod" },
                { connectionName: "Dev" },
                { connectionName: "Prod" }, // Duplicate
                { connectionName: null },
            ];
            queryBuilder.then.mockImplementation((resolve: any) => resolve(rows));

            const result = await getQueryConnectionNames("user-123");

            expect(result).toHaveLength(2);
            expect(result).toEqual(["Dev", "Prod"]); // Sorted
        });
    });
});
