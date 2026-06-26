/**
 * Integration test for the data access policies service.
 *
 * Boots a real in-memory SQLite RBAC database, runs all migrations (which
 * exercises the 1.26.0 policy migration on a fresh install), then drives the
 * policy service end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";

// Use an in-memory SQLite DB for this test process.
process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { initializeDatabase, closeDatabase, getDatabase, getSchema } = await import("../db");
const { runMigrations } = await import("../db/migrations");
const { seedDatabase } = await import("../services/seed");
const policies = await import("./dataAccessPolicies");

let connectionId = "";
let analystRoleId = "";

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  await seedDatabase(); // creates system roles + super admin

  const db = getDatabase() as any;
  const schema = getSchema();

  // A connection for connection-scoped policy tests.
  connectionId = randomUUID();
  await db.insert(schema.clickhouseConnections).values({
    id: connectionId,
    name: "test-conn",
    host: "localhost",
    port: 8123,
    username: "default",
    passwordEncrypted: "x",
    database: "default",
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const analyst = await db.select().from(schema.roles).where(eqName(schema, "analyst")).limit(1);
  analystRoleId = analyst[0].id;
});

afterAll(async () => {
  await closeDatabase();
});

// Small helper to avoid importing drizzle operators at top level repeatedly.
function eqName(schema: any, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { eq } = require("drizzle-orm");
  return eq(schema.roles.name, name);
}

describe("dataAccessPolicies service", () => {
  it("migrated the guest system-tables rule into a system policy", async () => {
    const all = await policies.listPolicies();
    const guestPolicy = all.find((p) => p.name === "System Tables (Guest)");
    expect(guestPolicy).toBeDefined();
    expect(guestPolicy!.isSystem).toBe(true);
    expect(guestPolicy!.rules.some((r) => r.databasePattern === "system")).toBe(true);
    expect(guestPolicy!.roleIds.length).toBeGreaterThan(0);
  });

  it("creates a policy with per-rule connection scope", async () => {
    const created = await policies.createPolicy({
      name: "Analytics RO",
      description: "read analytics",
      rules: [
        { connectionId, databasePattern: "analytics", tablePattern: "*", permissions: ["table:select", "query:execute"], isAllowed: true, priority: 10 },
        { connectionId: null, databasePattern: "shared", tablePattern: "*", isAllowed: true, priority: 5 },
      ],
    });
    expect(created.id).toBeTruthy();
    expect(created.rules.length).toBe(2);
    expect(created.rules.find((r) => r.databasePattern === "analytics")!.connectionId).toBe(connectionId);
    expect(created.rules.find((r) => r.databasePattern === "analytics")!.permissions).toEqual(["table:select", "query:execute"]);
    expect(created.rules.find((r) => r.databasePattern === "shared")!.connectionId).toBeNull();
    expect(created.rules.find((r) => r.databasePattern === "shared")!.permissions).toEqual(["database:view", "table:view", "table:select", "query:execute"]);

    const fetched = await policies.getPolicyById(created.id);
    expect(fetched!.name).toBe("Analytics RO");
  });

  it("resolves a connection-scoped rule only on that connection", async () => {
    const created = await policies.createPolicy({
      name: "Scoped",
      rules: [{ connectionId, databasePattern: "scoped_db", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    await policies.setPoliciesForRole(analystRoleId, [created.id]);

    const onConn = await policies.getPolicyRulesForRoleIds([analystRoleId], connectionId);
    expect(onConn.some((r) => r.databasePattern === "scoped_db")).toBe(true);
    expect(onConn.find((r) => r.databasePattern === "scoped_db")!.permissions).toContain("table:select");

    const otherConn = await policies.getPolicyRulesForRoleIds([analystRoleId], randomUUID());
    expect(otherConn.some((r) => r.databasePattern === "scoped_db")).toBe(false);
  });

  it("resolves a null-connection (all connections) rule everywhere", async () => {
    const created = await policies.createPolicy({
      name: "Global RO",
      rules: [{ connectionId: null, databasePattern: "global_db", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    await policies.setPoliciesForRole(analystRoleId, [created.id]);

    const anyConn = await policies.getPolicyRulesForRoleIds([analystRoleId], randomUUID());
    expect(anyConn.some((r) => r.databasePattern === "global_db")).toBe(true);
  });

  it("links/unlinks policies to roles and reports usage", async () => {
    const created = await policies.createPolicy({
      name: "Linkable",
      rules: [{ connectionId: null, databasePattern: "x", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    await policies.setPoliciesForRole(analystRoleId, [created.id]);

    const roleIds = await policies.getRolesForPolicy(created.id);
    expect(roleIds).toContain(analystRoleId);

    const rolePolicies = await policies.getPoliciesForRole(analystRoleId);
    expect(rolePolicies.map((p) => p.id)).toContain(created.id);

    await policies.setPoliciesForRole(analystRoleId, []);
    expect(await policies.getRolesForPolicy(created.id)).toHaveLength(0);
  });

  it("updates and deletes a policy", async () => {
    const created = await policies.createPolicy({
      name: "Temp",
      rules: [{ connectionId: null, databasePattern: "t", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    const updated = await policies.updatePolicy(created.id, { name: "Temp Renamed" });
    expect(updated!.name).toBe("Temp Renamed");

    await policies.deletePolicy(created.id);
    expect(await policies.getPolicyById(created.id)).toBeNull();
  });
});
