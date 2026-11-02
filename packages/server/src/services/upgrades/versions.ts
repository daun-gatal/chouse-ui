/**
 * ClickHouse release lines (ADR 0029 §2): monthly `YY.M` lines, LTS in months
 * 3 and 8, and the support rule ClickHouse publishes (the three newest lines
 * plus the two newest LTS lines). Pure, so the rule is tested without a network.
 */

/** Numeric compare of dotted versions: "25.10" sorts after "25.8". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const VERSION_RE = /^(\d{1,3})\.(\d{1,2})(?:\.(\d{1,4})(?:\.(\d{1,6}))?)?$/;

/** "25.8.33.6" → "25.8"; null for anything that is not a plain ClickHouse version. */
export function lineOf(version: string): string | null {
  const m = VERSION_RE.exec(version.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

/** The leading `x.y.z.w` of what `version()` returns ("24.8.1.2684-stable" or "25.3.2.39.altinitystable" included). */
export function plainVersion(version: string): string | null {
  const m = /^(\d{1,3}\.\d{1,2}(?:\.\d{1,4}(?:\.\d{1,6})?)?)/.exec(version.trim());
  return m ? m[1] : null;
}

export function isLts(line: string): boolean {
  const minor = Number(line.split(".")[1]);
  return minor === 3 || minor === 8;
}

export interface ReleaseLine {
  line: string;
  lts: boolean;
  /** First release date of the line (YYYY-MM-DD). */
  firstDate: string;
  /** Newest patch known for the line and its date. */
  latestPatch: string;
  latestDate: string | null;
}

/** Lines sorted newest first. */
export function sortLines(lines: ReleaseLine[]): ReleaseLine[] {
  return [...lines].sort((a, b) => compareVersions(b.line, a.line));
}

/** The three newest lines plus the two newest LTS lines, among `lines`. */
export function supportedLines(lines: ReleaseLine[]): Set<string> {
  const sorted = sortLines(lines);
  const out = new Set(sorted.slice(0, 3).map((l) => l.line));
  for (const l of sorted.filter((x) => x.lts).slice(0, 2)) out.add(l.line);
  return out;
}

/** The line whose release ended support for `line`, by replaying releases in order; null while still supported. */
export function supportEndedBy(line: string, lines: ReleaseLine[]): ReleaseLine | null {
  const ascending = [...lines].sort((a, b) => compareVersions(a.line, b.line));
  const seen: ReleaseLine[] = [];
  for (const l of ascending) {
    seen.push(l);
    if (compareVersions(l.line, line) <= 0) continue;
    if (!supportedLines(seen).has(line)) return l;
  }
  return null;
}

function nextLine(line: string): string {
  const [major, minor] = line.split(".").map(Number);
  return minor >= 12 ? `${major + 1}.1` : `${major}.${minor + 1}`;
}

/**
 * The future line whose release is expected to end support for `line`: three
 * newer lines for a stable line, the second next LTS for an LTS line. The
 * month is the line's own (`27.8` ships in August 2027).
 */
export function expectedSupportEnd(line: string): { line: string; month: string } {
  let l = line;
  if (isLts(line)) {
    let lts = 0;
    while (lts < 2) {
      l = nextLine(l);
      if (isLts(l)) lts++;
    }
  } else {
    for (let i = 0; i < 3; i++) l = nextLine(l);
  }
  const [major, minor] = l.split(".").map(Number);
  return { line: l, month: `${2000 + major}-${String(minor).padStart(2, "0")}` };
}
