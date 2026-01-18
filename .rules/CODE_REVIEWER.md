# Code Reviewer Rules

This document defines the rules and checklist for reviewing code changes in this repository. All code reviews must ensure consistency, production-grade quality, and adherence to best practices.

## Table of Contents
1. [Review Checklist](#review-checklist)
2. [TypeScript Review](#typescript-review)
3. [React Review](#react-review)
4. [Code Structure Review](#code-structure-review)
5. [Security Review](#security-review)
6. [Performance Review](#performance-review)
7. [Error Handling Review](#error-handling-review)
8. [Testing Review](#testing-review)
9. [Documentation Review](#documentation-review)
10. [Common Issues to Watch For](#common-issues-to-watch-for)

---

## Review Checklist

### Pre-Review
- [ ] Code follows the project's file structure and naming conventions
- [ ] No sensitive data (passwords, tokens, API keys) in code
- [ ] No commented-out code or debug statements
- [ ] Code is properly formatted and linted

### TypeScript Review
- [ ] No `any` types used (use `unknown` and type guards instead)
- [ ] All functions have explicit return types
- [ ] Interfaces/types are properly defined
- [ ] Type assertions (`as`) are avoided or justified
- [ ] Type guards are used for type narrowing
- [ ] Imports are properly organized and use `import type` for types

### React Review
- [ ] All hooks are properly imported
- [ ] `useEffect` dependencies are complete and correct
- [ ] Cleanup functions are returned from `useEffect` when needed
- [ ] `useRef` is used for values that shouldn't trigger re-renders
- [ ] `useMemo` and `useCallback` are used appropriately
- [ ] No infinite loops or unnecessary re-renders
- [ ] Component props are properly typed
- [ ] State management follows existing patterns (Zustand for global, useState for local)

### Code Structure Review
- [ ] Code follows feature-based organization
- [ ] Functions have single responsibility
- [ ] Complex logic is extracted to utilities or custom hooks
- [ ] Naming conventions are followed (PascalCase for components, camelCase for functions)
- [ ] Code is DRY (Don't Repeat Yourself)
- [ ] Early returns are used to reduce nesting

### Security Review
- [ ] Input validation is implemented (Zod schemas for API)
- [ ] Authentication/authorization checks are in place
- [ ] RBAC permissions are verified on server-side
- [ ] No SQL injection vulnerabilities (parameterized queries)
- [ ] No XSS vulnerabilities (`dangerouslySetInnerHTML` is avoided or sanitized)
- [ ] Sensitive data is not logged
- [ ] Environment variables are used for secrets

### Performance Review
- [ ] Expensive computations are memoized
- [ ] Callbacks passed to children are memoized with `useCallback`
- [ ] Large lists use virtualization
- [ ] Data fetching uses TanStack Query with proper cache keys
- [ ] Unnecessary re-renders are avoided
- [ ] Memory leaks are prevented (cleanup in useEffect)
- [ ] Debouncing/throttling is used for user input

### Error Handling Review
- [ ] Try-catch blocks wrap async operations
- [ ] Error messages are user-friendly
- [ ] Errors are logged with context
- [ ] Server errors use `AppError` class
- [ ] Proper HTTP status codes are used
- [ ] Resource cleanup is implemented (connections, timers, etc.)

### Testing Review
- [ ] Unit tests cover critical logic
- [ ] Edge cases are tested
- [ ] Error cases are tested
- [ ] Tests are meaningful and not just for coverage

### Documentation Review
- [ ] Complex logic has explanatory comments
- [ ] Functions have JSDoc when needed
- [ ] Types/interfaces are documented
- [ ] No commented-out code

---

## TypeScript Review

### Critical Issues
- ❌ **Using `any` type**: Must be fixed
  ```typescript
  // ❌ Bad
  function process(data: any) { ... }
  
  // ✅ Good
  function process(data: unknown) {
    if (isValidData(data)) { ... }
  }
  ```

- ❌ **Missing return types**: Should be explicit
  ```typescript
  // ❌ Bad
  function getUser(id: string) { ... }
  
  // ✅ Good
  function getUser(id: string): Promise<UserResponse> { ... }
  ```

- ❌ **Type assertions without validation**: Use type guards
  ```typescript
  // ❌ Bad
  const user = data as User;
  
  // ✅ Good
  if (isUser(data)) {
    const user = data; // Type is narrowed
  }
  ```

### Warning Issues
- ⚠️ **Complex type definitions**: Should be extracted to interfaces
- ⚠️ **Missing type imports**: Use `import type` for type-only imports
- ⚠️ **Inconsistent type usage**: Follow existing patterns

---

## React Review

### Critical Issues
- ❌ **Missing hook imports**: Must be fixed
  ```typescript
  // ❌ Bad
  const [state, setState] = useState(); // useRef not imported but used
  
  // ✅ Good
  import React, { useState, useRef } from "react";
  ```

- ❌ **Infinite loops in useEffect**: Must be fixed
  ```typescript
  // ❌ Bad
  useEffect(() => {
    setCount(count + 1); // Missing dependency or wrong dependency
  }, [count]); // Creates infinite loop
  
  // ✅ Good
  useEffect(() => {
    // Use ref for non-reactive values
    previousLogStatesRef.current = newStates;
  }, [filteredLogs]);
  ```

- ❌ **Memory leaks**: Missing cleanup
  ```typescript
  // ❌ Bad
  useEffect(() => {
    const timeout = setTimeout(() => {}, 1000);
    // Missing cleanup
  }, []);
  
  // ✅ Good
  useEffect(() => {
    const timeout = setTimeout(() => {}, 1000);
    return () => clearTimeout(timeout);
  }, []);
  ```

### Warning Issues
- ⚠️ **Unnecessary re-renders**: Missing memoization
- ⚠️ **Inline functions/objects**: Should use `useCallback`/`useMemo`
- ⚠️ **Missing dependency arrays**: Check all dependencies

---

## Code Structure Review

### Critical Issues
- ❌ **Code duplication**: Should be extracted to utilities
- ❌ **Functions doing too much**: Should be split
- ❌ **Inconsistent naming**: Should follow conventions

### Warning Issues
- ⚠️ **Deep nesting**: Should use early returns
- ⚠️ **Long functions**: Should be broken down
- ⚠️ **Magic numbers/strings**: Should be constants

---

## Security Review

### Critical Issues
- ❌ **No input validation**: Must validate all user input
- ❌ **Missing auth checks**: Must verify permissions
- ❌ **SQL injection risk**: Must use parameterized queries
- ❌ **XSS vulnerability**: Must sanitize HTML or avoid `dangerouslySetInnerHTML`
- ❌ **Sensitive data in logs**: Must remove or mask

### Warning Issues
- ⚠️ **Client-side only validation**: Server must also validate
- ⚠️ **Weak error messages**: Don't expose internals

---

## Performance Review

### Critical Issues
- ❌ **Memory leaks**: Missing cleanup in useEffect
- ❌ **N+1 queries**: Should batch or optimize
- ❌ **Large bundle size**: Should use code splitting

### Warning Issues
- ⚠️ **Missing memoization**: Expensive computations should be memoized
- ⚠️ **Unnecessary re-renders**: Should optimize with React.memo
- ⚠️ **Large data fetching**: Should implement pagination

---

## Error Handling Review

### Critical Issues
- ❌ **Unhandled promises**: Must use try-catch or .catch()
- ❌ **Silent failures**: Should log errors appropriately
- ❌ **Generic error messages**: Should be specific

### Warning Issues
- ⚠️ **Missing error boundaries**: Should add for component errors
- ⚠️ **Poor error UX**: Should show user-friendly messages

---

## Testing Review

### Critical Issues
- ❌ **No tests for new utility functions**: Should add tests
- ❌ **No tests for new API modules**: Should add tests
- ❌ **No tests for security-related code**: Must add tests for validation, escaping, auth
- ❌ **Existing tests broken by changes**: Must fix
- ❌ **Tests don't cover edge cases**: Should add null/empty/boundary tests

### Warning Issues
- ⚠️ **Low test coverage on critical paths**: Should improve coverage
- ⚠️ **Tests only cover happy path**: Should add error case tests
- ⚠️ **Flaky tests**: Should fix instability
- ⚠️ **Test file not co-located**: Should be next to source file

### Review Checklist for Tests

**When reviewing new code, ask:**
- [ ] Are there tests for new utility functions?
- [ ] Are there tests for new API methods?
- [ ] Do tests cover edge cases (empty input, null, boundaries)?
- [ ] Do tests cover error handling paths?
- [ ] Are security-related functions tested?

**When reviewing test code, check:**
- [ ] Tests use descriptive names (`it('should...`)
- [ ] Tests are independent (no shared state issues)
- [ ] Mocks are appropriate (MSW for API, vi.mock for modules)
- [ ] Store tests use dynamic imports (avoid Zustand persist issues)
- [ ] Tests don't duplicate coverage unnecessarily

### Test Expectations by File Type

| File Type | Test Required? | Notes |
|-----------|----------------|-------|
| `src/api/*.ts` | ✅ Required | Mock API with MSW |
| `src/hooks/*.ts` | ✅ Required for logic | Use renderHook, skip pure UI hooks |
| `src/lib/*.ts` | ✅ Required | Pure function tests |
| `src/helpers/*.ts` | ✅ Required | Pure function tests |
| `src/stores/*.ts` | ✅ Required | Use dynamic imports |
| `src/utils/*.ts` | ✅ Required | Pure function tests |
| `src/components/*.tsx` | ⚠️ Optional | Only for complex logic |

### Running Tests

Reviewers should verify tests pass:
```bash
# Frontend tests
bunx vitest run src/api src/lib src/helpers src/hooks src/stores src/utils

# Server tests
./scripts/test-isolated-server.sh
```

---

## Documentation Review

### Critical Issues
- ❌ **No comments for complex logic**: Should add explanations
- ❌ **Commented-out code**: Should be removed

### Warning Issues
- ⚠️ **Missing JSDoc**: Should document complex functions
- ⚠️ **Unclear variable names**: Should use descriptive names

---

## Common Issues to Watch For

### 1. Missing Imports
```typescript
// ❌ Bad: Using useRef without importing
const ref = useRef(null);

// ✅ Good: Properly imported
import React, { useRef } from "react";
```

### 2. Incorrect useEffect Dependencies
```typescript
// ❌ Bad: Missing dependency
useEffect(() => {
  fetchData(userId);
}, []); // userId is used but not in deps

// ✅ Good: All dependencies included
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

### 3. Memory Leaks
```typescript
// ❌ Bad: No cleanup
useEffect(() => {
  const interval = setInterval(() => {}, 1000);
}, []);

// ✅ Good: Cleanup included
useEffect(() => {
  const interval = setInterval(() => {}, 1000);
  return () => clearInterval(interval);
}, []);
```

### 4. Using `any` Type
```typescript
// ❌ Bad: Using any
function process(data: any) { ... }

// ✅ Good: Proper typing
function process(data: unknown) {
  if (isValidData(data)) {
    // Type is narrowed
  }
}
```

### 5. Missing Error Handling
```typescript
// ❌ Bad: No error handling
const result = await fetchData();

// ✅ Good: Proper error handling
try {
  const result = await fetchData();
} catch (error) {
  console.error('[Component] Failed to fetch:', error);
  toast.error('Failed to load data');
}
```

### 6. Console.logs in Production
```typescript
// ❌ Bad: Always logs
console.log('Debug info:', data);

// ✅ Good: Conditional logging
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', data);
}
```

### 7. Missing Permission Checks
```typescript
// ❌ Bad: No permission check
async function deleteUser(id: string) {
  await db.delete(id);
}

// ✅ Good: Permission checked
async function deleteUser(id: string, userId: string) {
  await requirePermission(PERMISSIONS.USERS_DELETE);
  await db.delete(id);
}
```

### 8. Inefficient Re-renders
```typescript
// ❌ Bad: Creates new object on every render
<ChildComponent config={{ key: 'value' }} />

// ✅ Good: Memoized
const config = useMemo(() => ({ key: 'value' }), []);
<ChildComponent config={config} />
```

---

## Review Process

### Step 1: Initial Review
1. Check if code follows structure and naming conventions
2. Verify no sensitive data is exposed
3. Check for obvious bugs or issues

### Step 2: Detailed Review
1. Go through each section of the checklist
2. Test the changes locally if possible
3. Verify edge cases are handled

### Step 3: Security Review
1. Check for security vulnerabilities
2. Verify authentication/authorization
3. Check input validation

### Step 4: Performance Review
1. Check for performance issues
2. Verify optimizations are applied
3. Check for memory leaks

### Step 5: Final Review
1. Verify all critical issues are fixed
2. Check if code is maintainable
3. Ensure consistency with codebase

---

## Review Comments Format

### Critical Issues (Must Fix)
```
❌ **Critical**: [Issue description]
Reason: [Why it's critical]
Fix: [How to fix]
```

### Warning Issues (Should Fix)
```
⚠️ **Warning**: [Issue description]
Suggestion: [How to improve]
```

### Suggestions (Nice to Have)
```
💡 **Suggestion**: [Improvement suggestion]
```

### Positive Feedback
```
✅ **Good**: [What was done well]
```

---

## Approval Criteria

Code should be approved when:
- ✅ All critical issues are resolved
- ✅ Code follows TypeScript and React best practices
- ✅ Security review passes
- ✅ Performance is acceptable
- ✅ Error handling is proper
- ✅ Code is maintainable and consistent
- ✅ Documentation is adequate
- ✅ **Tests are added for new functions/modules**
- ✅ **All tests pass**

Code should NOT be approved if:
- ❌ Critical security issues exist
- ❌ TypeScript strict mode violations (`any` types, etc.)
- ❌ Memory leaks or performance issues
- ❌ Missing error handling
- ❌ Code doesn't follow project patterns
- ❌ **New utility/API code lacks tests**
- ❌ **Tests are failing**

---

## Resources

- [TypeScript Best Practices](https://typescript-eslint.io/rules/)
- [React Best Practices](https://react.dev/learn/escape-hatches)
- [Security Checklist](https://owasp.org/www-project-top-ten/)
- [Performance Best Practices](https://web.dev/performance/)
