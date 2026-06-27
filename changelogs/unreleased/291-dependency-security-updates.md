type: patch

### Changed
- **Dependency security updates** — Bumped dependencies to clear known high-severity advisories with no breaking API changes: `drizzle-orm` (0.38 → 0.45), `hono` (4.11 → 4.12), `react-router-dom` (7.10 → 7.15+), `nodemailer` (8 → 9), `yaml` (2.8 → 2.9) and `dompurify` (3.3 → 3.4). The transitive `lodash` (via `dagre`) is pinned to a patched release through an `overrides` entry.
