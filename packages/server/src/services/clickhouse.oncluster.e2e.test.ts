/**
 * Docker-backed end-to-end test for issue #336.
 *
 * Queries with `ON CLUSTER` must stream per-host rows without a false
 * `JSON Parse error`. Runs against the local testbed cluster
 * (`testbed/docker-compose.yml`, logical cluster `fleet_cluster`).
 *
 * Skipped unless CH_E2E_URL is set, so the regular unit suite
 * (`./scripts/test-isolated-server.sh`) never needs Docker:
 *
 *   ./scripts/e2e-oncluster-ddl.sh
 *
 * Uses MergeTree (not ReplicatedMergeTree): the testbed has no Keeper.
 * Table names are unique per run and always dropped in `finally`.
 */

import { describe, it, expect } from "bun:test";
import { ClickHouseService } from "./clickhouse";

const E2E_URL = process.env["CH_E2E_URL"] ?? "";
const E2E_USER = process.env["CH_E2E_USER"] ?? "default";
const E2E_PASSWORD = process.env["CH_E2E_PASSWORD"] ?? "";

async function collectLines(gen: AsyncGenerator<string>): Promise<unknown[]> {
  const lines: unknown[] = [];
  for await (const line of gen) {
    lines.push(JSON.parse(line));
  }
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorLines(lines: unknown[]): unknown[] {
  return lines.filter((line) => isRecord(line) && line["t"] === "err");
}

describe.skipIf(!E2E_URL)("clickhouse ON CLUSTER e2e (issue #336)", () => {
  function makeService(): ClickHouseService {
    return new ClickHouseService({
      url: E2E_URL,
      username: E2E_USER,
      password: E2E_PASSWORD,
    });
  }

  function uniqueTable(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function drain(gen: AsyncGenerator<string>): Promise<void> {
    for await (const _line of gen) {
      // Drain only; assertions happen on the collected runs.
    }
  }

  it("CREATE TABLE ... ON CLUSTER streams host rows without error", async () => {
    const service = makeService();
    const table = uniqueTable("e2e_oc_create");
    try {
      const lines = await collectLines(
        service.streamQueryRows(
          `CREATE TABLE ${table} ON CLUSTER fleet_cluster (id UInt32) ENGINE MergeTree ORDER BY id`
        )
      );

      expect(errorLines(lines)).toEqual([]);
      const meta = lines.find((line) => isRecord(line) && line["t"] === "m");
      expect(meta).toMatchObject({ t: "m" });
      if (isRecord(meta)) {
        expect(meta["names"]).toContain("host");
      }
      const end = lines[lines.length - 1];
      expect(isRecord(end) && end["t"]).toBe("e");
      if (isRecord(end)) {
        expect(Number(end["rows"])).toBeGreaterThan(0);
      }
    } finally {
      try {
        await drain(service.streamQueryRows(`DROP TABLE IF EXISTS ${table} ON CLUSTER fleet_cluster`));
      } catch {
        // Best-effort cleanup only.
      }
    }
  });

  it("DROP TABLE ... ON CLUSTER streams host rows without error", async () => {
    const service = makeService();
    const table = uniqueTable("e2e_oc_drop");
    await drain(
      service.streamQueryRows(
        `CREATE TABLE ${table} ON CLUSTER fleet_cluster (id UInt32) ENGINE MergeTree ORDER BY id`
      )
    );
    try {
      const lines = await collectLines(
        service.streamQueryRows(`DROP TABLE IF EXISTS ${table} ON CLUSTER fleet_cluster`)
      );

      expect(errorLines(lines)).toEqual([]);
      const end = lines[lines.length - 1];
      expect(isRecord(end) && end["t"]).toBe("e");
    } finally {
      try {
        await drain(service.streamQueryRows(`DROP TABLE IF EXISTS ${table} ON CLUSTER fleet_cluster`));
      } catch {
        // Best-effort cleanup only.
      }
    }
  });
});
