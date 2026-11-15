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
 * And typed text reaches ClickHouse only as a checked statement:
 *   4. only `middleware/dataAccess.ts` may make one (`mintCheckedStatement`);
 *   5. the test helpers that make one without a check, or force the check to
 *      allow (`checked.test-util`, `setAccessOverrideForTests`), may be used
 *      only by test files.
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
const MINT = /\bmintCheckedStatement\b/;
const TEST_UTIL_IMPORT = /from\s+["'][^"']*checked\.test-util["']/;
const ACCESS_OVERRIDE = /\bsetAccessOverrideForTests\b/;

/** Files that may name `mintCheckedStatement`, and why. */
export const MINT_ALLOWED: Record<string, string> = {
  [`${EXECUTOR}checked.ts`]: "defines it",
  [`${EXECUTOR}checked.test-util.ts`]: "test helper; refuses to run outside a test",
  [`${SERVER_SRC}/middleware/dataAccess.ts`]: "the access check: the one place a checked statement is made",
};
const ACCESS_CHECK = `${SERVER_SRC}/middleware/dataAccess.ts`;

export interface Violation {
  file: string;
  line: number;
  rule: string;
}

/** Violations in one file's text. `file` is repo-relative with forward slashes. */
export function violationsIn(file: string, text: string): Violation[] {
  if (!file.startsWith(`${SERVER_SRC}/`)) return [];
  const out: Violation[] = [];
  const lines = text.split("\n");
  const isTest = file.endsWith(".test.ts");
  lines.forEach((line, index) => {
    if (MINT.test(line) && !(file in MINT_ALLOWED)) {
      out.push({ file, line: index + 1, rule: "makes a checked statement outside the access check" });
    }
    if (!isTest && TEST_UTIL_IMPORT.test(line) && !file.endsWith("checked.test-util.ts")) {
      out.push({ file, line: index + 1, rule: "uses the checked-statement test helper outside a test" });
    }
    if (!isTest && ACCESS_OVERRIDE.test(line) && file !== ACCESS_CHECK) {
      out.push({ file, line: index + 1, rule: "forces the access check to allow outside a test" });
    }
  });
  if (file.startsWith(EXECUTOR)) return out;
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
