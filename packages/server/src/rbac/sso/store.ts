/**
 * SSO DB Store — CRUD for rbac_sso_settings / rbac_sso_providers and the
 * identity-unlink helpers used by forced provider deletion. Owns client-secret
 * encryption (AES-256-GCM, reused from connections).
 */

import { eq } from "drizzle-orm";
import { getDatabase, getSchema } from "../db";
import { encryptSecret, decryptSecret } from "../services/connections";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface DbSsoSettings {
  id: string;
  enabled: boolean;
  baseUrl: string | null;
  defaultRole: string;
  autoLinkByEmail: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface DbSsoProvider {
  id: string;
  type: string;
  displayName: string;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  userinfoEndpoint: string | null;
  clientId: string;
  clientSecretEncrypted: string;
  scopes: string;
  claimMapping: string | null;
  roleMappingClaim: string | null;
  roleMapping: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface ProviderInput {
  id: string;
  type: string;
  displayName: string;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  userinfoEndpoint?: string | null;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimMapping?: string | null;
  roleMappingClaim?: string | null;
  roleMapping?: string | null;
  enabled?: boolean;
  createdBy?: string | null;
}

const SETTINGS_ID = "default";

export async function getDbSettings(): Promise<DbSsoSettings | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select()
    .from(schema.ssoSettings)
    .where(eq(schema.ssoSettings.id, SETTINGS_ID))
    .limit(1);
  return (rows[0] as DbSsoSettings) || null;
}

export async function upsertDbSettings(
  input: { enabled: boolean; baseUrl: string | null; defaultRole: string; autoLinkByEmail: boolean },
  actorId: string | null
): Promise<DbSsoSettings> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const existing = await getDbSettings();
  const row: DbSsoSettings = {
    id: SETTINGS_ID,
    enabled: input.enabled,
    baseUrl: input.baseUrl,
    defaultRole: input.defaultRole,
    autoLinkByEmail: input.autoLinkByEmail,
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  if (existing) {
    const { id: _id, ...updatePayload } = row;
    await db.update(schema.ssoSettings).set(updatePayload).where(eq(schema.ssoSettings.id, SETTINGS_ID));
  } else {
    await db.insert(schema.ssoSettings).values(row);
  }
  return row;
}

export async function listDbProviders(): Promise<DbSsoProvider[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  return (await db
    .select()
    .from(schema.ssoProviders)) as DbSsoProvider[];
}

export async function getDbProvider(id: string): Promise<DbSsoProvider | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select()
    .from(schema.ssoProviders)
    .where(eq(schema.ssoProviders.id, id))
    .limit(1);
  return (rows[0] as DbSsoProvider) || null;
}

export async function createDbProvider(input: ProviderInput): Promise<DbSsoProvider> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const now = new Date();
  const row: DbSsoProvider = {
    id: input.id,
    type: input.type,
    displayName: input.displayName,
    issuer: input.issuer ?? null,
    authorizationEndpoint: input.authorizationEndpoint ?? null,
    tokenEndpoint: input.tokenEndpoint ?? null,
    userinfoEndpoint: input.userinfoEndpoint ?? null,
    clientId: input.clientId,
    clientSecretEncrypted: encryptSecret(input.clientSecret),
    scopes: input.scopes,
    claimMapping: input.claimMapping ?? null,
    roleMappingClaim: input.roleMappingClaim ?? null,
    roleMapping: input.roleMapping ?? null,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? null,
  };
  await db.insert(schema.ssoProviders).values(row);
  return row;
}

export async function updateDbProvider(
  id: string,
  patch: Partial<Omit<ProviderInput, "id" | "createdBy">>
): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["type", "displayName", "issuer", "authorizationEndpoint", "tokenEndpoint",
    "userinfoEndpoint", "clientId", "scopes", "claimMapping", "roleMappingClaim", "roleMapping", "enabled"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (patch.clientSecret !== undefined) set.clientSecretEncrypted = encryptSecret(patch.clientSecret);
  await db.update(schema.ssoProviders).set(set).where(eq(schema.ssoProviders.id, id));
}

export async function deleteDbProvider(id: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.delete(schema.ssoProviders).where(eq(schema.ssoProviders.id, id));
}

/** Decrypt a provider's secret (used only by buildSsoConfig in memory). */
export function decryptProviderSecret(p: Pick<DbSsoProvider, "clientSecretEncrypted">): string {
  return decryptSecret(p.clientSecretEncrypted);
}

export async function countIdentitiesByProvider(provider: string): Promise<number> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select({ id: schema.userIdentities.id })
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.provider, provider));
  return rows.length;
}

export async function listIdentityUserIdsByProvider(provider: string): Promise<string[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select({ userId: schema.userIdentities.userId })
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.provider, provider));
  return (rows as Array<{ userId: string }>).map((r) => r.userId);
}

export async function deleteIdentitiesByProvider(provider: string): Promise<string[]> {
  const userIds = await listIdentityUserIdsByProvider(provider);
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db.delete(schema.userIdentities).where(eq(schema.userIdentities.provider, provider));
  return userIds;
}
