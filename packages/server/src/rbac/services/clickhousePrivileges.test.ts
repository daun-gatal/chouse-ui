import { describe, it, expect } from 'bun:test';
import {
  assertValidPrivilege,
  isReadonlyAccessStorage,
  normalizePrivilege,
  privilegeSupportsColumns,
  quoteIdent,
  formatGrantTarget,
  clusterClause,
  grantToAtoms,
  diffAtoms,
  grantsToAtoms,
  atomsToStatements,
  buildGrantDiffStatements,
  buildGrantStatements,
  systemGrantRowsToGrants,
  atomsToGrants,
  type CHGrant,
  type GrantAtom,
  type SystemGrantRow,
} from './clickhousePrivileges';

describe('assertValidPrivilege', () => {
  it('accepts known privileges', () => {
    expect(() => assertValidPrivilege('SELECT')).not.toThrow();
    expect(() => assertValidPrivilege('ALTER MODIFY COLUMN')).not.toThrow();
    expect(() => assertValidPrivilege('dictGet')).not.toThrow();
  });

  it('accepts digit-bearing source privileges', () => {
    expect(() => assertValidPrivilege('S3')).not.toThrow();
    expect(() => assertValidPrivilege('HDFS')).not.toThrow();
  });

  it('rejects injection attempts', () => {
    expect(() => assertValidPrivilege('SELECT; DROP USER x')).toThrow();
    expect(() => assertValidPrivilege("SELECT' OR '1")).toThrow();
    expect(() => assertValidPrivilege('SELECT(`a`)')).toThrow();
    expect(() => assertValidPrivilege('')).toThrow();
  });
});

describe('isReadonlyAccessStorage', () => {
  it('treats SQL-managed storages as writable', () => {
    expect(isReadonlyAccessStorage('local directory')).toBe(false);
    expect(isReadonlyAccessStorage('replicated')).toBe(false);
    expect(isReadonlyAccessStorage('memory')).toBe(false);
  });
  it('treats config/external storages as read-only', () => {
    expect(isReadonlyAccessStorage('users.xml')).toBe(true);
    expect(isReadonlyAccessStorage('users_xml')).toBe(true);
    expect(isReadonlyAccessStorage('ldap')).toBe(true);
  });
  it('is false when storage is unknown/empty', () => {
    expect(isReadonlyAccessStorage(undefined)).toBe(false);
    expect(isReadonlyAccessStorage('')).toBe(false);
  });
});

describe('normalizePrivilege', () => {
  it('canonicalizes case and whitespace', () => {
    expect(normalizePrivilege('  select  ')).toBe('SELECT');
    expect(normalizePrivilege('alter   modify   column')).toBe('ALTER MODIFY COLUMN');
  });
  it('returns collapsed input for unknown privileges', () => {
    expect(normalizePrivilege('SOME NEW PRIV')).toBe('SOME NEW PRIV');
  });
});

describe('privilegeSupportsColumns', () => {
  it('is true for column-capable privileges', () => {
    expect(privilegeSupportsColumns('SELECT')).toBe(true);
    expect(privilegeSupportsColumns('insert')).toBe(true);
  });
  it('is false otherwise', () => {
    expect(privilegeSupportsColumns('DROP TABLE')).toBe(false);
  });
});

describe('escaping helpers', () => {
  it('quotes identifiers and escapes backticks', () => {
    expect(quoteIdent('db')).toBe('`db`');
    expect(quoteIdent('we`ird')).toBe('`we``ird`');
  });
  it('formats grant targets', () => {
    expect(formatGrantTarget(null, null)).toBe('*.*');
    expect(formatGrantTarget('db', null)).toBe('`db`.*');
    expect(formatGrantTarget('db', 'tbl')).toBe('`db`.`tbl`');
  });
  it('builds cluster clause', () => {
    expect(clusterClause()).toBe('');
    expect(clusterClause('  ')).toBe('');
    expect(clusterClause('c1')).toBe(' ON CLUSTER `c1`');
  });
});

describe('grantToAtoms', () => {
  it('expands privileges x columns', () => {
    const grant: CHGrant = { privileges: ['SELECT', 'INSERT'], database: 'db', table: 't', columns: ['a', 'b'], grantOption: false };
    const atoms = grantToAtoms(grant);
    expect(atoms).toHaveLength(4);
    expect(atoms.every((a) => a.database === 'db' && a.table === 't')).toBe(true);
  });
  it('ignores columns for non-column privileges', () => {
    const grant: CHGrant = { privileges: ['DROP TABLE'], database: 'db', table: 't', columns: ['a'], grantOption: false };
    const atoms = grantToAtoms(grant);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].column).toBeNull();
  });
});

describe('diffAtoms', () => {
  it('computes added and removed', () => {
    const current: GrantAtom[] = grantsToAtoms([{ privileges: ['SELECT', 'INSERT'], database: 'db', table: null, columns: undefined, grantOption: false }]);
    const desired: GrantAtom[] = grantsToAtoms([{ privileges: ['SELECT', 'ALTER'], database: 'db', table: null, columns: undefined, grantOption: false }]);
    const { toGrant, toRevoke } = diffAtoms(current, desired);
    expect(toGrant.map((a) => a.privilege)).toEqual(['ALTER']);
    expect(toRevoke.map((a) => a.privilege)).toEqual(['INSERT']);
  });
  it('treats grant option as part of identity', () => {
    const current = grantsToAtoms([{ privileges: ['SELECT'], database: null, table: null, grantOption: false }]);
    const desired = grantsToAtoms([{ privileges: ['SELECT'], database: null, table: null, grantOption: true }]);
    const { toGrant, toRevoke } = diffAtoms(current, desired);
    expect(toGrant).toHaveLength(1);
    expect(toRevoke).toHaveLength(1);
  });
});

describe('atomsToStatements', () => {
  it('groups privileges sharing a scope into one statement', () => {
    const atoms = grantsToAtoms([{ privileges: ['SELECT', 'INSERT'], database: 'db', table: 't', grantOption: false }]);
    const stmts = atomsToStatements(atoms, { verb: 'GRANT', grantee: '`alice`' });
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('ON `db`.`t` TO `alice`');
    expect(stmts[0]).toMatch(/GRANT (SELECT, INSERT|INSERT, SELECT)/);
  });
  it('renders column-level grants', () => {
    const atoms = grantsToAtoms([{ privileges: ['SELECT'], database: 'db', table: 't', columns: ['a', 'b'], grantOption: false }]);
    const stmts = atomsToStatements(atoms, { verb: 'GRANT', grantee: '`alice`' });
    expect(stmts[0]).toContain('SELECT(`a`, `b`)');
  });
  it('adds WITH GRANT OPTION and ON CLUSTER', () => {
    const atoms = grantsToAtoms([{ privileges: ['SELECT'], database: null, table: null, grantOption: true }]);
    const stmts = atomsToStatements(atoms, { verb: 'GRANT', grantee: '`alice`', cluster: 'c1' });
    expect(stmts[0]).toBe('GRANT ON CLUSTER `c1` SELECT ON *.* TO `alice` WITH GRANT OPTION');
  });
  it('uses FROM for REVOKE without grant option', () => {
    const atoms = grantsToAtoms([{ privileges: ['SELECT'], database: null, table: null, grantOption: true }]);
    const stmts = atomsToStatements(atoms, { verb: 'REVOKE', grantee: '`alice`' });
    expect(stmts[0]).toBe('REVOKE SELECT ON *.* FROM `alice`');
  });
});

describe('buildGrantDiffStatements', () => {
  it('revokes before granting', () => {
    const current: CHGrant[] = [{ privileges: ['SELECT', 'INSERT'], database: 'db', table: null, grantOption: false }];
    const desired: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const stmts = buildGrantDiffStatements(current, desired, { grantee: '`alice`' });
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('REVOKE INSERT ON `db`.* FROM `alice`');
  });
  it('returns empty when nothing changed', () => {
    const set: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    expect(buildGrantDiffStatements(set, set, { grantee: '`alice`' })).toEqual([]);
  });
});

describe('buildGrantStatements', () => {
  it('produces only GRANT statements', () => {
    const set: CHGrant[] = [{ privileges: ['SELECT'], database: 'db', table: null, grantOption: false }];
    const stmts = buildGrantStatements(set, { grantee: '`r1`' });
    expect(stmts).toEqual(['GRANT SELECT ON `db`.* TO `r1`']);
  });
});

describe('systemGrantRowsToGrants round-trip', () => {
  it('parses rows and skips partial revokes', () => {
    const rows: SystemGrantRow[] = [
      { access_type: 'SELECT', database: 'db', table: 't', column: 'a', is_partial_revoke: 0, grant_option: 0 },
      { access_type: 'SELECT', database: 'db', table: 't', column: 'b', is_partial_revoke: 0, grant_option: 0 },
      { access_type: 'INSERT', database: 'db', table: 't', column: null, is_partial_revoke: 0, grant_option: 0 },
      { access_type: 'DROP TABLE', database: 'db', table: 't', column: null, is_partial_revoke: 1, grant_option: 0 },
    ];
    const grants = systemGrantRowsToGrants(rows);
    // SELECT(a,b) and INSERT should be separate grants; partial revoke skipped.
    const select = grants.find((g) => g.privileges.includes('SELECT'));
    const insert = grants.find((g) => g.privileges.includes('INSERT'));
    expect(select?.columns).toEqual(['a', 'b']);
    expect(insert?.columns).toBeUndefined();
    expect(grants.some((g) => g.privileges.includes('DROP TABLE'))).toBe(false);
  });

  it('atomsToGrants -> grantsToAtoms is stable', () => {
    const rows: SystemGrantRow[] = [
      { access_type: 'SELECT', database: null, table: null, column: null, is_partial_revoke: 0, grant_option: 1 },
      { access_type: 'INSERT', database: 'db', table: 't', column: null, is_partial_revoke: 0, grant_option: 0 },
    ];
    const grants = systemGrantRowsToGrants(rows);
    const atoms1 = grantsToAtoms(grants);
    const atoms2 = grantsToAtoms(atomsToGrants(atoms1));
    expect(new Set(atoms1.map((a) => JSON.stringify(a)))).toEqual(new Set(atoms2.map((a) => JSON.stringify(a))));
  });
});
