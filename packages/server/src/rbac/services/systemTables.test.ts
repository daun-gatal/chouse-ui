import { describe, expect, it } from "bun:test";

import { systemTablePermission, systemTableRefusal } from "./systemTables";

describe("systemTablePermission", () => {
  it("asks for query:history:view:all on the statement and session logs", () => {
    for (const table of ["query_log", "query_thread_log", "query_views_log", "processes", "text_log", "session_log", "crash_log", "asynchronous_insert_log", "opentelemetry_span_log", "asynchronous_inserts", "query_cache", "zookeeper_log"]) {
      expect(systemTablePermission("system", table)).toBe("query:history:view:all");
    }
  });

  it("asks for clickhouse:users:view on the access tables", () => {
    for (const table of ["users", "roles", "grants", "role_grants", "row_policies", "quotas", "quota_usage", "quotas_usage", "settings_profiles", "settings_profile_elements", "user_directories", "quota_limits", "zookeeper"]) {
      expect(systemTablePermission("system", table)).toBe("clickhouse:users:view");
    }
  });

  it("counts a log table ClickHouse rotated after an upgrade, in any letter case", () => {
    expect(systemTablePermission("system", "query_log_0")).toBe("query:history:view:all");
    expect(systemTablePermission("SYSTEM", "Query_Log_12")).toBe("query:history:view:all");
    expect(systemTablePermission("System", "USERS")).toBe("clickhouse:users:view");
  });

  it("leaves every other table alone", () => {
    expect(systemTablePermission("system", "parts")).toBeNull();
    expect(systemTablePermission("system", "tables")).toBeNull();
    expect(systemTablePermission("system", "part_log")).toBeNull();
    expect(systemTablePermission("system", "users_0")).toBeNull();
    expect(systemTablePermission("system", "query_log_x")).toBeNull();
    expect(systemTablePermission("default", "query_log")).toBeNull();
    expect(systemTablePermission("information_schema", "tables")).toBeNull();
  });

  it("words the refusal with the table and the permission", () => {
    expect(systemTableRefusal("query_log", "query:history:view:all")).toContain("system.query_log");
    expect(systemTableRefusal("query_log", "query:history:view:all")).toContain("query:history:view:all");
  });
});
