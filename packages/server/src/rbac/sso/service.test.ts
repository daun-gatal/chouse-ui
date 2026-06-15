/**
 * SSO Provisioning Service — unit tests
 *
 * All external dependencies are mocked via mock.module so tests run in
 * isolation without a real database, ClickHouse, or IdP.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// ============================================================
// Mock state — mutated per test in beforeEach / inside tests
// ============================================================

// identity.ts mocks
let mockGetUserIdentityResult: Record<string, unknown> | null = null;
let mockGetUserByEmailResult: Record<string, unknown> | null = null;
let mockGetUserByUsernameResults: Map<string, Record<string, unknown> | null> = new Map();
// Either a fixed role (returned for any name) or a name-aware resolver — the
// latter lets a test map several group→role names to distinct roles. Reset in
// beforeEach so it never leaks across tests.
type RoleResolver = (name: string) => Record<string, unknown> | null;
let mockGetRoleByNameResult: Record<string, unknown> | null | RoleResolver = null;
let mockGetUserRolesResult: string[] = [];
let mockCreateUserResult: Record<string, unknown> = {
  id: "new-user-id",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  isActive: true,
  roles: [],
  permissions: [],
  lastLoginAt: null,
  createdAt: new Date(),
};
let mockCreateSessionResult: Record<string, unknown> = {
  user: { id: "u1", email: "alice@example.com", username: "alice", roles: [], permissions: [], isActive: true, displayName: "Alice", avatarUrl: null, lastLoginAt: null, createdAt: new Date() },
  tokens: { accessToken: "access-tok", refreshToken: "refresh-tok", expiresIn: 900 },
};

// DB state for user row fetch (used by service.ts for direct db.select())
let mockDbUserRow: Record<string, unknown> | null = {
  id: "u1",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// mutable config so individual tests can override autoLinkByEmail etc.
const baseSsoConfig = {
  enabled: true,
  baseUrl: "https://app.example.com",
  defaultRole: "viewer",
  autoLinkByEmail: true,
  providers: new Map(),
};
let currentSsoConfig = { ...baseSsoConfig };

// Track calls for assertions
const mockFns = {
  getUserIdentity: mock(async (_p: string, _s: string) => mockGetUserIdentityResult),
  createUserIdentity: mock(async (_input: unknown) => ({ id: "identity-id", userId: "u1", provider: "okta", subject: "sub-1", email: null, createdAt: new Date(), lastLoginAt: new Date() })),
  touchUserIdentity: mock(async (_id: string) => undefined),
  getUserByEmail: mock(async (_e: string) => mockGetUserByEmailResult),
  getUserByUsername: mock(async (u: string) => mockGetUserByUsernameResults.get(u) ?? null),
  getRoleByName: mock(async (n: string) =>
    typeof mockGetRoleByNameResult === "function" ? mockGetRoleByNameResult(n) : mockGetRoleByNameResult),
  getUserRoles: mock(async (_id: string) => mockGetUserRolesResult),
  createUser: mock(async (_input: unknown) => mockCreateUserResult),
  createSessionAndTokens: mock(async (_u: unknown, _ip?: string, _ua?: string) => mockCreateSessionResult),
};

// DB mock for direct drizzle usage in service.ts (user row fetch + role sync)
let mockDbInsertValues: unknown[] = [];

function makeSelectBuilder(resolveWith: unknown[]): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  b.from = mock(() => b);
  b.where = mock(() => b);
  b.limit = mock(() => b);
  b.then = mock((resolve: (v: unknown) => void) => resolve(resolveWith));
  return b;
}

function makeDeleteBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  b.where = mock(() => b);
  b.then = mock((resolve: (v: unknown) => void) => resolve(undefined));
  return b;
}

function makeInsertBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  b.values = mock((v: unknown) => {
    mockDbInsertValues.push(v);
    return b;
  });
  // Role sync upserts (insert ... on conflict (user_id) do update) so it never
  // leaves the user role-less mid-sync.
  b.onConflictDoUpdate = mock(() => b);
  b.then = mock((resolve: (v: unknown) => void) => resolve(undefined));
  return b;
}

const mockDb = {
  select: mock(() => makeSelectBuilder(mockDbUserRow ? [mockDbUserRow] : [])),
  delete: mock(() => makeDeleteBuilder()),
  insert: mock(() => makeInsertBuilder()),
};

const mockSchema = {
  users: { id: { _col: "id" }, isActive: { _col: "isActive" } },
  userRoles: { userId: { _col: "userId" } },
};

// ============================================================
// Wire up mocks BEFORE importing module under test
// ============================================================

mock.module("./identity", () => ({
  getUserIdentity: mockFns.getUserIdentity,
  createUserIdentity: mockFns.createUserIdentity,
  touchUserIdentity: mockFns.touchUserIdentity,
}));

mock.module("../services/rbac", () => ({
  getUserByEmail: mockFns.getUserByEmail,
  getUserByUsername: mockFns.getUserByUsername,
  getRoleByName: mockFns.getRoleByName,
  getUserRoles: mockFns.getUserRoles,
  createUser: mockFns.createUser,
  createSessionAndTokens: mockFns.createSessionAndTokens,
}));

// config mock reads from the mutable currentSsoConfig variable
mock.module("./config", () => ({
  getSsoConfig: () => currentSsoConfig,
}));

mock.module("../db", () => ({
  getDatabase: () => mockDb,
  getSchema: () => mockSchema,
  isSqlite: () => true,
}));

// ============================================================
// Import module under test (AFTER mock registration)
// ============================================================

import { provisionSsoUser } from "./service";
import type { SsoProviderConfig } from "./config";
import type { SsoIdentity } from "./client";

// ============================================================
// Test fixtures
// ============================================================

function makeProvider(overrides: Partial<SsoProviderConfig> = {}): SsoProviderConfig {
  return {
    id: "okta",
    type: "oidc",
    displayName: "Okta",
    clientId: "client-id",
    clientSecret: "client-secret",
    scopes: "openid email profile",
    issuer: "https://okta.example.com",
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<SsoIdentity> = {}): SsoIdentity {
  return {
    provider: "okta",
    subject: "sub-alice",
    email: "alice@example.com",
    emailVerified: true,
    username: "alice",
    displayName: "Alice",
    claims: {},
    ...overrides,
  };
}

const existingIdentityRow = {
  id: "identity-row-id",
  userId: "u1",
  provider: "okta",
  subject: "sub-alice",
  email: "alice@example.com",
  createdAt: new Date(),
  lastLoginAt: new Date(),
};

const existingUserRow = {
  id: "u1",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ============================================================
// beforeEach — reset all mock state
// ============================================================

beforeEach(() => {
  // Reset return values to defaults
  mockGetUserIdentityResult = null;
  mockGetUserByEmailResult = null;
  mockGetUserByUsernameResults = new Map();
  mockGetRoleByNameResult = { id: "role-viewer", name: "viewer", displayName: "Viewer", isDefault: true };
  mockGetUserRolesResult = ["viewer"];
  mockCreateUserResult = {
    id: "new-user-id",
    email: "alice@example.com",
    username: "alice",
    displayName: "Alice",
    isActive: true,
    roles: [],
    permissions: [],
    lastLoginAt: null,
    createdAt: new Date(),
  };
  mockCreateSessionResult = {
    user: { id: "u1", email: "alice@example.com", username: "alice", roles: [], permissions: [], isActive: true, displayName: "Alice", avatarUrl: null, lastLoginAt: null, createdAt: new Date() },
    tokens: { accessToken: "access-tok", refreshToken: "refresh-tok", expiresIn: 900 },
  };
  mockDbUserRow = { ...existingUserRow };
  mockDbInsertValues = [];

  // reset config to defaults
  currentSsoConfig = { ...baseSsoConfig };

  // Clear all call tracking
  for (const fn of Object.values(mockFns)) {
    fn.mockClear();
  }
  mockDb.select.mockClear();
  mockDb.delete.mockClear();
  mockDb.insert.mockClear();
});

// ============================================================
// Tests
// ============================================================

describe("provisionSsoUser", () => {
  // ----------------------------------------------------------------
  // Test 1: existing identity link
  // ----------------------------------------------------------------
  it("1. existing identity → returns that user's session; touchUserIdentity called; createUser/createUserIdentity NOT called", async () => {
    mockGetUserIdentityResult = existingIdentityRow;

    const result = await provisionSsoUser(makeProvider(), makeIdentity());

    expect(mockFns.touchUserIdentity).toHaveBeenCalledWith(existingIdentityRow.id);
    expect(mockFns.createUser).not.toHaveBeenCalled();
    expect(mockFns.createUserIdentity).not.toHaveBeenCalled();
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
    expect(result).toEqual({ ...mockCreateSessionResult, outcome: "authenticated" });
  });

  // ----------------------------------------------------------------
  // Test 2: no identity + autoLinkByEmail + verified email
  // ----------------------------------------------------------------
  it("2. no identity + autoLinkByEmail + verified email → createUserIdentity called with userId/provider/subject; returns linked user's session", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = existingUserRow;

    const identity = makeIdentity({ emailVerified: true });
    const result = await provisionSsoUser(makeProvider(), identity);

    expect(mockFns.createUserIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: existingUserRow.id,
        provider: "okta",
        subject: identity.subject,
        email: identity.email,
      })
    );
    expect(mockFns.createUser).not.toHaveBeenCalled();
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
    // Auto-link by email is a distinct, auditable outcome.
    expect(result.outcome).toBe("linked");
  });

  // ----------------------------------------------------------------
  // Test 3: email match but emailVerified: false → NOT linked, JIT create
  // ----------------------------------------------------------------
  it("3. email match but emailVerified false → falls through to JIT create", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = existingUserRow; // would match by email
    // getUserByUsername returns null (username free)
    mockGetUserByUsernameResults.set("alice", null);
    // createUser returns a new user with an id
    const newUser = { ...existingUserRow, id: "new-jit-id" };
    mockCreateUserResult = { ...newUser, roles: [], permissions: [], lastLoginAt: null };
    mockDbUserRow = newUser;

    const identity = makeIdentity({ emailVerified: false });
    const result = await provisionSsoUser(makeProvider(), identity);

    // Should NOT link to existing user by email
    // Should call createUser instead (JIT)
    expect(mockFns.createUser).toHaveBeenCalled();
    // createUserIdentity should be called for the new JIT user, not the existing one
    expect(mockFns.createUserIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "new-jit-id" })
    );
    // A JIT-provisioned account is a distinct, auditable outcome.
    expect(result.outcome).toBe("created");
  });

  // ----------------------------------------------------------------
  // Test 4: autoLinkByEmail disabled → NOT linked, JIT create (Fix 2)
  // ----------------------------------------------------------------
  it("4. autoLinkByEmail disabled → getUserByEmail NOT called; JIT-creates new user even with matching verified email", async () => {
    // use the mutable config variable to truly disable autoLinkByEmail
    currentSsoConfig = { ...baseSsoConfig, autoLinkByEmail: false };

    mockGetUserIdentityResult = null;
    // Email exists in the system — but should NOT be consulted
    mockGetUserByEmailResult = existingUserRow;
    mockGetUserByUsernameResults.set("alice", null);
    const newUser = { ...existingUserRow, id: "jit-id" };
    mockCreateUserResult = { ...newUser, roles: [], permissions: [], lastLoginAt: null };
    mockDbUserRow = newUser;

    const identity = makeIdentity({ emailVerified: true });
    await provisionSsoUser(makeProvider(), identity);

    // autoLinkByEmail is false → getUserByEmail must NOT be called
    expect(mockFns.getUserByEmail).not.toHaveBeenCalled();
    // Must JIT-create instead
    expect(mockFns.createUser).toHaveBeenCalled();
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Test 5: JIT create — correct arguments
  // ----------------------------------------------------------------
  it("5. JIT create: createUser called with identity email, sanitized username, roleIds of default role; createUserIdentity called for new user", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = null;
    mockGetUserByUsernameResults.set("alice", null);
    const newUser = { ...existingUserRow, id: "jit-user-id" };
    mockCreateUserResult = { ...newUser, roles: [], permissions: [], lastLoginAt: null };
    mockDbUserRow = newUser;

    const identity = makeIdentity({ email: "alice@example.com", username: "alice" });
    await provisionSsoUser(makeProvider(), identity);

    expect(mockFns.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        username: "alice",
        roleIds: ["role-viewer"],
      })
    );
    expect(mockFns.createUserIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "jit-user-id",
        provider: "okta",
        subject: "sub-alice",
      })
    );
  });

  // ----------------------------------------------------------------
  // Test 6: username collision → suffix '2'
  // ----------------------------------------------------------------
  it("6. username collision: getUserByUsername('alice') taken, 'alice2' free → createUser called with 'alice2'", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = null;
    // 'alice' is taken, 'alice2' is free
    mockGetUserByUsernameResults.set("alice", { id: "other-user", username: "alice" });
    mockGetUserByUsernameResults.set("alice2", null);
    const newUser = { ...existingUserRow, id: "jit-user-2" };
    mockCreateUserResult = { ...newUser, username: "alice2", roles: [], permissions: [], lastLoginAt: null };
    mockDbUserRow = newUser;

    const identity = makeIdentity({ username: "alice" });
    await provisionSsoUser(makeProvider(), identity);

    expect(mockFns.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: "alice2" })
    );
  });

  // ----------------------------------------------------------------
  // Test 7: inactive user → throws; touchUserIdentity NOT called (Fix 5)
  // ----------------------------------------------------------------
  it("7. inactive user (existing identity) → throws AppError with /inactive/i; touchUserIdentity and createSessionAndTokens NOT called", async () => {
    mockGetUserIdentityResult = existingIdentityRow;
    mockDbUserRow = { ...existingUserRow, isActive: false };

    await expect(
      provisionSsoUser(makeProvider(), makeIdentity())
    ).rejects.toThrow(/inactive/i);

    // inactive check fires before touchUserIdentity
    expect(mockFns.touchUserIdentity).not.toHaveBeenCalled();
    expect(mockFns.createSessionAndTokens).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Test 8: role re-sync via roleMapping (Fix 7 hygiene)
  // ----------------------------------------------------------------
  it("8. role re-sync: roleMappingClaim 'groups', mapping ch-admins→admin, claims {groups:['ch-admins']} → atomic upsert with admin role id and assignedBy='sso:okta' (no delete)", async () => {
    mockGetUserIdentityResult = existingIdentityRow;
    mockDbUserRow = { ...existingUserRow };
    mockGetUserRolesResult = ["viewer"]; // current roles differ from mapped
    mockGetRoleByNameResult = { id: "role-admin", name: "admin", displayName: "Admin" };

    const provider = makeProvider({
      roleMappingClaim: "groups",
      roleMapping: { "ch-admins": "admin" },
    });
    const identity = makeIdentity({ claims: { groups: ["ch-admins"] } });

    await provisionSsoUser(provider, identity);

    // Role sync is an atomic upsert — no delete-then-insert lockout window.
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();

    // assert upserted row has the correct roleId and assignedBy
    const inserted = mockDbInsertValues[0];
    const insertedArr = Array.isArray(inserted) ? inserted : [inserted];
    expect(insertedArr.some((r: unknown) => (r as Record<string, unknown>).roleId === "role-admin")).toBe(true);
    expect(insertedArr.some((r: unknown) => (r as Record<string, unknown>).assignedBy === "sso:okta")).toBe(true);
  });

  // ----------------------------------------------------------------
  // Test 8b: multi-group claim → collapse to highest-privilege role (#261)
  // ----------------------------------------------------------------
  it("8b. multi-role mapping: claims {groups:['devs','admins']} mapping to developer+admin → upserts ONE role (admin, highest privilege)", async () => {
    mockGetUserIdentityResult = existingIdentityRow;
    mockDbUserRow = { ...existingUserRow };
    mockGetUserRolesResult = ["viewer"];
    // Resolve each mapped name to its own role (data-driven, reset in beforeEach).
    mockGetRoleByNameResult = (name: string) => {
      if (name === "admin") return { id: "role-admin", name: "admin", displayName: "Admin" };
      if (name === "developer") return { id: "role-developer", name: "developer", displayName: "Developer" };
      return null;
    };

    const provider = makeProvider({
      roleMappingClaim: "groups",
      roleMapping: { devs: "developer", admins: "admin" },
    });
    const identity = makeIdentity({ claims: { groups: ["devs", "admins"] } });

    await provisionSsoUser(provider, identity);

    // Exactly one role upserted, and it's the highest-privilege one (admin).
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDbInsertValues.length).toBe(1);
    const inserted = mockDbInsertValues[0];
    const insertedArr = Array.isArray(inserted) ? inserted : [inserted];
    expect(insertedArr.length).toBe(1);
    expect((insertedArr[0] as Record<string, unknown>).roleId).toBe("role-admin");
  });

  // ----------------------------------------------------------------
  // Test 9: mapping yields no known roles → roles NOT replaced
  // ----------------------------------------------------------------
  it("9. mapping yields no known roles → db delete/insert NOT called", async () => {
    mockGetUserIdentityResult = existingIdentityRow;
    mockDbUserRow = { ...existingUserRow };
    mockGetUserRolesResult = ["viewer"];
    mockGetRoleByNameResult = null; // no role found for the mapped name

    const provider = makeProvider({
      roleMappingClaim: "groups",
      roleMapping: { "unknown-group": "nonexistent-role" },
    });
    const identity = makeIdentity({ claims: { groups: ["unknown-group"] } });

    await provisionSsoUser(provider, identity);

    // Roles not replaced
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    // Session still created
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Test 10: JIT create with no email → throws mentioning 'email'
  // ----------------------------------------------------------------
  it("10. JIT create with no email on identity → throws with message mentioning 'email'", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = null;

    const identity = makeIdentity({ email: null });

    await expect(
      provisionSsoUser(makeProvider(), identity)
    ).rejects.toThrow(/email/i);
  });

  // ----------------------------------------------------------------
  // Test 11: Fix 1 — super_admin user skips role sync entirely
  // ----------------------------------------------------------------
  it("11. super_admin user: role mapping resolves to viewer → db delete/insert NOT called; session still created", async () => {
    mockGetUserIdentityResult = existingIdentityRow;
    mockDbUserRow = { ...existingUserRow };
    // Current roles include super_admin
    mockGetUserRolesResult = ["super_admin"];
    // Mapping would resolve to viewer
    mockGetRoleByNameResult = { id: "role-viewer", name: "viewer", displayName: "Viewer" };

    const provider = makeProvider({
      roleMappingClaim: "groups",
      roleMapping: { "regular-users": "viewer" },
    });
    const identity = makeIdentity({ claims: { groups: ["regular-users"] } });

    await provisionSsoUser(provider, identity);

    // Must NOT touch roles for super_admin
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    // Session is still created
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Test 12: Fix 3 — JIT race: createUser unique violation → re-resolve
  // ----------------------------------------------------------------
  it("12. JIT race: createUser throws UNIQUE error, getUserIdentity returns winner's identity on retry → session created for winner", async () => {
    mockGetUserIdentityResult = null; // first call: no existing identity
    mockGetUserByEmailResult = null;
    mockGetUserByUsernameResults.set("alice", null);

    const winnerIdentity = { ...existingIdentityRow, userId: "winner-id" };
    const winnerUserRow = { ...existingUserRow, id: "winner-id" };

    // createUser throws unique constraint error
    mockFns.createUser.mockImplementation(async () => {
      throw new Error("UNIQUE constraint failed: rbac_users.email");
    });

    // On second call to getUserIdentity (re-resolve), return the winner's identity
    let getUserIdentityCallCount = 0;
    mockFns.getUserIdentity.mockImplementation(async (_p: string, _s: string) => {
      getUserIdentityCallCount++;
      if (getUserIdentityCallCount === 1) return null; // initial check
      return winnerIdentity; // re-resolve after race
    });

    // db.select returns winner's user row (for the re-resolved identity lookup)
    mockDbUserRow = winnerUserRow;

    const identity = makeIdentity();
    const result = await provisionSsoUser(makeProvider(), identity);

    // Session should be created — using the winner's row
    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
    expect(result).toEqual({ ...mockCreateSessionResult, outcome: "authenticated" });
    // getUserIdentity was called twice: once initial, once to re-resolve
    expect(getUserIdentityCallCount).toBe(2);
  });

  // ----------------------------------------------------------------
  // Test 13: Postgres unique violation detected via SQLSTATE 23505
  // ----------------------------------------------------------------
  it("13. JIT race: Postgres error code 23505 (message without 'unique') is treated as unique violation → re-resolve", async () => {
    mockGetUserIdentityResult = null;
    mockGetUserByEmailResult = null;
    mockGetUserByUsernameResults.set("alice", null);

    const winnerIdentity = { ...existingIdentityRow, userId: "winner-pg-id" };
    const winnerUserRow = { ...existingUserRow, id: "winner-pg-id" };

    // Postgres-style error: SQLSTATE on `code`, message need not mention "unique"
    mockFns.createUser.mockImplementation(async () => {
      const err = new Error(
        'duplicate key value violates constraint "rbac_users_email_key"'
      ) as Error & { code?: string };
      err.code = "23505";
      throw err;
    });

    let getUserIdentityCallCount = 0;
    mockFns.getUserIdentity.mockImplementation(async (_p: string, _s: string) => {
      getUserIdentityCallCount++;
      if (getUserIdentityCallCount === 1) return null;
      return winnerIdentity;
    });

    mockDbUserRow = winnerUserRow;

    const result = await provisionSsoUser(makeProvider(), makeIdentity());

    expect(mockFns.createSessionAndTokens).toHaveBeenCalled();
    expect(result).toEqual({ ...mockCreateSessionResult, outcome: "authenticated" });
    expect(getUserIdentityCallCount).toBe(2);
  });

  // ----------------------------------------------------------------
  // Test 14: SECURITY — unverified email collides with a pre-existing foreign
  // account (no identity created). Must fail closed, never re-resolve by email.
  // ----------------------------------------------------------------
  it("14. JIT unique violation with NO matching identity (foreign email collision) → throws, no session, no email re-resolve", async () => {
    // A local account already owns this email — getUserByEmail would resolve to it.
    mockGetUserByEmailResult = existingUserRow;
    mockGetUserByUsernameResults.set("alice", null);

    // createUser collides on the existing account's unique email.
    mockFns.createUser.mockImplementation(async () => {
      throw new Error("UNIQUE constraint failed: rbac_users.email");
    });

    // No identity is ever found: attacker's first login, no link was created.
    mockFns.getUserIdentity.mockImplementation(async () => null);

    // Attacker-controlled, UNVERIFIED email matching the victim's account.
    const identity = makeIdentity({ emailVerified: false });
    await expect(provisionSsoUser(makeProvider(), identity)).rejects.toThrow();

    // No session was minted for the victim's account …
    expect(mockFns.createSessionAndTokens).not.toHaveBeenCalled();
    // … and the email-based re-resolution path is gone (step 2 skipped it for
    // the unverified email; the catch must not call it either).
    expect(mockFns.getUserByEmail).not.toHaveBeenCalled();
  });
});
