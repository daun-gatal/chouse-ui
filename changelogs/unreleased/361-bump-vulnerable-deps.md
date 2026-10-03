type: patch

### Fixed
- **Dependency vulnerabilities** — upgraded `nodemailer` to 10.0.13 (fixes 2 high and 3 medium advisories) and refreshed transitive `ip-address` (10.7.3) and `fast-uri` (3.1.8) to clear the findings in the Artifact Hub/Trivy report for v3.13.0
- **Further dependency advisories** — upgraded `dompurify` to 3.4.16 and the ESLint-side `ajv` 6.x to 6.15.0
- **Accepted vulnerability exception** — documented a time-boxed scanner exception for `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm), which has no upstream fix; see `SECURITY.md`
