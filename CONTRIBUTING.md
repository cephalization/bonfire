# Contributing to Bonfire

Thank you for your interest in contributing to Bonfire! This document provides guidelines and information for contributors.

## Development Workflow

### Setting Up Development Environment

1. Fork and clone the repository:
```bash
git clone https://github.com/yourusername/bonfire.git
cd bonfire
```

2. Install dependencies:
```bash
corepack enable
pnpm install
```

3. Run the setup script (requires root for network/VM setup):
```bash
sudo ./scripts/setup.sh
```

4. Start development servers:
```bash
# Terminal 1 - API server
pnpm --filter @bonfire/api dev

# Terminal 2 - Web UI
pnpm --filter @bonfire/web dev
```

### Project Structure

This is a monorepo using pnpm workspaces and Turborepo:

- `packages/api` - Hono API server with VM management endpoints
- `packages/web` - React frontend with terminal access
- `packages/sdk` - Auto-generated TypeScript SDK
- `packages/cli` - Command-line interface

### Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Use `pnpm run lint` to check code style
- Use `pnpm run typecheck` to check types

### Testing

All changes must include tests:

1. **Unit tests** (`*.test.ts`) - Fast, isolated tests
   - No filesystem writes
   - No network calls
   - No database connections
   - Run with: `pnpm -r test`

2. **Integration tests** (`*.integration.test.ts`) - Test with real routes
   - Use `createTestApp()` helper
   - Mock external services (Firecracker, Network)
   - Run with: `pnpm run test:int`

3. **E2E tests** (`e2e/*.test.ts`) - Full VM lifecycle tests
   - Require Linux with KVM
   - Run real Firecracker VMs
   - Run with: `pnpm run test:e2e`

### Making Changes

1. Create a feature branch:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and add tests

3. Run tests to ensure everything passes:
```bash
pnpm -r test
```

4. Run linting and type checking:
```bash
pnpm run lint
pnpm run typecheck
```

5. Commit your changes:
```bash
git add .
git commit -m "feat: add your feature description"
```

### Commit Message Format

Use conventional commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

Example:
```
feat: add terminal resize handling

Adds terminal resize support via xterm escape sequences.
Includes unit and integration tests.
```

### Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Create a pull request with clear description
4. Link any related issues
5. Wait for review

## Architecture Guidelines

### API Routes

- Use OpenAPI spec with Zod validation
- Place routes in `packages/api/src/routes/`
- Co-locate tests with `*.test.ts` suffix
- Use dependency injection for testability

### Web Components

- Use shadcn/ui components where possible
- Ensure mobile responsiveness (test at 375px width)
- Use `min-h-[44px]` for touch targets
- Follow React best practices

### Error Handling

- Use `BonfireAPIError` class for API errors
- Provide meaningful error messages
- Log server errors with context

### Mobile Responsiveness

All UI components must be mobile-responsive:

- Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)
- Test on small viewports (375px width)
- Use drawer components instead of dialogs on mobile
- Ensure touch targets are at least 44px

## Testing Guidelines

### Unit Tests

```typescript
import { describe, it, expect } from "vitest";

describe("My Feature", () => {
  it("should do something", () => {
    const result = myFunction();
    expect(result).toBe(expected);
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from "vitest";
import { createTestApp } from "../test-utils";

describe("POST /api/vms", () => {
  it("creates a VM", async () => {
    const { app, cleanup } = await createTestApp();
    
    const res = await app.request("/api/vms", {
      method: "POST",
      body: JSON.stringify({ name: "test-vm" }),
    });
    
    expect(res.status).toBe(201);
    cleanup();
  });
});
```

### Mock Services

Use the provided mock services in `test-utils.ts`:

- `createMockFirecrackerService()` - Mock Firecracker process management
- `createMockNetworkService()` - Mock network allocation
- `createMockSerialConsole()` - Mock serial console for terminal tests

## Questions?

If you have questions, please:

1. Check existing documentation
2. Search closed issues
3. Open a new issue with your question

## Code of Conduct

Be respectful and constructive in all interactions. We welcome contributors of all experience levels.
