# Agent Development Guide

This document provides essential information for AI agents working on the Bonfire codebase.

## Project Overview

Bonfire is a self-hosted platform for ephemeral Firecracker microVMs with a web UI, API, SDK, and CLI.

### Tech Stack
- **Runtime**: Node.js 24+
- **Backend**: Hono (TypeScript)
- **Frontend**: React + Vite + shadcn/ui + ghostty-web terminal
- **Database**: SQLite + Drizzle ORM
- **Auth**: Better Auth
- **VMs**: Firecracker microVMs
- **Build**: Turborepo monorepo

### Monorepo Structure
```
bonfire/
├── packages/
│   ├── api/           # Hono API server (port 3000)
│   ├── web/           # React + Vite frontend (port 5173)
│   ├── sdk/           # TypeScript SDK (auto-generated)
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

# Restart a service (REQUIRED after backend code changes)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml restart api

# Stop services
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml down

# Check service status
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml ps
```

**Important**: The API server requires restart after code changes. The web server has hot reload via Vite.

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
import { createTestApp, createMockFirecrackerService, createMockNetworkService, createMockSerialConsole } from "../test-utils";

// Create a test app with mocked services
const { app, db, request, cleanup, mocks } = await createTestApp();

// Make requests
const res = await request('/api/vms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'test-vm' }),
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
- `packages/web/src/components/Terminal.tsx` - Terminal component (xterm.js)
- `packages/web/src/pages/` - Page components
- `packages/web/src/lib/api.ts` - API client

### Terminal Architecture

The terminal uses a WebSocket connection to the API which connects to the VM's serial console via named pipes (FIFOs):

```
Browser (xterm.js) <-> WebSocket <-> API (terminal.ts) <-> FIFO pipes <-> Firecracker VM
```

Key files:
- `packages/api/src/ws/terminal.ts` - WebSocket upgrade + serial bridge
- `packages/api/src/routes/terminal.ts` - HTTP preflight + OpenAPI metadata
- `packages/api/src/services/firecracker/serial.ts` - Serial console FIFO management
- `packages/web/src/components/Terminal.tsx` - Frontend terminal component

## Common Issues and Solutions

### Terminal Reconnection Issues

**Problem**: Garbled output when reconnecting to VM terminal after page refresh.

**Cause**: FIFO pipes buffer VM output while no WebSocket is connected. On reconnect, buffered data floods the terminal.

**Solution**: Data gating - only forward data to client after ready message is sent. See `packages/api/src/ws/terminal.ts`.

### Docker API Changes Not Taking Effect

**Problem**: Code changes in `packages/api/` not reflected.

**Solution**: Restart the API container:
```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml restart api
```

### Test Database Cleanup

Tests use temporary SQLite databases in `/tmp/`. The `cleanup()` function from `createTestApp()` handles removal.

## Build and Lint

```bash
# Build all packages
pnpm run build

# Build specific package
pnpm run build -- --filter=@bonfire/api

# Type checking
pnpm run typecheck

# Linting
pnpm run lint
```

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
fix: terminal reconnection - gate data forwarding to prevent FIFO buffer flood

When reconnecting to a VM terminal, the FIFO pipe buffers VM output while
no WebSocket is connected. On reconnect, this buffered data floods the
terminal causing garbled output.

Changes:
- terminal.ts: Send reset sequence and wait for buffer drain
- serial.ts: Use fsOpen file handle for reliable FIFO reading
- Terminal.tsx: Clear terminal on reconnection
```

## Debugging Tips

1. **API Logs**: `docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f api`

2. **Terminal Issues**: Add `console.log` statements in `terminal.ts` with `[Terminal:${id}]` prefix

3. **Serial Console**: Check `serial.ts` for FIFO read/write issues

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
