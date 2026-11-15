// @vitest-environment node
// Filesystem checks only; jsdom would turn import.meta.url into an http: URL.
import { describe, expect, it } from "vitest";

import { scan, violationsIn } from "./check-clickhouse-access";

const SRC = "packages/server/src";

describe("check-clickhouse-access", () => {
  it("flags a client import outside the executor, types included", () => {
    expect(violationsIn(`${SRC}/routes/x.ts`, 'import { createClient } from "@clickhouse/client";')).toHaveLength(1);
    expect(violationsIn(`${SRC}/routes/x.ts`, "import type { ClickHouseClient } from '@clickhouse/client';")).toHaveLength(1);
    expect(violationsIn(`${SRC}/routes/x.test.ts`, 'import type { ClickHouseClient } from "@clickhouse/client";')).toHaveLength(1);
  });

  it("flags the pool and the remediation login outside the executor", () => {
    expect(violationsIn(`${SRC}/services/y.ts`, 'import { ClientManager } from "./chExecutor/clientPool";')).toHaveLength(1);
    expect(violationsIn(`${SRC}/services/y.ts`, "const login = await getCredential(id);")).toHaveLength(1);
  });

  it("allows the executor itself, real-server tests and the allow-listed files", () => {
    expect(violationsIn(`${SRC}/services/chExecutor/executor.ts`, 'import { createClient } from "@clickhouse/client";')).toEqual([]);
    expect(violationsIn(`${SRC}/services/observe/observe.e2e.test.ts`, 'import { createClient } from "@clickhouse/client";')).toEqual([]);
    expect(violationsIn(`${SRC}/middleware/sqlAccess/fixtures/record.ts`, 'import { createClient } from "@clickhouse/client";')).toEqual([]);
    expect(violationsIn(`${SRC}/services/remediation/store.ts`, "export async function getCredential(connectionId: string) {}")).toEqual([]);
  });

  it("flags making a checked statement anywhere but the access check", () => {
    const mint = 'import { mintCheckedStatement } from "../services/chExecutor/checked";';
    expect(violationsIn(`${SRC}/routes/query.ts`, mint)).toHaveLength(1);
    expect(violationsIn(`${SRC}/routes/query.test.ts`, mint)).toHaveLength(1);
    expect(violationsIn(`${SRC}/services/chExecutor/index.ts`, 'export { mintCheckedStatement } from "./checked";')).toHaveLength(1);
    expect(violationsIn(`${SRC}/middleware/dataAccess.ts`, mint)).toEqual([]);
    expect(violationsIn(`${SRC}/services/chExecutor/checked.ts`, "export function mintCheckedStatement() {}")).toEqual([]);
  });

  it("keeps the test helpers out of code the server runs", () => {
    const util = 'import { checkedForTests } from "../services/chExecutor/checked.test-util";';
    expect(violationsIn(`${SRC}/routes/query.ts`, util)).toHaveLength(1);
    expect(violationsIn(`${SRC}/routes/query.test.ts`, util)).toEqual([]);
    expect(violationsIn(`${SRC}/routes/query.ts`, "setAccessOverrideForTests(() => true);")).toHaveLength(1);
    expect(violationsIn(`${SRC}/services/chExecutor/shared.e2e.test.ts`, "setAccessOverrideForTests(() => true);")).toEqual([]);
    expect(violationsIn(`${SRC}/middleware/dataAccess.ts`, "export function setAccessOverrideForTests() {}")).toEqual([]);
  });

  it("ignores files outside the server source", () => {
    expect(violationsIn("src/api/query.ts", 'import { createClient } from "@clickhouse/client-web";')).toEqual([]);
  });

  it("passes on this repository", () => {
    expect(scan()).toEqual([]);
  });
});
