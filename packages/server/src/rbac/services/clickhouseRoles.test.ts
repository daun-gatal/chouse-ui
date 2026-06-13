import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ----- Mock the local RBAC DB (role-state table) used by enable/disable. -----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stateRows: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inserted: any[] = [];
let deleteCount = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const selectBuilder: any = {
  from: () => selectBuilder,
  where: () => selectBuilder,
  limit: () => selectBuilder,
  then: (resolve: (rows: unknown[]) => unknown) => resolve(stateRows),
};
const mockDb = {
  select: () => selectBuilder,
  insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
  delete: () => ({ where: () => { deleteCount += 1; return Promise.resolve(); } }),
};
mock.module('../db', () => ({
  getDatabase: () => mockDb,
  getSchema: () => ({ clickhouseRoleState: { id: 'id', connectionId: 'connection_id', roleName: 'role_name', savedGrants: 'saved_grants' } }),
}));

import {
  generateCreateRoleDDL,
  generateRoleDiffDDL,
  getRoleGrants,
  getClickHouseRole,
  createClickHouseRole,
  updateClickHouseRole,
  deleteClickHouseRole,
  getRoleAssignees,
  listClickHousePrivileges,
  disableClickHouseRole,
  enableClickHouseRole,
} from './clickhouseRoles';
import type { CHGrant } from './clickhousePrivileges';

/**
 * Build a mock ClickHouseService whose executeQuery returns rows based on a
 * matcher over the (normalized) query string.
 */
function mockService(handlers: Array<{ match: RegExp; data: unknown[] }>) {
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

describe('generateCreateRoleDDL', () => {
  it('creates the role then applies grants', () => {
    const ddl = generateCreateRoleDDL({
      name: 'analytics',
      grants: [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }],
    });
    expect(ddl[0]).toBe('CREATE ROLE IF NOT EXISTS `analytics`');
    expect(ddl[1]).toBe('GRANT SELECT ON `db`.* TO `analytics`');
  });

  it('supports ON CLUSTER', () => {
    const ddl = generateCreateRoleDDL({ name: 'r', cluster: 'c1', grants: [] });
    expect(ddl[0]).toBe('CREATE ROLE IF NOT EXISTS `r` ON CLUSTER `c1`');
    expect(ddl).toHaveLength(1);
  });
});

describe('generateRoleDiffDDL', () => {
  it('emits only changed grants', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT', 'INSERT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const ddl = generateRoleDiffDDL('r', current, desired);
    expect(ddl).toEqual(['REVOKE INSERT ON `db`.* FROM `r`']);
  });

  it('no-op when unchanged', () => {
    const set: CHGrant[] = [{ privileges: ['SELECT', 'INSERT'], database: 'db', table: 't', grantOption: false }];
    expect(generateRoleDiffDDL('r', set, set)).toEqual([]);
  });

  it('adds a single privilege without touching the rest', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT', 'INSERT'], database: 'db', table: null, grantOption: false }];
    expect(generateRoleDiffDDL('r', current, desired)).toEqual(['GRANT INSERT ON `db`.* TO `r`']);
  });

  it('grants a brand new scope only', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT'], database: 'a', table: null, grantOption: false }];
    const desired: CHGrant[] = [
      { privileges: ['SELECT'], database: 'a', table: null, grantOption: false },
      { privileges: ['SELECT'], database: 'b', table: null, grantOption: false },
    ];
    expect(generateRoleDiffDDL('r', current, desired)).toEqual(['GRANT SELECT ON `b`.* TO `r`']);
  });

  it('revokes a dropped scope entirely', () => {
    const current: CHGrant[] = [
      { privileges: ['SELECT'], database: 'a', table: null, grantOption: false },
      { privileges: ['SELECT'], database: 'b', table: null, grantOption: false },
    ];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'a', table: null, grantOption: false }];
    expect(generateRoleDiffDDL('r', current, desired)).toEqual(['REVOKE SELECT ON `b`.* FROM `r`']);
  });

  it('revokes then grants when both change (revoke ordered first)', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT', 'INSERT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT', 'ALTER'], database: 'db', table: null, grantOption: false }];
    const ddl = generateRoleDiffDDL('r', current, desired);
    expect(ddl).toEqual(['REVOKE INSERT ON `db`.* FROM `r`', 'GRANT ALTER ON `db`.* TO `r`']);
  });

  it('treats grant-option change as revoke + re-grant', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT'], database: null, table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: null, table: null, grantOption: true }];
    const ddl = generateRoleDiffDDL('r', current, desired);
    expect(ddl).toContain('REVOKE SELECT ON *.* FROM `r`');
    expect(ddl).toContain('GRANT SELECT ON *.* TO `r` WITH GRANT OPTION');
  });

  it('handles moving a privilege from db-wide to table scope', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: 't', grantOption: false }];
    const ddl = generateRoleDiffDDL('r', current, desired);
    expect(ddl).toEqual(['REVOKE SELECT ON `db`.* FROM `r`', 'GRANT SELECT ON `db`.`t` TO `r`']);
  });

  it('adds and removes column-level grants precisely', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: 't', columns: ['a', 'b'], grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: 't', columns: ['a', 'c'], grantOption: false }];
    const ddl = generateRoleDiffDDL('r', current, desired);
    expect(ddl).toContain('REVOKE SELECT(`b`) ON `db`.`t` FROM `r`');
    expect(ddl).toContain('GRANT SELECT(`c`) ON `db`.`t` TO `r`');
    // Column `a` is unchanged → not touched.
    expect(ddl.join('\n')).not.toContain('`a`');
  });

  it('supports ON CLUSTER on both grant and revoke', () => {
    const current: CHGrant[] = [{ privileges: ['INSERT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const ddl = generateRoleDiffDDL('r', current, desired, 'c1');
    expect(ddl).toContain('REVOKE ON CLUSTER `c1` INSERT ON `db`.* FROM `r`');
    expect(ddl).toContain('GRANT ON CLUSTER `c1` SELECT ON `db`.* TO `r`');
  });
});

describe('getRoleGrants', () => {
  it('parses system.grants rows', async () => {
    const { service } = mockService([
      {
        match: /system\.grants/,
        data: [
          { access_type: 'SELECT', database: 'db', table: null, column: null, is_partial_revoke: 0, grant_option: 0 },
        ],
      },
    ]);
    const grants = await getRoleGrants(service, 'r');
    expect(grants).toEqual([{ privileges: ['SELECT'], database: 'db', table: null, columns: undefined, grantOption: false }]);
  });
});

describe('getClickHouseRole', () => {
  it('returns null when role missing', async () => {
    const { service } = mockService([{ match: /FROM system\.roles/, data: [{ cnt: 0 }] }]);
    expect(await getClickHouseRole(service, 'nope')).toBeNull();
  });

  it('returns grants when role exists', async () => {
    const { service } = mockService([
      { match: /FROM system\.roles/, data: [{ cnt: 1 }] },
      {
        match: /system\.grants/,
        data: [{ access_type: 'SELECT', database: null, table: null, column: null, is_partial_revoke: 0, grant_option: 0 }],
      },
    ]);
    const role = await getClickHouseRole(service, 'r');
    expect(role?.name).toBe('r');
    expect(role?.grants[0].privileges).toEqual(['SELECT']);
  });
});

describe('listClickHousePrivileges', () => {
  it('groups by top-level family and derives column support', async () => {
    const { service } = mockService([
      {
        match: /system\.privileges/,
        data: [
          { privilege: 'ALL', level: null, parent_group: null },
          { privilege: 'SELECT', level: 'COLUMN', parent_group: 'ALL' },
          { privilege: 'ALTER', level: null, parent_group: 'ALL' },
          { privilege: 'ALTER COLUMN', level: 'COLUMN', parent_group: 'ALTER' },
          { privilege: 'ALTER UPDATE', level: 'COLUMN', parent_group: 'ALTER COLUMN' },
          { privilege: 'WEIRD NEW PRIV', level: 'TABLE', parent_group: 'CUSTOM GROUP' },
        ],
      },
    ]);
    const privileges = await listClickHousePrivileges(service);
    const byName = new Map(privileges.map((p) => [p.name, p]));
    // SELECT keeps its curated group; column-capable.
    expect(byName.get('SELECT')?.group).toBe('Read/Write');
    expect(byName.get('SELECT')?.supportsColumns).toBe(true);
    // Nested ALTER privileges roll up to the ALTER family (not ALL).
    expect(byName.get('ALTER UPDATE')?.group).toBe('Alter');
    expect(byName.get('ALTER COLUMN')?.group).toBe('Alter');
    // Unknown family falls back to a clean title-cased label from parent_group.
    expect(byName.get('WEIRD NEW PRIV')?.group).toBe('Custom Group');
    expect(byName.get('WEIRD NEW PRIV')?.supportsColumns).toBe(false);
    // Parent links are exposed for the hierarchy tree.
    expect(byName.get('ALL')?.parent).toBeNull();
    expect(byName.get('ALTER')?.parent).toBe('ALL');
    expect(byName.get('ALTER UPDATE')?.parent).toBe('ALTER COLUMN');
  });

  it('falls back to the static catalog when the query returns nothing', async () => {
    const { service } = mockService([{ match: /system\.privileges/, data: [] }]);
    const privileges = await listClickHousePrivileges(service);
    expect(privileges.some((p) => p.name === 'SELECT')).toBe(true);
  });
});

describe('write operations', () => {
  it('createClickHouseRole executes each statement', async () => {
    const { service, calls } = mockService([]);
    await createClickHouseRole(service, {
      name: 'r',
      grants: [{ privileges: ['SELECT'], database: null, table: null, grantOption: false }],
    });
    expect(calls).toContain('CREATE ROLE IF NOT EXISTS `r`');
    expect(calls).toContain('GRANT SELECT ON *.* TO `r`');
  });

  it('updateClickHouseRole diffs against current grants', async () => {
    const { service, calls } = mockService([
      {
        match: /system\.grants/,
        data: [{ access_type: 'SELECT', database: null, table: null, column: null, is_partial_revoke: 0, grant_option: 0 }],
      },
    ]);
    await updateClickHouseRole(service, 'r', {
      grants: [{ privileges: ['SELECT', 'INSERT'], database: null, table: null, grantOption: false }],
    });
    expect(calls).toContain('GRANT INSERT ON *.* TO `r`');
    expect(calls.some((c) => c.startsWith('REVOKE'))).toBe(false);
  });

  it('deleteClickHouseRole drops the role when no grantees', async () => {
    const { service, calls } = mockService([{ match: /system\.role_grants WHERE granted_role_name/, data: [] }]);
    await deleteClickHouseRole(service, 'r', 'c1');
    expect(calls).toContain('DROP ROLE IF EXISTS `r` ON CLUSTER `c1`');
  });

  it('deleteClickHouseRole refuses to drop a role that is still assigned', async () => {
    const { service, calls } = mockService([
      { match: /system\.role_grants WHERE granted_role_name/, data: [{ user_name: 'alice', role_name: null }, { user_name: null, role_name: 'parent_role' }] },
    ]);
    await expect(deleteClickHouseRole(service, 'analytics')).rejects.toThrow('still assigned to 2 grantee');
    expect(calls.some((c) => c.startsWith('DROP ROLE'))).toBe(false);
  });

  it('getRoleAssignees splits users and roles', async () => {
    const { service } = mockService([
      { match: /system\.role_grants WHERE granted_role_name/, data: [{ user_name: 'alice', role_name: null }, { user_name: null, role_name: 'r2' }] },
    ]);
    expect(await getRoleAssignees(service, 'analytics')).toEqual({ users: ['alice'], roles: ['r2'] });
  });
});

describe('enable/disable', () => {
  beforeEach(() => {
    stateRows = [];
    inserted.length = 0;
    deleteCount = 0;
  });

  it('disable snapshots grants then revokes them', async () => {
    stateRows = []; // not currently disabled
    const { service, calls } = mockService([
      { match: /count\(\) AS cnt FROM system\.roles WHERE name/, data: [{ cnt: 1 }] },
      { match: /FROM system\.grants\s+WHERE role_name/, data: [{ access_type: 'SELECT', database: 'db', table: null, column: null, is_partial_revoke: 0, grant_option: 0 }] },
    ]);
    await disableClickHouseRole(service, 'conn1', 'analytics');
    // Snapshot stored…
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ connectionId: 'conn1', roleName: 'analytics' });
    expect(inserted[0].savedGrants).toEqual([{ privileges: ['SELECT'], database: 'db', table: null, columns: undefined, grantOption: false }]);
    // …and grants revoked in ClickHouse.
    expect(calls).toContain('REVOKE SELECT ON `db`.* FROM `analytics`');
  });

  it('disable is a no-op when already disabled', async () => {
    stateRows = [{ id: 's1', savedGrants: [] }];
    const { service, calls } = mockService([]);
    await disableClickHouseRole(service, 'conn1', 'analytics');
    expect(inserted).toHaveLength(0);
    expect(calls.some((c) => c.startsWith('REVOKE'))).toBe(false);
  });

  it('enable re-applies the snapshot and clears state', async () => {
    stateRows = [{ id: 's1', savedGrants: [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }] }];
    const { service, calls } = mockService([
      { match: /FROM system\.grants\s+WHERE role_name/, data: [] }, // currently revoked
    ]);
    await enableClickHouseRole(service, 'conn1', 'analytics');
    expect(calls).toContain('GRANT SELECT ON `db`.* TO `analytics`');
    expect(deleteCount).toBe(1);
  });

  it('enable is a no-op when not disabled', async () => {
    stateRows = [];
    const { service, calls } = mockService([]);
    await enableClickHouseRole(service, 'conn1', 'analytics');
    expect(calls).toHaveLength(0);
    expect(deleteCount).toBe(0);
  });
});
