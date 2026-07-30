type: patch

### Fixed
- **Container image vulnerabilities** — the published image shipped Bun's global install cache (~1 GB), which held the entire dependency tree including dev-only prebuilt binaries such as esbuild 0.18.20 and 0.19.12; scanners reported those stale binaries as part of the runtime. The cache is now dropped in the same layer it is created in. The base image's Alpine packages are also patched at build time (`apk upgrade`), picking up OpenSSL 3.5.7-r0, and GNU `wget` — which carried unfixed CVEs and was installed only for the healthcheck — is replaced by busybox's built-in `wget`.

### Changed
- **Smaller runtime image** — the frontend's runtime dependencies (~735 MB) are no longer installed into the production image. They were pulled in only because the root `package.json` made Bun treat `/app` as a workspace root; the server never loads them, since the frontend is served as the pre-built static bundle in `/app/dist`.
