#!/usr/bin/env bun
// CLI release helper — the `release.ts` counterpart for the independent CLI
// version line (`cli/VERSION`, tags `cli-vX`, fragments in
// `changelogs/cli/unreleased/`). The app release never touches these paths.
//
//   bun run scripts/release-cli.ts [overrideVersion] [--dry-run]
//
// Dry run prints only the computed version (used by cli-release.yml to derive
// its tag) and exits without writing any files. Real mode bumps cli/VERSION,
// writes CLI_RELEASE_NOTES.md (used as the GitHub Release body), and deletes
// the fragments.
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAGMENTS_DIR = join(ROOT, "changelogs", "cli", "unreleased");
const VERSION_PATH = join(ROOT, "cli", "VERSION");
const NOTES_PATH = join(ROOT, "CLI_RELEASE_NOTES.md");

const SKIP_FILES = new Set([".gitkeep", "README.md"]);
const CATEGORIES = ["Added", "Changed", "Fixed", "Removed"] as const;
type Category = (typeof CATEGORIES)[number];
type BumpType = "major" | "minor" | "patch";

function bumpVersion(current: string, bump: BumpType): string {
  const parts = current.trim().split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    console.error(`Error in cli/VERSION: expected semver X.Y.Z (got: "${current.trim()}")`);
    process.exit(1);
  }
  const [major, minor, patch] = parts;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Read fragments ---

const fragmentFiles = readdirSync(FRAGMENTS_DIR).filter(
  (f) => f.endsWith(".md") && !SKIP_FILES.has(f)
);

if (fragmentFiles.length === 0) {
  console.log("No CLI fragments found — nothing to release.");
  process.exit(0);
}

interface Fragment {
  file: string;
  type: BumpType;
  sections: Partial<Record<Category, string[]>>;
}

const fragments: Fragment[] = [];

for (const file of fragmentFiles) {
  const content = readFileSync(join(FRAGMENTS_DIR, file), "utf8").trim();
  const lines = content.split("\n");

  const typeMatch = lines[0].match(/^type:\s*(major|minor|patch)\s*$/);
  if (!typeMatch) {
    console.error(
      `Error in ${file}: first line must be "type: major|minor|patch" (got: "${lines[0]}")`
    );
    process.exit(1);
  }

  const type = typeMatch[1] as BumpType;
  const sections: Partial<Record<Category, string[]>> = {};
  let currentCategory: Category | null = null;

  for (const line of lines.slice(1)) {
    const catMatch = line.match(/^###\s+(Added|Changed|Fixed|Removed)\s*$/);
    if (catMatch) {
      currentCategory = catMatch[1] as Category;
      if (!sections[currentCategory]) sections[currentCategory] = [];
    } else if (currentCategory && line.trimStart().startsWith("-")) {
      sections[currentCategory]!.push(line);
    }
  }

  fragments.push({ file, type, sections });
}

// --- Compute version ---

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const overrideVersion = args.find((arg) => !arg.startsWith("--"));

let bumpType: BumpType = "patch";
for (const f of fragments) {
  if (f.type === "major") {
    bumpType = "major";
    break;
  }
  if (f.type === "minor") bumpType = "minor";
}

const currentVersion: string = readFileSync(VERSION_PATH, "utf8").trim();
const versionArg = overrideVersion?.replace(/^cli-v/, "").replace(/^v/, "");
const newVersion = versionArg ?? bumpVersion(currentVersion, bumpType);

// Dry run: print only the computed version and exit without writing files.
if (dryRun) {
  console.log(newVersion);
  process.exit(0);
}

console.log(`\nReleasing chouse CLI cli-v${newVersion}  (${bumpType} bump from cli-v${currentVersion})`);
console.log(`Fragments: ${fragmentFiles.join(", ")}\n`);

// --- Assemble release notes ---

const grouped: Partial<Record<Category, string[]>> = {};
for (const cat of CATEGORIES) {
  const bullets = fragments.flatMap((f) => f.sections[cat] ?? []);
  if (bullets.length > 0) grouped[cat] = bullets;
}

let notes = `## [cli-v${newVersion}] - ${today()}\n`;
for (const cat of CATEGORIES) {
  if (grouped[cat]) {
    notes += `\n### ${cat}\n${grouped[cat]!.join("\n")}\n`;
  }
}

writeFileSync(NOTES_PATH, notes);
console.log("✓ CLI_RELEASE_NOTES.md written");

// --- Bump cli/VERSION ---

writeFileSync(VERSION_PATH, `${newVersion}\n`);
console.log(`✓ cli/VERSION → ${newVersion}`);

// --- Delete fragment files ---

for (const f of fragments) {
  unlinkSync(join(FRAGMENTS_DIR, f.file));
}
console.log(`✓ ${fragments.length} fragment(s) deleted`);
console.log(`\nCLI release cli-v${newVersion} ready. Review changes then commit and push.`);
