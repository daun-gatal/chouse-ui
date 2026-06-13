/**
 * SSO Admin Routes (/rbac/sso-admin)
 *
 * Manage global SSO settings and CRUD OIDC/OAuth2 providers from the UI,
 * coexisting with read-only env/YAML config. Client secrets are encrypted by
 * the store and never returned. Mutations hot-reload the SSO config and are
 * fully audited; deleting a provider force-unlinks all linked identities.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { PERMISSIONS, AUDIT_ACTIONS } from "../schema/base";
import { requirePermission, getRbacUser, getClientIp } from "../middleware/rbacAuth";
import { createAuditLogWithContext } from "../services/rbac";
import { AppError } from "../../types";
import { getSsoConfig, refreshSsoConfig, loadSsoConfig } from "../sso/config";
import * as store from "../sso/store";
import { testProviderConfig } from "../sso/test";

const ssoAdminRoutes = new Hono();
const SLUG = /^[a-z0-9_-]+$/;

/**
 * True when the environment/YAML defines SSO settings. That layer is read-only:
 * global settings are then authoritative from config and cannot be edited here
 * (mirrors how env-defined providers are read-only). loadSsoConfig() only reports
 * enabled when AUTH_SSO_ENABLED=true with a base_url; if it throws because the
 * operator enabled SSO but misconfigured it, they're still driving SSO via env.
 */
function envProvidesSsoSettings(): boolean {
  try {
    return loadSsoConfig().enabled;
  } catch {
    return true;
  }
}

const ProviderBody = z.object({
  id: z.string().regex(SLUG),
  type: z.enum(["oidc", "oauth2"]),
  displayName: z.string().min(1),
  issuer: z.string().url().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  userinfoEndpoint: z.string().url().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.string().min(1),
  claimMapping: z.string().optional(),
  roleMappingClaim: z.string().optional(),
  roleMapping: z.string().optional(),
  enabled: z.boolean().optional(),
});

const SettingsBody = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url().nullable(),
  defaultRole: z.string().min(1),
  autoLinkByEmail: z.boolean(),
});

const TestBody = z.object({
  // When testing an existing provider, `id` lets the server fall back to the
  // stored (encrypted) secret so the admin needn't re-enter it.
  id: z.string().regex(SLUG).optional(),
  type: z.enum(["oidc", "oauth2"]),
  issuer: z.string().url().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  userinfoEndpoint: z.string().url().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
});

/** Strip the encrypted secret and tag the provider as DB-sourced. */
function maskProvider(p: store.DbSsoProvider) {
  const { clientSecretEncrypted: _secret, ...rest } = p;
  return { ...rest, source: "database" as const, hasSecret: Boolean(p.clientSecretEncrypted) };
}

ssoAdminRoutes.get("/settings", requirePermission(PERMISSIONS.SSO_VIEW), async (c) => {
  const cfg = getSsoConfig();
  const db = await store.getDbSettings();
  // "config"  → env/YAML provides settings (read-only)
  // "database" → editable DB-backed settings row exists
  // "default" → nothing configured yet; editable so the first row can be created
  const source = db ? "database" : envProvidesSsoSettings() ? "config" : "default";
  return c.json({
    success: true,
    data: {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      defaultRole: cfg.defaultRole,
      autoLinkByEmail: cfg.autoLinkByEmail,
      source,
    },
  });
});

ssoAdminRoutes.put(
  "/settings",
  requirePermission(PERMISSIONS.SSO_MANAGE),
  zValidator("json", SettingsBody),
  async (c) => {
    const input = c.req.valid("json");
    const user = getRbacUser(c);
    // Env/YAML-provided settings are read-only: refuse to create a DB override
    // while config drives SSO (defense in depth — the UI also hides the form).
    const existing = await store.getDbSettings();
    if (!existing && envProvidesSsoSettings()) {
      throw AppError.badRequest(
        "Global SSO settings are defined by environment/YAML config and are read-only here."
      );
    }
    await store.upsertDbSettings(input, user.sub);
    await refreshSsoConfig();
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_SETTINGS_UPDATE, user.sub, {
      resourceType: "sso",
      resourceId: "settings",
      details: { changes: input },
      ipAddress: getClientIp(c),
    });
    return c.json({ success: true, data: { message: "SSO settings updated" } });
  }
);

ssoAdminRoutes.get("/providers", requirePermission(PERMISSIONS.SSO_VIEW), async (c) => {
  const cfg = getSsoConfig();
  const dbProviders = await store.listDbProviders();
  const envProviders = [...cfg.providers.values()]
    .filter((p) => p.source === "config")
    .map((p) => ({
      id: p.id,
      type: p.type,
      displayName: p.displayName,
      source: "config" as const,
      enabled: true,
      hasSecret: true,
    }));
  const withCounts = await Promise.all(
    dbProviders.map(async (p) => ({
      ...maskProvider(p),
      linkedUserCount: await store.countIdentitiesByProvider(p.id),
    }))
  );
  return c.json({ success: true, data: { providers: [...envProviders, ...withCounts] } });
});

ssoAdminRoutes.post(
  "/providers",
  requirePermission(PERMISSIONS.SSO_MANAGE),
  zValidator("json", ProviderBody),
  async (c) => {
    const input = c.req.valid("json");
    const user = getRbacUser(c);
    const cfg = getSsoConfig();
    const envHit = cfg.providers.get(input.id);
    if (envHit && envHit.source === "config") {
      throw AppError.badRequest("A config-defined provider already uses this id");
    }
    // A DB provider with this id may already exist (including a disabled one not
    // in the merged config) — return a clean 400 instead of a unique-constraint 500.
    if (await store.getDbProvider(input.id)) {
      throw AppError.badRequest("A provider with this id already exists");
    }
    await store.createDbProvider({ ...input, createdBy: user.sub });
    await refreshSsoConfig();
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_PROVIDER_CREATE, user.sub, {
      resourceType: "sso",
      resourceId: input.id,
      details: { id: input.id, type: input.type, clientSecretChanged: true },
      ipAddress: getClientIp(c),
    });
    return c.json({ success: true, data: { id: input.id } }, 201);
  }
);

ssoAdminRoutes.patch(
  "/providers/:id",
  requirePermission(PERMISSIONS.SSO_MANAGE),
  zValidator("json", ProviderBody.partial().omit({ id: true })),
  async (c) => {
    const id = c.req.param("id");
    const user = getRbacUser(c);
    const existing = await store.getDbProvider(id);
    if (!existing) {
      throw AppError.notFound("SSO provider not found (env providers are read-only)");
    }
    const patch = c.req.valid("json");
    await store.updateDbProvider(id, patch);
    await refreshSsoConfig();
    const { clientSecret: _cs, ...safeChanges } = patch;
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_PROVIDER_UPDATE, user.sub, {
      resourceType: "sso",
      resourceId: id,
      details: {
        changes: safeChanges,
        clientSecretChanged: patch.clientSecret !== undefined,
      },
      ipAddress: getClientIp(c),
    });
    return c.json({ success: true, data: { message: "SSO provider updated" } });
  }
);

ssoAdminRoutes.delete("/providers/:id", requirePermission(PERMISSIONS.SSO_MANAGE), async (c) => {
  const id = c.req.param("id");
  const user = getRbacUser(c);
  const ip = getClientIp(c);
  const existing = await store.getDbProvider(id);
  if (!existing) {
    throw AppError.notFound("SSO provider not found (env providers are read-only)");
  }
  const userIds = await store.deleteIdentitiesByProvider(id);
  await store.deleteDbProvider(id);
  await refreshSsoConfig();
  await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_PROVIDER_DELETE, user.sub, {
    resourceType: "sso",
    resourceId: id,
    details: { id, unlinkedUserCount: userIds.length, unlinkedUserIds: userIds },
    ipAddress: ip,
  });
  for (const uid of userIds) {
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_IDENTITY_UNLINK, user.sub, {
      resourceType: "user",
      resourceId: uid,
      details: { provider: id, forcedByProviderDeletion: true },
      ipAddress: ip,
    });
  }
  return c.json({
    success: true,
    data: { message: "SSO provider deleted", unlinkedUserCount: userIds.length },
  });
});

ssoAdminRoutes.post(
  "/providers/test",
  requirePermission(PERMISSIONS.SSO_MANAGE),
  zValidator("json", TestBody),
  async (c) => {
    const input = c.req.valid("json");
    const user = getRbacUser(c);

    // Prefer a freshly-typed secret; otherwise reuse the stored one of an
    // existing provider so an edit can re-test without re-entering it.
    let clientSecret = input.clientSecret;
    if (!clientSecret && input.id) {
      const existing = await store.getDbProvider(input.id);
      if (existing) clientSecret = store.decryptProviderSecret(existing);
    }
    if (!clientSecret) {
      throw AppError.badRequest("Enter a client secret to run a test.");
    }

    const result = await testProviderConfig({
      type: input.type,
      issuer: input.issuer,
      authorizationEndpoint: input.authorizationEndpoint,
      tokenEndpoint: input.tokenEndpoint,
      userinfoEndpoint: input.userinfoEndpoint,
      clientId: input.clientId,
      clientSecret,
    });
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_PROVIDER_TEST, user.sub, {
      resourceType: "sso",
      resourceId: "test",
      details: { type: input.type, ok: result.ok },
      ipAddress: getClientIp(c),
      status: result.ok ? "success" : "failure",
    });
    return c.json({ success: true, data: result });
  }
);

export default ssoAdminRoutes;
