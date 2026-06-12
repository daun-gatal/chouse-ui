import { describe, it, expect, mock, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";

// ------------------------------------------------------------------
// Mock schema — opaque sentinel objects, no real Drizzle columns.
// The production code receives these objects as column references and
// passes them straight into eq()/and(); we never inspect their shape.
// ------------------------------------------------------------------

const mockSchema = {
  userIdentities: {
    id:          { _col: "id" },
    userId:      { _col: "userId" },
    provider:    { _col: "provider" },
    subject:     { _col: "subject" },
    email:       { _col: "email" },
    createdAt:   { _col: "createdAt" },
    lastLoginAt: { _col: "lastLoginAt" },
  },
};

// ------------------------------------------------------------------
// Captured arguments — reset in beforeEach
// ------------------------------------------------------------------

let capturedWhereArg: unknown = undefined;
let capturedSetArg: Record<string, unknown> = {};

// ------------------------------------------------------------------
// Per-test seeded rows — the fake DB returns exactly what the test
// seeds; no SQL-AST parsing needed.
// ------------------------------------------------------------------

type Row = Record<string, unknown>;

// Rows that the next select().from(...).where(...).limit(1) should return.
let seededSelectRows: Row[] = [];

// Rows that have been inserted (used to verify round-trip).
let insertedRows: Row[] = [];

// Last-updated row (used to verify touchUserIdentity).
let updatedRows: Row[] = [];

// ------------------------------------------------------------------
// Fake DB builders
// ------------------------------------------------------------------

function makeSelectBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};

  builder.from = mock((_table: unknown) => builder);

  builder.where = mock((cond: unknown) => {
    capturedWhereArg = cond;
    return builder;
  });

  builder.limit = mock((_n: number) => builder);

  // Thenable — resolves with whatever the test seeded
  builder.then = mock((resolve: (v: unknown) => void) => resolve(seededSelectRows));

  return builder;
}

function makeInsertBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    values: mock((row: Row) => {
      insertedRows.push({ ...row });
      return builder;
    }),
    then: mock((resolve: (v: unknown) => void) => resolve(undefined)),
  };
  return builder;
}

function makeUpdateBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    set: mock((vals: Record<string, unknown>) => {
      capturedSetArg = vals;
      return builder;
    }),
    where: mock((cond: unknown) => {
      capturedWhereArg = cond;
      // Apply the update to seededSelectRows (so a subsequent select sees it)
      for (const row of seededSelectRows) {
        Object.assign(row, capturedSetArg);
        updatedRows.push({ ...row });
      }
      return builder;
    }),
    then: mock((resolve: (v: unknown) => void) => resolve(undefined)),
  };
  return builder;
}

function makeDeleteBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    where: mock((cond: unknown) => {
      capturedWhereArg = cond;
      return builder;
    }),
    then: mock((resolve: (v: unknown) => void) => resolve(undefined)),
  };
  return builder;
}

const mockDb = {
  select: mock((_projection?: unknown) => makeSelectBuilder()),
  insert: mock((_table: unknown) => makeInsertBuilder()),
  update: mock((_table: unknown) => makeUpdateBuilder()),
  delete: mock((_table: unknown) => makeDeleteBuilder()),
};

// ------------------------------------------------------------------
// Wire up the mock before importing the module under test
// ------------------------------------------------------------------

mock.module("../db", () => ({
  getDatabase: () => mockDb,
  getSchema:   () => mockSchema,
  isSqlite:    () => true,
}));

// ------------------------------------------------------------------
// Import the module under test (AFTER mock registration)
// ------------------------------------------------------------------

import {
  createUserIdentity,
  getUserIdentity,
  userHasSsoIdentity,
  touchUserIdentity,
  listUserIdentities,
  deleteUserIdentity,
} from "./identity";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Seed seededSelectRows from the insertedRows store filtered by provider+subject */
function seedSelectByProviderSubject(provider: string, subject: string): void {
  seededSelectRows = insertedRows.filter(
    (r) => r.provider === provider && r.subject === subject
  );
}

/** Seed seededSelectRows from the insertedRows store filtered by userId */
function seedSelectByUserId(userId: string): void {
  seededSelectRows = insertedRows.filter((r) => r.userId === userId);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("SSO Identity Store", () => {
  beforeEach(() => {
    capturedWhereArg = undefined;
    capturedSetArg = {};
    seededSelectRows = [];
    insertedRows = [];
    updatedRows = [];
    mockDb.select.mockClear();
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();
  });

  // ----------------------------------------------------------------
  describe("createUserIdentity + getUserIdentity (round-trip)", () => {
    it("returns the created row with all fields present", async () => {
      const identity = await createUserIdentity({
        userId:   "u1",
        provider: "okta",
        subject:  "sub-1",
        email:    "a@b.co",
      });

      expect(typeof identity.id).toBe("string");
      expect(identity.id.length).toBeGreaterThan(0);
      expect(identity.userId).toBe("u1");
      expect(identity.provider).toBe("okta");
      expect(identity.subject).toBe("sub-1");
      expect(identity.email).toBe("a@b.co");
      expect(identity.createdAt).toBeInstanceOf(Date);
      expect(identity.lastLoginAt).toBeInstanceOf(Date);
    });

    it("round-trips: created identity is retrievable by provider+subject", async () => {
      await createUserIdentity({
        userId:   "u1",
        provider: "okta",
        subject:  "sub-1",
        email:    "a@b.co",
      });

      // Seed what a real DB would return for this query
      seedSelectByProviderSubject("okta", "sub-1");
      const row = await getUserIdentity("okta", "sub-1");

      expect(row).not.toBeNull();
      expect(row!.userId).toBe("u1");
      expect(row!.provider).toBe("okta");
      expect(row!.subject).toBe("sub-1");
      expect(row!.email).toBe("a@b.co");
    });

    it("defaults email to null when omitted", async () => {
      const identity = await createUserIdentity({
        userId:   "u2",
        provider: "github",
        subject:  "sub-2",
      });

      expect(identity.email).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  describe("getUserIdentity", () => {
    it("returns null on an empty store (fake returns [])", async () => {
      // seededSelectRows stays [] — no matching row
      const result = await getUserIdentity("okta", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when subject does not match (fake returns [])", async () => {
      await createUserIdentity({ userId: "u1", provider: "okta", subject: "sub-1" });
      // Do NOT seed — simulates the DB returning nothing for "nope"
      seededSelectRows = [];
      const result = await getUserIdentity("okta", "nope");
      expect(result).toBeNull();
    });

    it("returns null for a different provider (fake returns [])", async () => {
      await createUserIdentity({ userId: "u1", provider: "okta", subject: "sub-1" });
      seededSelectRows = []; // nothing for provider=github
      const result = await getUserIdentity("github", "sub-1");
      expect(result).toBeNull();
    });

    it("passes the correct where-condition to Drizzle (provider + subject columns)", async () => {
      seededSelectRows = [];
      await getUserIdentity("okta", "sub-42");

      // Build the same condition the production code should have built,
      // using the SAME mock schema column objects.  toEqual does a deep
      // structural comparison — if drizzle changes internals both sides
      // change identically (same drizzle version), so the assertion stays valid.
      const expectedCond = and(
        eq(mockSchema.userIdentities.provider as never, "okta"),
        eq(mockSchema.userIdentities.subject  as never, "sub-42")
      );

      expect(capturedWhereArg).toEqual(expectedCond);
    });
  });

  // ----------------------------------------------------------------
  describe("userHasSsoIdentity", () => {
    it("returns false when no identity exists for the user (fake returns [])", async () => {
      seededSelectRows = [];
      const result = await userHasSsoIdentity("u1");
      expect(result).toBe(false);
    });

    it("returns true after an identity is created for the user", async () => {
      await createUserIdentity({ userId: "u1", provider: "okta", subject: "sub-1" });
      seedSelectByUserId("u1");
      const result = await userHasSsoIdentity("u1");
      expect(result).toBe(true);
    });

    it("returns false for a different userId even when identities exist (fake returns [])", async () => {
      await createUserIdentity({ userId: "u1", provider: "okta", subject: "sub-1" });
      // Seed nothing for u99
      seededSelectRows = [];
      const result = await userHasSsoIdentity("u99");
      expect(result).toBe(false);
    });

    it("passes the correct where-condition (userId column)", async () => {
      seededSelectRows = [];
      await userHasSsoIdentity("u-sentinel");

      const expectedCond = eq(mockSchema.userIdentities.userId as never, "u-sentinel");
      expect(capturedWhereArg).toEqual(expectedCond);
    });
  });

  // ----------------------------------------------------------------
  describe("touchUserIdentity", () => {
    it("calls db.update and captures a lastLoginAt Date in set()", async () => {
      const identity = await createUserIdentity({
        userId:   "u1",
        provider: "okta",
        subject:  "sub-1",
      });

      // Seed the row so the update's where() can mutate it
      seedSelectByProviderSubject("okta", "sub-1");

      await touchUserIdentity(identity.id);

      expect(mockDb.update).toHaveBeenCalled();
      expect(capturedSetArg.lastLoginAt).toBeInstanceOf(Date);
    });

    it("advances lastLoginAt strictly beyond the createdAt timestamp", async () => {
      const identity = await createUserIdentity({
        userId:   "u1",
        provider: "okta",
        subject:  "sub-1",
      });

      const originalLastLoginAt = identity.lastLoginAt as Date;

      // Small pause to guarantee the new Date() inside touchUserIdentity is later
      await new Promise((r) => setTimeout(r, 5));

      seedSelectByProviderSubject("okta", "sub-1");
      await touchUserIdentity(identity.id);

      const newLastLoginAt = capturedSetArg.lastLoginAt as Date;
      expect(newLastLoginAt).toBeInstanceOf(Date);
      expect(newLastLoginAt.getTime()).toBeGreaterThan(originalLastLoginAt.getTime());
    });

    it("passes the correct where-condition (id column)", async () => {
      const identity = await createUserIdentity({
        userId:   "u1",
        provider: "okta",
        subject:  "sub-1",
      });

      seedSelectByProviderSubject("okta", "sub-1");
      await touchUserIdentity(identity.id);

      const expectedCond = eq(mockSchema.userIdentities.id as never, identity.id);
      expect(capturedWhereArg).toEqual(expectedCond);
    });

    it("does not corrupt other rows in the store", async () => {
      const id1 = await createUserIdentity({ userId: "u1", provider: "okta", subject: "s1" });
      await createUserIdentity({ userId: "u2", provider: "okta", subject: "s2" });

      // Only seed the row for id1 — simulate DB filtering by id
      seededSelectRows = insertedRows.filter((r) => r.id === id1.id);
      await touchUserIdentity(id1.id);

      // Row for s2 must be untouched in insertedRows
      const row2 = insertedRows.find((r) => r.subject === "s2");
      expect(row2).toBeDefined();
      expect(row2!.userId).toBe("u2");
    });
  });

  // ----------------------------------------------------------------
  describe("listUserIdentities", () => {
    it("returns every identity seeded for the user", async () => {
      await createUserIdentity({ userId: "u1", provider: "okta", subject: "s1", email: "a@b.co" });
      await createUserIdentity({ userId: "u1", provider: "github", subject: "s2" });

      seedSelectByUserId("u1");
      const rows = await listUserIdentities("u1");

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.provider).sort()).toEqual(["github", "okta"]);
    });

    it("returns an empty array when the user has no identities", async () => {
      seededSelectRows = [];
      const rows = await listUserIdentities("u-none");
      expect(rows).toEqual([]);
    });

    it("passes the correct where-condition (userId column)", async () => {
      seededSelectRows = [];
      await listUserIdentities("u-sentinel");

      const expectedCond = eq(mockSchema.userIdentities.userId as never, "u-sentinel");
      expect(capturedWhereArg).toEqual(expectedCond);
    });
  });

  // ----------------------------------------------------------------
  describe("deleteUserIdentity", () => {
    it("calls db.delete", async () => {
      await deleteUserIdentity("identity-1");
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("passes the correct where-condition (id column)", async () => {
      await deleteUserIdentity("identity-42");

      const expectedCond = eq(mockSchema.userIdentities.id as never, "identity-42");
      expect(capturedWhereArg).toEqual(expectedCond);
    });
  });
});
