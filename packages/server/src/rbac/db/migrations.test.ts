/**
 * Migration tests — runs against BOTH SQLite and PostgreSQL (Docker required).
 *
 * Coverage (MANDATORY — see CLAUDE.md):
 *   1. Fresh-install full chain applies cleanly on both dialects.
 *   2. Every migration version has an explicit per-version effect assertion
 *      (a guard test fails if a migration is added without one).
 *   3. The data migrations (legacy rules -> policies + one-role collapse + dedup
 *      + admin preservation + idempotency + legacy table drop) are verified with
 *      seeded pre-migration data.
 *
 * Run via `scripts/test-migrations.sh` (or bun test on this file with Docker up).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { closeDatabase, getDatabaseType } from "./index";
import { runMigrations, MIGRATIONS } from "./migrations";
import * as h from "./migrationTestHarness";

const DIALECTS: h.Dialect[] = ["sqlite", "postgres"];

// Per-version assertions, evaluated against the final full-chain database (or, for
// the legacy data-access table, asserting it was dropped by 1.27.0).
const VERSION_CHECKS: Record<string, () => Promise<void>> = {
  "1.0.0": async () => {
    for (const t of ["rbac_users", "rbac_roles", "rbac_permissions", "rbac_user_roles", "rbac_role_permissions", "rbac_sessions", "rbac_audit_logs"]) {
      expect(await h.tableExists(t)).toBe(true);
    }
  },
  "1.1.0": async () => {
    // Created here, dropped by 1.27.0 — so it must be absent in the final state.
    expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
  },
  "1.2.0": async () => expect(await h.tableExists("rbac_clickhouse_users_metadata")).toBe(true),
  "1.2.1": async () => expect(await h.columnExists("rbac_clickhouse_users_metadata", "auth_type")).toBe(true),
  "1.2.2": async () => expect(await h.roleExists("guest")).toBe(true),
  "1.3.0": async () => {
    expect(await h.tableExists("rbac_user_preferences")).toBe(true);
    expect(await h.tableExists("rbac_user_favorites")).toBe(true);
    expect(await h.tableExists("rbac_user_recent_items")).toBe(true);
  },
  "1.4.0": async () => expect(await h.tableExists("rbac_saved_queries")).toBe(true),
  "1.5.0": async () => expect(await h.columnExists("rbac_saved_queries", "connection_id")).toBe(true),
  "1.6.0": async () => expect(await h.columnExists("rbac_user_favorites", "connection_id")).toBe(true),
  "1.7.0": async () => {
    expect(await h.permissionExists("live_queries:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "live_queries:view")).toBe(true);
  },
  "1.8.0": async () => expect(await h.permissionExists("connections:view")).toBe(true),
  "1.9.0": async () => expect(await h.permissionExists("audit:delete")).toBe(true),
  "1.10.0": async () => expect(await h.permissionExists("query:execute:misc")).toBe(true),
  "1.10.1": async () => expect(await h.roleHasPermission("analyst", "query:execute:misc")).toBe(true),
  "1.11.0": async () => expect(await h.columnExists("rbac_audit_logs", "username_snapshot")).toBe(true),
  "1.12.0": async () => expect(await h.permissionExists("ai:optimize")).toBe(true),
  "1.13.0": async () => expect(await h.permissionExists("live_queries:kill_all")).toBe(true),
  "1.14.0": async () => {
    expect(await h.tableExists("rbac_ai_chat_threads")).toBe(true);
    expect(await h.tableExists("rbac_ai_chat_messages")).toBe(true);
    expect(await h.permissionExists("ai:chat")).toBe(true);
  },
  "1.15.0": async () => expect(await h.columnExists("rbac_ai_chat_messages", "chart_spec")).toBe(true),
  "1.16.0": async () => {
    expect(await h.tableExists("rbac_ai_providers")).toBe(true);
    expect(await h.tableExists("rbac_ai_models")).toBe(true);
  },
  "1.16.1": async () => expect(await h.permissionExists("ai_models:view")).toBe(true),
  "1.16.2": async () => expect(await h.columnExists("rbac_ai_providers", "provider_type")).toBe(true),
  "1.17.0": async () => expect(await h.columnExists("rbac_audit_logs", "browser")).toBe(true),
  "1.17.1": async () => expect(await h.columnExists("rbac_audit_logs", "timezone")).toBe(true),
  "1.18.0": async () => expect(await h.tableExists("fleet_snapshots")).toBe(true),
  "1.19.0": async () => expect(await h.tableExists("fleet_poller_lease")).toBe(true),
  "1.20.0": async () => expect(await h.tableExists("doctor_reports")).toBe(true),
  "1.21.0": async () => expect(await h.columnExists("doctor_reports", "trigger_source")).toBe(true),
  "1.22.0": async () => {
    expect(await h.permissionExists("parts:view")).toBe(true);
    expect(await h.permissionExists("schema_advisor:view")).toBe(true);
  },
  "1.23.0": async () => expect(await h.permissionExists("logs:view")).toBe(true),
  "1.24.0": async () => expect(await h.permissionExists("doctor:run")).toBe(true),
  "1.25.0": async () => expect(await h.tableExists("rbac_user_identities")).toBe(true),
  "1.26.0": async () => {
    expect(await h.tableExists("rbac_data_access_policies")).toBe(true);
    expect(await h.tableExists("rbac_data_access_policy_rules")).toBe(true);
    expect(await h.tableExists("rbac_data_access_policy_connections")).toBe(true);
    expect(await h.tableExists("rbac_role_data_access_policies")).toBe(true);
    expect(await h.permissionExists("data_access:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "data_access:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "data_access:assign")).toBe(true);
    const guest = await h.rawAll(sql`SELECT 1 AS ok FROM rbac_data_access_policies WHERE name = 'System Tables (Guest)'`);
    expect(guest.length).toBe(1);
  },
  "1.27.0": async () => {
    expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
    expect(await h.indexExists("user_roles_user_unique_idx")).toBe(true);
  },
};

// ---------------------------------------------------------------------------
// Shared Postgres container for the whole file.
// ---------------------------------------------------------------------------
let pg: h.PostgresContainer | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

// Dialect-aware literals for seeding raw rows.
const b = (v: boolean): boolean | number => (getDatabaseType() === "sqlite" ? (v ? 1 : 0) : v);
const now = () => (getDatabaseType() === "sqlite" ? sql`unixepoch()` : sql`NOW()`);

async function roleId(name: string): Promise<string> {
  const rows = await h.rawAll(sql`SELECT id FROM rbac_roles WHERE name = ${name} LIMIT 1`);
  return String(rows[0].id);
}

async function insertUser(username: string): Promise<string> {
  const id = randomUUID();
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
    VALUES (${id}, ${`${username}@test.local`}, ${username}, 'x', ${b(true)}, ${now()}, ${now()})`);
  return id;
}

async function assignRole(userId: string, rid: string): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${randomUUID()}, ${userId}, ${rid}, ${now()})`);
}

async function insertLegacyRule(opts: { roleId?: string; userId?: string; db: string; table: string; allowed?: boolean }): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_data_access_rules
    (id, role_id, user_id, connection_id, database_pattern, table_pattern, access_type, is_allowed, priority, created_at, updated_at)
    VALUES (${randomUUID()}, ${opts.roleId ?? null}, ${opts.userId ?? null}, NULL, ${opts.db}, ${opts.table}, 'read', ${b(opts.allowed ?? true)}, 0, ${now()}, ${now()})`);
}

async function userRoleIds(userId: string): Promise<string[]> {
  const rows = await h.rawAll(sql`SELECT role_id FROM rbac_user_roles WHERE user_id = ${userId}`);
  return rows.map((r) => String(r.role_id));
}

// ---------------------------------------------------------------------------
// Per-dialect suites.
// ---------------------------------------------------------------------------
for (const dialect of DIALECTS) {
  describe(`migrations · fresh install [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("records every migration version", async () => {
      for (const m of MIGRATIONS) {
        expect(await h.migrationRecorded(m.version)).toBe(true);
      }
    });

    it("has a per-version check for every migration", () => {
      const missing = MIGRATIONS.map((m) => m.version).filter((v) => !VERSION_CHECKS[v]);
      expect(missing).toEqual([]);
    });

    for (const m of MIGRATIONS) {
      it(`${m.version} (${m.name}) applied its effect`, async () => {
        await VERSION_CHECKS[m.version]();
      });
    }
  });

  describe(`migrations · stepwise upgrade [${dialect}]`, () => {
    // Simulate a real upgrade: a DB that is brought forward one release at a time
    // (each app restart applies only the newly-pending migrations), then verify it
    // lands in exactly the same state as a fresh install.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      for (const m of MIGRATIONS) {
        const result = await runMigrations({ skipSeed: true, through: m.version });
        // Each step applies exactly the one newly-pending migration.
        expect(result.migrationsApplied).toContain(m.version);
      }
    }, 60_000);

    it("records every migration version after a stepwise upgrade", async () => {
      for (const m of MIGRATIONS) {
        expect(await h.migrationRecorded(m.version)).toBe(true);
      }
    });

    it("reaches the same final state as a fresh install", async () => {
      for (const m of MIGRATIONS) {
        await VERSION_CHECKS[m.version]();
      }
    });

    it("re-running after the upgrade applies nothing (idempotent)", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
    });
  });

  describe(`migrations · skip-version upgrade [${dialect}]`, () => {
    // A DB installed at an early version that skips several releases straight to HEAD.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true, through: "1.2.2" }); // "installed" at an old version
      await runMigrations({ skipSeed: true }); // jump to HEAD
    }, 60_000);

    it("reaches the same final state as a fresh install", async () => {
      for (const m of MIGRATIONS) {
        await VERSION_CHECKS[m.version]();
      }
    });
  });

  describe(`migrations · legacy data-access upgrade [${dialect}]`, () => {
    let userMulti = "";
    let userMultiTwin = "";
    let userWithRule = "";
    let userPlain = "";
    let userAdmin = "";

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // Run up to just before the policy migration; system roles exist (seeded by 1.2.2).
      await runMigrations({ skipSeed: true, through: "1.25.0" });

      const analyst = await roleId("analyst");
      const viewer = await roleId("viewer");
      const developer = await roleId("developer");
      const admin = await roleId("admin");

      // A role-level rule on developer -> should become a role-attached policy.
      await insertLegacyRule({ roleId: developer, db: "dev_db", table: "*" });

      // Multi-role user (analyst + viewer), no user rules -> merged role.
      userMulti = await insertUser("u_multi");
      await assignRole(userMulti, analyst);
      await assignRole(userMulti, viewer);

      // Identical multi-role user -> must share the SAME merged role (dedup).
      userMultiTwin = await insertUser("u_multi_twin");
      await assignRole(userMultiTwin, analyst);
      await assignRole(userMultiTwin, viewer);

      // Single role + a user-level rule -> merged role carrying the user policy.
      userWithRule = await insertUser("u_rule");
      await assignRole(userWithRule, analyst);
      await insertLegacyRule({ userId: userWithRule, db: "mine", table: "*" });

      // Single role, no user rules -> untouched.
      userPlain = await insertUser("u_plain");
      await assignRole(userPlain, analyst);

      // Admin + viewer -> collapses to admin only (preserves the bypass).
      userAdmin = await insertUser("u_admin");
      await assignRole(userAdmin, admin);
      await assignRole(userAdmin, viewer);

      // Apply the data-access migration + the drop.
      await runMigrations({ skipSeed: true, through: "1.27.0" });
    }, 60_000);

    it("dropped the legacy table and added the one-role index", async () => {
      expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
      expect(await h.indexExists("user_roles_user_unique_idx")).toBe(true);
    });

    it("converted the role-level rule into a policy attached to the developer role", async () => {
      const developer = await roleId("developer");
      const rows = await h.rawAll(sql`
        SELECT p.id FROM rbac_role_data_access_policies rp
        JOIN rbac_data_access_policies p ON p.id = rp.policy_id
        WHERE rp.role_id = ${developer}
      `);
      expect(rows.length).toBeGreaterThan(0);
    });

    it("collapsed every user to exactly one role", async () => {
      for (const u of [userMulti, userMultiTwin, userWithRule, userPlain, userAdmin]) {
        expect(await userRoleIds(u)).toHaveLength(1);
      }
    });

    it("left the single-role, no-rule user untouched (still analyst)", async () => {
      const analyst = await roleId("analyst");
      expect(await userRoleIds(userPlain)).toEqual([analyst]);
    });

    it("kept the admin user on the admin role (bypass preserved)", async () => {
      const admin = await roleId("admin");
      expect(await userRoleIds(userAdmin)).toEqual([admin]);
    });

    it("de-duplicated identical merged users onto the same generated role", async () => {
      const [a] = await userRoleIds(userMulti);
      const [b2] = await userRoleIds(userMultiTwin);
      expect(a).toBe(b2);
      // ...and that role is neither analyst nor viewer.
      const analyst = await roleId("analyst");
      const viewer = await roleId("viewer");
      expect(a).not.toBe(analyst);
      expect(a).not.toBe(viewer);
    });

    it("gave the user-rule user a merged role with a migrated user policy", async () => {
      const [mergedRole] = await userRoleIds(userWithRule);
      const rows = await h.rawAll(sql`
        SELECT p.name FROM rbac_role_data_access_policies rp
        JOIN rbac_data_access_policies p ON p.id = rp.policy_id
        WHERE rp.role_id = ${mergedRole} AND p.name = 'Migrated user: u_rule'
      `);
      expect(rows.length).toBe(1);
    });

    it("is idempotent — re-running applies nothing and adds no duplicate policies", async () => {
      const before = await h.rowCount("rbac_data_access_policies");
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_data_access_policies")).toBe(before);
    });
  });
}
