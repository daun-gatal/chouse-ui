import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Section, Container, SectionHeader, Tag } from "./Section";
import { cn } from "@/lib/utils";

interface CategoryBlock {
  name: string;
  count: number;
  highlights: string[];
}

interface Release {
  version: string;
  date: string;
  categories: CategoryBlock[];
  topHighlights: string[];
}

const GITHUB_CHANGELOG_BASE = "https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md";

const CATEGORY_ORDER = ["Added", "Changed", "Fixed", "Removed", "Deprecated", "Security"];

function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  const versionRe = /^## \[(v[\d.]+)\] - (\d{4}-\d{2}-\d{2})/gm;
  const matches: Array<{ version: string; date: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = versionRe.exec(markdown)) !== null) {
    matches.push({ version: m[1], date: m[2], index: m.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i < matches.length - 1 ? matches[i + 1].index : markdown.length;
    const body = markdown.substring(current.index, nextIndex);

    // Split into ### Category sections. Header line only — no newline/bullet content.
    const sectionRe = /^### ([^\n]+)/gm;
    const sectionMatches: Array<{ name: string; index: number }> = [];
    let s: RegExpExecArray | null;
    while ((s = sectionRe.exec(body)) !== null) {
      sectionMatches.push({ name: s[1].trim(), index: s.index });
    }

    const categories: CategoryBlock[] = sectionMatches.map((sec, idx) => {
      const sectionBody = body.substring(
        sec.index,
        idx < sectionMatches.length - 1 ? sectionMatches[idx + 1].index : body.length
      );
      // Match top-level bullet titles: lines starting with `- **Title**`.
      const bulletTitles = Array.from(sectionBody.matchAll(/^-\s+\*\*(.+?)\*\*/gm)).map(
        (b) => b[1].trim()
      );
      // If no bolded titles, fall back to first sentence of each `-` bullet.
      const fallback =
        bulletTitles.length > 0
          ? bulletTitles
          : Array.from(sectionBody.matchAll(/^-\s+(.+?)(?:[.:]|$)/gm))
              .map((b) => b[1].trim())
              .filter(Boolean);
      return { name: sec.name, count: fallback.length, highlights: fallback };
    });

    // Pick top highlights across categories, preferred order.
    const sortedCats = [...categories].sort(
      (a, b) =>
        (CATEGORY_ORDER.indexOf(a.name) === -1 ? 99 : CATEGORY_ORDER.indexOf(a.name)) -
        (CATEGORY_ORDER.indexOf(b.name) === -1 ? 99 : CATEGORY_ORDER.indexOf(b.name))
    );
    const top: string[] = [];
    outer: for (const cat of sortedCats) {
      for (const h of cat.highlights) {
        top.push(h);
        if (top.length >= 3) break outer;
      }
    }

    releases.push({
      version: current.version,
      date: current.date,
      categories: categories.filter((c) => c.count > 0),
      topHighlights: top,
    });
  }

  return releases.slice(0, 3);
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

const CATEGORY_DOT: Record<string, string> = {
  Added: "bg-accent",
  Changed: "bg-paper",
  Fixed: "bg-paper-muted",
  Removed: "bg-paper-dim",
  Deprecated: "bg-paper-dim",
  Security: "bg-accent",
};

export default function Changelog() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || "/";
    const path = `${base}CHANGELOG.md`.replace(/\/+/g, "/");
    fetch(path)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("failed"))))
      .then((text) => {
        setReleases(parseChangelog(text));
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <Section id="changelog" aria-label="Changelog">
      <Container>
        <SectionHeader
          eyebrow="Recent releases"
          eyebrowIndex={10}
          title="What shipped lately."
          description="Three latest from CHANGELOG.md. Full history on GitHub."
          action={
            <a
              href={GITHUB_CHANGELOG_BASE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-paper"
            >
              Full changelog
              <ArrowUpRight className="h-3 w-3" />
            </a>
          }
        />

        <div className="mt-16">
          {loading && (
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-paper-dim">
              Loading…
            </p>
          )}

          {error && (
            <p className="rounded-md border border-ink-500 bg-ink-100 p-6 text-sm text-paper-muted">
              Could not load changelog ({error}). It is generated at build time by CI.
            </p>
          )}

          {!loading && !error && releases.length > 0 && (
            <ul className="border-t border-ink-500">
              {releases.map((release, idx) => {
                const anchor = release.version.replace(/\./g, "");
                return (
                  <li
                    key={release.version}
                    className="grid grid-cols-12 gap-x-6 gap-y-4 border-b border-ink-500 py-8"
                  >
                    {/* Meta */}
                    <div className="col-span-12 flex flex-col gap-3 md:col-span-3">
                      <div className="flex items-center gap-2">
                        <h3 className="font-mono text-[15px] text-paper">{release.version}</h3>
                        {idx === 0 && <Tag variant="accent">Latest</Tag>}
                      </div>
                      <time className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                        {formatDate(release.date)}
                      </time>
                      <div className="flex flex-wrap gap-2">
                        {release.categories.map((cat) => (
                          <span
                            key={cat.name}
                            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim"
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                CATEGORY_DOT[cat.name] ?? "bg-paper-faint"
                              )}
                              aria-hidden
                            />
                            {cat.name} {cat.count}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Highlights */}
                    <div className="col-span-12 flex flex-col gap-3 md:col-span-7">
                      {release.topHighlights.length > 0 ? (
                        <ul className="flex flex-col gap-2.5">
                          {release.topHighlights.map((title, hidx) => (
                            <li key={hidx} className="flex items-start gap-3 text-[14px] leading-snug text-paper-muted">
                              <span className="mt-2 h-px w-3 shrink-0 bg-ink-700" aria-hidden />
                              <span className="text-paper">{title}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] text-paper-dim">No highlight bullets parsed.</p>
                      )}
                    </div>

                    {/* Link */}
                    <div className="col-span-12 flex items-start md:col-span-2 md:justify-end">
                      <a
                        href={`${GITHUB_CHANGELOG_BASE}#${anchor}---${release.date}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-paper"
                      >
                        Read notes
                        <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Container>
    </Section>
  );
}
