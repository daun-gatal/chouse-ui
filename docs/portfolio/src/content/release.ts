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
  version: "3.18",
  kind: "minor",
  summary: "Every statement CHouse UI sends to ClickHouse now says which account it is for, and EXECUTE AS is refused for everyone.",
  highlights: [
    { label: "Who a statement runs as", href: "/docs/security/#who-a-statement-runs-as" },
    { label: "Who a job runs as", href: "/docs/scheduled-queries/#who-a-job-runs-as" },
    { label: "Killing queries", href: "/docs/monitoring-live-queries/#killing-queries" },
  ],
};

export const WHATS_NEW_PATH = "/docs/whats-new/";
