# Bonfire Architecture Refactor Plan

## Executive Summary

This document outlines the simplification of the Bonfire architecture from ~13,000 lines to ~5,000 lines while maintaining core functionality. The refactor focuses on CLI-first VM management with SSH access instead of complex serial console infrastructure.

**Target State:**

- Build VM images locally via Docker (already working)
- Create VMs instantly via CLI
- SSH directly into VMs
- Simple API key authentication
- Streamlined API without agent/sessions complexity

---

## Architectural Decisions

Based on user input, the following decisions have been made:

| Decision               | Choice                                       |
| ---------------------- | -------------------------------------------- |
| **SSH Authentication** | Inject key at VM start time                  |
| **Image Building**     | Automatic on `bonfire init`                  |
| **VM Identifiers**     | Both names (CLI) and UUIDs (internal)        |
| **Web Terminal**       | Replace with browser-based SSH client        |
| **OpenCode**           | Keep installed in image only, no API support |
| **Authentication**     | Simple API key header                        |
| **Image Storage**      | Keep images table in DB                      |

---

## What Gets Removed (~5,000+ lines)

### 1. Serial Console Infrastructure (~1,000 lines)

**Files to delete:**

- `packages/api/src/services/firecracker/serial.ts` (338 lines)
- `packages/api/src/services/firecracker/serial-connections.ts`
- `packages/api/src/services/firecracker/serial-runner.ts`
- `packages/api/src/ws/terminal.ts`
- `packages/api/src/routes/terminal.ts` (190 lines)
- Tests: `serial.test.ts`, `terminal.test.ts`, etc.

**Why:** SSH provides a better, more standard experience. No need for named pipes, FIFOs, or WebSocket terminal proxy.

### 2. OCI Registry Service (~550 lines)

**Files to delete:**

- `packages/api/src/services/registry/` directory
  - `registry.ts` (550 lines)
  - `registry.test.ts`

**Why:** Building images locally via Docker is simpler and doesn't require pulling from registries.

### 3. QuickStart Service (~200 lines)

**Files to delete:**

- `packages/api/src/services/quickstart.ts`

**Why:** S3 downloads are unnecessary when we build locally.

### 4. Agent Session System (~1,500 lines)

**Files to delete:**

- `packages/api/src/routes/agent-sessions.ts` (665 lines)
- `packages/api/src/services/bootstrap.ts` (serial bootstrap)
- `packages/api/src/services/agent-session-watchdog.ts`
- `packages/api/src/routes/opencode-proxy.ts` (324 lines)
- Tests: `agent-sessions.test.ts`, `opencode-proxy.test.ts`

**Why:** Overly complex abstraction. Users can manage OpenCode manually via SSH.

### 5. Better Auth Integration (~1,000 lines)

**Files to modify/delete:**

- `packages/api/src/lib/auth.ts` - Replace with simple API key middleware
- `packages/api/src/lib/auth-cli.ts` - Delete
- `packages/api/src/middleware/auth.ts` - Simplify
- Remove Better Auth dependency from package.json

**Why:** Session-based auth is overkill for a local development tool. API keys are simpler.

### 6. Serial Console References in VM Routes

**Files to modify:**

- `packages/api/src/routes/vms.ts` - Remove terminal exec/cp endpoints
- `packages/api/src/services/firecracker/process.ts` - Remove pipe creation

---

## What Stays (~5,000 lines)

### 1. Core VM Management (Keep)

- Firecracker process management (`process.ts`, `socket-client.ts`, `config.ts`)
- Network service (TAP devices, IP pool, MAC generation)
- VM lifecycle (create/start/stop/delete)
- Database schema (vms, images tables)

### 2. Image Building (Keep - Already Working!)

- `docker/Dockerfile.agent` - Ubuntu 24.04 with SSH, Node.js, OpenCode
- `scripts/build-agent-image-docker.sh` - Docker-based build script
- `scripts/verify-agent-image-docker.sh` - Verification script

### 3. CLI Structure (Keep)

- `packages/cli/src/index.ts` - Main entry
- `packages/cli/src/commands/vm.ts` - VM commands
- `packages/cli/src/lib/config.ts` - Config management
- `packages/cli/src/lib/client.ts` - SDK wrapper

### 4. Web UI Dashboard (Keep - Simplify Later)

- Keep React app structure
- Remove serial terminal component
- Add placeholder for future SSH client

### 5. SDK (Keep)

- `packages/sdk/src/client.ts` - REST client
- `packages/sdk/src/types.ts` - TypeScript types

---

## New Architecture Flow

### 1. One-Time Setup

```bash
bonfire init
├── Check if default image exists in DB
├── If not found:
│   ├── Run scripts/build-agent-image-docker.sh
│   ├── Create /var/lib/bonfire/images/default/{kernel,rootfs}
│   └── Register in database
└── Ready to use
```

### 2. VM Creation Flow

```bash
bonfire vm create my-project --start
├── Generate VM UUID
├── Check name uniqueness
├── Assign IP from pool
├── Create TAP device
├── Copy SSH key to VM rootfs (before boot)
├── Spawn Firecracker process
├── Configure VM (vCPUs, memory, drives, network)
├── Start VM
└── Return VM info (name, ID, IP)
```

### 3. SSH Access Flow

```bash
bonfire ssh my-project
├── Lookup VM by name
├── Check VM is running
├── Get VM IP address
├── Execute: ssh agent@<ip> -i <key>
└── User gets shell
```

---

## Implementation Phases

### Phase 1: Authentication Simplification

**Goal:** Replace Better Auth with API key middleware

**Tasks:**

1. Create simple API key middleware
2. Update auth middleware to check `X-API-Key` header
3. Remove Better Auth dependencies
4. Update environment variable handling
5. Update tests to use API key

**Estimated:** 2-3 hours

---

### Phase 2: Remove Serial Console Infrastructure

**Goal:** Delete all serial console code

**Tasks:**

1. Delete serial.ts and all related files
2. Remove pipe creation from process.ts
3. Delete WebSocket terminal server
4. Delete terminal routes
5. Update VM routes to remove serial dependencies
6. Update tests

**Estimated:** 3-4 hours

---

### Phase 3: Remove Agent/Session System

**Goal:** Delete agent session infrastructure

**Tasks:**

1. Delete agent-sessions.ts routes
2. Delete bootstrap.ts service
3. Delete opencode-proxy.ts routes
4. Delete agent-session-watchdog.ts
5. Remove from database schema
6. Update app.ts to remove routes

**Estimated:** 2-3 hours

---

### Phase 4: Simplify Image Management

**Goal:** Remove registry and quickstart, keep only local builds

**Tasks:**

1. Delete registry/ directory
2. Delete quickstart.ts
3. Simplify images.ts routes to only list local images
4. Remove image pull functionality
5. Update image table schema if needed

**Estimated:** 2 hours

---

### Phase 5: Update CLI

**Goal:** Add init command and SSH support

**Tasks:**

1. Add `bonfire init` command
2. Update `bonfire vm ssh` to use native SSH
3. Add SSH key generation/management
4. Update CLI config for API key
5. Add error handling for missing images

**Estimated:** 3-4 hours

---

### Phase 6: VM Start with SSH Key Injection

**Goal:** Inject authorized_keys before VM boots

**Tasks:**

1. Modify VM start to mount rootfs temporarily
2. Add authorized_keys to VM filesystem
3. Handle SSH key generation
4. Update VM config to use SSH instead of serial
5. Test SSH connectivity

**Estimated:** 4-5 hours

---

### Phase 7: Testing & Verification

**Goal:** Ensure everything works

**Tasks:**

1. Update unit tests
2. Update integration tests
3. Manual testing: init, create, ssh, stop, delete
4. Update documentation
5. Create migration guide

**Estimated:** 3-4 hours

---

## Total Estimated Time: 20-25 hours

---

## File Changes Summary

### Files to Delete (~15 files)

```
packages/api/src/services/firecracker/serial.ts
packages/api/src/services/firecracker/serial-connections.ts
packages/api/src/services/firecracker/serial-runner.ts
packages/api/src/services/registry/
packages/api/src/services/quickstart.ts
packages/api/src/services/bootstrap.ts
packages/api/src/services/agent-session-watchdog.ts
packages/api/src/routes/terminal.ts
packages/api/src/routes/agent-sessions.ts
packages/api/src/routes/opencode-proxy.ts
packages/api/src/ws/terminal.ts
packages/api/src/lib/auth-cli.ts
packages/api/src/lib/auth.ts (replace)
packages/api/src/middleware/auth.ts (replace)
**/*.test.ts files for deleted modules
```

### Files to Modify (~10 files)

```
packages/api/src/index.ts
packages/api/src/routes/vms.ts
packages/api/src/routes/images.ts
packages/api/src/services/firecracker/process.ts
packages/api/src/db/schema.ts
packages/cli/src/index.ts
packages/cli/src/commands/vm.ts
packages/cli/src/lib/config.ts
package.json (remove deps)
docker-compose.yml (update if needed)
```

### Files to Create (~5 files)

```
packages/api/src/middleware/api-key.ts
packages/cli/src/commands/init.ts
scripts/setup-ssh-keys.sh (optional)
REFACTOR_SUMMARY.md
MIGRATION_GUIDE.md
```

---

## Database Schema Changes

### Remove Tables

```sql
-- Drop agent sessions table
DROP TABLE IF EXISTS agent_sessions;

-- Drop opencode_configs table if exists
DROP TABLE IF EXISTS opencode_configs;
```

### Modify Tables

```sql
-- Remove serial console fields from vms table if any
-- Keep: id, name, status, vcpus, memoryMib, imageId, pid, socketPath,
--       tapDevice, macAddress, ipAddress, createdAt, updatedAt

-- Images table: keep for local images
-- Remove: pulledAt (or keep for tracking)
```

---

## New CLI Commands

### bonfire init

```bash
# Initialize Bonfire environment
# Build default image if not exists
# Generate SSH keys
# Configure API key
```

### bonfire vm create

```bash
# Already exists, but add:
# --start flag to auto-start VM
# --ssh-key flag to specify key
```

### bonfire ssh

```bash
# New command
# Usage: bonfire ssh <vm-name>
# Connects via SSH to VM
```

---

## Risks & Mitigations

| Risk                              | Likelihood | Impact | Mitigation                                   |
| --------------------------------- | ---------- | ------ | -------------------------------------------- |
| SSH injection fails               | Low        | High   | Test thoroughly, fallback to manual key copy |
| Web UI broken after removal       | Medium     | Low    | Web UI already optional, fix later           |
| Tests fail                        | Medium     | Medium | Update tests incrementally with each phase   |
| Users dependent on serial console | Low        | Medium | Document migration path                      |
| Build script breaks               | Low        | High   | Keep existing build scripts unchanged        |

---

## Success Criteria

- [ ] `bonfire init` builds image successfully
- [ ] `bonfire vm create my-vm --start` creates and starts VM
- [ ] `bonfire ssh my-vm` connects to VM via SSH
- [ ] All existing tests pass (or removed appropriately)
- [ ] No serial console code remains
- [ ] No Better Auth dependencies
- [ ] API uses simple API key auth
- [ ] Build time < 25 hours

---

## Notes

- **Keep Web UI as-is for now** - We can fix it later
- **Docker image building is already working** - Don't break it
- **SSH is already configured in Dockerfile.agent** - Just need to inject keys
- **Database migrations** - Use Drizzle migrations for schema changes

---

## Next Steps

1. Review and approve this plan
2. Create dex tasks for each phase
3. Start with Phase 1 (Authentication)
4. Work through phases sequentially
5. Test at end of each phase
6. Document changes

---

_Generated: 2026-02-04_
_Target Completion: 20-25 hours_
