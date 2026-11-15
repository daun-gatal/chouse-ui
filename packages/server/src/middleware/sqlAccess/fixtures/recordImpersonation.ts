/**
 * Re-record the printouts the personal-connection check is tested on.
 *
 *   bun src/middleware/sqlAccess/fixtures/recordImpersonation.ts http://user:pass@host:8123
 *
 * The server must be a build that passes the self-test (26.3.63.123 when this
 * was recorded). Every text is stored under itself, so a test asks for exactly
 * the text CHouse would have ClickHouse parse.
 */
import { createClient } from "@clickhouse/client";
import { writeFileSync } from "fs";
import { join } from "path";

import { executorOverClient, serviceActor } from "../../../services/chExecutor";
import { wrapperFor } from "../../../services/chExecutor/impersonate";
import { explainAstOn } from "../clickhouseParse";
import { IMPERSONATION_CASES, IMPERSONATION_USER } from "./impersonation-cases";

const url = process.argv[2];
if (!url) throw new Error("Pass the server URL, e.g. http://default:pass@localhost:8123");

const client = createClient({ url });
const executor = executorOverClient(() => client, serviceActor("access-parse"));
const version = ((await (await client.query({ query: "SELECT version() AS v", format: "JSONEachRow" })).json()) as Array<{ v: string }>)[0].v;
const out: Record<string, { lines?: string[]; code?: string }> = {};
const wrapper = wrapperFor(IMPERSONATION_USER);
for (const sql of IMPERSONATION_CASES) {
  const base = sql.replace(/[;\s]+$/, "");
  for (const text of [sql, `${wrapper}${sql}`, `${wrapper}${base}\nSETTINGS readonly = 1`, `${wrapper}${base}\n, readonly = 1`]) {
    const result = await explainAstOn(executor, text);
    out[text] = result.ok ? { lines: result.lines } : { code: result.code };
  }
}
await client.close();
writeFileSync(join(import.meta.dir, "explain-ast-impersonation.json"), `${JSON.stringify({ version, printouts: out }, null, 1)}\n`);
