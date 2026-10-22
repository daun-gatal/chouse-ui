/**
 * The release the site announces — shown as the "New in X.Y" banner on the
 * landing page and the docs home, and used for the title of the What's new
 * page (`whats-new.md`).
 *
 * Update it in the same PR as the first `minor` or `major` changelog fragment
 * of a new version, together with whats-new.md. `bun scripts/gen-reference.ts
 * --check` (CI) fails while `version` is behind the version the unreleased
 * fragments will produce. See .rules/RELEASE_NOTES.md.
 */

export type ReleaseKind = "major" | "minor";

export interface ReleaseHighlight {
  label: string;
  /** A docs page path, such as /docs/mcp/; the docs build checks it resolves. */
  href: string;
}

export interface Release {
  /** `major.minor`, e.g. "3.14". */
  version: string;
  kind: ReleaseKind;
  /** One line: what the release is about. */
  summary: string;
  /** Three to five links to the biggest additions. */
  highlights: ReleaseHighlight[];
}

export const RELEASE: Release = {
  version: "3.16",
  kind: "minor",
  summary: "Dashboards on a free canvas that show what changed, what is normal and why it spiked — with snapshots, reports and Grafana import.",
  highlights: [
    { label: "Dashboard canvas", href: "/docs/dashboards/#the-canvas" },
    { label: "Explain this spike", href: "/docs/dashboards/#annotations-and-notes" },
    { label: "Expected ranges", href: "/docs/dashboards/#compare-and-expected-ranges" },
    { label: "Scheduled reports", href: "/docs/dashboards/#scheduled-reports" },
    { label: "Grafana import", href: "/docs/dashboards/#import-from-grafana" },
  ],
};

export const WHATS_NEW_PATH = "/docs/whats-new/";
