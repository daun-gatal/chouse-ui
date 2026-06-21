#!/usr/bin/env bun
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const FRAGMENTS_DIR = join(ROOT, "changelogs", "unreleased");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const PACKAGE_JSON_PATHS = [
  join(ROOT, "package.json"),
  join(ROOT, "packages", "server", "package.json"),
  join(ROOT, "docs", "portfolio", "package.json"),
];

const SKIP_FILES = new Set([".gitkeep", "README.md"]);
const CATEGORIES = ["Added", "Changed", "Fixed", "Removed"] as const;
type Category = (typeof CATEGORIES)[number];
type BumpType = "major" | "minor" | "patch";

function bumpVersion(current: string, bump: BumpType): string {
  const [major, minor, patch] = current.split(".").map(Number);
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
  console.log("No fragments found — nothing to release.");
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

const rootPkg = JSON.parse(readFileSync(PACKAGE_JSON_PATHS[0], "utf8"));
const currentVersion: string = rootPkg.version;
const newVersion = overrideVersion ?? bumpVersion(currentVersion, bumpType);

// Dry run: print only the computed version (used by the pre-release image build
// to derive its tag) and exit without writing any files.
if (dryRun) {
  console.log(newVersion);
  process.exit(0);
}

console.log(`\nReleasing v${newVersion}  (${bumpType} bump from v${currentVersion})`);
console.log(`Fragments: ${fragmentFiles.join(", ")}\n`);

// --- Assemble changelog block ---

const grouped: Partial<Record<Category, string[]>> = {};
for (const cat of CATEGORIES) {
  const bullets = fragments.flatMap((f) => f.sections[cat] ?? []);
  if (bullets.length > 0) grouped[cat] = bullets;
}

let block = `## [v${newVersion}] - ${today()}\n`;
for (const cat of CATEGORIES) {
  if (grouped[cat]) {
    block += `\n### ${cat}\n${grouped[cat]!.join("\n")}\n`;
  }
}

// --- Insert into CHANGELOG.md ---
// Strategy: clear content between ## [Unreleased] and the first versioned heading,
// then insert the new block just before that versioned heading.

let changelog = readFileSync(CHANGELOG_PATH, "utf8");

const firstVersionIdx = changelog.search(/\n## \[v\d/);

if (firstVersionIdx === -1) {
  // No versioned entries yet — append at end
  changelog = changelog.trimEnd() + `\n\n${block}\n`;
} else {
  const unreleasedIdx = changelog.indexOf("\n## [Unreleased]");
  if (unreleasedIdx !== -1) {
    const unreleasedHeaderEnd =
      unreleasedIdx + "\n## [Unreleased]".length;
    // Clear everything between [Unreleased] header and first versioned entry
    changelog =
      changelog.slice(0, unreleasedHeaderEnd) +
      "\n\n" +
      block +
      "\n" +
      changelog.slice(firstVersionIdx + 1);
  } else {
    // No [Unreleased] section — insert before first versioned entry
    changelog =
      changelog.slice(0, firstVersionIdx + 1) +
      block +
      "\n" +
      changelog.slice(firstVersionIdx + 1);
  }
}

writeFileSync(CHANGELOG_PATH, changelog);
console.log("✓ CHANGELOG.md updated");

// --- Update package.json files ---

for (const pkgPath of PACKAGE_JSON_PATHS) {
  const raw = readFileSync(pkgPath, "utf8");
  const updated = raw.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${newVersion}"`
  );
  writeFileSync(pkgPath, updated);
  console.log(`✓ ${pkgPath.replace(ROOT + "/", "")} → ${newVersion}`);
}

// --- Delete fragment files ---

for (const f of fragments) {
  unlinkSync(join(FRAGMENTS_DIR, f.file));
}
console.log(`✓ ${fragments.length} fragment(s) deleted`);
console.log(`\nRelease v${newVersion} ready. Review changes then commit and push.`);
