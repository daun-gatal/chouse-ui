type: patch

### Fixed
- **Image and dependency security fixes** — the production image requires zlib 1.4-r0 (CVE-2026-4738), and lodash moves to 4.18.1 (CVE-2026-2950); the lodash override pinned the vulnerable 4.18.0 exactly. With the musl floor from the previous fix, a Trivy scan of the image finds nothing at any severity.
