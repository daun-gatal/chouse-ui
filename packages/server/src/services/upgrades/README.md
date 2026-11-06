# Upgrade Check

## Overview
Upgrade check (ADR 0029): what upgrading a connection to a target ClickHouse version changes for its real workload, using release data, breaking-change notes, server snapshots, workload facts and optional "try it on this server" query planning.

## Interface
- `[assess.ts:startAssessment]`, `[assess.ts:getAssessment]`, `[assess.ts:listAssessments]`, `[assess.ts:latestChecks]`, `[assess.ts:CheckInputError]`.
- `[releaseData.ts:getReleaseData]`, `[releaseData.ts:versionStatus]`, `[releaseData.ts:upgradeTargets]`.
- `[versions.ts:compareVersions]`, `[versions.ts:supportedLines]`, `[versions.ts:isLts]`, `[versions.ts:expectedSupportEnd]`.
- `[notes.ts:notesBetween]`, `[notes.ts:parseChangelog]`.
- `[snapshot.ts:readSnapshot]`, `[snapshot.ts:diffSnapshots]`.
- `[workload.ts:gatherWorkload]`.
- `[match.ts:matchFindings]`, `[match.ts:noteFindings]`, `[match.ts:tryFindings]`, `[match.ts:relevantNotes]`.
- `[tryQueries.ts:tryShapes]`, `[tryQueries.ts:explainOn]`.
- `[fetch.ts:fetchSource]`, `[fetch.ts:upgradeCheckEnabled]`, `[fetch.ts:UpgradeSourceError]`.

## Invariants
- Outbound requests go only to two fixed origins with paths built from validated parts, HTTPS only, redirects refused (`[fetch.ts:fetchSource]`); disabled unless `UPGRADE_CHECK_ENABLED` is `true`/`1` (`[fetch.ts:upgradeCheckEnabled]`).
- Exception: with `CHOUSE_ALLOW_TEST_OVERRIDES=1`, `CHOUSE_UPGRADE_TEST_HOSTS` (JSON) replaces the origins and may use `http://` (`[fetch.ts:loadOverrides]`).
- A change becomes a finding only when the workload uses it (`[match.ts:matchFindings]`); matching is pure.
- Workload reads are read-only and bounded (`[workload.ts:gatherWorkload]`); try-queries only plan read-only shapes (`[tryQueries.ts:tryShapes]`).
- Release lines and support rule are pure and network-free (`[versions.ts:supportedLines]`).

## Side Effects
- Writes `upgrade_assessments`, `upgrade_findings` (`[assess.ts:startAssessment]`).
- HTTPS fetches to ClickHouse GitHub sources and Docker Hub (`[fetch.ts:fetchSource]`, `[releaseData.ts:getReleaseData]`), cached per process 24 h.
- Read-only ClickHouse system-table and `EXPLAIN` queries (`[snapshot.ts:readSnapshot]`, `[tryQueries.ts:explainOn]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
