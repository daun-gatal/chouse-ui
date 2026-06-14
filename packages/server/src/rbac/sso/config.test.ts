import { describe, it, expect, mock } from 'bun:test';
import { loadSsoConfig, buildSsoConfig } from './config';

// Mock the DB store so buildSsoConfig's dynamic import of './store' resolves
// to a fixed set of DB providers (no real database). 'okta' collides with the
// env provider (env must win); 'google' is DB-only.
mock.module('./store', () => ({
  getDbSettings: async () => null,
  listDbProviders: async () => [
    {
      id: 'okta',
      type: 'oidc',
      displayName: 'Okta (DB)',
      issuer: 'https://db.okta.com',
      authorizationEndpoint: null,
      tokenEndpoint: null,
      userinfoEndpoint: null,
      clientId: 'db-cid',
      clientSecretEncrypted: 'enc:sek',
      scopes: 'openid',
      claimMapping: null,
      roleMappingClaim: null,
      roleMapping: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
    {
      id: 'google',
      type: 'oidc',
      displayName: 'Google',
      issuer: 'https://accounts.google.com',
      authorizationEndpoint: null,
      tokenEndpoint: null,
      userinfoEndpoint: null,
      clientId: 'g-cid',
      clientSecretEncrypted: 'enc:sek',
      scopes: 'openid email',
      claimMapping: null,
      roleMappingClaim: null,
      roleMapping: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    },
  ],
  decryptProviderSecret: () => 'sek',
}));

function baseEnv(): Record<string, string> {
  return {
    AUTH_SSO_ENABLED: 'true',
    AUTH_SSO_BASE_URL: 'https://chouse.example.com',
    AUTH_SSO_DEFAULT_ROLE: 'viewer',
    AUTH_SSO_AUTO_LINK_BY_EMAIL: 'true',
    AUTH_SSO_PROVIDERS_OKTA_TYPE: 'oidc',
    AUTH_SSO_PROVIDERS_OKTA_DISPLAY_NAME: 'Okta',
    AUTH_SSO_PROVIDERS_OKTA_ISSUER: 'https://corp.okta.com',
    AUTH_SSO_PROVIDERS_OKTA_CLIENT_ID: 'cid',
    AUTH_SSO_PROVIDERS_OKTA_CLIENT_SECRET: 'csecret',
    AUTH_SSO_PROVIDERS_OKTA_SCOPES: 'openid profile email',
  };
}

describe('loadSsoConfig', () => {
  it('returns disabled config when AUTH_SSO_ENABLED is not true', () => {
    const cfg = loadSsoConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.providers.size).toBe(0);
  });

  it('parses an oidc provider', () => {
    const cfg = loadSsoConfig(baseEnv());
    expect(cfg.enabled).toBe(true);
    expect(cfg.baseUrl).toBe('https://chouse.example.com');
    expect(cfg.defaultRole).toBe('viewer');
    expect(cfg.autoLinkByEmail).toBe(true);
    const okta = cfg.providers.get('okta');
    expect(okta).toBeDefined();
    expect(okta!.type).toBe('oidc');
    expect(okta!.displayName).toBe('Okta');
    if (okta!.type === 'oidc') expect(okta!.issuer).toBe('https://corp.okta.com');
  });

  it('keeps OIDC endpoint overrides and claim mapping (not stripped)', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_OKTA_AUTHORIZATION_ENDPOINT: 'https://corp.okta.com/oauth2/v1/authorize',
      AUTH_SSO_PROVIDERS_OKTA_TOKEN_ENDPOINT: 'https://corp.okta.com/oauth2/v1/token',
      AUTH_SSO_PROVIDERS_OKTA_USERINFO_ENDPOINT: 'https://corp.okta.com/oauth2/v1/userinfo',
      AUTH_SSO_PROVIDERS_OKTA_CLAIM_MAPPING: 'username:upn,email:mail',
    };
    const okta = loadSsoConfig(env).providers.get('okta')!;
    expect(okta.type).toBe('oidc');
    if (okta.type === 'oidc') {
      expect(okta.authorizationEndpoint).toBe('https://corp.okta.com/oauth2/v1/authorize');
      expect(okta.tokenEndpoint).toBe('https://corp.okta.com/oauth2/v1/token');
      expect(okta.userinfoEndpoint).toBe('https://corp.okta.com/oauth2/v1/userinfo');
      expect(okta.claimMapping).toEqual({ username: 'upn', email: 'mail' });
    }
  });

  it('parses an oauth2 provider with claim mapping', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_GITHUB_TYPE: 'oauth2',
      AUTH_SSO_PROVIDERS_GITHUB_DISPLAY_NAME: 'GitHub',
      AUTH_SSO_PROVIDERS_GITHUB_AUTHORIZATION_ENDPOINT: 'https://github.com/login/oauth/authorize',
      AUTH_SSO_PROVIDERS_GITHUB_TOKEN_ENDPOINT: 'https://github.com/login/oauth/access_token',
      AUTH_SSO_PROVIDERS_GITHUB_USERINFO_ENDPOINT: 'https://api.github.com/user',
      AUTH_SSO_PROVIDERS_GITHUB_CLIENT_ID: 'gid',
      AUTH_SSO_PROVIDERS_GITHUB_CLIENT_SECRET: 'gsecret',
      AUTH_SSO_PROVIDERS_GITHUB_SCOPES: 'read:user user:email',
      AUTH_SSO_PROVIDERS_GITHUB_CLAIM_MAPPING: 'subject:id,email:email,username:login',
    };
    const cfg = loadSsoConfig(env);
    const gh = cfg.providers.get('github');
    expect(gh).toBeDefined();
    expect(gh!.type).toBe('oauth2');
    if (gh!.type === 'oauth2') {
      expect(gh!.claimMapping).toEqual({ subject: 'id', email: 'email', username: 'login' });
    }
  });

  it('accepts "=" as the claim-mapping separator (alongside ":")', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_GITHUB_TYPE: 'oauth2',
      AUTH_SSO_PROVIDERS_GITHUB_DISPLAY_NAME: 'GitHub',
      AUTH_SSO_PROVIDERS_GITHUB_AUTHORIZATION_ENDPOINT: 'https://github.com/login/oauth/authorize',
      AUTH_SSO_PROVIDERS_GITHUB_TOKEN_ENDPOINT: 'https://github.com/login/oauth/access_token',
      AUTH_SSO_PROVIDERS_GITHUB_USERINFO_ENDPOINT: 'https://api.github.com/user',
      AUTH_SSO_PROVIDERS_GITHUB_CLIENT_ID: 'gid',
      AUTH_SSO_PROVIDERS_GITHUB_CLIENT_SECRET: 'gsecret',
      AUTH_SSO_PROVIDERS_GITHUB_SCOPES: 'read:user user:email',
      AUTH_SSO_PROVIDERS_GITHUB_CLAIM_MAPPING: 'subject=id,email=email,username=login',
    };
    const gh = loadSsoConfig(env).providers.get('github')!;
    if (gh.type === 'oauth2') {
      expect(gh.claimMapping).toEqual({ subject: 'id', email: 'email', username: 'login' });
    }
  });

  it('parses auth_params into a record', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_OKTA_AUTH_PARAMS: 'hd:example.com,prompt:select_account',
    };
    const okta = loadSsoConfig(env).providers.get('okta')!;
    expect(okta.authParams).toEqual({ hd: 'example.com', prompt: 'select_account' });
  });

  it('parses role mapping into a record', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_OKTA_ROLE_MAPPING_CLAIM: 'groups',
      AUTH_SSO_PROVIDERS_OKTA_ROLE_MAPPING: 'ch-admins:admin,ch-devs:developer',
    };
    const okta = loadSsoConfig(env).providers.get('okta')!;
    expect(okta.roleMappingClaim).toBe('groups');
    expect(okta.roleMapping).toEqual({ 'ch-admins': 'admin', 'ch-devs': 'developer' });
  });

  it('skips an invalid provider but keeps valid ones', () => {
    const env = { ...baseEnv(), AUTH_SSO_PROVIDERS_BROKEN_TYPE: 'oidc' }; // missing everything else
    const cfg = loadSsoConfig(env);
    expect(cfg.providers.has('okta')).toBe(true);
    expect(cfg.providers.has('broken')).toBe(false);
  });

  it('throws when enabled without base_url', () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).AUTH_SSO_BASE_URL;
    expect(() => loadSsoConfig(env)).toThrow(/base_url/i);
  });

  it('supports provider ids containing underscores', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_MY_IDP_TYPE: 'oidc',
      AUTH_SSO_PROVIDERS_MY_IDP_DISPLAY_NAME: 'My IdP',
      AUTH_SSO_PROVIDERS_MY_IDP_ISSUER: 'https://idp.example.com',
      AUTH_SSO_PROVIDERS_MY_IDP_CLIENT_ID: 'x',
      AUTH_SSO_PROVIDERS_MY_IDP_CLIENT_SECRET: 'y',
      AUTH_SSO_PROVIDERS_MY_IDP_SCOPES: 'openid',
    };
    expect(loadSsoConfig(env).providers.has('my_idp')).toBe(true);
  });

  it('defaults autoLinkByEmail to true when unset', () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).AUTH_SSO_AUTO_LINK_BY_EMAIL;
    expect(loadSsoConfig(env).autoLinkByEmail).toBe(true);
  });

  it('accepts uppercase provider type values', () => {
    const env = { ...baseEnv(), AUTH_SSO_PROVIDERS_OKTA_TYPE: 'OIDC' };
    expect(loadSsoConfig(env).providers.get('okta')!.type).toBe('oidc');
  });
});

describe('SAML provider', () => {
  it('parses a saml env provider', () => {
    const env = {
      ...baseEnv(),
      AUTH_SSO_PROVIDERS_OKTA_TYPE: 'saml',
      AUTH_SSO_PROVIDERS_OKTA_DISPLAY_NAME: 'Okta SAML',
      AUTH_SSO_PROVIDERS_OKTA_SAML_IDP_ENTITY_ID: 'https://idp.test/entity',
      AUTH_SSO_PROVIDERS_OKTA_SAML_IDP_SSO_URL: 'https://idp.test/sso',
      AUTH_SSO_PROVIDERS_OKTA_SAML_IDP_CERTIFICATE: 'PEMDATA',
      AUTH_SSO_PROVIDERS_OKTA_SAML_SP_ENTITY_ID: 'https://app.test/sp',
      AUTH_SSO_PROVIDERS_OKTA_SAML_ALLOW_IDP_INITIATED: 'true',
    } as Record<string, string | undefined>;
    // baseEnv defines OKTA as oidc — remove the oidc-only keys so the id is unambiguously SAML
    delete env.AUTH_SSO_PROVIDERS_OKTA_ISSUER;
    delete env.AUTH_SSO_PROVIDERS_OKTA_CLIENT_ID;
    delete env.AUTH_SSO_PROVIDERS_OKTA_CLIENT_SECRET;
    delete env.AUTH_SSO_PROVIDERS_OKTA_SCOPES;
    const p = loadSsoConfig(env as Record<string, string>).providers.get('okta')!;
    expect(p.type).toBe('saml');
    if (p.type === 'saml') {
      expect(p.samlIdpEntityId).toBe('https://idp.test/entity');
      expect(p.samlSpEntityId).toBe('https://app.test/sp');
      expect(p.samlAllowIdpInitiated).toBe(true);
    }
  });
});

describe('buildSsoConfig', () => {
  it('merges env + DB providers, env wins on id, tags source', async () => {
    const cfg = await buildSsoConfig(baseEnv());

    // env-only provider keeps source 'config'
    expect(cfg.providers.get('okta')!.source).toBe('config');
    // env wins on id conflict: issuer is the env value, not the DB one
    const okta = cfg.providers.get('okta')!;
    expect(okta.type).toBe('oidc');
    if (okta.type === 'oidc') expect(okta.issuer).toBe('https://corp.okta.com');
    expect(okta.displayName).toBe('Okta');

    // DB-only provider is merged with source 'database'
    expect(cfg.providers.get('google')!.source).toBe('database');
  });
});
