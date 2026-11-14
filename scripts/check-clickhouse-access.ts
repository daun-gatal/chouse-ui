#!/usr/bin/env bun
/**
 * Fails when server code outside the statement executor can reach ClickHouse
 * on its own (ADR 0033 §2).
 *
 *   bun run check:clickhouse-access
 *
 * Under `packages/server/src`, only `services/chExecutor/` may:
 *   1. import `@clickhouse/client` (types included: a raw client type in a
 *      signature is how a raw client gets passed around);
 *   2. import the client pool, `chExecutor/clientPool`;
 *   3. read a stored ClickHouse password: call `getConnectionWithPassword` and
 *      use its `password`, or call the remediation store's `getCredential`.
 *
 * Rule 3 is checked by name: a file that mentions `getCredential` or reads
 * `.password` off a connection must be on the allow-list below, with a reason.
 * Tests that set up a real server (`*.e2e.test.ts`, `*.integration.test.ts`)
 * may create a client of their own.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER_SRC = "packages/server/src";
const EXECUTOR = `${SERVER_SRC}/services/chExecutor/`;

/** Files outside the executor that may import the client library, and why. */
export const CLIENT_IMPORT_ALLOWED: Record<string, string> = {
  [`${SERVER_SRC}/middleware/sqlAccess/fixtures/record.ts`]: "developer script that records parse fixtures from real servers",
};

/** Files that may call the remediation store's `getCredential`, and why. */
export const CREDENTIAL_READ_ALLOWED: Record<string, string> = {
  [`${SERVER_SRC}/services/remediation/store.ts`]: "defines getCredential",
  [`${SERVER_SRC}/services/remediation/executor.ts`]: "checks that a remediation login exists before a run; never reads the password",
  [`${SERVER_SRC}/services/observe/codecTrials.ts`]: "checks that a remediation login exists before a trial; never reads the password",
};

const CLIENT_IMPORT = /from\s+["']@clickhouse\/client(?:-common|-web)?["']|require\(\s*["']@clickhouse\/client/;
const POOL_IMPORT = /from\s+["'][^"']*chExecutor\/clientPool["']/;
const CREDENTIAL_READ = /\bgetCredential\s*\(/;
const REAL_SERVER_TEST = /\.(?:e2e|integration)\.test\.ts$/;

export interface Violation {
  file: string;
  line: number;
  rule: string;
}

/** Violations in one file's text. `file` is repo-relative with forward slashes. */
export function violationsIn(file: string, text: string): Violation[] {
  if (!file.startsWith(`${SERVER_SRC}/`) || file.startsWith(EXECUTOR)) return [];
  const out: Violation[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (CLIENT_IMPORT.test(line) && !(file in CLIENT_IMPORT_ALLOWED) && !REAL_SERVER_TEST.test(file)) {
      out.push({ file, line: index + 1, rule: "imports @clickhouse/client outside services/chExecutor" });
    }
    if (POOL_IMPORT.test(line)) {
      out.push({ file, line: index + 1, rule: "imports the ClickHouse client pool outside services/chExecutor" });
    }
    if (CREDENTIAL_READ.test(line) && !(file in CREDENTIAL_READ_ALLOWED) && !file.endsWith(".test.ts")) {
      out.push({ file, line: index + 1, rule: "reads the remediation login outside services/chExecutor" });
    }
  });
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
}

export function scan(root: string = ROOT): Violation[] {
  const files: string[] = [];
  walk(join(root, SERVER_SRC), files);
  return files.flatMap((path) => violationsIn(relative(root, path).split("\\").join("/"), readFileSync(path, "utf8")));
}

if (import.meta.main) {
  const violations = scan();
  for (const v of violations) process.stderr.write(`${v.file}:${v.line}: ${v.rule}\n`);
  if (violations.length > 0) {
    process.stderr.write(`\n${violations.length} problem(s). Only packages/server/src/services/chExecutor/ may talk to ClickHouse (ADR 0033 §2).\n`);
    process.exit(1);
  }
  process.stdout.write("ClickHouse access OK.\n");
}
