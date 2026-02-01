# Project Learnings Log

This file is appended by each agent after completing a task.
Key insights, gotchas, and patterns discovered during implementation.

Use this knowledge to avoid repeating mistakes and build on what works.

---

<!-- Agents: Append your learnings below this line -->
<!-- Format:
## <task-id>

- Key insight or decision made
- Gotcha or pitfall discovered
- Pattern that worked well
- Anything the next agent should know
-->

## w4lf5g8p - Phase 1: Data model and CRUD

- When auth is skipped in tests (`skipAuth: true`), routes that rely on `c.get("user")` will fail unless a mock user is injected into the context. The solution is to create a mock user in the database and add middleware that sets `c.set("user", mockUser)` before the routes are mounted.
- SQLite stores timestamps as integers (milliseconds since epoch), which can cause precision issues in tests comparing timestamps. Use tolerance-based comparisons (e.g., `expect(timestamp).toBeGreaterThanOrEqual(expected - 1000)`) when testing timestamp updates.
- The test-utils `createTestApp()` function now returns a `mockUserId` that tests can use when creating records that need to be scoped to the authenticated user.
- When using `app.use()` middleware in Hono, order matters - middleware must be registered before the routes it should apply to.
- For user-scoped resources, always filter by user ID in the database queries to ensure proper authorization. Use `and(eq(agentSessions.id, id), eq(agentSessions.userId, user.id))` patterns.
- OpenAPIHono validates request bodies using Zod schemas defined in `createRoute()`, but validation errors have a different format than custom validation. Tests should check for `body.error` being defined rather than checking for specific error strings.
