# Server Shared Types

## Overview
Single module (`index.ts`) of cross-cutting server types: Zod request schemas,
ClickHouse query/metadata result shapes, the monitoring metric interfaces used
by metrics routes and services, the generic API envelope, and the `AppError`
class that every route and service throws for HTTP-mapped failures.

## Interface
- Errors
  - `[index.ts:AppError]` - `Error` subclass with `code`, `category`, `statusCode`, `details`, mutable `id`, and `toJSON()`. Factories: `badRequest` (400), `unauthorized` (401), `forbidden` (403), `notFound` (404), `conflict` (409), `validation` (400, `VALIDATION_ERROR`), `internal` (500), `unavailable` (503).
  - `[index.ts:ErrorCategory]` - `connection | authentication | query | timeout | network | validation | permission | unknown`.
  - `[index.ts:requireParam]` - reads a Hono path param, throwing `AppError.badRequest` when absent.
- Request schemas (Zod): `[index.ts:ConnectionConfigSchema]`, `[index.ts:QueryRequestSchema]`, `[index.ts:SavedQuerySchema]` and their inferred types `ConnectionConfig`, `QueryRequest`, `SavedQueryInput`.
- Query and metadata shapes: `QueryResult`, `QueryStatistics`, `QueryMeta`, `TableInfo`, `DatabaseInfo`, `ColumnInfo`, `TableDetails`, `SavedQuery`, `Session`, `SessionInfo` `[index.ts]`.
- Monitoring shapes: `SystemStats`, `RecentQuery`, `ProductionMetrics`, `QueryLatencyMetrics`, `DiskMetrics`, `MergeMetrics`, `PartsPressureRow`, `DdlImpactEstimate`, `ReplicationMetrics`, `CacheMetrics`, `ResourceMetrics`, `ErrorMetrics`, `InsertThroughputMetrics`, `TopTableBySize`, `NetworkMetrics`, `*HistoryMetric`, `StorageCacheMetric`, `ConcurrencyMetric`, `ZooKeeperMetric`, `DetailedMemoryMetric` `[index.ts]`.
- Envelopes: `[index.ts:ApiResponse]` (`success`, `data`, `error { code, message, details }`), `[index.ts:PaginatedResponse]`.

## Invariants
- Server code signals HTTP errors by throwing `AppError` (via its static factories) so `[../middleware/error.ts:errorHandler]` can map `statusCode`/`code` to the response.
- `requireParam` fails closed with a 400 rather than returning `undefined` `[index.ts:requireParam]`.
- `ConnectionConfigSchema` requires a valid URL and non-empty username; `password` defaults to `""` `[index.ts:ConnectionConfigSchema]`.

## Side Effects
- None. Pure type, schema, and class definitions.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Typecheck: `bun run typecheck`
