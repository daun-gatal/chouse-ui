/**
 * Test-only: a checked statement without running the access check, for tests
 * that stub the check or drive the executor directly. Throws outside
 * `bun test`; `bun run check:clickhouse-access` fails when a file that is not
 * a test imports it.
 */

import { mintCheckedStatement, type CheckedFields, type CheckedStatement } from "./checked";

export function checkedForTests(fields: Partial<CheckedFields> & { sql: string }): CheckedStatement {
  if (process.env.NODE_ENV !== "test") throw new Error("checkedForTests is only available under test");
  return mintCheckedStatement({
    params: undefined,
    connectionId: "conn-1",
    accountId: "user-1",
    isRead: /^\s*(select|with|show|describe|desc|exists|check|explain)\b/i.test(fields.sql),
    mayWrite: true,
    ...fields,
  });
}
