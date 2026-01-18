
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { generateUserDDL, createClickHouseUser, CreateClickHouseUserInput } from "./clickhouseUsers";

// Mock dependencies
const mockService = {
    executeQuery: mock(async () => ({ data: [] })),
};

const queryBuilder = {
    from: mock(() => queryBuilder),
    where: mock(() => queryBuilder),
    limit: mock(() => queryBuilder),
    insert: mock(() => queryBuilder),
    values: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
    set: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
    then: mock((resolve: any) => resolve([])),
};

const mockDb = {
    select: mock(() => queryBuilder),
    insert: mock(() => queryBuilder),
    update: mock(() => queryBuilder),
    delete: mock(() => queryBuilder),
};

const mockSchema = {
    clickhouseUsersMetadata: { id: "id", username: "username", connectionId: "connectionId" },
};

mock.module("../db", () => ({
    getDatabase: () => mockDb,
    getSchema: () => mockSchema,
}));

describe("ClickHouse Users Service", () => {
    beforeEach(() => {
        mockService.executeQuery.mockClear();
        mockDb.insert.mockClear();
        queryBuilder.values.mockClear();
    });

    describe("generateUserDDL", () => {
        it("should generate basic create user DDL", () => {
            const input: CreateClickHouseUserInput = {
                username: "test_user",
                password: "password123",
                role: "viewer",
            };

            const result = generateUserDDL(input);

            expect(result.createUser).toContain("CREATE USER IF NOT EXISTS `test_user`");
            expect(result.createUser).toContain("IDENTIFIED WITH sha256_password BY 'password123'");
            expect(result.grantStatements[0]).toContain("GRANT SELECT ON *.* TO `test_user`");
        });

        it("should generate DDL with host restrictions", () => {
            const input: CreateClickHouseUserInput = {
                username: "test_user",
                role: "viewer",
                hostIp: "192.168.1.1",
            };

            const result = generateUserDDL(input);
            expect(result.createUser).toContain("HOST IP '192.168.1.1'");
        });

        it("should generate DDL with specific database grants", () => {
            const input: CreateClickHouseUserInput = {
                username: "test_user",
                role: "viewer",
                allowedDatabases: ["analytics"],
            };

            const result = generateUserDDL(input);
            // Should revoke all then grant specific
            expect(result.grantStatements[0]).toContain("REVOKE ALL ON *.*");
            expect(result.grantStatements[1]).toContain("GRANT SELECT ON `analytics`.* TO `test_user`");
        });
    });

    describe("createClickHouseUser", () => {
        it("should execute DDL and save metadata", async () => {
            const input: CreateClickHouseUserInput = {
                username: "test_user",
                password: "password123",
                role: "analyst",
            };

            // Mock finding existing metadata (return empty)
            mockDb.select.mockReturnValue({ ...queryBuilder, then: mock((resolve: any) => resolve([])) });

            await createClickHouseUser(mockService as any, input, "conn-123");

            // 1. Create user
            expect(mockService.executeQuery).toHaveBeenCalledWith(expect.stringContaining("CREATE USER"));
            // 2. Grant permissions (analyst has 4 grants for *.*)
            expect(mockService.executeQuery).toHaveBeenCalledWith(expect.stringContaining("GRANT SELECT"));

            // 3. Save metadata
            expect(mockDb.insert).toHaveBeenCalled();
            expect(queryBuilder.values).toHaveBeenCalledWith(expect.objectContaining({
                username: "test_user",
                role: "analyst",
                connectionId: "conn-123"
            }));
        });
    });
});
