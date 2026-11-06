#!/usr/bin/env bun
/**
 * Validates the EGM directory contracts (`README.md` in each code directory and
 * the root `ARCHITECTURE.md`) against the code. Rules: .rules/EGM.md.
 *
 *   bun run check:contracts           # fails (exit 1) on any problem
 *
 * Checks:
 *   1. Every code directory not listed in .egmignore has a README.md contract.
 *   2. Component contracts (the directory has source files) have the Overview,
 *      Interface, Invariants, Side Effects and Verification sections; Blueprint
 *      contracts have Overview and Subdirectories.
 *   3. Every relative link resolves to an existing file or directory.
 *   4. Every `[path:symbol]` citation names an existing file that contains the
 *      symbol, and every bare `[path]` citation names an existing file.
 *   5. Every `bunx vitest run <path>` / `bun test <path>` in a contract targets a
 *      path that contains tests, so the verification command can actually pass.
 */
import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, normalize, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARCHITECTURE = "ARCHITECTURE.md";
const CONTRACT = "README.md";

export const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".h", ".hpp", ".rs", ".go", ".java", ".kt", ".py", ".rb",
  ".php", ".sh", ".bash", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".swift",
  ".sql", ".proto", ".graphql", ".gql", ".prisma", ".tf", ".hcl",
]);
const CITABLE = /\.(?:tsx?|jsx?|mjs|cjs|go|sh|sql|ya?ml|json)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|_test\.go$)/;
const TEST_DIRS = new Set(["test", "tests", "__tests__", "__mocks__", "fixtures", "testdata"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

// Blueprints written from the root template say "System Overview".
const OVERVIEW = /^## (?:System )?Overview\b/;
const COMPONENT_SECTIONS: Array<[string, RegExp]> = [
  ["## Overview", OVERVIEW],
  ["## Interface", /^## Interface\b/],
  ["## Invariants", /^## Invariants\b/],
  ["## Side Effects", /^## Side Effects\b/],
  ["## Verification", /^## Verification\b/],
];
const BLUEPRINT_SECTIONS: Array<[string, RegExp]> = [
  ["## Overview", OVERVIEW],
  ["## Subdirectories", /^## Subdirectories\b/],
];

export interface Problem {
  file: string;
  message: string;
}

/** Reads `.egmignore`: one repo-relative directory prefix per line, `#` comments. */
export function parseIgnore(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\.?\//, "").replace(/\/?$/, "/"));
}

export function isIgnored(relDir: string, ignore: string[]): boolean {
  const withSlash = relDir === "" ? "" : `${relDir}/`;
  return ignore.some((prefix) => withSlash.startsWith(prefix));
}

export function isSourceFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return SOURCE_EXTENSIONS.has(name.slice(dot)) && !TEST_FILE.test(name) && !name.endsWith(".d.ts");
}

/** Relative markdown link targets, without anchors or query strings. */
export function extractLinks(markdown: string): string[] {
  const links: string[] = [];
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  for (const match of withoutCode.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0].split("?")[0];
    if (target === "" || /^(?:[a-z]+:|\/)/i.test(target)) continue;
    links.push(decodeURIComponent(target));
  }
  return links;
}

export interface Citation {
  path: string;
  symbol: string | null;
}

/** `[path/file.ts:symbol]` and bare `[path/file.ts]` citations (not link text). */
export function extractCitations(markdown: string): Citation[] {
  const citations: Citation[] = [];
  const pattern = /\[([\w@./-]+\.[A-Za-z]+)(?::([A-Za-z_$][\w$.]*))?\](?!\()/g;
  for (const match of markdown.matchAll(pattern)) {
    if (!CITABLE.test(match[1])) continue;
    citations.push({ path: match[1], symbol: match[2] ?? null });
  }
  return citations;
}

/** Paths passed to `bunx vitest run` / `bun test`, with the directory they run from. */
export function extractTestTargets(markdown: string): Array<{ cwd: string; target: string }> {
  const targets: Array<{ cwd: string; target: string }> = [];
  for (const line of markdown.split("\n")) {
    const cwd = /cd (packages\/server|docs\/portfolio)\b/.exec(line)?.[1] ?? "";
    for (const match of line.matchAll(/\b(?:bunx vitest run|bun test)((?:\s+[\w./-]+)+)/g)) {
      for (const target of match[1].trim().split(/\s+/)) {
        if (target.startsWith("-")) break;
        targets.push({ cwd, target });
      }
    }
  }
  return targets;
}

function listDir(absDir: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) dirs.push(entry.name);
    else if (entry.isFile()) files.push(entry.name);
  }
  return { files, dirs };
}

function hasTests(absPath: string): boolean {
  if (!existsSync(absPath)) return false;
  if (statSync(absPath).isFile()) return TEST_FILE.test(absPath);
  const { files, dirs } = listDir(absPath);
  if (files.some((name) => TEST_FILE.test(name))) return true;
  return dirs.some((name) => !SKIP_DIRS.has(name) && hasTests(join(absPath, name)));
}

/** Code directories that need a contract, from git's view of the tree. */
function codeDirectories(ignore: string[]): Set<string> {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const dirs = new Set<string>();
  for (const file of listed.split("\n")) {
    if (file === "") continue;
    const name = file.slice(file.lastIndexOf("/") + 1);
    const dir = file.includes("/") ? dirname(file) : "";
    if (dir === "" || !isSourceFile(name) || !existsSync(join(ROOT, file))) continue;
    const parts = dir.split("/");
    if (parts.some((part) => part.startsWith(".") || SKIP_DIRS.has(part) || TEST_DIRS.has(part))) continue;
    if (isIgnored(dir, ignore)) continue;
    dirs.add(dir);
  }
  return dirs;
}

function checkSections(file: string, text: string, isComponent: boolean): Problem[] {
  const required = isComponent ? COMPONENT_SECTIONS : BLUEPRINT_SECTIONS;
  const lines = text.split("\n");
  return required
    .filter(([, pattern]) => !lines.some((line) => pattern.test(line)))
    .map(([heading]) => ({ file, message: `missing section "${heading}"` }));
}

function checkLinks(file: string, text: string): Problem[] {
  const base = dirname(join(ROOT, file));
  return extractLinks(text)
    .filter((target) => !existsSync(normalize(join(base, target))))
    .map((target) => ({ file, message: `broken link "${target}"` }));
}

const fileCache = new Map<string, string>();
function readCached(absPath: string): string {
  let text = fileCache.get(absPath);
  if (text === undefined) {
    text = readFileSync(absPath, "utf8");
    fileCache.set(absPath, text);
  }
  return text;
}

/** Whole-identifier match, so `run` does not match inside `runPanel`. */
export function containsIdentifier(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[$]/g, "\\$");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

function checkCitations(file: string, text: string): Problem[] {
  const problems: Problem[] = [];
  const base = dirname(join(ROOT, file));
  for (const { path, symbol } of extractCitations(text)) {
    const candidates = [normalize(join(base, path)), normalize(join(ROOT, path))];
    const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (found === undefined) {
      problems.push({ file, message: `cited file not found "${path}"` });
      continue;
    }
    if (symbol === null) continue;
    const leaf = symbol.slice(symbol.lastIndexOf(".") + 1);
    if (!containsIdentifier(readCached(found), leaf)) {
      problems.push({ file, message: `"${symbol}" not found in ${relative(ROOT, found)}` });
    }
  }
  return problems;
}

function checkTestTargets(file: string, text: string): Problem[] {
  return extractTestTargets(text)
    .filter(({ cwd, target }) => !hasTests(join(ROOT, cwd, target)))
    .map(({ cwd, target }) => ({
      file,
      message: `verification runs "${target}"${cwd ? ` (from ${cwd})` : ""}, which has no test files`,
    }));
}

export function checkContracts(): Problem[] {
  const ignorePath = join(ROOT, ".egmignore");
  const ignore = existsSync(ignorePath) ? parseIgnore(readFileSync(ignorePath, "utf8")) : [];
  const problems: Problem[] = [];
  const codeDirs = codeDirectories(ignore);

  // A directory needs a contract if it holds code or sits above code.
  const contractDirs = new Set<string>();
  for (const dir of codeDirs) {
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i += 1) contractDirs.add(parts.slice(0, i).join("/"));
  }

  for (const dir of [...contractDirs].sort()) {
    const file = join(dir, CONTRACT);
    const abs = join(ROOT, file);
    if (!existsSync(abs)) {
      problems.push({ file, message: "missing contract (new code directory? see .rules/EGM.md)" });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    problems.push(
      ...checkSections(file, text, codeDirs.has(dir)),
      ...checkLinks(file, text),
      ...checkCitations(file, text),
      ...checkTestTargets(file, text),
    );
  }

  const architecture = join(ROOT, ARCHITECTURE);
  if (!existsSync(architecture)) {
    problems.push({ file: ARCHITECTURE, message: "missing root blueprint" });
  } else {
    const text = readFileSync(architecture, "utf8");
    problems.push(...checkLinks(ARCHITECTURE, text), ...checkCitations(ARCHITECTURE, text));
  }
  const seen = new Set<string>();
  return problems.filter(({ file, message }) => {
    const key = `${file}\u0000${message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

if (import.meta.main) {
  const problems = checkContracts();
  if (problems.length === 0) {
    console.log("Contracts OK.");
    process.exit(0);
  }
  for (const { file, message } of problems) console.error(`${file}: ${message}`);
  console.error(`\n${problems.length} contract problem(s). Rules: .rules/EGM.md#directory-contracts`);
  process.exit(1);
}
