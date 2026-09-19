# Agent Development Guide

This document covers day-to-day workflow: running things, testing, and browser
automation.

For architecture, conventions, and — importantly — what is deliberately missing
from this codebase, read [CLAUDE.md](./CLAUDE.md) first.

## Project Overview

Bonfire is a self-hosted platform for ephemeral Firecracker microVMs with a web UI, API, SDK, and CLI.

### Tech Stack

- **Runtime**: Node.js 24+
- **Backend**: Hono (TypeScript)
- **Frontend**: React + Vite + shadcn/ui + ghostty-web terminal component
- **Database**: SQLite + Drizzle ORM
- **Auth**: Shared API key via `X-API-Key` (no user accounts — see CLAUDE.md)
- **VMs**: Firecracker microVMs
- **Build**: Turborepo monorepo

### Monorepo Structure

```
bonfire/
├── packages/
│   ├── api/           # Hono API server (port 3000)
│   ├── web/           # React + Vite frontend (port 5173)
│   ├── sdk/           # TypeScript SDK (hand-written)
│   └── cli/           # CLI with Clack
├── docker/            # Docker configurations
├── scripts/           # Setup and utility scripts
└── e2e/               # End-to-end tests
```

## Development Environment

### Docker Development (Recommended)

Start both API and Web servers with hot reload:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d
```

Services:

- **API**: http://localhost:3000
- **Web UI**: http://localhost:5173
- **Default login**: admin@example.com / admin123

### Docker Commands

```bash
# Start services
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d

# View logs
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f api
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f web

# Restart a service (only needed if the process gets stuck)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml restart api

# Stop services
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml down

# Check service status
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml ps
```

**Important**: Both the API and web servers hot reload in the dev compose setup.

### Local Development (Alternative)

```bash
corepack enable
pnpm install
sudo ./scripts/setup.sh  # Requires root for network/VM setup
pnpm run dev              # Uses mprocs to run API and web
```

## Testing

### Test Commands

```bash
# Run all unit tests across all packages
pnpm -r test

# Run tests in a specific package
pnpm --filter @bonfire/api test
pnpm --filter @bonfire/web test

# Run a specific test file
pnpm --filter @bonfire/api exec vitest run packages/api/src/routes/terminal.test.ts
pnpm --filter @bonfire/web exec vitest run packages/web/src/components/Terminal.test.tsx

# Run tests matching a pattern
pnpm -r test -- --testNamePattern "resize"

# Integration tests (requires Docker)
pnpm run test:int

# E2E tests (requires KVM, Linux only)
pnpm run test:e2e

# All tests
pnpm run test:all
```

### Test Types

1. **Unit tests** (`*.test.ts`) - Fast, isolated
   - Located next to source files
   - No external dependencies
   - Run with: `pnpm -r test`

2. **Integration tests** (`*.integration.test.ts`)
   - Use `createTestApp()` from `packages/api/src/test-utils.ts`
   - Mock external services (Firecracker, Network)
   - Run with: `pnpm run test:int`

3. **E2E tests** (`e2e/*.test.ts`)
   - Full VM lifecycle and browser tests
   - Require Linux with KVM
   - Run with: `pnpm run test:e2e`

### Test Utilities (packages/api/src/test-utils.ts)

```typescript
import {
  createTestApp,
  createMockFirecrackerService,
  createMockNetworkService,
  createMockSerialConsole,
} from "../test-utils";

// Create a test app with mocked services
const { app, db, request, cleanup, mocks } = await createTestApp();

// Make requests
const res = await request("/api/vms", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "test-vm" }),
});

// Check mock calls
expect(mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);

// Always cleanup after tests
cleanup();
```

### Frontend Test Setup (packages/web/test-setup.ts)

The frontend uses happy-dom for DOM simulation and includes mocks for:

- `ResizeObserver`
- `requestAnimationFrame`
- `MutationObserver`
- Various DOM globals

## Browser Automation with agent-browser

For UI testing and debugging, use the `agent-browser` CLI tool:

### Basic Workflow

```bash
# Navigate to page
agent-browser open http://localhost:5173

# Get interactive elements with refs
agent-browser snapshot -i

# Interact using refs from snapshot
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser type @e3 "text"
agent-browser press Enter

# Take screenshot
agent-browser screenshot /tmp/screenshot.png

# Wait for elements/conditions
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait @e1                     # Wait for element
agent-browser wait --text "Success"        # Wait for text

# Close browser
agent-browser close
```

### Example: Testing Terminal

```bash
# Open app and navigate to VM
agent-browser open http://localhost:5173
agent-browser snapshot -i
agent-browser click @e7                    # Click Terminal button
agent-browser wait 2000

# Interact with terminal
agent-browser snapshot -i
agent-browser click @e8                    # Focus terminal input
agent-browser type @e8 "ls -la"
agent-browser press Enter
agent-browser wait 1000

# Screenshot the result
agent-browser screenshot /tmp/terminal.png
agent-browser close
```

### Reading Screenshots

Use the Read tool to view screenshots:

```
Read /tmp/screenshot.png
```

## Key Files Reference

### API

- `packages/api/src/index.ts` - App factory with dependency injection
- `packages/api/src/routes/` - API route handlers
- `packages/api/src/services/firecracker/` - VM management
- `packages/api/src/services/network/` - Network allocation
- `packages/api/src/db/schema.ts` - Database schema

### Web

- `packages/web/src/components/Terminal.tsx` - Terminal component (ghostty-web)
- `packages/web/src/pages/` - Page components
- `packages/web/src/lib/api.ts` - API client

### Terminal Architecture

```
Browser (ghostty-web) <-> WebSocket <-> API (ws/terminal.ts) <-> SSH pty <-> Firecracker VM
```

Key files:

- `packages/api/src/ws/terminal.ts` - WebSocket upgrade + SSH bridge
- `packages/api/src/routes/terminal.ts` - HTTP preflight, ticket minting, OpenAPI metadata
- `packages/api/src/lib/terminal-tickets.ts` - single-use handshake tickets
- `packages/api/src/services/ssh.ts` - ssh2 wrapper, including `shell()`
- `packages/api/src/services/ssh-keys.ts` - per-VM keypair generation/injection
- `packages/web/src/components/Terminal.tsx` - Frontend terminal component

The handshake cannot carry an `X-API-Key` header from a browser, so the client
mints a single-use ticket first. See [CLAUDE.md](./CLAUDE.md) for the details.

## Common Issues and Solutions

### Docker API Changes Not Taking Effect

**Problem**: Code changes in `packages/api/` not reflected.

**Solution**: Restart the API container (rare):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml restart api
```

### Test Database Cleanup

Tests use temporary SQLite databases in `/tmp/`. The `cleanup()` function from `createTestApp()` handles removal.

## Build, Lint, and Format

### Build Commands

```bash
# Build all packages
pnpm run build

# Build specific package
pnpm run build -- --filter=@bonfire/api

# Type checking
pnpm run typecheck
```

### Linting with Oxlint

This project uses [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) - a high-performance linter that's 50-100x faster than ESLint.

```bash
# Run linter
pnpm run lint

# Run linter with auto-fix
pnpm run lint:fix
```

Configuration: `.oxlintrc.json`

- Categories enabled: `correctness` (error), `suspicious` (warn), `perf` (warn)
- Plugins: `typescript`, `react`, `import`, `promise`, `vitest`
- Error rules (CI blocking): `react/jsx-key`, `import/no-cycle`, `import/no-self-import`
- Warning rules: `no-unused-vars`, `no-console`, `no-explicit-any`

Note: Unused variables use underscore prefix convention (`_unusedVar`) to suppress warnings.

### Formatting with Oxfmt

This project uses [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) - a high-performance formatter that's ~30x faster than Prettier.

```bash
# Format all files
pnpm run format

# Check formatting (CI)
pnpm run format:check
```

Configuration: `.oxfmtrc.json`

- Print width: 100
- Semicolons: yes
- Single quotes: no
- Trailing commas: es5

### Pre-commit Hooks

Husky + lint-staged automatically runs linting and formatting on staged files before each commit. This ensures consistent code quality without manual intervention.

## Commit Message Format

Use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance

Example:

```
fix: release TAP device when VM start fails after allocation

If Firecracker failed to spawn after the network resources were allocated,
the TAP device and IP lease were left behind, eventually exhausting the pool.

Changes:
- vms.ts: Release network resources in the failure path
- ip-pool.ts: Make release idempotent
```

## Debugging Tips

1. **API Logs**: `docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f api`

2. **Terminal Issues**: Check the API logs for the SSH bridge in
   `ws/terminal.ts`. A terminal that opens and immediately errors is usually
   the VM refusing SSH; try `bonfire vm ssh <name>` to confirm.

3. **SSH Issues**: Check `ssh-keys.ts` for key injection and `ssh.ts` for the
   connection itself; keys land under `/var/lib/bonfire/`

4. **Frontend State**: Use React DevTools or add console.log in component effects

5. **Network Issues**: Check VM IP allocation in database and TAP device creation

## Environment Variables

API (packages/api/.env):

```env
DB_PATH=/var/lib/bonfire/bonfire.db
BETTER_AUTH_SECRET=change-me-in-production
BETTER_AUTH_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=changeme123
INITIAL_ADMIN_NAME=Admin
```
