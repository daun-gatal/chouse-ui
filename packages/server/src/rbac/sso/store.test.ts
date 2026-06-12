import { describe, it, expect, mock, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";

// ------------------------------------------------------------------
// Mock schema — opaque sentinel objects, no real Drizzle columns.
// The production code receives these objects as column references and
// passes them straight into eq(); we never inspect their shape.
// The store touches ssoSettings, ssoProviders, and userIdentities.
// ------------------------------------------------------------------

const mockSchema = {
  ssoSettings: {
    id:               { _col: "id" },
    enabled:          { _col: "enabled" },
    baseUrl:          { _col: "baseUrl" },
    defaultRole:      { _col: "defaultRole" },
    autoLinkByEmail:  { _col: "autoLinkByEmail" },
    updatedAt:        { _col: "updatedAt" },
    updatedBy:        { _col: "updatedBy" },
  },
  ssoProviders: {
    id:                    { _col: "id" },
    type:                  { _col: "type" },
    displayName:           { _col: "displayName" },
    issuer:                { _col: "issuer" },
    authorizationEndpoint: { _col: "authorizationEndpoint" },
    tokenEndpoint:         { _col: "tokenEndpoint" },
    userinfoEndpoint:      { _col: "userinfoEndpoint" },
    clientId:              { _col: "clientId" },
    clientSecretEncrypted: { _col: "clientSecretEncrypted" },
    scopes:                { _col: "scopes" },
    claimMapping:          { _col: "claimMapping" },
    roleMappingClaim:      { _col: "roleMappingClaim" },
    roleMapping:           { _col: "roleMapping" },
    enabled:               { _col: "enabled" },
    createdAt:             { _col: "createdAt" },
    updatedAt:             { _col: "updatedAt" },
    createdBy:             { _col: "createdBy" },
  },
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

type Row = Record<string, unknown>;

// Rows that the next select().from(...).where(...).limit(1) should return.
let seededSelectRows: Row[] = [];

// Rows that have been inserted (used to verify round-trip).
let insertedRows: Row[] = [];

// Tables that db.delete() was called against.
let deletedTables: unknown[] = [];

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
  delete: mock((table: unknown) => {
    deletedTables.push(table);
    return makeDeleteBuilder();
  }),
};

// ------------------------------------------------------------------
// Wire up the mocks before importing the module under test
// ------------------------------------------------------------------

mock.module("../db", () => ({
  getDatabase: () => mockDb,
  getSchema:   () => mockSchema,
}));

mock.module("../services/connections", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

// ------------------------------------------------------------------
// Import the module under test (AFTER mock registration)
// ------------------------------------------------------------------

import {
  getDbSettings,
  upsertDbSettings,
  listDbProviders,
  getDbProvider,
  createDbProvider,
  updateDbProvider,
  deleteDbProvider,
  decryptProviderSecret,
  countIdentitiesByProvider,
  listIdentityUserIdsByProvider,
  deleteIdentitiesByProvider,
} from "./store";

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("SSO DB Store", () => {
  beforeEach(() => {
    capturedWhereArg = undefined;
    capturedSetArg = {};
    seededSelectRows = [];
    insertedRows = [];
    deletedTables = [];
    mockDb.select.mockClear();
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();
  });

  // ----------------------------------------------------------------
  describe("createDbProvider", () => {
    it("encrypts the client secret and never stores plaintext", async () => {
      const row = await createDbProvider({
        id: "okta",
        type: "oidc",
        displayName: "Okta",
        issuer: "https://x",
        clientId: "cid",
        clientSecret: "sek",
        scopes: "openid",
        createdBy: "admin",
      });

      expect(row.clientSecretEncrypted).toBe("enc:sek");
      expect((row as Record<string, unknown>).clientSecret).toBeUndefined();
      expect(mockDb.insert).toHaveBeenCalled();
      // The inserted row carries the encrypted secret, no plaintext.
      expect(insertedRows[0].clientSecretEncrypted).toBe("enc:sek");
      expect(insertedRows[0].clientSecret).toBeUndefined();
    });

    it("defaults optional fields to null and enabled to true", async () => {
      const row = await createDbProvider({
        id: "g",
        type: "oauth2",
        displayName: "Google",
        clientId: "c",
        clientSecret: "s",
        scopes: "openid email",
      });

      expect(row.issuer).toBeNull();
      expect(row.authorizationEndpoint).toBeNull();
      expect(row.claimMapping).toBeNull();
      expect(row.enabled).toBe(true);
      expect(row.createdBy).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    });
  });

  // ----------------------------------------------------------------
  describe("listDbProviders", () => {
    it("returns the seeded rows verbatim", async () => {
      seededSelectRows = [
        { id: "okta", type: "oidc", clientSecretEncrypted: "enc:s" },
        { id: "google", type: "oauth2", clientSecretEncrypted: "enc:t" },
      ];
      const rows = await listDbProviders();
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe("okta");
      expect(rows[1].id).toBe("google");
    });

    it("returns an empty array when there are no providers", async () => {
      seededSelectRows = [];
      const rows = await listDbProviders();
      expect(rows).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  describe("getDbProvider", () => {
    it("round-trips a created provider when seeded", async () => {
      const created = await createDbProvider({
        id: "okta",
        type: "oidc",
        displayName: "Okta",
        issuer: "https://x",
        clientId: "c",
        clientSecret: "s",
        scopes: "openid",
      });

      seededSelectRows = [created];
      const row = await getDbProvider("okta");

      expect(row).not.toBeNull();
      expect(row!.id).toBe("okta");
      expect(row!.clientSecretEncrypted).toBe("enc:s");
    });

    it("returns null when the provider is not found", async () => {
      seededSelectRows = [];
      const row = await getDbProvider("nope");
      expect(row).toBeNull();
    });

    it("passes the correct where-condition (id column)", async () => {
      seededSelectRows = [];
      await getDbProvider("okta");
      const expected = eq(mockSchema.ssoProviders.id as never, "okta");
      expect(capturedWhereArg).toEqual(expected);
    });
  });

  // ----------------------------------------------------------------
  describe("updateDbProvider", () => {
    it("re-encrypts the secret when clientSecret is patched", async () => {
      await updateDbProvider("okta", { clientSecret: "new", displayName: "New Name" });
      expect(mockDb.update).toHaveBeenCalled();
      expect(capturedSetArg.clientSecretEncrypted).toBe("enc:new");
      expect(capturedSetArg.clientSecret).toBeUndefined();
      expect(capturedSetArg.displayName).toBe("New Name");
      expect(capturedSetArg.updatedAt).toBeInstanceOf(Date);
      expect(capturedWhereArg).toEqual(eq(mockSchema.ssoProviders.id as never, "okta"));
    });

    it("does not set clientSecretEncrypted when secret is not patched", async () => {
      await updateDbProvider("okta", { displayName: "Renamed" });
      expect(capturedSetArg.clientSecretEncrypted).toBeUndefined();
      expect(capturedSetArg.displayName).toBe("Renamed");
    });
  });

  // ----------------------------------------------------------------
  describe("upsertDbSettings", () => {
    it("inserts when no settings exist", async () => {
      seededSelectRows = []; // getDbSettings returns null
      const row = await upsertDbSettings(
        { enabled: true, baseUrl: "https://app", defaultRole: "viewer", autoLinkByEmail: true },
        "admin",
      );
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(row.id).toBe("default");
      expect(row.enabled).toBe(true);
      expect(row.updatedBy).toBe("admin");
      expect(insertedRows[0].enabled).toBe(true);
    });

    it("updates when settings already exist", async () => {
      seededSelectRows = [
        { id: "default", enabled: false, baseUrl: null, defaultRole: "viewer", autoLinkByEmail: true },
      ];
      const row = await upsertDbSettings(
        { enabled: true, baseUrl: "https://app", defaultRole: "admin", autoLinkByEmail: false },
        "admin",
      );
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(capturedSetArg.enabled).toBe(true);
      expect(capturedSetArg.defaultRole).toBe("admin");
      expect(row.autoLinkByEmail).toBe(false);
      expect(capturedWhereArg).toEqual(eq(mockSchema.ssoSettings.id as never, "default"));
    });
  });

  // ----------------------------------------------------------------
  describe("getDbSettings", () => {
    it("returns the seeded row", async () => {
      seededSelectRows = [{ id: "default", enabled: true, defaultRole: "viewer" }];
      const row = await getDbSettings();
      expect(row).not.toBeNull();
      expect(row!.enabled).toBe(true);
    });

    it("returns null when no settings exist", async () => {
      seededSelectRows = [];
      const row = await getDbSettings();
      expect(row).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  describe("decryptProviderSecret", () => {
    it("decrypts the stored encrypted secret", () => {
      const secret = decryptProviderSecret({ clientSecretEncrypted: "enc:hello" });
      expect(secret).toBe("hello");
    });
  });

  // ----------------------------------------------------------------
  describe("countIdentitiesByProvider", () => {
    it("returns the number of identity rows for the provider", async () => {
      seededSelectRows = [{ id: "i1" }, { id: "i2" }, { id: "i3" }];
      const count = await countIdentitiesByProvider("okta");
      expect(count).toBe(3);
    });

    it("returns 0 when no identities exist", async () => {
      seededSelectRows = [];
      const count = await countIdentitiesByProvider("okta");
      expect(count).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  describe("listIdentityUserIdsByProvider", () => {
    it("maps rows to userIds", async () => {
      seededSelectRows = [{ userId: "u1" }, { userId: "u2" }];
      const ids = await listIdentityUserIdsByProvider("okta");
      expect(ids).toEqual(["u1", "u2"]);
    });
  });

  // ----------------------------------------------------------------
  describe("deleteIdentitiesByProvider", () => {
    it("returns the affected userIds and calls db.delete", async () => {
      seededSelectRows = [{ userId: "u1" }, { userId: "u2" }];
      const ids = await deleteIdentitiesByProvider("okta");

      expect(ids).toEqual(["u1", "u2"]);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(deletedTables[0]).toBe(mockSchema.userIdentities);
    });
  });

  // ----------------------------------------------------------------
  describe("deleteDbProvider", () => {
    it("calls db.delete against the providers table", async () => {
      await deleteDbProvider("okta");
      expect(mockDb.delete).toHaveBeenCalled();
      expect(deletedTables[0]).toBe(mockSchema.ssoProviders);
      const expected = eq(mockSchema.ssoProviders.id as never, "okta");
      expect(capturedWhereArg).toEqual(expected);
    });
  });
});
