# providers

## Overview
Application-wide React context providers. Currently the TanStack Query provider and the single shared `QueryClient`.

## Interface
- `QueryProvider` (named and default export) - wraps children in `QueryClientProvider` [QueryProvider.tsx:QueryProvider]
- `queryClient` - the shared `QueryClient` instance for imperative cache work outside React [QueryProvider.tsx:queryClient]

## Invariants
- There is exactly one `QueryClient`; imperative callers (for example session cleanup) must import `queryClient` from here rather than create their own [QueryProvider.tsx:queryClient], [../utils/sessionCleanup.ts:cleanupUserSession].
- Defaults: queries retry 3 times with exponential backoff capped at 30 s, `staleTime` 30 s, `gcTime` 5 min, refetch on window focus; mutations retry once [QueryProvider.tsx:queryClient].

## Side Effects
- Holds the in-memory query cache for the app lifetime [QueryProvider.tsx:queryClient].

## Verification
- No co-located tests; covered by `bun run typecheck` (and indirectly by the full suite, `bunx vitest run`)
