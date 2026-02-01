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

## xcj85c38 - Fix Terminal WebSocket connection failures in E2E tests

- **WebSocket upgrade rejection pattern**: When rejecting WebSocket connections (e.g., for auth failures, concurrent connections, or non-existent VMs), accept the upgrade and send an error message over the WebSocket rather than rejecting at the HTTP level. Browser WebSocket clients don't reliably fire error/close events when upgrades are rejected with HTTP error codes.

- **File descriptor cleanup**: When spawning child processes with pipes (like Firecracker), always close the parent process file descriptors after the spawn. The child inherits the fds, and leaving them open in the parent causes issues with pipe reopening on reconnection.

- **E2E test module resolution**: Vitest needs explicit path aliases in the config to resolve workspace packages like `@bonfire/sdk` in E2E tests running in Docker.

- **WebSocket readyState timing**: After closing a WebSocket or receiving an error, the readyState may be `CLOSING` (2) rather than `CLOSED` (3). Tests should accept either state rather than requiring immediate closure.

- **Serial console reconnection**: When reconnecting to a serial console, allow sufficient time (3+ seconds) for the previous connection's file handles to fully close before attempting to reopen the pipes.

- **Firecracker stdio mapping**: Remember that Firecracker's stdin connects to the stdout pipe (for input TO the VM) and stdout connects to the stdin pipe (for output FROM the VM). This naming inversion is intentional from the VM's perspective.

## n6yzfi15 - Fix Browser UI E2E tests - missing agent-browser CLI

- **agent-browser CLI installation**: The agent-browser tool is installed globally via `npm install -g agent-browser`. It depends on Playwright, which needs browsers installed via `npx playwright install chromium`.

- **Dockerfile placement matters**: The agent-browser and Playwright installation should happen after the main pnpm install but before the build, as shown in docker/Dockerfile lines 74-78:
  ```dockerfile
  RUN npm install -g agent-browser
  RUN npx playwright install chromium
  ```

- **Playwright browser dependencies**: When running in Docker, Playwright needs system dependencies for Chromium. These are installed via apt in the Dockerfile (libnss3, libatk-bridge2.0-0, libgtk-3-0, libgbm-dev, etc.).

- **E2E test execution**: The Browser UI tests use agent-browser commands like `open`, `snapshot`, `click`, `fill` to automate browser interactions. The tests spawn the agent-browser CLI as a child process with a session name for isolation.

- **Test vs CLI installation**: While the CLI tool is installed globally in the Dockerfile, local development may also need it installed globally for testing outside Docker: `npm install -g agent-browser && npx playwright install chromium`
