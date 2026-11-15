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

  it("ignores files outside the server source", () => {
    expect(violationsIn("src/api/query.ts", 'import { createClient } from "@clickhouse/client-web";')).toEqual([]);
  });

  it("passes on this repository", () => {
    expect(scan()).toEqual([]);
  });
});
