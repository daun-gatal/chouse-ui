# CHouse Assistant Tools

## Overview
CHouse Assistant v3 toolkits and UI tools (ADR 0025 §5). The assistant always sees its core tools plus the write tools of loaded toolkits: the current page's toolkit up front, others loaded on demand.

## Interface
- `[tools.ts:ASSISTANT_TOOLS]` - assistant catalog tools: `load_toolkit`, `navigate`, `open_entity`, and `fill_form` (puts up to 20,000 chars of SQL into a new `sql_editor` tab without running or saving it).
- `[tools.ts:LOAD_TOOLKIT_TOOL]`, `[tools.ts:loadedToolkits]`, `[tools.ts:toolkitMiddleware]` - on-demand toolkit loading.
- `[tools.ts:toolkitsForPage]`, `[tools.ts:pagePath]`, `[tools.ts:pagePromptSection]` - page-to-toolkit mapping and prompt text.
- `[tools.ts:navigablePath]`, `[tools.ts:entityPath]` - safe in-app paths.

## Invariants
- Write tools are only visible for toolkits the run has loaded (`[tools.ts:toolkitMiddleware]`).
- `[tools.ts:toolkitsForPage]` always preloads the `data` toolkit, plus the current page's toolkits.

## Side Effects
- None server-side (pure tool and middleware definitions); `fill_form`, `navigate` and `open_entity` return UI instructions the client acts on (`[tools.ts:ASSISTANT_TOOLS]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
