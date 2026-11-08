/**
 * Re-record the EXPLAIN AST fixtures the access-check tests read.
 *
 *   bun src/middleware/sqlAccess/fixtures/record.ts \
 *     26.5=http://user:pass@host:8123 23.8=http://user:pass@host:8124
 *
 * Each statement in CASES is explained on every server and stored per version,
 * so a ClickHouse release that prints a shape differently shows up as a diff.
 */
import { createClient } from "@clickhouse/client";
import { writeFileSync } from "fs";
import { join } from "path";

import { explainAstOn } from "../clickhouseParse";
import { CASES, caseKey } from "./cases";

// One `<version>=<url>` argument per server.
const servers = process.argv.slice(2).map((arg) => {
  const eq = arg.indexOf("=");
  if (eq <= 0) throw new Error(`Expected <version>=<url>, got ${arg}`);
  return [arg.slice(0, eq), arg.slice(eq + 1)] as const;
});
if (servers.length === 0) throw new Error("Pass one <version>=<url> per ClickHouse server, e.g. 26.5=http://default:pass@localhost:8123");

const out: Record<string, Record<string, { lines?: string[]; code?: string }>> = {};
for (const [version, url] of servers) {
  const client = createClient({ url });
  for (const c of CASES) {
    const result = await explainAstOn(client, c.sql, c.params);
    const key = caseKey(c);
    out[key] ??= {};
    out[key][version] = result.ok ? { lines: result.lines } : { code: result.code };
  }
  await client.close();
}
writeFileSync(join(import.meta.dir, "explain-ast.json"), `${JSON.stringify(out, null, 1)}\n`);
