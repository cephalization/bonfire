# Serial Console Implementation Plan

## Overview

> NOTE: This plan is historical (written during the Bun-based era). Bonfire has migrated to Node 24+.
> Replace Slicer agent-based terminal with Firecracker native serial console support. This enables terminal access with ANY VM image (quickstart, custom, Slicer, etc.) without requiring a guest agent.

## Current State Analysis

### Existing Implementation

- **Location**: `packages/api/src/services/agent/shell.ts` + `packages/api/src/routes/terminal.ts`
- **Protocol**: WebSocket connection to Slicer agent at port 8080
- **Requirements**: VM must have Slicer agent running (proprietary, costs money)
- **Problem**: Does not work with Firecracker quickstart images or custom images

### Firecracker Serial Console Architecture

Browser (WebSocket) -> Bonfire API -> Serial Console Service -> Named Pipes <-> Firecracker Process -> VM Serial Console (ttyS0)

## Implementation Plan

### Phase 1: Serial Console Service

Create `packages/api/src/services/firecracker/serial.ts` to manage serial console I/O via named pipes.

Key implementation:

- Use Node file handles / streams for reading/writing FIFO pipes
- Create FIFOs using mkfifo system call
- Handle backpressure and buffering for WebSocket bridge

### Phase 2: VM Configuration Updates

Update `packages/api/src/services/firecracker/process.ts`:

1. Create serial pipes on VM start (.stdin and .stdout FIFOs)
2. Redirect Firecracker stdio to these pipes when spawning process
3. Boot args already include ip=dhcp for network

### Phase 3: Terminal Route Refactoring

Update `packages/api/src/routes/terminal.ts`:

- Replace agent WebSocket connection with serial console file I/O
- Keep WebSocket protocol unchanged for frontend compatibility
- Support resize messages (send xterm escape sequences)

### Phase 4: Cleanup

- Remove `packages/api/src/services/agent/` directory
- Remove Slicer references from documentation
- Deprecate or remove exec/cp endpoints that required agent

### Phase 5: Frontend

No changes needed - WebSocket protocol remains the same.

## Testing Strategy

### Test Architecture Overview

The project has 3 test layers:

1. **Unit Tests**: Pure functions, no I/O, co-located with source (\*.test.ts)
2. **Integration Tests**: Mocked services, real routes, isolated DB (.integration/\*.test.ts)
3. **E2E Tests**: Real Firecracker VMs, requires KVM (e2e/\*.test.ts)

### Test Files to Create/Update

#### Unit Tests

Create `packages/api/src/services/firecracker/serial.test.ts`:

- Test pipe path generation
- Test data formatting utilities
- Test error classes (SerialConsoleError)
- Mock Bun file I/O operations
- Test resize escape sequence generation

Update `packages/api/src/services/firecracker/process.test.ts`:

- Add tests for pipe creation logic
- Add tests for stdio redirection
- Mock spawn calls to verify arguments
- Test cleanup of pipes on VM stop

#### Integration Tests

Update `packages/api/src/test-utils.ts`:

- Replace `MockAgentClient` with `MockSerialConsole`
- Mock serial console methods: `create()`, `write()`, `onData()`, `close()`
- Track pipe creation/removal calls
- Remove agent-related mock helpers

Update `packages/api/.integration/vms.integration.test.ts`:

- Remove tests for agent-based exec/cp/health endpoints
- Add tests for VM start/stop with serial console pipes
- Verify pipe paths are stored in DB or derived correctly
- Test WebSocket terminal endpoint with mocked serial console

Update `packages/api/.integration/auth.integration.test.ts`:

- Ensure auth middleware works with terminal WebSocket route
- Test auth token validation on WebSocket upgrade

#### E2E Tests

Rewrite `e2e/terminal.test.ts`:

- Remove agent health check dependency
- Use quickstart image instead of Slicer image
- Test: Create VM -> Start VM -> Connect WebSocket -> Send echo command -> Verify output
- Test: Resize terminal -> Verify escape sequence handling
- Test: Concurrent connections (should reject second connection)
- Test: VM stop -> Terminal disconnect
- Test: Special characters and UTF-8
- Update SDK to remove `waitForVMAgentHealth()` dependency

### Test Migration Plan

#### Step 1: Create Serial Console Unit Tests

File: `packages/api/src/services/firecracker/serial.test.ts`

```typescript
// Tests for:
- generatePipePaths(vmId) returns correct paths
- formatResizeMessage(cols, rows) returns correct escape sequence
- SerialConsoleError class
- Mock Bun.file operations
- Backpressure handling logic
```

#### Step 2: Update Process Unit Tests

File: `packages/api/src/services/firecracker/process.test.ts`

```typescript
// Add tests for:
- spawnFirecracker creates stdin/stdout pipes
- VM start includes pipe paths in spawn options
- VM stop removes pipes
- Handle pipe creation failure
```

#### Step 3: Update Test Utilities

File: `packages/api/src/test-utils.ts`

```typescript
// Replace:
export interface MockAgentClient { ... }
export function createMockAgentClient(): MockAgentClient

// With:
export interface MockSerialConsole {
  create: (vmId: string, pipes: { stdin: string, stdout: string }) => Promise<void>
  write: (data: string | Uint8Array) => void
  onData: (callback: (data: Uint8Array) => void) => void
  close: () => void
  isActive: () => boolean
  calls: { ... }
}
export function createMockSerialConsole(): MockSerialConsole

// Update createTestApp to inject serial console mock
```

#### Step 4: Update Integration Tests

File: `packages/api/.integration/vms.integration.test.ts`

```typescript
// Remove:
- Tests for /api/vms/:id/exec
- Tests for /api/vms/:id/cp (upload/download)
- Tests for /api/vms/:id/health (agent health)
- References to mockAgentClient

// Add:
- Test VM start creates pipe files
- Test WebSocket terminal connection uses serial console
- Test resize messages sent to serial console
- Test second WebSocket connection rejected with 409
```

#### Step 5: Rewrite E2E Tests

File: `e2e/terminal.test.ts`

```typescript
// Remove:
- waitForVMAgentHealth() helper
- TEST_IMAGE_REF using Slicer image
- Tests depending on agent exec/cp

// Update:
- Use quickstart image (firecracker-quickstart:ubuntu-24.04)
- Remove agent health wait, just wait for VM running status
- Test commands via serial console (echo, pwd, ls)
- Test resize with xterm sequences
- Test reconnection (serial console should allow reconnect)

// Keep:
- WebSocket connection tests
- Command execution tests
- Special character tests
- Concurrent connection tests (but expect rejection)
```

### Testing Checklist

Before implementation:

- [ ] Review all existing agent tests
- [ ] Document current test coverage
- [ ] Identify tests that must be rewritten

During implementation:

- [ ] Write unit tests for serial service
- [ ] Update process tests for pipe handling
- [ ] Update test-utils with serial console mocks
- [ ] Update integration tests to use serial mocks
- [ ] Rewrite E2E tests for serial console

After implementation:

- [ ] All unit tests pass: `pnpm -r test`
- [ ] All integration tests pass: `pnpm run test:int`
- [ ] All E2E tests pass: `pnpm run test:e2e`
- [ ] Test with quickstart image manually
- [ ] Test terminal resize manually
- [ ] Test concurrent connections manually

## Technical Details

### Pipe Creation

Use mkfifo via Bun spawn to create named pipes before starting VM.

### Firecracker Spawning

Modify spawnFirecracker to redirect:

- stdin from VM_DIR/{vmId}.stdin pipe
- stdout/stderr to VM_DIR/{vmId}.stdout pipe

### Serial Protocol

- Input: Raw keystrokes written to stdin pipe
- Output: Read from stdout pipe and forward to WebSocket
- Resize: Send xterm escape sequence (ESC[8;rows;colst)

## Benefits

1. Works with ANY Firecracker-compatible image
2. No guest agent required (no Slicer dependency)
3. No network configuration required for terminal
4. Simpler architecture (no TCP/WebSocket inside VM)
5. Compatible with quickstart images

## Trade-offs

1. Serial console is exclusive (one user at a time)
2. No advanced features like file copy or exec without shell
3. Resize requires xterm escape sequences (not all apps support)
4. Binary data transfer not as clean as agent-based

## Implementation Order

1. Create serial console service
2. Update VM spawn to create pipes and redirect stdio
3. Update terminal route to use serial console
4. Write unit tests for serial service
5. Update integration tests
6. Rewrite E2E tests
7. Test with quickstart image
8. Archive agent code
9. Update documentation

## Risks and Mitigations

- Pipe buffer overflow: Use backpressure handling
- Stdio buffering: Use stdbuf/unbuffer if needed
- Encoding issues: Ensure UTF-8 throughout
- Multiple clients: Reject concurrent connections
- Test flakiness: Serial console timing differs from agent

## Files

Create:

- packages/api/src/services/firecracker/serial.ts
- packages/api/src/services/firecracker/serial.test.ts

Modify:

- packages/api/src/services/firecracker/process.ts
- packages/api/src/services/firecracker/process.test.ts
- packages/api/src/routes/terminal.ts
- packages/api/src/routes/vms.ts
- packages/api/src/test-utils.ts
- packages/api/.integration/vms.integration.test.ts
- e2e/terminal.test.ts

Archive:

- packages/api/src/services/agent/

## Effort Estimate

- Serial console service: 2 hours
- VM spawn updates: 1 hour
- Terminal route: 1 hour
- Unit tests: 2 hours
- Integration tests: 2 hours
- E2E tests: 3 hours
- Testing & debugging: 3 hours
- Cleanup: 1 hour
- Total: ~15 hours
