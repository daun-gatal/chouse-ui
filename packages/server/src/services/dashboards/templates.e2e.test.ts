/**
 * Every template query runs on a real ClickHouse with the dashboard caps.
 * Skipped unless CH_E2E_URLS names a node (CH_E2E_USER / CH_E2E_PASSWORD as
 * for the other e2e suites).
 */

import { afterAll, describe, expect, it } from "bun:test";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { compileSql, defaultValues, resolveWindow } from "./macros";
import { MAX_BYTES_TO_READ, MAX_EXECUTION_SECONDS, MAX_RESULT_ROWS } from "./runner";
import { TEMPLATES } from "./templates";

const URLS = (process.env["CH_E2E_URLS"] ?? "").split(",").map((u) => u.trim()).filter(Boolean);
const USER = process.env["CH_E2E_USER"] ?? "default";
const PASSWORD = process.env["CH_E2E_PASSWORD"] ?? "default";

describe.skipIf(URLS.length === 0)("dashboard templates on ClickHouse (ADR 0021 §8)", () => {
  const client: ClickHouseClient = createClient({ url: URLS[0], username: USER, password: PASSWORD });
  afterAll(async () => {
    await client.close();
  });

  for (const template of TEMPLATES) {
    for (const panel of template.dashboard.panels) {
      it(`${template.id} · ${panel.title}`, async () => {
        const window = resolveWindow({ kind: "relative", value: template.dashboard.timeRange }, Date.now());
        const compiled = compileSql(panel.sql, template.dashboard.variables, defaultValues(template.dashboard.variables), window);
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;
        const result = await client.query({
          query: compiled.compiled.sql,
          query_params: compiled.compiled.params,
          format: "JSON",
          clickhouse_settings: {
            readonly: "1",
            max_execution_time: MAX_EXECUTION_SECONDS,
            max_result_rows: String(MAX_RESULT_ROWS),
            result_overflow_mode: "throw",
            max_bytes_to_read: String(MAX_BYTES_TO_READ),
            read_overflow_mode: "throw",
            output_format_json_quote_64bit_integers: 0,
          },
        });
        const json = (await result.json()) as { meta: Array<{ name: string }> };
        const columns = json.meta.map((m) => m.name);
        for (const column of [panel.viz.x, ...panel.viz.y, panel.viz.series].filter((c): c is string => c !== null)) {
          expect({ panel: panel.title, column, present: columns.includes(column) }).toEqual({ panel: panel.title, column, present: true });
        }
      }, 60_000);
    }
  }
});
