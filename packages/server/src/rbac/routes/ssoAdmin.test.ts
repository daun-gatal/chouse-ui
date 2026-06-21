import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
// NOTE: Mocks MUST be declared BEFORE importing the routes under test.

// ---- SSO store mock ----
const mockGetDbSettings = mock(async () => null as unknown);
const mockUpsertDbSettings = mock(async () => ({}));
const mockListDbProviders = mock(async () => [] as Array<Record<string, unknown>>);
const mockGetDbProvider = mock(async () => null as unknown);
const mockCreateDbProvider = mock(async () => ({}));
const mockUpdateDbProvider = mock(async () => {});
const mockDeleteDbProvider = mock(async () => {});
const mockCountIdentitiesByProvider = mock(async () => 0);
const mockDeleteIdentitiesByProvider = mock(async () => [] as string[]);

mock.module("../sso/store", () => ({
  getDbSettings: mockGetDbSettings,
  upsertDbSettings: mockUpsertDbSettings,
  listDbProviders: mockListDbProviders,
  getDbProvider: mockGetDbProvider,
  decryptProviderSecret: mock(() => "stored-secret"),
  createDbProvider: mockCreateDbProvider,
  updateDbProvider: mockUpdateDbProvider,
  deleteDbProvider: mockDeleteDbProvider,
  countIdentitiesByProvider: mockCountIdentitiesByProvider,
  deleteIdentitiesByProvider: mockDeleteIdentitiesByProvider,
}));

// ---- SSO config mock ----
// getSsoConfig returns a config carrying one env provider ('google', source 'config').
let mockSsoConfig = {
  enabled: false,
  baseUrl: "http://localhost:5521",
  defaultRole: "viewer",
  autoLinkByEmail: true,
  providers: new Map<string, Record<string, unknown>>([
    ["google", { id: "google", type: "oidc", displayName: "Google", source: "config" }],
  ]),
};
const mockRefreshSsoConfig = mock(async () => {});
// Controls whether env/YAML "provides" SSO settings (the read-only layer).
let mockEnvSsoEnabled = false;

mock.module("../sso/config", () => ({
  getSsoConfig: mock(() => mockSsoConfig),
  refreshSsoConfig: mockRefreshSsoConfig,
  loadSsoConfig: mock(() => ({ enabled: mockEnvSsoEnabled })),
}));

// ---- SSO test service mock ----
const mockTestProviderConfig = mock(async () => ({ ok: true }) as { ok: boolean } & Record<string, unknown>);
mock.module("../sso/test", () => ({
  testProviderConfig: mockTestProviderConfig,
}));

// ---- Audit mock ----
const mockCreateAuditLogWithContext = mock(async () => {});
const mockUserHasPermission = mock(async () => false);
mock.module("../services/rbac", () => ({
  createAuditLogWithContext: mockCreateAuditLogWithContext,
  userHasPermission: mockUserHasPermission,
}));

// ---- JWT mock so the real requirePermission middleware passes ----
let mockTokenPayload = {
  sub: "admin-id",
  roles: ["super_admin"],
  permissions: ["sso:view", "sso:edit", "sso:delete"],
  sessionId: "sess-1",
};
mock.module("../services/jwt", () => ({
  verifyAccessToken: mock(async () => mockTokenPayload),
  extractTokenFromHeader: mock((h: string | undefined) => (h ? "valid_token" : null)),
  verifyRefreshToken: mock(async () => mockTokenPayload),
}));

import ssoAdminRoutes from "./ssoAdmin";
import { errorHandler } from "../../middleware/error";

const AUTH = { Authorization: "Bearer token" };
const JSON_AUTH = { "Content-Type": "application/json", Authorization: "Bearer token" };

function makeDbProvider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "okta",
    type: "oidc",
    displayName: "Okta",
    issuer: "https://okta.example.com",
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userinfoEndpoint: null,
    clientId: "cid",
    clientSecretEncrypted: "enc:secret",
    scopes: "openid",
    claimMapping: null,
    roleMappingClaim: null,
    roleMapping: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "admin-id",
    ...overrides,
  };
}

describe("RBAC SSO Admin Routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
    app.route("/sso-admin", ssoAdminRoutes);

    mockGetDbSettings.mockReset().mockResolvedValue(null);
    mockUpsertDbSettings.mockReset().mockResolvedValue({});
    mockListDbProviders.mockReset().mockResolvedValue([]);
    mockGetDbProvider.mockReset().mockResolvedValue(null);
    mockCreateDbProvider.mockReset().mockResolvedValue({});
    mockUpdateDbProvider.mockReset().mockResolvedValue(undefined);
    mockDeleteDbProvider.mockReset().mockResolvedValue(undefined);
    mockCountIdentitiesByProvider.mockReset().mockResolvedValue(0);
    mockDeleteIdentitiesByProvider.mockReset().mockResolvedValue([]);
    mockRefreshSsoConfig.mockClear();
    mockEnvSsoEnabled = false;
    mockTestProviderConfig.mockReset().mockResolvedValue({ ok: true });
    mockCreateAuditLogWithContext.mockClear();
    mockUserHasPermission.mockReset().mockResolvedValue(false);

    mockSsoConfig = {
      enabled: false,
      baseUrl: "http://localhost:5521",
      defaultRole: "viewer",
      autoLinkByEmail: true,
      providers: new Map<string, Record<string, unknown>>([
        ["google", { id: "google", type: "oidc", displayName: "Google", source: "config" }],
      ]),
    };

    mockTokenPayload = {
      sub: "admin-id",
      roles: ["super_admin"],
      permissions: ["sso:view", "sso:edit", "sso:delete"],
      sessionId: "sess-1",
    };
  });

  afterAll(() => {
    mock.restore();
  });

  describe("GET /settings", () => {
    it("returns source 'config' (read-only) when env provides settings and no DB row", async () => {
      mockEnvSsoEnabled = true;
      const res = await app.request("/sso-admin/settings", { headers: AUTH });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.source).toBe("config");
      expect(body.data.defaultRole).toBe("viewer");
    });

    it("returns source 'default' (editable) when nothing is configured yet", async () => {
      mockEnvSsoEnabled = false;
      const res = await app.request("/sso-admin/settings", { headers: AUTH });
      const body = await res.json();
      expect(body.data.source).toBe("default");
    });

    it("returns source 'database' when a DB row exists", async () => {
      mockGetDbSettings.mockResolvedValue({ id: "default" });
      const res = await app.request("/sso-admin/settings", { headers: AUTH });
      const body = await res.json();
      expect(body.data.source).toBe("database");
    });
  });

  describe("PUT /settings", () => {
    it("upserts, refreshes config, and audits", async () => {
      const res = await app.request("/sso-admin/settings", {
        method: "PUT",
        headers: JSON_AUTH,
        body: JSON.stringify({
          enabled: true,
          baseUrl: "https://app.example.com",
          defaultRole: "viewer",
          autoLinkByEmail: true,
        }),
      });
      expect(res.status).toBe(200);
      expect(mockUpsertDbSettings).toHaveBeenCalled();
      expect(mockRefreshSsoConfig).toHaveBeenCalled();
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "sso.settings_update",
        "admin-id",
        expect.objectContaining({ resourceType: "sso", resourceId: "settings" })
      );
    });

    it("rejects writes when env/YAML config provides settings (read-only)", async () => {
      mockEnvSsoEnabled = true; // env drives SSO, no DB row → read-only
      const res = await app.request("/sso-admin/settings", {
        method: "PUT",
        headers: JSON_AUTH,
        body: JSON.stringify({
          enabled: true,
          baseUrl: "https://app.example.com",
          defaultRole: "viewer",
          autoLinkByEmail: true,
        }),
      });
      expect(res.status).toBe(400);
      expect(mockUpsertDbSettings).not.toHaveBeenCalled();
    });

    it("allows editing an existing DB settings row even if env also provides config", async () => {
      mockEnvSsoEnabled = true;
      mockGetDbSettings.mockResolvedValue({ id: "default" });
      const res = await app.request("/sso-admin/settings", {
        method: "PUT",
        headers: JSON_AUTH,
        body: JSON.stringify({
          enabled: true,
          baseUrl: "https://app.example.com",
          defaultRole: "viewer",
          autoLinkByEmail: true,
        }),
      });
      expect(res.status).toBe(200);
      expect(mockUpsertDbSettings).toHaveBeenCalled();
    });

    it("rejects without sso:edit", async () => {
      // Token has sso:view but NOT sso:edit — fast-path check misses, falls
      // through to the DB check (userHasPermission) which is mocked to return
      // false, so requirePermission throws AppError.forbidden -> 403.
      mockTokenPayload.permissions = ["sso:view"];
      const res = await app.request("/sso-admin/settings", {
        method: "PUT",
        headers: JSON_AUTH,
        body: JSON.stringify({
          enabled: true,
          baseUrl: null,
          defaultRole: "viewer",
          autoLinkByEmail: true,
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /providers", () => {
    it("merges env providers (config) with masked DB providers (linkedUserCount, no secret)", async () => {
      mockListDbProviders.mockResolvedValue([makeDbProvider()]);
      mockCountIdentitiesByProvider.mockResolvedValue(3);

      const res = await app.request("/sso-admin/providers", { headers: AUTH });
      expect(res.status).toBe(200);
      const body = await res.json();
      const providers = body.data.providers as Array<Record<string, unknown>>;

      const env = providers.find((p) => p.id === "google");
      expect(env).toBeDefined();
      expect(env!.source).toBe("config");
      expect(env!.linkedUserCount).toBe(3);

      const db = providers.find((p) => p.id === "okta");
      expect(db).toBeDefined();
      expect(db!.source).toBe("database");
      expect(db!.hasSecret).toBe(true);
      expect(db!.linkedUserCount).toBe(3);
      expect(db!.clientSecretEncrypted).toBeUndefined();
    });
  });

  describe("POST /providers", () => {
    const validBody = {
      id: "newprov",
      type: "oidc",
      displayName: "New Provider",
      issuer: "https://idp.example.com",
      clientId: "cid",
      clientSecret: "supersecret",
      scopes: "openid",
    };

    it("rejects an id colliding with a config provider (400)", async () => {
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ ...validBody, id: "google" }),
      });
      expect(res.status).toBe(400);
      expect(mockCreateDbProvider).not.toHaveBeenCalled();
    });

    it("rejects an id colliding with an existing DB provider (400, no 500)", async () => {
      mockGetDbProvider.mockResolvedValue(makeDbProvider());
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(400);
      expect(mockCreateDbProvider).not.toHaveBeenCalled();
    });

    it("creates, refreshes, and audits without echoing the secret", async () => {
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
      expect(mockCreateDbProvider).toHaveBeenCalled();
      expect(mockRefreshSsoConfig).toHaveBeenCalled();

      const auditCall = mockCreateAuditLogWithContext.mock.calls.find(
        (call) => call[1] === "sso.provider_create"
      );
      expect(auditCall).toBeDefined();
      const details = (auditCall![3] as { details: Record<string, unknown> }).details;
      expect(details.clientSecretChanged).toBe(true);
      expect(JSON.stringify(details)).not.toContain("supersecret");
    });

    it("persists multiple role mappings (multi-group is allowed; login fails closed on overlap)", async () => {
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ ...validBody, id: "multi-map", roleMappingClaim: "groups", roleMapping: "admins:admin,devs:developer" }),
      });
      expect(res.status).toBe(201);
      const arg = mockCreateDbProvider.mock.calls.at(-1)![0] as unknown as { roleMapping?: string };
      expect(arg.roleMapping).toBe("admins:admin,devs:developer");
    });

    it("persists auth_params passed in the body", async () => {
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ ...validBody, id: "with-params", authParams: "hd:acme.com,prompt:consent" }),
      });
      expect(res.status).toBe(201);
      const arg = mockCreateDbProvider.mock.calls.at(-1)![0] as unknown as { authParams?: string };
      expect(arg.authParams).toBe("hd:acme.com,prompt:consent");
    });

    const validSamlBody = {
      id: "saml-idp",
      type: "saml",
      displayName: "SAML IdP",
      samlIdpEntityId: "https://idp.example.com/entity",
      samlIdpSsoUrl: "https://idp.example.com/sso",
      samlIdpCertificate: "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----",
      samlSpEntityId: "https://app.example.com/sp",
    };

    it("creates a SAML provider, passing the SAML fields to the store", async () => {
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify(validSamlBody),
      });
      expect(res.status).toBe(201);
      expect(mockCreateDbProvider).toHaveBeenCalled();
      const arg = mockCreateDbProvider.mock.calls.at(-1)![0] as unknown as {
        samlIdpEntityId?: string;
        type?: string;
      };
      expect(arg.type).toBe("saml");
      expect(arg.samlIdpEntityId).toBe("https://idp.example.com/entity");
    });

    it("rejects a SAML provider missing samlIdpEntityId (400)", async () => {
      const { samlIdpEntityId: _omit, ...incomplete } = validSamlBody;
      const res = await app.request("/sso-admin/providers", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify(incomplete),
      });
      expect(res.status).toBe(400);
      expect(mockCreateDbProvider).not.toHaveBeenCalled();
    });
  });

  describe("POST /providers/parse-metadata", () => {
    const METADATA_XML = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.test/entity"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>MIIBconly</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.test/sso"/></IDPSSODescriptor></EntityDescriptor>`;

    it("parses pasted IdP metadata XML into endpoints and certificate", async () => {
      const res = await app.request("/sso-admin/providers/parse-metadata", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ xml: METADATA_XML }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.idpEntityId).toBe("https://idp.test/entity");
      expect(body.data.idpSsoUrl).toBe("https://idp.test/sso");
      expect(body.data.idpCertificate).toContain("BEGIN CERTIFICATE");
    });
  });

  describe("PATCH /providers/:id", () => {
    it("404s for an env (config-only) provider", async () => {
      mockGetDbProvider.mockResolvedValue(null);
      const res = await app.request("/sso-admin/providers/google", {
        method: "PATCH",
        headers: JSON_AUTH,
        body: JSON.stringify({ displayName: "Renamed" }),
      });
      expect(res.status).toBe(404);
      expect(mockUpdateDbProvider).not.toHaveBeenCalled();
    });

    it("updates a DB provider and audits clientSecretChanged correctly", async () => {
      mockGetDbProvider.mockResolvedValue(makeDbProvider());
      const res = await app.request("/sso-admin/providers/okta", {
        method: "PATCH",
        headers: JSON_AUTH,
        body: JSON.stringify({ displayName: "Okta v2" }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateDbProvider).toHaveBeenCalledWith("okta", expect.objectContaining({ displayName: "Okta v2" }));

      const auditCall = mockCreateAuditLogWithContext.mock.calls.find(
        (call) => call[1] === "sso.provider_update"
      );
      const details = (auditCall![3] as { details: Record<string, unknown> }).details;
      expect(details.clientSecretChanged).toBe(false);
    });
  });

  describe("DELETE /providers/:id", () => {
    it("rejects with sso:edit but without sso:delete (distinct permission)", async () => {
      // Editing and deleting are separate permissions; an edit-only token can't delete.
      mockTokenPayload.permissions = ["sso:view", "sso:edit"];
      mockGetDbProvider.mockResolvedValue(makeDbProvider());
      const res = await app.request("/sso-admin/providers/okta", {
        method: "DELETE",
        headers: AUTH,
      });
      expect(res.status).toBe(403);
      expect(mockDeleteDbProvider).not.toHaveBeenCalled();
    });

    it("404s for an env provider", async () => {
      mockGetDbProvider.mockResolvedValue(null);
      const res = await app.request("/sso-admin/providers/google", {
        method: "DELETE",
        headers: AUTH,
      });
      expect(res.status).toBe(404);
      expect(mockDeleteDbProvider).not.toHaveBeenCalled();
    });

    it("force-unlinks identities, deletes, returns count, and audits per user", async () => {
      mockGetDbProvider.mockResolvedValue(makeDbProvider());
      mockDeleteIdentitiesByProvider.mockResolvedValue(["u1", "u2"]);

      const res = await app.request("/sso-admin/providers/okta", {
        method: "DELETE",
        headers: AUTH,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.unlinkedUserCount).toBe(2);

      expect(mockDeleteIdentitiesByProvider).toHaveBeenCalledWith("okta");
      expect(mockDeleteDbProvider).toHaveBeenCalledWith("okta");
      expect(mockRefreshSsoConfig).toHaveBeenCalled();

      const deleteAudit = mockCreateAuditLogWithContext.mock.calls.find(
        (call) => call[1] === "sso.provider_delete"
      );
      expect(deleteAudit).toBeDefined();
      const deleteDetails = (deleteAudit![3] as { details: Record<string, unknown> }).details;
      expect(deleteDetails.unlinkedUserCount).toBe(2);
      expect(deleteDetails.unlinkedUserIds).toEqual(["u1", "u2"]);

      const unlinkAudits = mockCreateAuditLogWithContext.mock.calls.filter(
        (call) => call[1] === "user.sso_identity_unlink"
      );
      expect(unlinkAudits.length).toBe(2);
    });
  });

  describe("POST /providers/test", () => {
    it("returns the test result and audits success", async () => {
      mockTestProviderConfig.mockResolvedValue({ ok: true });
      const res = await app.request("/sso-admin/providers/test", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({
          type: "oidc",
          issuer: "https://idp.example.com",
          clientId: "c",
          clientSecret: "s",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.ok).toBe(true);

      const auditCall = mockCreateAuditLogWithContext.mock.calls.find(
        (call) => call[1] === "sso.provider_test"
      );
      expect(auditCall).toBeDefined();
      expect((auditCall![3] as { status?: string }).status).toBe("success");
    });

    it("audits failure when the test fails", async () => {
      mockTestProviderConfig.mockResolvedValue({ ok: false, cause: "ENOTFOUND" });
      const res = await app.request("/sso-admin/providers/test", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({
          type: "oidc",
          issuer: "https://bad.example.com",
          clientId: "c",
          clientSecret: "s",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.ok).toBe(false);

      const auditCall = mockCreateAuditLogWithContext.mock.calls.find(
        (call) => call[1] === "sso.provider_test"
      );
      expect((auditCall![3] as { status?: string }).status).toBe("failure");
    });

    it("falls back to the stored secret when editing (id, no clientSecret)", async () => {
      mockGetDbProvider.mockResolvedValue(makeDbProvider());
      mockTestProviderConfig.mockResolvedValue({ ok: true });
      const res = await app.request("/sso-admin/providers/test", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({
          id: "google",
          type: "oidc",
          issuer: "https://idp.example.com",
          clientId: "c",
        }),
      });
      expect(res.status).toBe(200);
      expect(mockTestProviderConfig).toHaveBeenCalled();
      const passed = mockTestProviderConfig.mock.calls.at(-1)![0] as { clientSecret?: string };
      expect(passed.clientSecret).toBe("stored-secret");
    });

    it("400s when no secret is typed and no existing provider matches", async () => {
      mockGetDbProvider.mockResolvedValue(null);
      const res = await app.request("/sso-admin/providers/test", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ id: "ghost", type: "oidc", issuer: "https://x.example.com", clientId: "c" }),
      });
      expect(res.status).toBe(400);
    });
  });
});
