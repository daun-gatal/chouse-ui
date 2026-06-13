import { describe, it, expect, mock } from 'bun:test';
import {
  generateUserDDL,
  generateUpdateUserDDL,
  createClickHouseUser,
  updateClickHouseUser,
  deleteClickHouseUser,
  getClickHouseUser,
  extractRoleFromUser,
  type CreateClickHouseUserInput,
  type CurrentUserState,
} from './clickhouseUsers';

function mockService(handlers: Array<{ match: RegExp; data: unknown[] }> = []) {
  const calls: string[] = [];
  const executeQuery = mock(async (query: string) => {
    calls.push(query);
    for (const h of handlers) {
      if (h.match.test(query)) return { data: h.data };
    }
    return { data: [] };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: { executeQuery } as any, calls };
}

describe('generateUserDDL', () => {
  it('creates a user with default auth and HOST ANY', () => {
    const input: CreateClickHouseUserInput = { username: 'alice', password: 'password123' };
    const ddl = generateUserDDL(input);
    expect(ddl.createUser).toBe("CREATE USER IF NOT EXISTS `alice` IDENTIFIED WITH sha256_password BY 'password123' HOST ANY;");
  });

  it('supports no_password without a password', () => {
    const ddl = generateUserDDL({ username: 'svc', authType: 'no_password' });
    expect(ddl.createUser).toContain('IDENTIFIED WITH no_password');
  });

  it('applies host restrictions', () => {
    const ddl = generateUserDDL({ username: 'alice', password: 'password123', hostIp: '10.0.0.1', hostNames: 'host1' });
    expect(ddl.createUser).toContain("HOST IP '10.0.0.1', NAME 'host1'");
  });

  it('grants roles and sets default roles', () => {
    const ddl = generateUserDDL({ username: 'alice', password: 'password123', roles: ['analytics', 'readonly'], defaultRoles: ['analytics'] });
    expect(ddl.grantStatements).toContain('GRANT `analytics`, `readonly` TO `alice`;');
    expect(ddl.grantStatements).toContain('ALTER USER `alice` DEFAULT ROLE `analytics`;');
  });

  it('applies direct grants', () => {
    const ddl = generateUserDDL({
      username: 'alice',
      password: 'password123',
      directGrants: [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }],
    });
    expect(ddl.grantStatements).toContain('GRANT SELECT ON `db`.* TO `alice`;');
  });

  it('rejects unsupported auth types', () => {
    expect(() => generateUserDDL({ username: 'x', authType: 'evil; DROP USER y' })).toThrow();
  });
});

describe('generateUpdateUserDDL', () => {
  const current: CurrentUserState = {
    roles: ['readonly'],
    defaultRoles: 'ALL',
    directGrants: [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }],
    authType: 'sha256_password',
  };

  it('diffs role assignments', () => {
    const ddl = generateUpdateUserDDL('alice', { roles: ['analytics'] }, current);
    expect(ddl.fullDDL).toContain('REVOKE `readonly` FROM `alice`');
    expect(ddl.fullDDL).toContain('GRANT `analytics` TO `alice`');
  });

  it('diffs direct grants', () => {
    const ddl = generateUpdateUserDDL('alice', { directGrants: [] }, current);
    expect(ddl.fullDDL).toContain('REVOKE SELECT ON `db`.* FROM `alice`');
  });

  it('changes password using current auth type', () => {
    const ddl = generateUpdateUserDDL('alice', { password: 'newpassword1' }, current);
    expect(ddl.fullDDL).toContain("ALTER USER `alice` IDENTIFIED WITH sha256_password BY 'newpassword1'");
  });

  it('replaces host authoritatively', () => {
    const ddl = generateUpdateUserDDL('alice', { hostIp: '' }, current);
    expect(ddl.fullDDL).toContain('ALTER USER `alice` HOST ANY');
  });
});

describe('reads', () => {
  it('getClickHouseUser returns roles, defaults and direct grants', async () => {
    const { service } = mockService([
      { match: /FROM system\.users\s+WHERE name/, data: [{ name: 'alice', host_ip: [], host_names: [], default_roles_all: 1, default_roles_list: [], auth_type: 'sha256_password' }] },
      { match: /system\.role_grants WHERE user_name/, data: [{ granted_role_name: 'analytics' }] },
      { match: /default_roles_all, default_roles_list FROM system\.users WHERE name/, data: [{ default_roles_all: 1, default_roles_list: [] }] },
      { match: /system\.grants\s+WHERE user_name/, data: [{ access_type: 'SELECT', database: 'db', table: null, column: null, is_partial_revoke: 0, grant_option: 0 }] },
    ]);
    const user = await getClickHouseUser(service, 'alice');
    expect(user?.roles).toEqual(['analytics']);
    expect(user?.defaultRoles).toBe('ALL');
    expect(user?.directGrants[0].privileges).toEqual(['SELECT']);
  });

  it('getClickHouseUser returns null for unknown user', async () => {
    const { service } = mockService([{ match: /FROM system\.users/, data: [] }]);
    expect(await getClickHouseUser(service, 'nope')).toBeNull();
  });

  it('marks config-managed (users.xml) users as read-only', async () => {
    const { service } = mockService([
      { match: /FROM system\.users\s+WHERE name/, data: [{ name: 'admin', host_ip: [], host_names: [], default_roles_all: 1, default_roles_list: [], auth_type: 'sha256_password', storage: 'users.xml' }] },
      { match: /system\.role_grants WHERE user_name/, data: [] },
      { match: /system\.grants\s+WHERE user_name/, data: [] },
    ]);
    const user = await getClickHouseUser(service, 'admin');
    expect(user?.readonly).toBe(true);
  });
});

describe('writes', () => {
  it('createClickHouseUser executes create + grants', async () => {
    const { service, calls } = mockService();
    await createClickHouseUser(service, { username: 'alice', password: 'password123', roles: ['readonly'] });
    expect(calls).toContain('CREATE USER IF NOT EXISTS `alice` IDENTIFIED WITH sha256_password BY \'password123\' HOST ANY');
    expect(calls).toContain('GRANT `readonly` TO `alice`');
  });

  it('deleteClickHouseUser drops the user', async () => {
    const { service, calls } = mockService();
    await deleteClickHouseUser(service, 'alice');
    expect(calls).toContain('DROP USER IF EXISTS `alice`');
  });

  it('updateClickHouseUser fetches current state when not provided', async () => {
    const { service, calls } = mockService([
      { match: /FROM system\.users\s+WHERE name/, data: [{ name: 'alice', host_ip: [], host_names: [], default_roles_all: 1, default_roles_list: [], auth_type: 'sha256_password' }] },
      { match: /system\.role_grants WHERE user_name/, data: [] },
      { match: /system\.grants\s+WHERE user_name/, data: [] },
    ]);
    await updateClickHouseUser(service, 'alice', { roles: ['analytics'] });
    expect(calls).toContain('GRANT `analytics` TO `alice`');
  });
});

describe('extractRoleFromUser', () => {
  it('rejects extract for a writable (SQL-managed) user', async () => {
    const { service, calls } = mockService([
      { match: /SELECT storage FROM system\.users WHERE name/, data: [{ storage: 'local directory' }] },
      { match: /system\.grants\s+WHERE user_name/, data: [{ access_type: 'SELECT', database: 'db', table: null, column: null, is_partial_revoke: 0, grant_option: 0 }] },
    ]);
    await expect(extractRoleFromUser(service, 'alice', 'extracted_alice')).rejects.toThrow('only available for read-only');
    expect(calls.some((c) => c.startsWith('CREATE ROLE'))).toBe(false);
  });

  it('throws when a read-only user has no direct grants', async () => {
    const { service } = mockService([
      { match: /SELECT storage FROM system\.users WHERE name/, data: [{ storage: 'users.xml' }] },
      { match: /system\.grants/, data: [] },
    ]);
    await expect(extractRoleFromUser(service, 'admin', 'r')).rejects.toThrow('no direct grants');
  });

  it('for a read-only user, only materializes the role without touching the user', async () => {
    const { service, calls } = mockService([
      { match: /SELECT storage FROM system\.users WHERE name/, data: [{ storage: 'users.xml' }] },
      { match: /system\.grants\s+WHERE user_name/, data: [{ access_type: 'SELECT', database: null, table: null, column: null, is_partial_revoke: 0, grant_option: 0 }] },
    ]);
    await extractRoleFromUser(service, 'admin', 'admin_role');
    // The role is created with the grants…
    expect(calls).toContain('CREATE ROLE IF NOT EXISTS `admin_role`');
    expect(calls).toContain('GRANT SELECT ON *.* TO `admin_role`');
    // …but the read-only user is never modified.
    expect(calls.some((c) => c.includes('TO `admin`'))).toBe(false);
    expect(calls.some((c) => c.includes('FROM `admin`'))).toBe(false);
    expect(calls.some((c) => c.startsWith('ALTER USER `admin`'))).toBe(false);
  });

  it('handles digit-bearing source privileges like S3 for a read-only user (regression)', async () => {
    const { service, calls } = mockService([
      { match: /SELECT storage FROM system\.users WHERE name/, data: [{ storage: 'users.xml' }] },
      { match: /system\.grants\s+WHERE user_name/, data: [{ access_type: 'S3', database: null, table: null, column: null, is_partial_revoke: 0, grant_option: 0 }] },
    ]);
    await extractRoleFromUser(service, 'admin', 'svc_role');
    expect(calls).toContain('GRANT S3 ON *.* TO `svc_role`');
    expect(calls.some((c) => c.includes('FROM `admin`'))).toBe(false);
  });
});
