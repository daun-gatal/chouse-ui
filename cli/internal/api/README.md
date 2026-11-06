# api

## Overview

Package `api` is a typed, PAT-authenticated HTTP client for the CHouse UI backend. It speaks the server's `{success,data,error}` envelope, maps failures to the CLI's exit-code contract, and also calls the stateless MCP JSON-RPC endpoint at `/mcp`.

## Interface

- `[client.go:Client]` / `[client.go:New]` - one server + token + optional connection; 60 s HTTP timeout, `chouse-cli/1` user agent, `DefaultRetryPolicy`.
- `[client.go:ExitOK]`, `ExitUsage` (2), `ExitAuth` (3), `ExitRBAC` (4), `ExitServer` (5), `ExitNetwork` (6) - exit codes.
- `[client.go:Error]` with `[client.go:Error.ExitCode]` - decoded failure (`StatusCode`, `Code`, `Message`, `RequestID`).
- `[client.go:Client.DoJSON]`, `[client.go:Client.GetRaw]`, `[client.go:Client.Get]`, `[client.go:Client.Post]`, `[client.go:Client.Delete]` - generic calls.
- Typed endpoints: `[client.go:Client.Health]`, `RbacStatus`, `AppConfig`, `Whoami`, `Validate`, `CanAccess`, `QueryExecute`, `QueryExplain`, `QueryTableSelect`, `DDLSimulate`, `ExplorerDatabases`, `ExplorerTable`, `ExplorerSample`, `UploadPreview`.
- `[transport.go:TLSOptions]` / `[transport.go:Client.ConfigureTLS]` - extra CA bundle or explicit insecure mode.
- `[transport.go:RetryPolicy]` / `[transport.go:DefaultRetryPolicy]` - 3 attempts, 500 ms base, 10 s cap.
- `[transport.go:Client.EnableDebug]` - request tracing.
- `[mcp.go:MCPPath]`, `[mcp.go:Client.MCPEndpoint]`, `[mcp.go:Client.MCPCall]`, `[mcp.go:Client.MCPTools]`, `[mcp.go:MCPTool]`.

## Invariants

- Requests send `Authorization: Bearer <PAT>`, `X-Connection-Id` when set and the `User-Agent`, and never `X-Requested-With` or `X-Session-ID` `[client.go:Client.newRequest]`. `UploadPreview` builds its own multipart request: it sends `Authorization` and `X-Connection-Id` but no `User-Agent`, and its errors carry no `RequestID` `[client.go:Client.UploadPreview]`.
- Only idempotent requests (GET/HEAD) are retried, on network errors, 429, 502, 503 and 504; writes are never retried `[transport.go:Client.do]`, `[transport.go:retryableStatus]`.
- Retry delay honours `Retry-After` seconds, otherwise backs off exponentially, always capped by `MaxDelay` `[transport.go:RetryPolicy.retryDelay]`.
- Context cancellation and deadlines surface as themselves, not as `NETWORK_ERROR` `[client.go:Client.DoJSON]`, `[mcp.go:Client.MCPCall]`.
- Status mapping: no response -> 6, 401 -> 3, 403 -> 4, 400/404/409 -> 2, everything else -> 5 `[client.go:Error.ExitCode]`.
- All three server failure shapes are normalised to a non-empty code and message `[client.go:decodeError]`.
- Response bodies are read up to 32 MiB `[client.go:Client.DoJSON]`, `[client.go:Client.GetRaw]`; `UploadPreview` reads up to 8 MiB `[client.go:Client.UploadPreview]`.
- TLS is at least 1.2 when configured, and the cloned default transport keeps proxy settings `[transport.go:Client.ConfigureTLS]`.
- Debug tracing never prints headers or bodies, so tokens cannot leak `[transport.go:debugTransport.RoundTrip]`.
- MCP responses are accepted as JSON or a one-event SSE stream; JSON-RPC errors become `MCP_<code>` errors `[mcp.go:Client.MCPCall]`, `[mcp.go:firstSSEData]`.

## Side Effects

- HTTP(S) calls to the configured CHouse UI server under `/api/*` and `/mcp` `[client.go:Client.DoJSON]`, `[mcp.go:Client.MCPCall]`.
- Reads the CA bundle file `[transport.go:Client.ConfigureTLS]` and the upload file `[client.go:Client.UploadPreview]` from disk.
- Writes one trace line per request to the debug writer when enabled `[transport.go:debugTransport.RoundTrip]`.

## Verification

- Run: `cd cli && go test ./internal/api/...`
