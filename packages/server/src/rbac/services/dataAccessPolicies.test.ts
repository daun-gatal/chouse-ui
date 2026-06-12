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

  it("creates a connection-scoped policy with rules", async () => {
    const created = await policies.createPolicy({
      name: "Analytics RO",
      description: "read analytics",
      allConnections: false,
      connectionIds: [connectionId],
      rules: [
        { databasePattern: "analytics", tablePattern: "*", isAllowed: true, priority: 10 },
        { databasePattern: "analytics", tablePattern: "secrets", isAllowed: false, priority: 20 },
      ],
    });
    expect(created.id).toBeTruthy();
    expect(created.allConnections).toBe(false);
    expect(created.connectionIds).toEqual([connectionId]);
    expect(created.rules.length).toBe(2);

    const fetched = await policies.getPolicyById(created.id);
    expect(fetched!.name).toBe("Analytics RO");
  });

  it("resolves rules for a role only on the scoped connection", async () => {
    const created = await policies.createPolicy({
      name: "Scoped",
      allConnections: false,
      connectionIds: [connectionId],
      rules: [{ databasePattern: "scoped_db", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    await policies.setPoliciesForRole(analystRoleId, [created.id]);

    const onConn = await policies.getPolicyRulesForRoleIds([analystRoleId], connectionId);
    expect(onConn.some((r) => r.databasePattern === "scoped_db")).toBe(true);

    const otherConn = await policies.getPolicyRulesForRoleIds([analystRoleId], randomUUID());
    expect(otherConn.some((r) => r.databasePattern === "scoped_db")).toBe(false);
  });

  it("resolves all-connections policies everywhere", async () => {
    const created = await policies.createPolicy({
      name: "Global RO",
      allConnections: true,
      rules: [{ databasePattern: "global_db", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    await policies.setPoliciesForRole(analystRoleId, [created.id]);

    const anyConn = await policies.getPolicyRulesForRoleIds([analystRoleId], randomUUID());
    expect(anyConn.some((r) => r.databasePattern === "global_db")).toBe(true);
  });

  it("links/unlinks policies to roles and reports usage", async () => {
    const created = await policies.createPolicy({
      name: "Linkable",
      allConnections: true,
      rules: [{ databasePattern: "x", tablePattern: "*", isAllowed: true, priority: 0 }],
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
      allConnections: true,
      rules: [{ databasePattern: "t", tablePattern: "*", isAllowed: true, priority: 0 }],
    });
    const updated = await policies.updatePolicy(created.id, { name: "Temp Renamed" });
    expect(updated!.name).toBe("Temp Renamed");

    await policies.deletePolicy(created.id);
    expect(await policies.getPolicyById(created.id)).toBeNull();
  });
});
