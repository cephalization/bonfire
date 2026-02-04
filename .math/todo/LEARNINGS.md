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

## w8oknctg - Phase 2: Agent-ready VM image

- **Docker heredoc gotcha**: When creating multi-line files in Dockerfiles with heredocs (`cat > file << 'EOF'`), the syntax can fail silently if there are whitespace or parsing issues. Using `printf` with explicit line arguments is more reliable: `printf '%s\n' 'line1' 'line2' > file`.

- **ext4 image creation without sudo**: You can create ext4 images without root by using privileged Docker containers with loop device support. The trick is to mount the ext4 image inside a privileged container, extract the tar, then unmount.

- **OpenCode installation path**: OpenCode installs to `/home/agent/.opencode/bin/opencode`, NOT `/home/agent/.local/bin/opencode`. The installation script updates `.bashrc` to add this to PATH.

- **debugfs for ext4 inspection**: You can inspect ext4 filesystem contents without mounting by using `debugfs` with commands like `debugfs -R 'stat /path' /image.ext4`. This works without sudo and is CI-friendly.

- **Size parsing from debugfs**: The debugfs stat output has "Size:" appearing twice (once for file size, once for fragment). Use `head -1` to get just the file size: `debugfs ... | grep "Size:" | head -1`.

- **Symlink detection**: In ext4, symlinks have "Type: symlink" not "Type: symbolic". Regex patterns should look for `Type: (regular|symlink)` to match both files and symlinks.

- **systemd service template**: The opencode@.service template uses `%i` to represent the instance name (session ID), which is passed as the password to OpenCode. WorkingDirectory uses `%i` to create per-session workspace directories.

- **corepack/pnpm setup**: Enable corepack with `corepack enable && corepack prepare pnpm@latest --activate`. This provides pnpm without a separate npm install.

- **Docker build context**: When building images, the entire project is sent as build context. Use `.dockerignore` to exclude large files like `images/` and `node_modules/` to speed up builds.

## d7gipbfh - Phase 3: SSH bootstrap service

- **SSH abstraction pattern**: Abstract SSH operations behind an interface (`SSHService`) with `connect()`, `exec()`, `disconnect()`, and `testConnection()` methods. This allows both real SSH (using ssh2) and mock implementations for testing without code changes.

- **Mock service pattern**: Create mock services that track calls in arrays and allow setting custom responses via regex patterns. This enables precise test assertions about what commands were executed without requiring actual network calls.

- **Bootstrap sequence idempotency**: The bootstrap process updates the database at each step (workspace path, status transitions). On failure, it updates status to 'error' with the error message, allowing retry via the POST `/api/agent/sessions/:id/retry` endpoint.

- **Background bootstrap execution**: Bootstrap runs asynchronously after session creation returns. The client polls the session status endpoint to track progress from 'creating' -> 'ready' or 'error'.

- **Health polling implementation**: The health endpoint polls `http://<vmIp>:4096/global/health` with configurable timeout (default 60s) and interval (default 2s). Uses standard fetch API with try/catch to handle connection failures gracefully.

- **Foreign key constraints in tests**: When creating test databases, include all tables referenced by foreign keys (like `images` table for VMs) to avoid "no such table" errors during INSERT operations.

- **Dependency injection for testing**: Services accept their dependencies via constructor parameters with defaults, enabling easy injection of mocks: `new RealBootstrapService(db, mockSSHService)`.

## ooq0a1e3 - Phase 4: OpenCode proxy

- **Hono wildcard route parameters**: When using wildcard routes (`*`) in Hono, the captured path is available via `c.req.param("*")`, not as a named parameter. However, this can be inconsistent depending on route registration order. A more reliable approach is to extract the path from the request URL using regex.

- **OpenAPI route conflicts with wildcards**: OpenAPI routes with parameterized paths (e.g., `{proxyPath+}`) can conflict with wildcard routes. When both are registered, the OpenAPI route may match first but fail validation if the parameter isn't captured correctly. For proxy routes with dynamic paths, it's often better to skip OpenAPI documentation or use wildcard routes exclusively.

- **Proxy path extraction**: For a reverse proxy at `/api/agent/sessions/:id/opencode/*`, extract the proxy path using regex on the request URL:

  ```typescript
  const pathMatch = url.pathname.match(/\/api\/agent\/sessions\/[^/]+\/opencode\/?(.*)$/);
  const proxyPath = pathMatch?.[1] ?? "";
  ```

- **HTML base href injection**: When proxying HTML content, inject a `<base href>` tag to ensure relative assets load correctly. Check if a base tag already exists to avoid duplication, and handle cases where `<head>` is missing by creating one.

- **Hop-by-hop header stripping**: Proxy responses should strip hop-by-hop headers like `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, and `upgrade` to prevent issues with connection management.

- **Mock fetch pattern for proxy testing**: Create mock fetch functions that track calls in an array and allow setting responses via URL patterns. This enables testing proxy behavior without real network calls:

  ```typescript
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const responses = new Map<string, Response>();
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), options: init || {} });
    return responses.get(url)?.clone() ?? new Response("Not Found", { status: 404 });
  };
  ```

- **SSE streaming in proxies**: Server-Sent Event responses should be passed through directly without reading the body, preserving the stream for the client to consume.

## 7ltzgbeu - Phase 5: Web UI

- **Test library patterns in this codebase**: The project uses `fireEvent` from `@testing-library/react` instead of `userEvent`. Tests use basic matchers like `toBeTruthy()` rather than jest-dom matchers like `toBeInTheDocument()`. Import the test setup with `import "../../test-setup"` at the top of test files.

- **Mock API pattern**: Use `vi.mock` to mock the entire API module, then use `vi.mocked()` to get typed mock functions:

  ```typescript
  vi.mock("@/lib/api", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    return {
      ...actual,
      listAgentSessions: vi.fn(),
    };
  });
  const mockListAgentSessions = vi.mocked(api.listAgentSessions);
  ```

- **Component test structure**: Tests use `MemoryRouter` for routing and mock API responses via the vi.mock pattern. Use `waitFor` for async assertions and avoid testing implementation details like internal state.

- **Responsive design patterns**: Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) for responsive layouts. Mobile-first approach with drawer components for mobile and dialog components for desktop using a media query hook.

- **Status badge colors**: Use consistent badge variants for status states:
  - `default` (blue) for "ready"
  - `secondary` (gray) for "creating"
  - `destructive` (red) for "error"
  - `outline` for "archived"

- **Polling pattern**: Use `useEffect` with `setInterval` for polling, with cleanup via `return () => clearInterval(interval)`. Fast-forward timers in tests with `vi.advanceTimersByTimeAsync(3000)`.

- **Navigation structure**: Add new routes to both `Layout.tsx` (navItems array) and `App.tsx` (Routes component) following existing patterns.

## ja2d72xw - Phase 6: Polish and hardening (Task 6.1 - Config Injection)

- **OpenCode config injection via systemd**: To inject environment variables into systemd user services, use the pattern: `export VAR='value' && systemctl --user import-environment VAR && systemctl --user start service`. This sets the env var in the current shell, imports it into systemd's environment, then starts the service.

- **JSON config serialization**: When serializing JSON for shell commands, ensure proper escaping. Using single quotes around the JSON in the shell command avoids most escaping issues: `export VAR='{"key":"value"}'`.

- **Config structure for OpenCode**: The MVP config should disable sharing (`share: "disabled"`), allow all operations (`permission: "allow"`), disable auto-updates (`autoupdate: false`), and bind to all interfaces on port 4096.

- **Testing env var injection**: Mock SSH services can track executed commands and verify that environment variable patterns are present in the command string. Look for patterns like `OPENCODE_CONFIG_CONTENT` and `systemctl --user import-environment`.

## 3uvde3rf - Agent UI Plan (Complete Implementation)

- **End-to-end agent session flow**: The complete agent session implementation spans 6 phases:
  1. Data model (agent_sessions table with Drizzle schema)
  2. Agent-ready VM image (Dockerfile with OpenCode, SSH, Node.js)
  3. SSH bootstrap service (clone repo, start OpenCode via systemctl)
  4. OpenCode proxy (reverse proxy with base href injection)
  5. Web UI (React pages with iframe embedding)
  6. Polish (config injection, error handling, retry logic)

- **Architecture verification**: All 438 tests pass across 4 packages (API: 291, Web: 106, SDK: 4, CLI: 37). The implementation follows the planned architecture with proper separation between Bonfire (VM orchestration) and OpenCode (agent runtime).

- **Key integration points**:
  - API routes at `/api/agent/sessions/*` for CRUD operations
  - Proxy routes at `/api/agent/sessions/:id/opencode/*` for OpenCode access
  - Web UI at `/agent/sessions` and `/agent/sessions/:id` for user interaction
  - Bootstrap service coordinates SSH connections and OpenCode lifecycle

- **Security considerations implemented**:
  - Basic auth injection for OpenCode with session ID as password
  - User-scoped session access (users can only access their own sessions)
  - HTML base href injection to prevent asset path issues
  - Hop-by-hop header stripping in proxy responses

## 2fvxakhr - Phase 2: Remove Serial Console

- **Finding all serial console references**: Use `grep` with multiple patterns to find all imports and usages of the serial console modules: `grep -r "from.*serial\|import.*serial" packages/api/src --include="*.ts"`. This catches imports from both the index.ts barrel file and direct imports from specific serial files.

- **Files that need updating when removing a major feature**:
  1. The actual service files (serial.ts, serial-runner.ts, serial-connections.ts)
  2. Test files for those services
  3. The barrel export file (firecracker/index.ts)
  4. Any files importing from the removed modules (process.ts, bootstrap.ts, terminal.ts, ws/terminal.ts)
  5. Test utility files that mock the removed services (test-utils.ts)
  6. Test files that test the removed functionality (terminal.test.ts, process.test.ts, bootstrap.test.ts)
  7. Watchdog or background services (vm-watchdog.ts)

- **TypeScript will catch missing exports**: Running `pnpm run typecheck` quickly identifies any files still importing from removed modules. The build will fail with "No matching export" errors pointing to exact line numbers.

- **Simplifying the FirecrackerProcess interface**: When removing pipe support, update the interface to remove `stdinPipePath` and `stdoutPipePath` fields. This affects:
  - The interface definition in process.ts
  - Mock implementations in test-utils.ts
  - Any destructuring that expects these fields

- **Graceful degradation for removed features**: Instead of completely breaking terminal and bootstrap functionality, return clear error messages indicating the feature is temporarily unavailable. This maintains API compatibility while signaling the feature removal.

- **Test updates when removing features**: Tests that relied on the removed functionality need to be updated to:
  - Test the new error behavior (bootstrap returns "temporarily unavailable")
  - Remove tests for removed functionality (serial console connection tests)
  - Update type tests to match new interfaces (FirecrackerProcess without pipe paths)

- **Serial console removal affects bootstrap**: The bootstrap service relied entirely on serial runner for VM configuration. When removing serial support, bootstrap becomes a no-op that returns an error. Future phases will need to implement an alternative bootstrap mechanism (likely via SSH).
