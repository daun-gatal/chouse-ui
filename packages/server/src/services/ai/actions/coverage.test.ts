/**
 * The coverage gate (ADR 0025 §2): every write permission has a tool or a
 * reason it has none, and the security rules hold across every tool.
 */
import { describe, expect, it } from "bun:test";

import { PERMISSIONS, type Permission } from "../../../rbac/schema/base";
import { isWritePermission, NOT_FOR_AI } from "./coverage";
import { ACTION_DEFINITIONS } from "./definitions";

const ALL = Object.values(PERMISSIONS) as Permission[];
const covered = new Set(ACTION_DEFINITIONS.flatMap((d) => d.permissions));

describe("AI write coverage (ADR 0025)", () => {
  it("gives every write permission a tool or a reason it has none", () => {
    const missing = ALL.filter((p) => isWritePermission(p) && !covered.has(p) && !NOT_FOR_AI[p]);
    expect(missing).toEqual([]);
  });

  it("only lists real write permissions as never-for-AI, each with a reason", () => {
    for (const [permission, reason] of Object.entries(NOT_FOR_AI)) {
      expect(ALL).toContain(permission as Permission);
      expect(isWritePermission(permission as Permission)).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("offers no tool for what AI must never do", () => {
    const forbidden: Permission[] = [
      PERMISSIONS.AI_ACT, PERMISSIONS.AI_GUARDRAILS_MANAGE, PERMISSIONS.AI_BUDGETS_MANAGE, PERMISSIONS.AI_MEMORIES_MANAGE,
      PERMISSIONS.AGENTS_MANAGE, PERMISSIONS.SSO_EDIT, PERMISSIONS.AUDIT_DELETE, PERMISSIONS.REMEDIATION_APPROVE,
      PERMISSIONS.REMEDIATION_APPROVE_HIGH, PERMISSIONS.USERS_DELETE, PERMISSIONS.CH_USERS_CREATE, PERMISSIONS.AI_MODELS_CREATE,
    ];
    for (const permission of forbidden) expect(covered.has(permission)).toBe(false);
    const names = ACTION_DEFINITIONS.map((d) => d.name);
    for (const name of names) expect(name).not.toMatch(/password|token|secret|guardrail|budget|sso|approve/);
  });

  it("makes every access tool T3, so a second person always approves a change to who can do what", () => {
    for (const d of ACTION_DEFINITIONS.filter((x) => x.toolkit === "access")) expect(d.tier).toBe("t3");
  });

  it("never lets an access tool take a password", () => {
    for (const d of ACTION_DEFINITIONS) {
      for (const key of Object.keys(d.schema.shape)) expect(key.toLowerCase()).not.toContain("password");
    }
  });
});
