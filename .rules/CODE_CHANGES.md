# Code Changes Rules

This document defines the rules and best practices for making code changes in this repository. All code changes must follow these guidelines to ensure consistency, maintainability, and production-grade quality.

## Table of Contents
1. [TypeScript Guidelines](#typescript-guidelines)
2. [React Guidelines](#react-guidelines)
3. [Code Structure](#code-structure)
4. [Error Handling](#error-handling)
5. [Performance](#performance)
6. [Security](#security)
7. [Testing](#testing)
8. [Documentation](#documentation)
9. [Code Style](#code-style)

---

## TypeScript Guidelines

### Type Safety
- **Always use strict TypeScript**: The project uses `strict: true` in tsconfig.json
- **Never use `any` type**: Use `unknown` if type is truly unknown, then narrow it
- **Avoid type assertions (`as`)**: Prefer type guards and proper type narrowing
- **Use proper return types**: Explicitly type function return values
- **Define interfaces/types**: Create proper interfaces for objects, especially API responses

### Type Definitions
```typescript
// ✅ Good: Proper interface definition
interface UserResponse {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
}

// ❌ Bad: Using any
function getUser(id: any): any { ... }

// ✅ Good: Proper typing
function getUser(id: string): Promise<UserResponse> { ... }
```

### Type Guards
```typescript
// ✅ Good: Type guard for narrowing
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// ✅ Good: Usage (client — use log helper, not console)
try {
  // ...
} catch (error) {
  if (isError(error)) {
    log.error('Operation failed', error);
  }
}
```

### Import/Export
- Use named exports for utilities and components
- Use default exports only for page components or main entry points
- Group imports: React → Third-party → Internal → Types
- Use absolute imports with `@/` prefix for internal modules

```typescript
// ✅ Good: Organized imports
import React, { useState, useMemo, useEffect, useRef } from "react";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Button } from "@/components/ui/button";
import { useQueryLogs } from "@/hooks";
import type { LogEntry } from "@/types";
```

---

## React Guidelines

### Hooks
- **Always import all hooks used**: Check imports before using `useState`, `useEffect`, `useRef`, etc.
- **Use proper hook dependencies**: Include all dependencies in `useEffect`, `useMemo`, `useCallback`
- **Avoid infinite loops**: Use `useRef` for values that shouldn't trigger re-renders
- **Cleanup side effects**: Always return cleanup functions from `useEffect` when needed

```typescript
// ✅ Good: Proper cleanup
useEffect(() => {
  const timeoutId = setTimeout(() => {
    setStatusChangedIds(new Set());
  }, 2000);
  
  return () => {
    clearTimeout(timeoutId);
  };
}, [filteredLogs]);

// ✅ Good: Using ref for non-reactive values
const previousLogStatesRef = useRef<Map<string, string>>(new Map());
```

### Component Structure
- **Functional components only**: Use function components, not class components
- **Type props properly**: Always type component props with interfaces
- **Extract complex logic**: Move complex logic to custom hooks or utilities
- **Memoization**: Use `useMemo` and `useCallback` for expensive computations and callbacks

```typescript
// ✅ Good: Properly typed component
interface InfoTabProps {
  database: string;
  tableName?: string;
}

const InfoTab: React.FC<InfoTabProps> = ({ database, tableName }) => {
  // Component logic
};
```

### State Management
- **Use Zustand for global state**: Follow existing patterns in `src/stores/`
- **Local state for component-specific data**: Use `useState` for local UI state
- **Derived state**: Use `useMemo` for computed values from props/state

### Performance Optimization
- **Memoize expensive computations**: Use `useMemo` for filtered/sorted arrays
- **Memoize callbacks**: Use `useCallback` for callbacks passed to child components
- **Avoid unnecessary re-renders**: Check dependencies and use `React.memo` when appropriate
- **Lazy loading**: Use `React.lazy` and `Suspense` for code splitting

```typescript
// ✅ Good: Memoized filtered data
const filteredLogs = useMemo(() => {
  // Complex filtering logic
  return logs.filter(/* ... */);
}, [logs, searchTerm, logType, selectedRoleId, usersByRoleData, limit]);
```

---

## Code Structure

### File Organization
- **Feature-based structure**: Organize by features, not file types
- **Co-location**: Keep related files together (components, hooks, types)
- **Barrel exports**: Use `index.ts` files for clean imports

### Naming Conventions
- **Components**: PascalCase (e.g., `DataExplorer.tsx`, `InfoTab.tsx`)
- **Hooks**: camelCase starting with `use` (e.g., `useQueryLogs.ts`, `useAuth.ts`)
- **Utilities**: camelCase (e.g., `sqlUtils.ts`, `utils.ts`)
- **Types/Interfaces**: PascalCase (e.g., `LogEntry`, `UserResponse`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `SYSTEM_ROLES`, `PERMISSIONS`)

### Function Structure
- **Single responsibility**: Each function should do one thing
- **Pure functions when possible**: Avoid side effects in utility functions
- **Error handling**: Always handle errors appropriately
- **Early returns**: Use early returns to reduce nesting

```typescript
// ✅ Good: Early returns, clear logic
function validateUser(user: unknown): user is User {
  if (!user || typeof user !== 'object') return false;
  if (!('id' in user) || typeof user.id !== 'string') return false;
  return true;
}
```

---

## Error Handling

### Client-Side
- **Try-catch blocks**: Always wrap async operations in try-catch
- **User-friendly messages**: Show meaningful error messages to users
- **Error boundaries**: Use React Error Boundaries for component-level errors
- **Toast notifications**: Use `toast.error()` for user-facing errors

```typescript
// ✅ Good: Proper error handling
try {
  await executeQuery.mutateAsync({ query });
  toast.success("Query executed successfully");
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  log.error('[Component] Operation failed', { errorMessage });
  toast.error(`Failed to execute: ${errorMessage}`);
}
// (Use import { log } from '@/lib/log'; in client code.)
```

### Server-Side
- **Use AppError**: Use the `AppError` class for consistent error responses
- **Proper HTTP status codes**: Use appropriate status codes (400, 401, 403, 404, 500)
- **Error logging**: Use the shared **logger** (see [Logging (server and client)](#logging-server-and-client)); log errors with context for debugging
- **Don't expose internals**: Don't leak sensitive information in error messages

```typescript
// ✅ Good: Server error handling (use logger, not console)
try {
  const user = await getUserById(id);
  if (!user) {
    throw AppError.notFound('User not found');
  }
  return c.json({ success: true, data: { user } });
} catch (error) {
  if (error instanceof AppError) {
    throw error;
  }
  requestLogger(c.get('requestId')).error({ err: error instanceof Error ? error.message : String(error) }, 'Failed to fetch user');
  throw AppError.internal('Failed to fetch user');
}
// (Use import { requestLogger } from '../utils/logger'; in server route.)
```

### Resource Cleanup
- **Close connections**: Always close database connections, file handles, etc.
- **Clear timeouts/intervals**: Clean up timers in `useEffect` cleanup
- **Abort controllers**: Use AbortController for canceling fetch requests

```typescript
// ✅ Good: Resource cleanup
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal });
  
  return () => {
    controller.abort();
  };
}, [url]);
```

---

## Performance

### React Performance
- **Avoid inline functions**: Use `useCallback` for event handlers passed to children
- **Avoid inline objects**: Use `useMemo` for object/array props
- **Virtualization**: Use virtualization for long lists (e.g., `@tanstack/react-virtual`)
- **Code splitting**: Split large bundles using dynamic imports

### Data Fetching
- **Use TanStack Query**: Use `useQuery` for data fetching and caching
- **Proper cache keys**: Use descriptive, stable cache keys
- **Stale time**: Set appropriate `staleTime` for different data types
- **Pagination**: Implement pagination for large datasets

```typescript
// ✅ Good: Proper query configuration
const { data: logs = [] } = useQuery({
  queryKey: ['queryLogs', limit, username, rbacUserId],
  queryFn: () => queryApi.executeQuery(/* ... */),
  staleTime: 10000,
  refetchInterval: 30000,
});
```

### Memory Management
- **Avoid memory leaks**: Clean up subscriptions, timers, event listeners
- **Limit data fetching**: Don't fetch more data than necessary
- **Debounce/throttle**: Use debouncing for search inputs, throttling for scroll events

---

## Security

### Input Validation
- **Validate all inputs**: Use Zod schemas for API request validation
- **Sanitize user input**: Never trust user input
- **SQL injection prevention**: Use parameterized queries (handled by ClickHouse client)
- **XSS prevention**: Avoid `dangerouslySetInnerHTML` when possible; sanitize if needed

### Authentication & Authorization
- **Check permissions**: Always verify user permissions before operations
- **RBAC middleware**: Use `rbacAuthMiddleware` and `requirePermission` on server
- **Client-side checks**: Use `PermissionGuard` component for UI protection
- **Never trust client**: Always validate on server-side

### Sensitive Data
- **Don't log sensitive data**: Never log passwords, tokens, or PII
- **Environment variables**: Use env vars for secrets, never commit them
- **Secure connections**: Use HTTPS in production

---

## Testing

### When to Add/Update Tests

**Add new tests when:**
- Creating a new utility function, hook, or API module
- Adding new exported functions to existing modules
- Implementing security-related functionality (validation, escaping, auth)
- Adding business logic that can be unit tested

**Update existing tests when:**
- Modifying function signatures or behavior
- Fixing bugs (add a test that would have caught the bug)
- Changing API response structures
- Updating validation logic

**Tests may be skipped for:**
- Pure UI components without complex logic (use visual testing instead)
- Simple re-exports from index files
- Third-party library wrappers with minimal logic

### Testing Frameworks

**Frontend (Vitest + jsdom):**
- Located in `src/**/*.test.ts`
- Uses MSW (Mock Service Worker) for API mocking
- React Testing Library for hooks
- Run with: `bunx vitest run`

**Server (Bun Test):**
- Located in `packages/server/src/**/*.test.ts`
- Uses Hono's built-in test utilities
- Run with: `./scripts/test-isolated-server.sh`

### Test File Structure

Test files should be co-located with source files:
```
src/
  api/
    client.ts
    client.test.ts     # ← Test file next to source
  hooks/
    useDebounce.ts
    useDebounce.test.ts
  stores/
    auth.ts
    auth.test.ts
```

### Test Patterns

#### API/Utility Tests
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myModule', () => {
  describe('myFunction', () => {
    it('should return expected result for valid input', () => {
      expect(myFunction('valid')).toBe('expected');
    });

    it('should handle edge cases', () => {
      expect(myFunction('')).toBe('');
      expect(myFunction(null as any)).toBe('');
    });

    it('should throw on invalid input', () => {
      expect(() => myFunction('invalid')).toThrow();
    });
  });
});
```

#### Store Tests (Zustand)
Use dynamic imports to avoid initialization issues:
```typescript
import { describe, it, expect } from 'vitest';

describe('stores/myStore', () => {
  it('should export useMyStore', async () => {
    const module = await import('./myStore');
    expect(module.useMyStore).toBeDefined();
    expect(typeof module.useMyStore).toBe('function');
  });
});
```

#### Hook Tests
```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMyHook } from './useMyHook';

describe('useMyHook', () => {
  it('should return initial value', () => {
    const { result } = renderHook(() => useMyHook('initial'));
    expect(result.current).toBe('initial');
  });
});
```

### What to Test

**Always test:**
- ✅ Security functions (validation, escaping, sanitization)
- ✅ Data transformation functions
- ✅ API client methods
- ✅ Error handling paths
- ✅ Edge cases (empty strings, null, undefined, boundaries)

**Test exports validate that:**
- ✅ All public functions are exported
- ✅ No breaking changes to module API
- ✅ Types are properly defined

### Test Coverage Goals
- Aim for 80%+ coverage on utilities and API modules
- Focus on critical paths over line coverage
- Prioritize security-related code

---

## Documentation

### Code Comments
- **Explain why, not what**: Comments should explain reasoning, not obvious code
- **JSDoc for functions**: Document complex functions with JSDoc
- **Remove commented code**: Delete commented-out code before committing

```typescript
// ✅ Good: Meaningful comment
// Fetch more logs than requested to account for:
// 1. Deduplication (multiple entries per query_id)
// 2. Filtering (search, logType, role filters may exclude many logs)
const fetchLimit = Math.max(limit * multiplier, 1000);
```

### Type Documentation
- **Document complex types**: Add comments for complex type definitions
- **Interface documentation**: Document interfaces used in APIs

---

## Code Style

### Formatting
- **Consistent indentation**: Use 2 spaces (as configured)
- **Trailing commas**: Use trailing commas in multi-line objects/arrays
- **Quotes**: Use double quotes for strings (TypeScript default)
- **Semicolons**: Use semicolons consistently

### Logging (server and client)
- **Prefer logging utilities over raw console**: Do not use `console.log`/`console.error`/`console.warn` in application code. Use the shared logger on the server and the `log` helper on the client for consistent, level-based, and (server) JSON-formatted logs.
- **Server** (`packages/server`): Use the shared **logger** from `utils/logger.ts` (Pino). All logs are JSON (one line per entry). Use `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`; use `requestLogger(c.get('requestId'))` in route handlers for request-scoped logs with correlation ID. Set `LOG_LEVEL` (e.g. `info` in production, `debug` in development). Never log passwords, tokens, or full request bodies.
- **Client** (`src`): Use the **log** helper from `@/lib/log`. Use `log.error()`, `log.warn()` for errors/warnings (always); use `log.info()`, `log.debug()` for dev-only messages (they no-op in production). Pass an optional context object; do not log sensitive data.

```typescript
// ✅ Good: Server route
import { requestLogger } from '../utils/logger';
requestLogger(c.get('requestId')).error({ module: 'MyRoute', err: e.message }, 'Failed to fetch');

// ✅ Good: Client
import { log } from '@/lib/log';
log.error('Failed to fetch data', { err: error instanceof Error ? error.message : String(error) });
log.debug('Debug info', { key: data }); // dev only
```

### Imports
- **Group imports**: React → Third-party → Internal → Types
- **Absolute imports**: Use `@/` prefix for internal modules
- **Type imports**: Use `import type` for type-only imports

---

## Checklist Before Committing

- [ ] All TypeScript types are properly defined (no `any`)
- [ ] All React hooks are properly imported
- [ ] All `useEffect` hooks have proper cleanup
- [ ] Error handling is implemented for async operations
- [ ] Resource cleanup is implemented (timers, connections, etc.)
- [ ] Server uses `logger` (no raw console); client uses `log` helper for errors/debug
- [ ] Input validation is implemented
- [ ] Permissions are checked (server-side)
- [ ] Performance optimizations applied (memoization, etc.)
- [ ] Code follows existing patterns and structure
- [ ] No commented-out code
- [ ] Meaningful variable and function names
- [ ] Code is properly formatted
- [ ] **Unit tests added/updated for new/modified functions**
- [ ] **All tests pass (`bunx vitest run` for frontend)**

---

## Common Patterns in This Codebase

### API Client Pattern
```typescript
// src/api/*.ts files
export const queryApi = {
  executeQuery: async (sql: string, format?: string) => {
    // Implementation
  },
};
```

### Custom Hook Pattern
```typescript
// src/hooks/*.ts files
export function useQueryLogs(limit: number, username?: string, rbacUserId?: string) {
  return useQuery({
    queryKey: ['queryLogs', limit, username, rbacUserId],
    queryFn: async () => { /* ... */ },
  });
}
```

### Store Pattern (Zustand)
```typescript
// src/stores/*.ts files
export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set, get) => ({
      // State and actions
    }),
    { name: 'explorer-storage' }
  )
);
```

### Server Route Pattern
```typescript
// packages/server/src/routes/*.ts
const route = new Hono<{ Variables: Variables }>();
route.use("*", authMiddleware);
route.post("/endpoint", zValidator("json", Schema), async (c) => {
  // Handler
});
```

---

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [React Documentation](https://react.dev/)
- [TanStack Query Docs](https://tanstack.com/query/latest)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
