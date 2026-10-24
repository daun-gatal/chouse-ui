type: patch

### Fixed
- **Server on zod 4** — the API server's request validation moves from zod 3.25.76 to zod 4.6.7, which fixes CVE-2023-54404 (denial of service through unbounded array validation) and removes its accepted-risk exception from the security scans
