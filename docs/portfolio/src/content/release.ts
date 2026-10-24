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
  summary: "Meet Chobi, the CHouse buddy: AI that acts across CHouse, checked by tier with Undo — and dashboards that show what changed and why it spiked.",
  highlights: [
    { label: "Meet Chobi", href: "/docs/chobi/" },
    { label: "AI changes with Undo", href: "/docs/ai-approvals/#tiers" },
    { label: "Dashboard canvas", href: "/docs/dashboards/#the-canvas" },
    { label: "Explain this spike", href: "/docs/dashboards/#annotations-and-notes" },
    { label: "Auto-triage", href: "/docs/ai-triage/" },
  ],
};

export const WHATS_NEW_PATH = "/docs/whats-new/";
