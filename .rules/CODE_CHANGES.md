# Code Changes Rules

Rules and best practices for making code changes in this repository.

---

## TypeScript Guidelines

### Type Safety
- **Strict mode**: The project uses `strict: true` — never use `any` (use `unknown` + type guards)
- **Avoid `as` assertions**: Prefer type guards and proper narrowing
- **Explicit return types**: Type function return values explicitly
- **Define interfaces**: Create proper interfaces for objects, especially API responses

```typescript
// Type guard for narrowing
function isError(error: unknown): error is Error {
  return error instanceof Error;
}
```

### Import/Export
- Named exports for utilities and components; default exports only for page components
- Group imports: React > Third-party > Internal (`@/`) > Types
- Use `import type` for type-only imports

---

## React Guidelines

### Hooks
- Always import all hooks used — check imports before using `useState`, `useEffect`, `useRef`, etc.
- Include all dependencies in `useEffect`, `useMemo`, `useCallback`
- Use `useRef` for values that shouldn't trigger re-renders
- Always return cleanup functions from `useEffect` when needed

```typescript
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal });
  return () => controller.abort();
}, [url]);
```

### Components
- Functional components only, props typed via interfaces
- Extract complex logic to custom hooks or utilities
- Use `useMemo`/`useCallback` for expensive computations and child callbacks

### State Management
- Zustand for global state (follow patterns in `src/stores/`)
- `useState` for local UI state
- `useMemo` for derived/computed values

---

## Code Structure

### File Organization
- Feature-based structure, not file-type-based
- Co-locate related files (components, hooks, types)
- Barrel exports via `index.ts`

### Naming Conventions
- **Components**: PascalCase (`DataExplorer.tsx`)
- **Hooks**: camelCase with `use` prefix (`useQueryLogs.ts`)
- **Utilities**: camelCase (`sqlUtils.ts`)
- **Types/Interfaces**: PascalCase (`LogEntry`, `UserResponse`)
- **Constants**: UPPER_SNAKE_CASE (`SYSTEM_ROLES`)

### Functions
- Single responsibility, pure when possible
- Early returns to reduce nesting

---

## Error Handling

### Client-Side
- Try-catch with `toast.error()` for user-facing messages
- Use `log.error()` from `@/lib/log` for logging (never raw `console`)

```typescript
try {
  await executeQuery.mutateAsync({ query });
  toast.success("Query executed successfully");
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  log.error('[Component] Operation failed', { errorMessage });
  toast.error(`Failed to execute: ${errorMessage}`);
}
```

### Server-Side
- Use `AppError` class for consistent error responses (`AppError.notFound()`, `AppError.internal()`, etc.)
- Use `requestLogger(c.get('requestId'))` for request-scoped logging (never raw `console`)
- Don't expose internal details in error messages

### Resource Cleanup
- Close connections, clear timeouts/intervals, use AbortControllers for fetch

---

## Performance

- `useMemo`/`useCallback` for expensive computations and child callbacks
- Virtualization for long lists (`@tanstack/react-virtual`)
- Code splitting with `React.lazy` + `Suspense`
- TanStack Query with proper cache keys and `staleTime`
- Debounce search inputs, throttle scroll events
- Avoid memory leaks: clean up subscriptions, timers, event listeners

---

## Security

- **Validate all inputs**: Zod schemas for API requests
- **Authentication**: `rbacAuthMiddleware` + `requirePermission` on server routes
- **Client**: `PermissionGuard` component for UI protection
- **SQL injection**: Handled by `node-sql-parser` middleware
- **XSS**: Avoid `dangerouslySetInnerHTML`; sanitize with DOMPurify if needed
- **Sensitive data**: Never log passwords, tokens, or PII; use env vars for secrets

---

## Testing

### When to Add Tests
- **Required**: New utility functions, hooks, API modules, security-related code
- **Update**: When modifying function signatures, fixing bugs, changing validation
- **Optional**: Pure UI components without complex logic

### Frameworks
- **Frontend** (`src/**/*.test.ts`): Vitest + jsdom, MSW for API mocking, React Testing Library
- **Server** (`packages/server/src/**/*.test.ts`): Bun Test + Hono utilities

### Patterns
- Test files co-located with source (`file.ts` -> `file.test.ts`)
- Zustand store tests: use dynamic imports to avoid persist initialization issues
- Coverage goal: 80%+ on utilities and API modules

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  it('should return expected result for valid input', () => {
    expect(myFunction('valid')).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('');
  });
});
```

### Running Tests
```bash
bunx vitest run                           # All frontend tests
bunx vitest run src/api src/lib src/hooks # Specific directories
./scripts/test-isolated-server.sh         # Server tests
```

---

## Logging

### Server (`packages/server`)
Use the shared **logger** from `utils/logger.ts` (Pino). All logs are JSON. Use `requestLogger(c.get('requestId'))` in route handlers for correlation.

```typescript
import { requestLogger } from '../utils/logger';
requestLogger(c.get('requestId')).error({ module: 'MyRoute', err: e.message }, 'Failed to fetch');
```

### Client (`src`)
Use the **log** helper from `@/lib/log`. `log.debug()`/`log.info()` are dev-only (no-op in production).

```typescript
import { log } from '@/lib/log';
log.error('Failed to fetch data', { err: error instanceof Error ? error.message : String(error) });
```

---

## Code Style

- 2-space indentation, trailing commas, double quotes, semicolons
- Comments explain *why*, not *what* — no commented-out code
- JSDoc only for complex functions
- Group imports: React > Third-party > Internal (`@/`) > Types

---

## Documentation

The docs site (`docs/portfolio`, published at `/docs`) is the source of truth for
operating CHouse UI. A user-visible change is not done until its docs page is.

- **Hand-written pages** live in `docs/portfolio/src/content/docs/`. Update the page
  for the screen or feature you changed; add a page (and a manifest entry) for a new
  screen. Conventions: `docs/portfolio/src/docs-site/README.md`.
- **Generated pages** (permission catalog, environment variables, MCP tool catalog,
  CLI reference, Helm values) are built from the code by
  `docs/portfolio/scripts/gen-reference.ts`. Never edit them by hand — change the
  source, then run `bun scripts/gen-reference.ts` in `docs/portfolio`.
- **New environment variable:** add it to
  `docs/portfolio/src/content/reference/config-keys.ts`.
- **CLI command or flag changed:** regenerate the snapshot with
  `UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference` (in
  `cli/`), then `bun scripts/gen-reference.ts`.
- CI fails when a generated page is stale, the server reads an undocumented env
  var, an app screen (route or tab) has no docs page, or a docs link is broken.

---

## Checklist Before Committing

- [ ] No `any` types — all TypeScript types properly defined
- [ ] All React hooks properly imported with correct dependencies
- [ ] `useEffect` hooks have cleanup when needed
- [ ] Error handling implemented for async operations
- [ ] Server uses `logger`/`requestLogger`; client uses `log` helper (no raw `console`)
- [ ] Input validation with Zod schemas
- [ ] Permissions checked server-side (`requirePermission`)
- [ ] Performance optimizations applied (memoization, pagination)
- [ ] Code follows existing patterns and naming conventions
- [ ] No commented-out code
- [ ] Unit tests added/updated for new/modified functions
- [ ] All tests pass (`bunx vitest run`)
- [ ] Unused imports/symbols cleaned up in touched files (see `.rules/DEAD_CODE.md`)
- [ ] If change is user-visible: fragment added in `changelogs/unreleased/` (never edit `CHANGELOG.md`) and the docs page updated (see Documentation)
