import { describe, expect, it } from "vitest";

import { RBAC_PERMISSIONS } from "@/stores/rbac";
import {
  OTHER_PERMISSION_CATEGORY,
  groupPermissionsByCategory,
  permissionCategory,
} from "./permissionCategories";

describe("permissionCategory", () => {
  it("categorizes every known permission (none fall into Other)", () => {
    const uncategorized = Object.values(RBAC_PERMISSIONS).filter(
      (permission) => permissionCategory(permission) === OTHER_PERMISSION_CATEGORY,
    );
    expect(uncategorized).toEqual([]);
  });

  it("puts the data observability permissions in their own categories", () => {
    expect(permissionCategory("observe:view")).toBe("Data Observability");
    expect(permissionCategory("schema:override")).toBe("Data Observability");
    expect(permissionCategory("cost:view")).toBe("Performance & Capacity");
    expect(permissionCategory("remediation:approve_high")).toBe("Remediation");
    expect(permissionCategory("agents:manage")).toBe("Agents");
  });

  it("uses the longest prefix for nested names", () => {
    expect(permissionCategory("clickhouse:roles:view")).toBe("ClickHouse Roles");
    expect(permissionCategory("clickhouse:users:view")).toBe("ClickHouse Users");
    expect(permissionCategory("metrics:view:advanced")).toBe("Metrics & Monitoring");
  });

  it("falls back to Other for unknown permissions", () => {
    expect(permissionCategory("nope:view")).toBe(OTHER_PERMISSION_CATEGORY);
    expect(permissionCategory("standalone")).toBe(OTHER_PERMISSION_CATEGORY);
  });
});

describe("groupPermissionsByCategory", () => {
  it("prefers the server category over the local mirror", () => {
    const server = new Map([["observe:view", "Server Category"]]);
    expect(groupPermissionsByCategory(["observe:view", "cost:view"], server)).toEqual({
      "Server Category": ["observe:view"],
      "Performance & Capacity": ["cost:view"],
    });
  });

  it("groups without server data", () => {
    expect(groupPermissionsByCategory(["users:view", "users:create"])).toEqual({
      "User Management": ["users:view", "users:create"],
    });
  });
});
