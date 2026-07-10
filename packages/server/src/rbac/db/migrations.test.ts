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
  // Created here, dropped by 1.30.0 — so it must be absent in the final state.
  "1.2.0": async () => expect(await h.tableExists("rbac_clickhouse_users_metadata")).toBe(false),
  "1.2.1": async () => expect(await h.columnExists("rbac_clickhouse_users_metadata", "auth_type")).toBe(false),
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
    expect(await h.tableExists("rbac_role_data_access_policies")).toBe(true);
    // Per-rule connection scope (no separate policy<->connection table).
    expect(await h.columnExists("rbac_data_access_policy_rules", "connection_id")).toBe(true);
    expect(await h.tableExists("rbac_data_access_policy_connections")).toBe(false);
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
  "1.28.0": async () => {
    // Per-user connection access is gone; access is derived from role policies.
    expect(await h.tableExists("rbac_user_connections")).toBe(false);
  },
  "1.29.0": async () => {
    for (const p of ["clickhouse:roles:view", "clickhouse:roles:create", "clickhouse:roles:update", "clickhouse:roles:delete", "clickhouse:roles:assign"]) {
      expect(await h.permissionExists(p)).toBe(true);
    }
    expect(await h.roleHasPermission("super_admin", "clickhouse:roles:create")).toBe(true);
    expect(await h.roleHasPermission("admin", "clickhouse:roles:assign")).toBe(true);
  },
  "1.30.0": async () => {
    // ClickHouse is now the source of truth; the local metadata cache is gone.
    expect(await h.tableExists("rbac_clickhouse_users_metadata")).toBe(false);
  },
  "1.31.0": async () => {
    expect(await h.tableExists("rbac_clickhouse_role_state")).toBe(true);
    expect(await h.indexExists("ch_role_state_conn_role_idx")).toBe(true);
  },
  "1.32.0": async () => {
    expect(await h.tableExists("rbac_sso_settings")).toBe(true);
    expect(await h.tableExists("rbac_sso_providers")).toBe(true);
    expect(await h.permissionExists("sso:view")).toBe(true);
    expect(await h.permissionExists("sso:edit")).toBe(true);
    expect(await h.permissionExists("sso:delete")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:edit")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "sso:delete")).toBe(true);
    expect(await h.roleHasPermission("admin", "sso:view")).toBe(true);
  },
  "1.33.0": async () => {
    expect(await h.columnExists("rbac_sso_providers", "auth_params")).toBe(true);
  },
  "1.34.0": async () => {
    for (const col of [
      "saml_idp_entity_id", "saml_idp_sso_url", "saml_idp_certificate",
      "saml_sp_entity_id", "saml_nameid_format", "saml_allow_idp_initiated",
    ]) {
      expect(await h.columnExists("rbac_sso_providers", col)).toBe(true);
    }
    expect(await h.columnIsNullable("rbac_sso_providers", "client_id")).toBe(true);
    expect(await h.columnIsNullable("rbac_sso_providers", "scopes")).toBe(true);
  },
  "1.35.0": async () => {
    expect(await h.columnExists("rbac_sso_providers", "saml_trust_email_verified")).toBe(true);
  },
  "1.36.0": async () => {
    // 1.36.0 created fleet_alert_config; its data was imported into the
    // normalized alerting tables by 1.39.0 and the table was dropped by 1.39.1,
    // so at HEAD it no longer exists.
    expect(await h.tableExists("fleet_alert_config")).toBe(false);
  },
  "1.37.0": async () => {
    expect(await h.tableExists("doctor_schedule")).toBe(true);
    expect(await h.columnExists("doctor_schedule", "last_run_at")).toBe(true);
    expect(await h.columnExists("doctor_schedule", "last_run_by")).toBe(true);
    const rows = await h.rawAll(sql`SELECT id FROM doctor_schedule WHERE id = 1`);
    expect(rows.length).toBe(1);
  },
  "1.38.0": async () => {
    expect(await h.tableExists("_rbac_rate_limits")).toBe(true);
    expect(await h.columnExists("_rbac_rate_limits", "hits")).toBe(true);
    expect(await h.columnExists("_rbac_rate_limits", "reset_at_ms")).toBe(true);
    expect(await h.indexExists("idx_rbac_rate_limits_reset_at_ms")).toBe(true);
  },
  "1.39.0": async () => {
    expect(await h.tableExists("notification_channels")).toBe(true);
    expect(await h.tableExists("alert_rules")).toBe(true);
    expect(await h.tableExists("alert_rule_channels")).toBe(true);
    expect(await h.tableExists("alert_events")).toBe(true);
    expect(await h.columnExists("notification_channels", "config")).toBe(true);
    expect(await h.columnExists("alert_rules", "source_type")).toBe(true);
    expect(await h.indexExists("idx_alert_events_fired_at")).toBe(true);
    // Permissions are seeded and granted in the same migration: super_admin gets
    // view + edit + delete, admin gets view + edit (delete is super-admin only).
    expect(await h.permissionExists("alerting:view")).toBe(true);
    expect(await h.permissionExists("alerting:edit")).toBe(true);
    expect(await h.permissionExists("alerting:delete")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:view")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:edit")).toBe(true);
    expect(await h.roleHasPermission("super_admin", "alerting:delete")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:view")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:edit")).toBe(true);
    expect(await h.roleHasPermission("admin", "alerting:delete")).toBe(false);
  },
  "1.39.1": async () => {
    // The legacy blob table is dropped once its data has been imported.
    expect(await h.tableExists("fleet_alert_config")).toBe(false);
  },
  "1.40.0": async () => {
    // Four scheduled-queries tables + their indexes.
    expect(await h.tableExists("scheduled_queries")).toBe(true);
    expect(await h.tableExists("scheduled_query_runs")).toBe(true);
    expect(await h.tableExists("scheduled_query_channels")).toBe(true);
    expect(await h.tableExists("scheduled_query_outbox")).toBe(true);
    expect(await h.columnExists("scheduled_queries", "output_mode")).toBe(true);
    expect(await h.columnExists("scheduled_queries", "last_run_at")).toBe(true);
    expect(await h.columnExists("scheduled_query_runs", "slot_at")).toBe(true);
    expect(await h.columnExists("scheduled_query_runs", "written_rows")).toBe(true);
    expect(await h.columnExists("scheduled_query_outbox", "dedup_key")).toBe(true);
    expect(await h.indexExists("sq_enabled_idx")).toBe(true);
    expect(await h.indexExists("sq_runs_status_idx")).toBe(true);
    expect(await h.indexExists("sq_outbox_dedup_idx")).toBe(true);
    // Permissions seeded and granted to super_admin + admin (write + view_all included).
    for (const p of [
      "scheduled_queries:view",
      "scheduled_queries:edit",
      "scheduled_queries:delete",
      "scheduled_queries:run",
      "scheduled_queries:write",
      "scheduled_queries:view_all",
    ]) {
      expect(await h.permissionExists(p)).toBe(true);
      expect(await h.roleHasPermission("super_admin", p)).toBe(true);
      expect(await h.roleHasPermission("admin", p)).toBe(true);
    }
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

async function insertLegacyRule(opts: { roleId?: string; userId?: string; connectionId?: string | null; db: string; table: string; allowed?: boolean }): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_data_access_rules
    (id, role_id, user_id, connection_id, database_pattern, table_pattern, access_type, is_allowed, priority, created_at, updated_at)
    VALUES (${randomUUID()}, ${opts.roleId ?? null}, ${opts.userId ?? null}, ${opts.connectionId ?? null}, ${opts.db}, ${opts.table}, 'read', ${b(opts.allowed ?? true)}, 0, ${now()}, ${now()})`);
}

async function insertConnection(name: string): Promise<string> {
  const id = randomUUID();
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections
    (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${id}, ${name}, 'localhost', 8123, 'default', 'x', 'default', ${b(false)}, ${b(true)}, ${b(false)}, ${now()}, ${now()})`);
  return id;
}

async function insertGrant(userId: string, connectionId: string): Promise<void> {
  await h.rawRun(sql`INSERT INTO rbac_user_connections (id, user_id, connection_id, can_use, created_at)
    VALUES (${randomUUID()}, ${userId}, ${connectionId}, ${b(true)}, ${now()})`);
}

// The connection_ids set on a user's (single) role's policy rules.
async function userRuleConnIds(userId: string): Promise<Set<string>> {
  const rows = await h.rawAll(sql`
    SELECT pr.connection_id AS connection_id FROM rbac_user_roles ur
    JOIN rbac_role_data_access_policies rp ON rp.role_id = ur.role_id
    JOIN rbac_data_access_policy_rules pr ON pr.policy_id = rp.policy_id
    WHERE ur.user_id = ${userId}
  `);
  return new Set(rows.map((r) => String(r.connection_id)));
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
    let connX = "";
    let userGrant = "";
    let userGrantTwin = "";
    let userConnScoped = "";
    let userPlain = "";
    let userNullNoGrant = "";
    let userMulti = "";
    let userAdmin = "";

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // Install at the last released version; system roles exist (seeded by 1.2.2).
      await runMigrations({ skipSeed: true, through: "1.25.0" });

      const analyst = await roleId("analyst");
      const viewer = await roleId("viewer");
      const admin = await roleId("admin");
      connX = await insertConnection("connX");

      // Role-level global (null-connection) rule on analyst, like a real install.
      await insertLegacyRule({ roleId: analyst, db: "analytics", table: "*" });

      // analyst + a direct connection grant -> null rule must be expanded onto connX.
      userGrant = await insertUser("u_grant");
      await assignRole(userGrant, analyst);
      await insertGrant(userGrant, connX);

      // Identical to u_grant -> must share the same generated role (dedup).
      userGrantTwin = await insertUser("u_grant_twin");
      await assignRole(userGrantTwin, analyst);
      await insertGrant(userGrantTwin, connX);

      // analyst + a connection-scoped user rule -> connX reachable without a grant.
      userConnScoped = await insertUser("u_connscoped");
      await assignRole(userConnScoped, analyst);
      await insertLegacyRule({ userId: userConnScoped, connectionId: connX, db: "sales", table: "*" });

      // analyst only (analyst has a null rule) but NO grant -> no reachable connection -> no access -> untouched.
      userNullNoGrant = await insertUser("u_nullnograent");
      await assignRole(userNullNoGrant, analyst);

      // analyst with nothing extra and no grant -> untouched (stays analyst).
      userPlain = await insertUser("u_plain");
      await assignRole(userPlain, analyst);

      // Multi-role, no grants/rules -> collapses to a merged role (one role rule).
      userMulti = await insertUser("u_multi");
      await assignRole(userMulti, analyst);
      await assignRole(userMulti, viewer);

      // admin + viewer -> collapses to admin only (preserves the bypass).
      userAdmin = await insertUser("u_admin");
      await assignRole(userAdmin, admin);
      await assignRole(userAdmin, viewer);

      // Apply the data-access migration + the drops (through HEAD).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("dropped both legacy tables and added the one-role index", async () => {
      expect(await h.tableExists("rbac_data_access_rules")).toBe(false);
      expect(await h.tableExists("rbac_user_connections")).toBe(false);
      expect(await h.indexExists("user_roles_user_unique_idx")).toBe(true);
    });

    it("collapsed every user to exactly one role", async () => {
      for (const u of [userGrant, userGrantTwin, userConnScoped, userPlain, userNullNoGrant, userMulti, userAdmin]) {
        expect(await userRoleIds(u)).toHaveLength(1);
      }
    });

    it("kept the admin user on the admin role (bypass preserved)", async () => {
      expect(await userRoleIds(userAdmin)).toEqual([await roleId("admin")]);
    });

    it("left no-access single-role users untouched (still analyst)", async () => {
      const analyst = await roleId("analyst");
      expect(await userRoleIds(userPlain)).toEqual([analyst]);
      expect(await userRoleIds(userNullNoGrant)).toEqual([analyst]);
    });

    it("expanded the role's null rule onto a directly-granted connection", async () => {
      // u_grant should reach connX (a connection-scoped rule exists for it).
      expect(await userRuleConnIds(userGrant)).toContain(connX);
      // and that rule carries the analyst null rule's db pattern, scoped to connX.
      const [role] = await userRoleIds(userGrant);
      const rows = await h.rawAll(sql`
        SELECT pr.database_pattern AS db FROM rbac_role_data_access_policies rp
        JOIN rbac_data_access_policy_rules pr ON pr.policy_id = rp.policy_id
        WHERE rp.role_id = ${role} AND pr.connection_id = ${connX}
      `);
      expect(rows.map((r) => String(r.db))).toContain("analytics");
    });

    it("de-duplicated identical granted users onto the same generated role", async () => {
      const [a] = await userRoleIds(userGrant);
      const [b2] = await userRoleIds(userGrantTwin);
      expect(a).toBe(b2);
      expect(a).not.toBe(await roleId("analyst"));
    });

    it("made a connection-scoped user rule's connection reachable", async () => {
      expect(await userRuleConnIds(userConnScoped)).toContain(connX);
    });

    it("is idempotent — re-running applies nothing and adds no duplicate policies", async () => {
      const before = await h.rowCount("rbac_data_access_policies");
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_data_access_policies")).toBe(before);
    });
  });

  describe(`migrations · 1.34.0 sso provider rebuild [${dialect}]`, () => {
    // 1.34.0 rebuilds rbac_sso_providers on SQLite (CREATE __new -> INSERT…SELECT ->
    // DROP -> RENAME), which MOVES rows. Prove a pre-existing OIDC provider survives
    // the rebuild intact, the new SAML columns are NULL, and re-running is a no-op.
    const provId = randomUUID();

    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // State BEFORE the SAML migration (rbac_sso_providers exists, pre-1.34.0 shape).
      await runMigrations({ skipSeed: true, through: "1.33.0" });

      await h.rawRun(sql`INSERT INTO rbac_sso_providers
        (id, type, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled, created_at, updated_at)
        VALUES (${provId}, 'oidc', 'Acme OIDC', 'https://idp.acme.test', 'acme-client', 'enc:secret', 'openid email profile', ${b(true)}, ${now()}, ${now()})`);

      // Apply the remaining migrations (1.34.0 — the rebuild).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("kept the seeded OIDC provider's original columns intact through the rebuild", async () => {
      const rows = await h.rawAll(sql`SELECT id, type, display_name, issuer, client_id, client_secret_encrypted, scopes
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(String(row.id)).toBe(provId);
      expect(String(row.type)).toBe("oidc");
      expect(String(row.display_name)).toBe("Acme OIDC");
      expect(String(row.issuer)).toBe("https://idp.acme.test");
      expect(String(row.client_id)).toBe("acme-client");
      expect(String(row.client_secret_encrypted)).toBe("enc:secret");
      expect(String(row.scopes)).toBe("openid email profile");
    });

    it("left the six new SAML columns NULL on the migrated row", async () => {
      const rows = await h.rawAll(sql`SELECT
        saml_idp_entity_id, saml_idp_sso_url, saml_idp_certificate,
        saml_sp_entity_id, saml_nameid_format, saml_allow_idp_initiated
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      for (const v of Object.values(rows[0])) {
        expect(v).toBeNull();
      }
    });

    it("is idempotent — re-running the rebuild leaves a single intact row", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("rbac_sso_providers")).toBe(1);

      const rows = await h.rawAll(sql`SELECT id, type, display_name, issuer, client_id, client_secret_encrypted, scopes
        FROM rbac_sso_providers WHERE id = ${provId}`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].client_id)).toBe("acme-client");
      expect(String(rows[0].client_secret_encrypted)).toBe("enc:secret");
      expect(String(rows[0].scopes)).toBe("openid email profile");
    });
  });

  describe(`migrations · 1.39.0 alerting normalization data migration [${dialect}]`, () => {
    // 1.39.0 imports the legacy fleet_alert_config blob (id=1) into the
    // normalized tables: one fleet-default rule + its channels, with the
    // previously-plaintext secrets encrypted at rest. Prove the projection is
    // correct, secrets are encrypted (and decrypt back), and re-running is a no-op.
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      // State BEFORE alerting normalization: fleet_alert_config exists (1.36.0)
      // but the normalized tables do not yet.
      await runMigrations({ skipSeed: true, through: "1.38.0" });

      const blob = JSON.stringify({
        enabled: true,
        aiRcaOnBreach: true,
        aiRcaModelId: "model-xyz",
        rules: { memoryPercent: 90, queryMemoryGb: 8, longQueryMin: 5, partsEtaMin: 30 },
        slack: { webhookUrl: "https://hooks.slack.com/services/T/B/secret", enabled: true },
        email: {
          user: "alerts@acme.test",
          password: "smtp-secret",
          to: "oncall@acme.test",
          host: "smtp.acme.test",
          port: 587,
          secure: false,
          enabled: false,
        },
      });
      await h.rawRun(sql`UPDATE fleet_alert_config SET config = ${blob} WHERE id = 1`);

      // Apply the remaining migrations (1.39.0 — the normalization import).
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("imported the fleet-default rule with thresholds + AI-RCA settings", async () => {
      const rows = await h.rawAll(sql`SELECT name, source_type, config, severity, enabled, ai_rca_enabled, ai_rca_model_id
        FROM alert_rules WHERE id = 'fleet-default'`);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(String(row.source_type)).toBe("fleet_threshold");
      expect(Number(row.enabled)).toBe(1);
      expect(Number(row.ai_rca_enabled)).toBe(1);
      expect(String(row.ai_rca_model_id)).toBe("model-xyz");
      const cfg = JSON.parse(String(row.config));
      expect(cfg.memoryPercent).toBe(90);
      expect(cfg.queryMemoryGb).toBe(8);
      expect(cfg.longQueryMin).toBe(5);
      expect(cfg.partsEtaMin).toBe(30);
    });

    it("imported the slack + email channels and linked them to the rule", async () => {
      const links = await h.rawAll(sql`SELECT channel_id FROM alert_rule_channels WHERE rule_id = 'fleet-default' ORDER BY channel_id`);
      expect(links.map((l) => String(l.channel_id))).toEqual(["fleet-email", "fleet-slack"]);

      const slack = await h.rawAll(sql`SELECT type, enabled FROM notification_channels WHERE id = 'fleet-slack'`);
      expect(String(slack[0].type)).toBe("slack");
      expect(Number(slack[0].enabled)).toBe(1);

      const email = await h.rawAll(sql`SELECT type, enabled FROM notification_channels WHERE id = 'fleet-email'`);
      expect(String(email[0].type)).toBe("email");
      expect(Number(email[0].enabled)).toBe(0); // email.enabled: false in the blob
    });

    it("encrypted the previously-plaintext secrets at rest (and they decrypt back)", async () => {
      const { decryptSecret } = await import("../services/connections");

      const slack = await h.rawAll(sql`SELECT config FROM notification_channels WHERE id = 'fleet-slack'`);
      const slackCfg = JSON.parse(String(slack[0].config));
      expect(slackCfg.webhookUrl).not.toBe("https://hooks.slack.com/services/T/B/secret");
      expect(decryptSecret(slackCfg.webhookUrl)).toBe("https://hooks.slack.com/services/T/B/secret");

      const email = await h.rawAll(sql`SELECT config FROM notification_channels WHERE id = 'fleet-email'`);
      const emailCfg = JSON.parse(String(email[0].config));
      expect(emailCfg.password).not.toBe("smtp-secret");
      expect(decryptSecret(emailCfg.password)).toBe("smtp-secret");
      expect(emailCfg.host).toBe("smtp.acme.test");
      expect(emailCfg.port).toBe(587);
      expect(emailCfg.secure).toBe(false);
    });

    it("is idempotent — re-running imports nothing new", async () => {
      const result = await runMigrations({ skipSeed: true });
      expect(result.migrationsApplied).toEqual([]);
      expect(await h.rowCount("alert_rules")).toBe(1);
      expect(await h.rowCount("notification_channels")).toBe(2);
      expect(await h.rowCount("alert_rule_channels")).toBe(2);
    });
  });
}

// ---------------------------------------------------------------------------
// Concurrent migration runners (Postgres only).
//
// During a rolling deploy / scale-up, several replicas boot and call
// runMigrations() against the same Postgres at once. Without the advisory lock
// they race on the version table (UNIQUE version) and on non-idempotent steps,
// crashing the loser. With the lock, exactly one runs and the rest no-op.
//
// SQLite is single-process and not a multi-replica target, so this only applies
// to Postgres.
// ---------------------------------------------------------------------------
describe("migrations · concurrent runners [postgres]", () => {
  beforeAll(async () => {
    await h.freshDatabase("postgres", pg);
  }, 60_000);

  it("serializes concurrent runMigrations without error or duplicate records", async () => {
    // Fire several runners at once against the same fresh database. The advisory
    // lock must serialize them: the winner applies the full chain, the others wait
    // and then observe everything already applied.
    const results = await Promise.all([
      runMigrations({ skipSeed: true }),
      runMigrations({ skipSeed: true }),
      runMigrations({ skipSeed: true }),
    ]);

    // Exactly one runner applied the chain; the rest applied nothing.
    const appliedChain = results.filter((r) => r.migrationsApplied.length > 0);
    expect(appliedChain).toHaveLength(1);
    expect(appliedChain[0].migrationsApplied).toEqual(MIGRATIONS.map((m) => m.version));
    for (const r of results) {
      if (r.migrationsApplied.length === 0) {
        expect(r.migrationsApplied).toEqual([]);
      }
    }

    // Every migration recorded exactly once (no duplicate-key crash, no double-apply).
    for (const m of MIGRATIONS) {
      const rows = await h.rawAll(sql`SELECT 1 FROM _rbac_migrations WHERE version = ${m.version}`);
      expect(rows).toHaveLength(1);
    }

    // Final schema matches a normal install.
    for (const m of MIGRATIONS) {
      await VERSION_CHECKS[m.version]();
    }
  }, 60_000);
});
