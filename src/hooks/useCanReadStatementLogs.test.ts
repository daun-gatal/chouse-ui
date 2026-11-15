import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useCanReadStatementLogs } from "./useCanReadStatementLogs";

function signInAs(roles: string[], permissions: string[]): void {
  useRbacStore.setState({ roles, permissions });
}

describe("useCanReadStatementLogs", () => {
  beforeEach(() => {
    signInAs([], []);
  });

  it("refuses a person with neither the permission nor an admin role", () => {
    signInAs(["analyst"], ["query:execute", "query:history:view"]);
    expect(renderHook(() => useCanReadStatementLogs()).result.current).toBe(false);
  });

  it("allows a person who holds query:history:view:all", () => {
    signInAs(["analyst"], [RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL]);
    expect(renderHook(() => useCanReadStatementLogs()).result.current).toBe(true);
  });

  it("allows an admin whose permission list does not carry it", () => {
    signInAs(["admin"], []);
    expect(renderHook(() => useCanReadStatementLogs()).result.current).toBe(true);
  });

  it("allows a super admin", () => {
    signInAs(["super_admin"], []);
    expect(renderHook(() => useCanReadStatementLogs()).result.current).toBe(true);
  });
});
