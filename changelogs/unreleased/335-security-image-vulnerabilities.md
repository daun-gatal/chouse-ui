type: patch

### Fixed
- **Container image vulnerabilities** — the published image no longer carries known CVEs from the server runtime or the Alpine base. Bumped `hono`, `nodemailer`, and `@xmldom/xmldom`, forced patched transitive `@xmldom/xmldom` and `uuid` through overrides that the production install honours, and pinned a minimum OpenSSL (`libcrypto3`/`libssl3`) version in the base image.

### Changed
- **CI now scans the built image** with Trivy and fails on HIGH/CRITICAL findings, matching ArtifactHub's scanner. Base images are digest-pinned and kept current by Renovate.
