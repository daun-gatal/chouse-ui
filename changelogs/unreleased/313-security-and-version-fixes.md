type: patch

### Fixed
- **Security** — upgraded react-router to v8.3.0, resolving GHSA-qwww-vcr4-c8h2 (High), and bumped dompurify to 3.4.12 (GHSA-c2j3-45gr-mqc4, Low); dependency scans now report no known vulnerabilities.
- **RBAC version reporting** — servers no longer log a contradictory "current 1.47.0 / target 1.46.0" migration state; the schema version constant now matches the newest migration and is guarded by a test.
