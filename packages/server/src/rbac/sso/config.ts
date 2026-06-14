/**
 * SSO Configuration
 *
 * Parses SSO settings from environment variables (which the YAML config
 * loader also populates — see utils/configLoader.ts). Providers are a keyed
 * map because flattenConfig() cannot represent YAML arrays.
 *
 * Env shape: AUTH_SSO_ENABLED, AUTH_SSO_BASE_URL, AUTH_SSO_DEFAULT_ROLE,
 * AUTH_SSO_AUTO_LINK_BY_EMAIL, AUTH_SSO_PROVIDERS_<ID>_<FIELD>.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger';

const PROVIDER_PREFIX = 'AUTH_SSO_PROVIDERS_';

// Known field suffixes, longest first so CLIENT_SECRET wins over SECRET etc.
// Provider ids may themselves contain underscores, so we match the suffix
// against this fixed list and treat the remainder as the provider id.
const FIELD_SUFFIXES = [
  'SAML_TRUST_EMAIL_VERIFIED',
  'SAML_ALLOW_IDP_INITIATED',
  'SAML_IDP_CERTIFICATE',
  'SAML_IDP_ENTITY_ID',
  'SAML_NAMEID_FORMAT',
  'SAML_IDP_SSO_URL',
  'SAML_SP_ENTITY_ID',
  'AUTHORIZATION_ENDPOINT',
  'ROLE_MAPPING_CLAIM',
  'USERINFO_ENDPOINT',
  'TOKEN_ENDPOINT',
  'CLIENT_SECRET',
  'CLAIM_MAPPING',
  'DISPLAY_NAME',
  'ROLE_MAPPING',
  'AUTH_PARAMS',
  'CLIENT_ID',
  'ISSUER',
  'SCOPES',
  'TYPE',
] as const;

/**
 * Parse "a:b,c:d" into { a: 'b', c: 'd' }. Whitespace-tolerant. Accepts either
 * ':' or '=' as the key/value separator (whichever appears first in the pair,
 * so a value may itself contain the other character).
 */
function parsePairs(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    const equals = trimmed.indexOf('=');
    const idx =
      colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals);
    if (idx <= 0 || idx === trimmed.length - 1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

const CommonProviderSchema = z.object({
  displayName: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.string().min(1),
  roleMappingClaim: z.string().optional(),
  roleMapping: z.record(z.string()).optional(),
  // Extra params merged into the authorization request (e.g. prompt, hd, audience).
  authParams: z.record(z.string()).optional(),
});

const OidcProviderSchema = CommonProviderSchema.extend({
  type: z.literal('oidc'),
  issuer: z.string().url(),
  // Optional overrides: endpoints normally come from OIDC discovery, claims from
  // the ID token's standard names. Provide these only to override either.
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  userinfoEndpoint: z.string().url().optional(),
  claimMapping: z.record(z.string()).optional(),
});

const Oauth2ProviderSchema = CommonProviderSchema.extend({
  type: z.literal('oauth2'),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  userinfoEndpoint: z.string().url(),
  claimMapping: z.record(z.string()).default({ subject: 'sub', email: 'email', username: 'username' }),
});

const SamlProviderSchema = z.object({
  type: z.literal('saml'),
  displayName: z.string().min(1),
  samlIdpEntityId: z.string().min(1),
  samlIdpSsoUrl: z.string().url(),
  samlIdpCertificate: z.string().min(1),
  samlSpEntityId: z.string().min(1),
  samlNameIdFormat: z.string().optional(),
  samlAllowIdpInitiated: z.boolean().optional(),
  samlTrustEmailVerified: z.boolean().optional(),
  claimMapping: z.record(z.string()).optional(),
  roleMappingClaim: z.string().optional(),
  roleMapping: z.record(z.string()).optional(),
});

const ProviderSchema = z.discriminatedUnion('type', [OidcProviderSchema, Oauth2ProviderSchema, SamlProviderSchema]);

export type SsoProviderConfig = z.infer<typeof ProviderSchema> & {
  id: string;
  source: 'config' | 'database';
};

export interface SsoConfig {
  enabled: boolean;
  baseUrl: string;
  defaultRole: string;
  autoLinkByEmail: boolean;
  providers: Map<string, SsoProviderConfig>;
}

const FIELD_TO_KEY: Record<string, string> = {
  TYPE: 'type',
  DISPLAY_NAME: 'displayName',
  ISSUER: 'issuer',
  CLIENT_ID: 'clientId',
  CLIENT_SECRET: 'clientSecret',
  SCOPES: 'scopes',
  AUTHORIZATION_ENDPOINT: 'authorizationEndpoint',
  TOKEN_ENDPOINT: 'tokenEndpoint',
  USERINFO_ENDPOINT: 'userinfoEndpoint',
  CLAIM_MAPPING: 'claimMapping',
  ROLE_MAPPING_CLAIM: 'roleMappingClaim',
  ROLE_MAPPING: 'roleMapping',
  AUTH_PARAMS: 'authParams',
  SAML_IDP_ENTITY_ID: 'samlIdpEntityId',
  SAML_IDP_SSO_URL: 'samlIdpSsoUrl',
  SAML_IDP_CERTIFICATE: 'samlIdpCertificate',
  SAML_SP_ENTITY_ID: 'samlSpEntityId',
  SAML_NAMEID_FORMAT: 'samlNameIdFormat',
  SAML_ALLOW_IDP_INITIATED: 'samlAllowIdpInitiated',
  SAML_TRUST_EMAIL_VERIFIED: 'samlTrustEmailVerified',
};

export function loadSsoConfig(env: Record<string, string | undefined> = process.env): SsoConfig {
  const enabled = (env.AUTH_SSO_ENABLED || '').toLowerCase() === 'true';
  const disabled: SsoConfig = {
    enabled: false,
    baseUrl: '',
    defaultRole: 'viewer',
    autoLinkByEmail: true,
    providers: new Map(),
  };
  if (!enabled) return disabled;

  const baseUrl = (env.AUTH_SSO_BASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('[SSO] auth.sso.base_url (AUTH_SSO_BASE_URL) is required when SSO is enabled');
  }

  // Group raw values per provider id
  const raw = new Map<string, Record<string, string>>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(PROVIDER_PREFIX) || value === undefined) continue;
    const rest = key.slice(PROVIDER_PREFIX.length);
    const suffix = FIELD_SUFFIXES.find((f) => rest.endsWith(`_${f}`));
    if (!suffix) continue;
    const id = rest.slice(0, rest.length - suffix.length - 1).toLowerCase();
    if (!id) continue;
    const bucket = raw.get(id) || {};
    bucket[FIELD_TO_KEY[suffix]] = value;
    raw.set(id, bucket);
  }

  const providers = new Map<string, SsoProviderConfig>();
  for (const [id, fields] of raw) {
    const candidate: Record<string, unknown> = { ...fields };
    if (typeof candidate.type === 'string') candidate.type = candidate.type.toLowerCase();
    if (typeof fields.claimMapping === 'string') candidate.claimMapping = parsePairs(fields.claimMapping);
    if (typeof fields.roleMapping === 'string') candidate.roleMapping = parsePairs(fields.roleMapping);
    if (typeof fields.authParams === 'string') candidate.authParams = parsePairs(fields.authParams);
    if (typeof fields.samlAllowIdpInitiated === 'string') candidate.samlAllowIdpInitiated = fields.samlAllowIdpInitiated.toLowerCase() === 'true';
    if (typeof fields.samlTrustEmailVerified === 'string') candidate.samlTrustEmailVerified = fields.samlTrustEmailVerified.toLowerCase() === 'true';
    if (typeof fields.samlIdpCertificate === 'string') candidate.samlIdpCertificate = fields.samlIdpCertificate.replace(/\\n/g, '\n');

    const parsed = ProviderSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.error(
        { module: 'SSO', provider: id, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        'Invalid SSO provider configuration — provider disabled'
      );
      continue;
    }
    providers.set(id, { ...parsed.data, id, source: 'config' });
  }

  return {
    enabled: true,
    baseUrl,
    defaultRole: env.AUTH_SSO_DEFAULT_ROLE || 'viewer',
    autoLinkByEmail: (env.AUTH_SSO_AUTO_LINK_BY_EMAIL ?? 'true').toLowerCase() !== 'false',
    providers,
  };
}

let cache: SsoConfig | null = null;

/** Sync accessor on the hot path. Falls back to env-only until the first refresh. */
export function getSsoConfig(): SsoConfig {
  return cache ?? loadSsoConfig();
}

/** Merge env (read-only) with the DB layer (editable). */
export async function buildSsoConfig(
  env: Record<string, string | undefined> = process.env
): Promise<SsoConfig> {
  const envCfg = loadSsoConfig(env);
  const { getDbSettings, listDbProviders, decryptProviderSecret } = await import('./store');

  const providers = new Map(envCfg.providers); // env providers (source 'config')
  let dbProviders: Awaited<ReturnType<typeof listDbProviders>> = [];
  try {
    dbProviders = await listDbProviders();
  } catch (error) {
    logger.error(
      { module: 'SSO', err: error instanceof Error ? error.message : String(error) },
      'Failed to load DB SSO providers'
    );
  }
  for (const p of dbProviders) {
    if (!p.enabled) continue;
    if (providers.has(p.id)) continue; // env wins on conflict
    let candidate: Record<string, unknown>;
    if (p.type === 'saml') {
      candidate = {
        type: 'saml',
        displayName: p.displayName,
        samlIdpEntityId: p.samlIdpEntityId ?? undefined,
        samlIdpSsoUrl: p.samlIdpSsoUrl ?? undefined,
        samlIdpCertificate: p.samlIdpCertificate ?? undefined,
        samlSpEntityId: (p.samlSpEntityId ?? '') || envCfg.baseUrl, // default SP entityID = base URL
        samlNameIdFormat: p.samlNameIdFormat ?? undefined,
        samlAllowIdpInitiated: p.samlAllowIdpInitiated ?? undefined,
        samlTrustEmailVerified: p.samlTrustEmailVerified ?? undefined,
        claimMapping: p.claimMapping ? parsePairs(p.claimMapping) : undefined,
        roleMappingClaim: p.roleMappingClaim ?? undefined,
        roleMapping: p.roleMapping ? parsePairs(p.roleMapping) : undefined,
      };
    } else {
      candidate = {
        type: p.type,
        displayName: p.displayName,
        issuer: p.issuer ?? undefined,
        authorizationEndpoint: p.authorizationEndpoint ?? undefined,
        tokenEndpoint: p.tokenEndpoint ?? undefined,
        userinfoEndpoint: p.userinfoEndpoint ?? undefined,
        clientId: p.clientId,
        clientSecret: decryptProviderSecret(p),
        scopes: p.scopes,
        claimMapping: p.claimMapping ? parsePairs(p.claimMapping) : undefined,
        roleMappingClaim: p.roleMappingClaim ?? undefined,
        roleMapping: p.roleMapping ? parsePairs(p.roleMapping) : undefined,
        authParams: p.authParams ? parsePairs(p.authParams) : undefined,
      };
    }
    const parsed = ProviderSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.error(
        {
          module: 'SSO',
          provider: p.id,
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        'Invalid DB SSO provider — skipped'
      );
      continue;
    }
    providers.set(p.id, { ...parsed.data, id: p.id, source: 'database' });
  }

  let settings: Awaited<ReturnType<typeof getDbSettings>> = null;
  try {
    settings = await getDbSettings();
  } catch {
    /* keep env */
  }

  const baseUrl = (settings?.baseUrl ?? '').trim().replace(/\/$/, '') || envCfg.baseUrl;
  let enabled = settings ? settings.enabled : envCfg.enabled;
  if (enabled && !baseUrl) {
    logger.warn({ module: 'SSO' }, 'SSO enabled but no base_url resolved; disabling SSO');
    enabled = false;
  }

  return {
    enabled,
    baseUrl,
    defaultRole: settings ? settings.defaultRole : envCfg.defaultRole,
    autoLinkByEmail: settings ? settings.autoLinkByEmail : envCfg.autoLinkByEmail,
    providers,
  };
}

/** Rebuild the cache (boot + after each admin mutation). Keeps the previous cache on error. */
export async function refreshSsoConfig(): Promise<void> {
  const { resetProviderConfigurationCache } = await import('./client');
  try {
    cache = await buildSsoConfig();
  } catch (error) {
    logger.error(
      { module: 'SSO', err: error instanceof Error ? error.message : String(error) },
      'Failed to rebuild SSO config; keeping previous cache'
    );
    return;
  }
  resetProviderConfigurationCache();
  logger.info(
    {
      module: 'SSO',
      providers: [...cache.providers.values()].map((p) => ({
        id: p.id,
        type: p.type,
        source: p.source,
      })),
    },
    `SSO config refreshed — ${cache.providers.size} provider(s)`
  );
}

/** Test-only: clear the cache. */
export function resetSsoConfigCache(): void {
  cache = null;
}
