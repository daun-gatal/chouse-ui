# Code Reviewer Rules

Checklist and process for reviewing code changes. For coding standards and examples, see [CODE_CHANGES.md](CODE_CHANGES.md).

---

## Review Checklist

### Pre-Review
- [ ] No sensitive data (passwords, tokens, API keys) in code
- [ ] No commented-out code or debug statements
- [ ] Code is properly formatted and linted

### TypeScript
- [ ] No `any` types (use `unknown` + type guards)
- [ ] Explicit return types on functions
- [ ] Interfaces/types properly defined
- [ ] `import type` used for type-only imports
- [ ] Type assertions (`as`) avoided or justified

### React
- [ ] All hooks properly imported
- [ ] `useEffect` dependencies complete and correct
- [ ] Cleanup functions returned from `useEffect` when needed
- [ ] `useRef` used for non-reactive values
- [ ] `useMemo`/`useCallback` used appropriately
- [ ] No infinite loops or unnecessary re-renders
- [ ] Component props properly typed

### Code Structure
- [ ] Feature-based organization followed
- [ ] Single responsibility principle
- [ ] Naming conventions followed (PascalCase components, camelCase functions)
- [ ] DRY — no unnecessary duplication
- [ ] Early returns used to reduce nesting

### Security
- [ ] Input validation implemented (Zod schemas for API)
- [ ] Auth/authorization checks in place
- [ ] RBAC permissions verified server-side (`requirePermission`)
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities (`dangerouslySetInnerHTML` avoided or sanitized)
- [ ] Sensitive data not logged
- [ ] For auth, data access, SQL, CORS, outbound-request or dependency changes: the [SECURITY.md](SECURITY.md) security review checklist passes

### Performance
- [ ] Expensive computations memoized
- [ ] Callbacks to children memoized with `useCallback`
- [ ] Large lists use virtualization
- [ ] TanStack Query with proper cache keys
- [ ] Memory leaks prevented (cleanup in `useEffect`)
- [ ] Debouncing/throttling for user input

### Error Handling
- [ ] Try-catch wraps async operations
- [ ] Error messages are user-friendly
- [ ] Server errors use `AppError` class with proper HTTP codes
- [ ] Resources cleaned up (connections, timers)

### Testing
- [ ] Unit tests cover critical logic
- [ ] Edge cases tested (empty, null, boundaries)
- [ ] Error cases tested
- [ ] Tests are meaningful, not just for coverage

### Logging
- [ ] Server uses `logger`/`requestLogger` (never raw `console`)
- [ ] Client uses `log` helper from `@/lib/log` (never raw `console`)

---

## Common Issues to Watch For

1. **Missing hook imports** — using `useRef`, `useState` etc. without importing
2. **Incorrect `useEffect` dependencies** — missing deps or stale closures
3. **Memory leaks** — missing cleanup for timers, intervals, subscriptions
4. **`any` type usage** — always use `unknown` + type guards instead
5. **Missing error handling** — unhandled promises, silent failures
6. **Raw `console.*`** — use `logger` (server) or `log` (client)
7. **Missing permission checks** — server routes without `requirePermission`
8. **Inefficient re-renders** — inline objects/functions passed as props

---

## Test Expectations by File Type

| File Type | Tests Required? | Notes |
|-----------|----------------|-------|
| `src/api/*.ts` | Required | Mock API with MSW |
| `src/hooks/*.ts` | Required for logic | Use `renderHook`, skip pure UI hooks |
| `src/lib/*.ts` | Required | Pure function tests |
| `src/helpers/*.ts` | Required | Pure function tests |
| `src/stores/*.ts` | Required | Use dynamic imports |
| `src/utils/*.ts` | Required | Pure function tests |
| `src/components/*.tsx` | Optional | Only for complex logic |

---

## Review Process

1. **Initial** — Structure, naming, no sensitive data, obvious bugs
2. **Detailed** — Walk through checklist section by section
3. **Security** — Auth, validation, injection risks
4. **Performance** — Memoization, leaks, unnecessary re-renders
5. **Final** — Maintainability, consistency with codebase

---

## Approval Criteria

**Approve when:**
- All critical issues resolved
- TypeScript and React best practices followed
- Security review passes
- Error handling is proper
- Tests added for new functions/modules and all tests pass

**Do NOT approve if:**
- Critical security issues exist
- `any` types or strict mode violations
- Memory leaks or performance issues
- Missing error handling
- New utility/API code lacks tests
- Tests are failing

---

## Review Comment Format

```
❌ **Critical**: [Issue] — Reason: [why] — Fix: [how]
⚠️ **Warning**: [Issue] — Suggestion: [improvement]
💡 **Suggestion**: [Improvement idea]
✅ **Good**: [What was done well]
```
