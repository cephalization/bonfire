# Bonfire - Implementation Plan

> **For AI Agents**: Your pre-training data is likely outdated. Always fetch current documentation before implementing any component. Use `webfetch` or search for the latest docs on: Node.js, pnpm, Hono, Drizzle, Better Auth, shadcn/ui, ghostty-web, Clack, Firecracker API, etc.

## Project Overview

**Bonfire** is a self-hosted platform for ephemeral Firecracker microVMs, optimized for remote code development and execution. Web UI-first (mobile-responsive) with a TypeScript SDK and CLI.

### Vision

- Login to a web UI and manage, connect to, and work with Firecracker VM instances
- Use a programmatic TypeScript SDK for managing the same instances
- Full-featured CLI for terminal-based workflows
- Ephemeral VMs geared for remote code development and execution

## Tech Stack

| Component        | Technology                    | Docs URL                                                                             |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| Runtime          | Node.js (24+)                 | https://nodejs.org/docs/latest/api/                                                  |
| Backend          | Hono                          | https://hono.dev/docs                                                                |
| Frontend         | React + Vite                  | https://vite.dev/guide                                                               |
| Terminal         | ghostty-web                   | https://github.com/coder/ghostty-web                                                 |
| WebSocket Client | PartySocket                   | https://github.com/cloudflare/partykit/tree/main/packages/partysocket                |
| Database         | Drizzle + SQLite              | https://orm.drizzle.team/docs/overview                                               |
| Auth             | Better Auth                   | https://www.better-auth.com/docs                                                     |
| UI Components    | shadcn/ui + Tailwind          | https://ui.shadcn.com/docs                                                           |
| CLI              | Clack                         | https://bomb.sh/docs/clack/basics/getting-started                                    |
| VM Images        | Firecracker quickstart images | https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md |

---

## Monorepo Structure

```
bonfire/
├── packages/
│   ├── api/                    # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts        # Entry point, Hono app setup
│   │   │   ├── routes/
│   │   │   │   ├── vms.ts      # VM CRUD + actions
│   │   │   │   ├── vms.test.ts             # Unit tests
│   │   │   │   ├── vms.integration.test.ts # Integration tests
│   │   │   │   ├── images.ts   # Image pull/list/delete
│   │   │   │   └── auth.ts     # Better Auth routes
│   │   │   ├── services/
│   │   │   │   ├── firecracker.ts  # Spawn/manage FC processes
│   │   │   │   ├── firecracker.test.ts     # Unit tests
│   │   │   │   ├── network.ts      # TAP/bridge helpers
│   │   │   │   ├── network.test.ts         # Unit tests
│   │   │   │   ├── firecracker/    # VM management + serial console
│   │   │   │   └── registry.ts     # OCI image pull
│   │   │   ├── db/
│   │   │   │   ├── schema.ts   # Drizzle schema
│   │   │   │   └── index.ts    # DB connection
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts     # Better Auth config
│   │   │   │   └── config.ts   # App configuration
│   │   │   └── test-utils.ts   # Test helpers, mock factories
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                    # React + Vite (mobile-responsive)
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── Terminal.tsx      # ghostty-web wrapper
│   │   │   │   ├── VMList.tsx
│   │   │   │   ├── VMCard.tsx
│   │   │   │   ├── CreateVMDialog.tsx
│   │   │   │   └── ui/               # shadcn components
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── VMDetail.tsx
│   │   │   │   ├── Images.tsx
│   │   │   │   └── Login.tsx
│   │   │   └── lib/
│   │   │       ├── api.ts            # API client (from SDK)
│   │   │       └── utils.ts
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tailwind.config.js
│   │   ├── components.json           # shadcn config
│   │   └── vite.config.ts
│   │
│   ├── sdk/                    # Auto-generated TypeScript SDK
│   │   ├── src/
│   │   │   ├── index.ts        # Main exports
│   │   │   ├── client.ts       # API client class
│   │   │   └── types.ts        # TypeScript types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                    # CLI with Clack
│       ├── src/
│       │   ├── index.ts        # Entry point
│       │   ├── commands/
│       │   │   ├── vm.ts       # vm subcommands
│       │   │   ├── image.ts    # image subcommands
│       │   │   └── config.ts   # config subcommands
│       │   └── lib/
│       │       ├── config.ts   # ~/.bonfire/config.json
│       │       └── client.ts   # SDK wrapper
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/
│   ├── setup.sh                # Install firecracker, setup bridge
│   ├── generate-sdk.ts         # Generate SDK from OpenAPI
│   └── run-e2e.sh              # E2E test runner script
│
├── docker/
│   ├── Dockerfile              # Production image
│   ├── docker-compose.yml      # Production stack
│   ├── test.Dockerfile         # Integration test image
│   ├── e2e.Dockerfile          # E2E test image (with Firecracker)
│   └── docker-compose.test.yml # Test stack
│
├── e2e/                        # End-to-end tests (require KVM)
│   ├── vm-lifecycle.test.ts
│   └── terminal.test.ts
│
├── package.json                # Workspace root
├── turbo.json                  # Turborepo config
└── pnpm-lock.yaml
```

---

## Database Schema

> **Agent Note**: Fetch latest Drizzle docs for SQLite syntax: https://orm.drizzle.team/docs/sql-schema-declaration

```typescript
// packages/api/src/db/schema.ts

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const vms = sqliteTable("vms", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(),
  status: text("status", {
    enum: ["creating", "running", "stopped", "error"],
  })
    .notNull()
    .default("creating"),
  vcpus: integer("vcpus").notNull().default(1),
  memoryMib: integer("memory_mib").notNull().default(512),
  imageId: text("image_id").references(() => images.id),

  // Runtime state (set when VM starts)
  pid: integer("pid"),
  socketPath: text("socket_path"),
  tapDevice: text("tap_device"),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull().unique(), // e.g., firecracker-quickstart:ubuntu-24.04
  kernelPath: text("kernel_path").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  sizeBytes: integer("size_bytes"),
  pulledAt: integer("pulled_at", { mode: "timestamp" }).notNull(),
});

// Better Auth will create its own tables for users/sessions
```

---

## API Endpoints

### VMs (`/api/vms`)

| Method   | Path                    | Description                         | Request Body                            | Response            |
| -------- | ----------------------- | ----------------------------------- | --------------------------------------- | ------------------- |
| `GET`    | `/api/vms`              | List all VMs                        | -                                       | `VM[]`              |
| `POST`   | `/api/vms`              | Create VM                           | `{ name, vcpus?, memoryMib?, imageId }` | `VM`                |
| `GET`    | `/api/vms/:id`          | Get VM details                      | -                                       | `VM`                |
| `DELETE` | `/api/vms/:id`          | Delete VM                           | -                                       | `{ success: true }` |
| `POST`   | `/api/vms/:id/start`    | Start VM                            | -                                       | `VM`                |
| `POST`   | `/api/vms/:id/stop`     | Stop VM                             | -                                       | `VM`                |
| `WS`     | `/api/vms/:id/terminal` | Terminal WebSocket (serial console) | -                                       | WebSocket           |

> **Note**: Terminal access uses Firecracker's serial console via named pipes, not an in-VM agent.
> This eliminates the need for agent installation and network-based communication with the VM.

### Images (`/api/images`)

| Method   | Path               | Description        | Request Body            | Response            |
| -------- | ------------------ | ------------------ | ----------------------- | ------------------- |
| `GET`    | `/api/images`      | List cached images | -                       | `Image[]`           |
| `POST`   | `/api/images/pull` | Pull from registry | `{ reference: string }` | `Image`             |
| `DELETE` | `/api/images/:id`  | Remove image       | -                       | `{ success: true }` |

### Auth (`/api/auth/*`)

> **Agent Note**: Better Auth handles these routes. Fetch docs: https://www.better-auth.com/docs

---

## Services Implementation

### 1. Firecracker Service (`packages/api/src/services/firecracker.ts`)

> **Agent Note**: Fetch Firecracker API spec: https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml

Responsibilities:

- Spawn `firecracker` process with `--api-sock` option
- Configure VM via Unix socket (PUT `/machine-config`, `/boot-source`, `/drives`, `/network-interfaces`)
- Start VM (PUT `/actions` with `InstanceStart`)
- Stop VM (send SIGTERM or Ctrl+Alt+Del)
- Track process lifecycle

Key functions:

```typescript
async function createVM(config: VMConfig): Promise<string>; // Returns socket path
async function startVM(socketPath: string): Promise<void>;
async function stopVM(socketPath: string, pid: number): Promise<void>;
async function configureVM(socketPath: string, config: VMConfig): Promise<void>;
```

### 2. Network Service (`packages/api/src/services/network.ts`)

Responsibilities:

- Create TAP device for each VM
- Attach TAP to bridge `bonfire0`
- Assign IP addresses from pool `10.0.100.0/24`
- Generate MAC addresses

Key functions:

```typescript
async function createTap(vmId: string): Promise<{ tapName: string; mac: string }>;
async function deleteTap(tapName: string): Promise<void>;
async function allocateIP(): Promise<string>;
async function releaseIP(ip: string): Promise<void>;
```

### 3. Serial Console Service (`packages/api/src/services/firecracker/serial.ts`)

> **Note**: Terminal access uses Firecracker's serial console via named pipes (FIFOs),
> eliminating the need for in-VM agents.

Responsibilities:

- Create named pipes for stdin/stdout to Firecracker process
- Proxy WebSocket data to/from serial console
- Handle terminal resize via xterm escape sequences
- Manage connection lifecycle

Key functions:

```typescript
function generatePipePaths(
  vmId: string,
  pipeDir?: string
): { stdinPath: string; stdoutPath: string };
function formatResizeMessage(cols: number, rows: number): Uint8Array; // xterm escape sequence
async function createSerialConsole(options: SerialConsoleOptions): Promise<SerialConsole>;
```

The serial console interface:

```typescript
interface SerialConsole {
  write(data: Uint8Array): void; // Send to VM stdin
  onData(callback: (data: Uint8Array) => void): void; // Receive from VM stdout
  close(): void;
  isActive(): boolean;
  getPaths(): { stdin: string; stdout: string };
}
```

### 4. Registry Service (`packages/api/src/services/registry.ts`)

> **Agent Note**: OCI distribution spec for pulling images. Slicer images are on ghcr.io.

Responsibilities:

- Pull OCI images (kernel + rootfs layers)
- Extract and store in `/var/lib/bonfire/images/`
- Track pulled images in database

Key functions:

```typescript
async function pullImage(reference: string): Promise<Image>;
async function deleteImage(imageId: string): Promise<void>;
```

---

## Web UI Pages & Components

> **Agent Note**:
>
> - Use shadcn/ui CLI to add components: `pnpm dlx shadcn@latest add <component>`
> - Fetch shadcn docs: https://ui.shadcn.com/docs
> - Fetch ghostty-web docs: https://github.com/coder/ghostty-web
> - **All pages must be mobile-responsive** (test at 375px width)

### Pages

1. **Login** (`/login`)
   - Email/password form
   - Better Auth integration
   - Redirect to dashboard on success

2. **Dashboard** (`/`)
   - VM list with status indicators
   - "Create VM" button
   - Quick actions (start/stop/delete) per VM
   - Responsive: cards on mobile, table on desktop

3. **VM Detail** (`/vms/:id`)
   - VM info (name, status, IP, specs)
   - Full-screen terminal (ghostty-web)
   - Actions: start, stop, delete
   - Responsive: stack controls above terminal on mobile

4. **Images** (`/images`)
   - List of cached images
   - "Pull Image" dialog
   - Delete action per image

### Components

1. **Terminal.tsx**
   - Wrapper for ghostty-web
   - WebSocket connection via PartySocket (`useWebSocket` hook)
   - Auto-reconnection on network changes (critical for mobile)
   - Message buffering during brief disconnects
   - Handles resize events
   - Full-height on mobile

   ```typescript
   // Example usage with PartySocket
   import useWebSocket from "partysocket/react";

   const socket = useWebSocket(() => `${baseUrl}/api/vms/${vmId}/terminal`, [], {
     onMessage: (e) => terminal.write(e.data),
     onOpen: () => console.log("Terminal connected"),
     onClose: () => console.log("Terminal disconnected"),
   });
   ```

2. **VMList.tsx**
   - Fetches and displays VMs
   - Real-time status updates (polling or WebSocket)
   - Responsive grid/list layout

3. **VMCard.tsx**
   - Single VM display
   - Status badge (running=green, stopped=gray, error=red)
   - Quick action buttons

4. **CreateVMDialog.tsx**
   - Modal/drawer for creating VM
   - Form: name, vcpus, memory, image select
   - shadcn Dialog on desktop, Drawer on mobile

### Mobile Responsiveness Requirements

- Touch-friendly tap targets (min 44px)
- Hamburger menu for navigation on mobile
- Terminal should be usable on phone (full width, appropriate font size)
- Forms should stack vertically on mobile
- Use shadcn's responsive patterns

---

## CLI Commands

> **Agent Note**: Fetch Clack docs: https://bomb.sh/docs/clack/basics/getting-started

```
bonfire
├── vm
│   ├── create <name> [--vcpus=N] [--memory=N] [--image=REF]
│   ├── list
│   ├── start <name|id>
│   ├── stop <name|id>
│   ├── rm <name|id>
│   ├── exec <name|id> -- <command...>
│   └── ssh <name|id>       # Interactive shell
├── image
│   ├── pull <reference>
│   ├── list
│   └── rm <id>
├── config
│   ├── set <key> <value>   # api-url, token
│   └── get [key]
└── login                    # Authenticate with Bonfire server
```

CLI config stored at: `~/.bonfire/config.json`

```json
{
  "apiUrl": "http://localhost:3000",
  "token": "..."
}
```

---

## Setup Script (`scripts/setup.sh`)

> **Agent Note**: This script must be run as root on the host machine before Bonfire can manage VMs.

```bash
#!/bin/bash
set -e

# 1. Check for KVM support
if [ ! -e /dev/kvm ]; then
  echo "Error: /dev/kvm not found. KVM is required."
  exit 1
fi

# 2. Install Firecracker (fetch latest release)
FC_VERSION="v1.14.1"  # Check https://github.com/firecracker-microvm/firecracker/releases
# Download and install firecracker + jailer binaries

# 3. Create bridge network
BRIDGE="bonfire0"
SUBNET="10.0.100.1/24"

ip link add name $BRIDGE type bridge || true
ip addr add $SUBNET dev $BRIDGE || true
ip link set dev $BRIDGE up

# 4. Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1

# 5. NAT for internet access
iptables -t nat -A POSTROUTING -s 10.0.100.0/24 ! -o $BRIDGE -j MASQUERADE

# 6. Create directories
mkdir -p /var/lib/bonfire/{images,vms}
chmod 755 /var/lib/bonfire

echo "Bonfire host setup complete!"
```

---

## Docker Compose (`docker/docker-compose.yml`)

> **Agent Note**: Bonfire requires access to `/dev/kvm` and network capabilities. The container needs to be privileged or have specific capabilities.

```yaml
version: "3.8"

services:
  bonfire:
    build: .
    ports:
      - "3000:3000" # API
      - "5173:5173" # Web UI (dev)
    volumes:
      - bonfire-data:/var/lib/bonfire
      - /dev/kvm:/dev/kvm
    privileged: true # Required for network/VM management
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    environment:
      - DATABASE_URL=/var/lib/bonfire/bonfire.db
      - BETTER_AUTH_SECRET=change-me-in-production

volumes:
  bonfire-data:
```

---

## Implementation Phases

### Phase 1: Foundation

- [ ] Initialize Node.js monorepo with pnpm workspaces
- [ ] Configure Turborepo for build orchestration
- [ ] Create package skeletons (`api`, `web`, `sdk`, `cli`)
- [ ] Set up Drizzle with SQLite, create schema, run migrations
- [ ] Create Hono app with health endpoint
- [ ] Integrate Better Auth (email/password)
- [ ] Add OpenAPI spec generation (for SDK)

### Phase 2: VM Management Core

- [ ] Implement Firecracker service (spawn, configure, start, stop)
- [ ] Implement Network service (TAP creation, IP allocation)
- [ ] Create VM CRUD endpoints
- [ ] Create VM lifecycle endpoints (start, stop)
- [ ] Write setup script for host preparation
- [ ] Test VM creation and lifecycle manually

### Phase 3: Serial Console Communication

- [x] Implement Serial Console service (named pipes for Firecracker)
- [x] Implement WebSocket terminal proxy (`/vms/:id/terminal`)
- [x] Handle terminal resize via xterm escape sequences
- [x] Test terminal with running VM

> **Note**: Agent-based endpoints (exec, health, cp) have been deprecated in favor of
> direct serial console access. The VM's serial port provides full shell access without
> needing an in-VM agent.

### Phase 4: Web UI

- [ ] Initialize React + Vite app
- [ ] Configure Tailwind CSS
- [ ] Add shadcn/ui components (Button, Card, Dialog, Input, etc.)
- [ ] Create responsive layout shell (nav, mobile menu)
- [ ] Implement Login page
- [ ] Implement Dashboard with VM list
- [ ] Implement VM Detail page with ghostty-web terminal
- [ ] Implement Images page
- [ ] Test on mobile viewport (375px)

### Phase 5: Images, SDK & CLI

- [ ] Implement Registry service (OCI pull)
- [ ] Add image endpoints
- [ ] Add image management to Web UI
- [ ] Generate TypeScript SDK from OpenAPI spec
- [ ] Implement CLI with Clack
- [ ] Test CLI commands end-to-end

### Phase 6: Deployment & Polish

- [ ] Create Dockerfile
- [ ] Create Docker Compose stack
- [ ] Document setup process
- [ ] End-to-end testing
- [ ] Bug fixes and polish

---

## Default Configuration

| Setting          | Default Value                         |
| ---------------- | ------------------------------------- |
| VM vCPUs         | 1                                     |
| VM Memory        | 512 MiB                               |
| Bridge Name      | `bonfire0`                            |
| Bridge Subnet    | `10.0.100.0/24`                       |
| Gateway IP       | `10.0.100.1`                          |
| VM IP Range      | `10.0.100.2` - `10.0.100.254`         |
| Images Directory | `/var/lib/bonfire/images/`            |
| VMs Directory    | `/var/lib/bonfire/vms/`               |
| Database Path    | `/var/lib/bonfire/bonfire.db`         |
| API Port         | `3000`                                |
| Default Image    | `firecracker-quickstart:ubuntu-24.04` |

---

## Testing Strategy

> **Agent Note**: Tests must be safe to run anywhere. Never write tests that modify the host system, create real network devices, or require KVM unless explicitly in the E2E test container.

### Test Philosophy

- **Only write tests that add real confidence and value**
- **No fake tests** that just read files, check documentation exists, or test trivial getters/setters
- **Mock only what's necessary** to isolate the module under test - don't mock the world
- **Tests must be deterministic** - no flaky tests, no timing dependencies

### Test Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Test Environments                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │    Unit Tests     │  │ Integration Tests  │  │   E2E Tests    │  │
│  │                   │  │                    │  │                │  │
│  │  pnpm -r test     │  │  docker compose    │  │ docker + KVM   │  │
│  │                   │  │  run test-int      │  │                │  │
│  │  - No I/O         │  │                    │  │  - Real FCs    │  │
│  │  - No network     │  │  - Isolated DB     │  │  - Real TAPs   │  │
│  │  - No DB          │  │  - Mocked FC       │  │  - Isolated    │  │
│  │  - Pure functions │  │  - Real routes     │  │    network     │  │
│  │                   │  │                    │  │                │  │
│  │  Runs: anywhere   │  │  Runs: Docker      │  │  Runs: Linux   │  │
│  │                   │  │                    │  │  + KVM host    │  │
│  └───────────────────┘  └────────────────────┘  └────────────────┘  │
│                                                                      │
│  Command:              Command:                 Command:             │
│  pnpm -r test           pnpm run test:int        pnpm run test:e2e    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1. Unit Tests

**Location**: `packages/*/src/**/*.test.ts` (co-located with source)

**Run with**: `pnpm -r test`

**Rules**:

- **NO** filesystem writes
- **NO** network requests
- **NO** database connections
- **NO** spawning processes
- **NO** environment variable dependencies
- **YES** pure functions, business logic, data transformations

**What to test**:

```typescript
// packages/api/src/services/network.test.ts
// Testing pure IP allocation logic (no actual network calls)
describe("IP allocation", () => {
  it("allocates next available IP from pool", () => {
    const pool = createIPPool("10.0.100.0/24");
    expect(pool.allocate()).toBe("10.0.100.2"); // .1 is gateway
    expect(pool.allocate()).toBe("10.0.100.3");
  });

  it("throws when pool exhausted", () => {
    const pool = createIPPool("10.0.100.0/30"); // Only 2 usable IPs
    pool.allocate();
    pool.allocate();
    expect(() => pool.allocate()).toThrow("IP pool exhausted");
  });
});

// packages/api/src/services/firecracker.test.ts
// Testing config generation (no actual Firecracker calls)
describe("VM config generation", () => {
  it("generates valid machine config", () => {
    const config = generateMachineConfig({ vcpus: 2, memoryMib: 1024 });
    expect(config).toEqual({
      vcpu_count: 2,
      mem_size_mib: 1024,
    });
  });
});

// packages/cli/src/commands/vm.test.ts
// Testing argument parsing (no actual API calls)
describe("vm create argument parsing", () => {
  it("parses vcpus flag", () => {
    const args = parseVMCreateArgs(["my-vm", "--vcpus=4"]);
    expect(args.vcpus).toBe(4);
  });
});
```

**What NOT to test**:

```typescript
// BAD: Testing that a file exists
it("has a README", () => {
  expect(fs.existsSync("README.md")).toBe(true); // Useless test
});

// BAD: Testing trivial code
it("returns the name", () => {
  const vm = { name: "test" };
  expect(vm.name).toBe("test"); // Tests nothing meaningful
});

// BAD: Testing library code
it("drizzle inserts data", () => {
  // Don't test that Drizzle works - test YOUR logic
});
```

### 2. Integration Tests

**Location**: `packages/*/src/**/*.integration.test.ts`

**Run with**: `pnpm run test:int` (runs inside Docker container)

**Rules**:

- Run inside `docker/test.Dockerfile` container
- Each test file gets a fresh temp SQLite database: `/tmp/bonfire-test-{random}.db`
- Tests are independent - no shared state between test files
- Firecracker service is mocked (no KVM required)
- Network service is mocked (no TAP devices)
- HTTP routes are tested with real Hono app

**What to test**:

```typescript
// packages/api/src/routes/vms.integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../test-utils";

describe("POST /api/vms", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    // Creates fresh DB, mocked services
    app = await createTestApp();
  });

  it("creates a VM and returns it", async () => {
    const res = await app.request("/api/vms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-vm", imageId: "img-123" }),
    });

    expect(res.status).toBe(201);
    const vm = await res.json();
    expect(vm.name).toBe("test-vm");
    expect(vm.status).toBe("creating");
  });

  it("rejects duplicate VM names", async () => {
    await app.request("/api/vms", {
      method: "POST",
      body: JSON.stringify({ name: "dupe", imageId: "img-123" }),
    });

    const res = await app.request("/api/vms", {
      method: "POST",
      body: JSON.stringify({ name: "dupe", imageId: "img-123" }),
    });

    expect(res.status).toBe(409);
  });
});
```

**Test utilities** (`packages/api/src/test-utils.ts`):

```typescript
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { createApp } from "./index";

export async function createTestApp() {
  // Fresh database for each test
  const dbPath = `/tmp/bonfire-test-${randomUUID()}.db`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  // Run migrations
  await migrate(db);

  // Create app with mocked services
  const app = createApp({
    db,
    firecracker: createMockFirecrackerService(),
    network: createMockNetworkService(),
  });

  return {
    app,
    db,
    request: app.request.bind(app),
    cleanup: () => {
      sqlite.close();
      fs.unlinkSync(dbPath);
    },
  };
}

function createMockFirecrackerService() {
  return {
    createVM: async () => ({ socketPath: "/tmp/mock.sock", pid: 12345 }),
    startVM: async () => {},
    stopVM: async () => {},
  };
}

function createMockNetworkService() {
  let nextIP = 2;
  return {
    createTap: async () => ({ tapName: "tap-mock", mac: "00:00:00:00:00:01" }),
    deleteTap: async () => {},
    allocateIP: async () => `10.0.100.${nextIP++}`,
    releaseIP: async () => {},
  };
}
```

### 3. End-to-End Tests

**Location**: `e2e/*.test.ts`

**Run with**: `pnpm run test:e2e` (manual) or in CI with KVM-enabled runner

**Rules**:

- **Only run on Linux hosts with KVM**
- Run inside `docker/e2e.Dockerfile` container with:
  - `/dev/kvm` passed through
  - Isolated network namespace
  - Separate bridge `bonfire-test0`
  - Separate directories `/tmp/bonfire-e2e/`
- Codebase mounted read-only
- Tests real Firecracker VMs
- Cleanup must be thorough (VMs, TAPs, bridge, files)

**What to test**:

```typescript
// e2e/vm-lifecycle.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { BonfireClient } from "@bonfire/sdk";

describe(
  "VM lifecycle (E2E)",
  () => {
    const client = new BonfireClient({ baseUrl: "http://localhost:3000" });
    const createdVMs: string[] = [];

    afterAll(async () => {
      // Cleanup all VMs created during tests
      for (const id of createdVMs) {
        await client.vms.delete(id).catch(() => {});
      }
    });

    it("creates, starts, executes command, and stops a VM", async () => {
      // Create
      const vm = await client.vms.create({
        name: `e2e-test-${Date.now()}`,
        imageId: "default",
      });
      createdVMs.push(vm.id);
      expect(vm.status).toBe("creating");

      // Start
      await client.vms.start(vm.id);

      // Wait for agent to be healthy
      await waitForHealth(client, vm.id, { timeout: 30000 });

      // Execute command
      const result = await client.vms.exec(vm.id, {
        command: "echo",
        args: ["hello"],
      });
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);

      // Stop
      await client.vms.stop(vm.id);
      const stopped = await client.vms.get(vm.id);
      expect(stopped.status).toBe("stopped");
    });
  },
  { timeout: 60000 }
);
```

### Test Infrastructure Files

**`docker/test.Dockerfile`** (for integration tests):

```dockerfile
FROM node:24-bookworm

WORKDIR /app

# No KVM needed, no special privileges
# Just runs the app with mocked services

COPY . .
RUN corepack enable
RUN pnpm install

CMD ["pnpm", "-C", "packages/api", "exec", "vitest", "run", "--config", "vitest.integration.config.mjs"]
```

**`docker/e2e.Dockerfile`** (for E2E tests):

```dockerfile
FROM node:24-bookworm

# Install Firecracker
RUN curl -fsSL https://github.com/firecracker-microvm/firecracker/releases/download/v1.14.1/firecracker-v1.14.1-x86_64.tgz | tar -xz
RUN mv release-*/firecracker-* /usr/local/bin/firecracker

# Network tools
RUN apt-get update && apt-get install -y iproute2 iptables

# Enable pnpm
RUN corepack enable

WORKDIR /app

# Codebase mounted at runtime
CMD ["./scripts/run-e2e.sh"]
```

**`docker/docker-compose.test.yml`**:

```yaml
version: "3.8"

services:
  test-integration:
    build:
      context: ..
      dockerfile: docker/test.Dockerfile
    volumes:
      - ../:/app:ro
      - /tmp/bonfire-test:/tmp/bonfire-test
    environment:
      - NODE_ENV=test

  test-e2e:
    build:
      context: ..
      dockerfile: docker/e2e.Dockerfile
    privileged: true
    devices:
      - /dev/kvm:/dev/kvm
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    volumes:
      - ../:/app:ro
      - /tmp/bonfire-e2e:/var/lib/bonfire
    environment:
      - NODE_ENV=test
      - BONFIRE_BRIDGE=bonfire-test0
      - BONFIRE_SUBNET=10.0.200.0/24
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "pnpm -r test",
    "test:int": "docker compose -f docker/docker-compose.test.yml run --build --rm test-integration",
    "test:e2e": "docker compose -f docker/docker-compose.test.yml run --build --rm test-e2e",
    "test:all": "pnpm -r test && pnpm run test:int"
  }
}
```

### Test File Naming Convention

| Pattern                 | Type        | Runs In                   |
| ----------------------- | ----------- | ------------------------- |
| `*.test.ts`             | Unit        | `pnpm -r test` (anywhere) |
| `*.integration.test.ts` | Integration | Docker container          |
| `e2e/*.test.ts`         | End-to-end  | Docker + KVM              |

### CI Configuration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r test

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose -f docker/docker-compose.test.yml run --build --rm test-integration

  e2e:
    runs-on: [self-hosted, kvm] # Requires self-hosted runner with KVM
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - run: docker compose -f docker/docker-compose.test.yml run --build --rm test-e2e
```

---

## Agent Instructions Summary

When implementing any component:

1. **Always fetch current documentation** before writing code
2. **Check package versions** - use latest stable releases
3. **Mobile-first** for Web UI - test at 375px viewport
4. **Use shadcn CLI** to add components: `pnpm dlx shadcn@latest add <component>`
5. **Node-native** - use Node APIs where available
6. **Type safety** - leverage TypeScript strictly
7. **Error handling** - provide meaningful error messages
8. **Logging** - add structured logs for debugging
9. **Use available skills** - Load relevant skills for specific code domains (see Skills section below)

---

## Skills for Code Domains

This project has specialized skills available for specific code domains. **Always use the appropriate skill when working on relevant code** to follow best practices and avoid common mistakes.

### Available Skills

| Skill Name                      | When to Use                                                                                           | Skill Command                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **vercel-react-best-practices** | Writing/reviewing React or Next.js components, data fetching, performance optimization                | Use when touching any React/Next.js code              |
| **vercel-composition-patterns** | Refactoring components with many boolean props, building flexible component APIs, compound components | Use when designing component architecture             |
| **turborepo**                   | Configuring tasks, setting up monorepo, managing packages, debugging cache, CI configuration          | Use when working with turbo.json or package structure |

### How to Use Skills

Before implementing features in these domains:

1. **Load the relevant skill** to get detailed best practices
2. **Follow the skill's guidance** for patterns and anti-patterns
3. **Apply the skill's rules** to your implementation

Example scenarios:

- **Creating a new React component in `packages/web/`**: Load `vercel-react-best-practices` and `vercel-composition-patterns`
- **Adding a new package or configuring tasks**: Load `turborepo`
- **Optimizing data fetching or bundle size**: Load `vercel-react-best-practices`
- **Setting up CI or debugging cache**: Load `turborepo`

### Key Skill Rules to Remember

#### React/Next.js (vercel-react-best-practices)

- Eliminate waterfalls: Use `Promise.all()` for independent operations, defer `await` until needed
- Bundle optimization: Import directly from source (avoid barrel files), use dynamic imports for heavy components
- Server-side: Use `React.cache()` for deduplication, authenticate server actions like API routes
- Re-renders: Use functional setState, derive state during render, extract to memoized components

#### Component Architecture (vercel-composition-patterns)

- Avoid boolean prop proliferation: Use composition instead of `isEditing`, `isThread`, etc.
- Use compound components with shared context for flexible composition
- Lift state into provider components for sibling access
- Define generic context interfaces (state, actions, meta) for dependency injection

#### Turborepo (turborepo)

- **CRITICAL**: Always create package tasks, not root tasks
- Always use `turbo run` in code (never shorthand `turbo <task>`)
- Declare workspace dependencies to enable automatic build ordering
- Use `dependsOn: ["^build"]` for dependency build ordering
- Specify `outputs` for all tasks that produce files

### Testing Rules for Agents

> **CRITICAL**: Tests must be safe to run anywhere. Violating these rules can damage the host system.

1. **Unit tests (`*.test.ts`)**:
   - NO filesystem writes, NO network calls, NO database connections
   - Test pure functions and business logic only
   - Must pass with just `pnpm -r test`

2. **Integration tests (`*.integration.test.ts`)**:
   - Use `createTestApp()` helper which provides isolated temp database
   - Mock Firecracker and Network services
   - Never create real TAP devices or network bridges

3. **E2E tests (`e2e/*.test.ts`)**:
   - Only create these for full VM lifecycle testing
   - They ONLY run in the E2E Docker container with KVM
   - Always clean up VMs in `afterAll`

4. **No fake tests**:
   - Don't test that files exist
   - Don't test trivial getters/setters
   - Don't test library code (Drizzle, Hono, etc.)
   - Every test must add real confidence

### Key Documentation URLs to Fetch

| Technology         | URL                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Node.js            | https://nodejs.org/docs/latest/api/                                                                   |
| Hono               | https://hono.dev/docs                                                                                 |
| Drizzle            | https://orm.drizzle.team/docs/overview                                                                |
| Better Auth        | https://www.better-auth.com/docs                                                                      |
| shadcn/ui          | https://ui.shadcn.com/docs                                                                            |
| Clack              | https://bomb.sh/docs/clack/basics/getting-started                                                     |
| ghostty-web        | https://github.com/coder/ghostty-web                                                                  |
| PartySocket        | https://github.com/cloudflare/partykit/tree/main/packages/partysocket                                 |
| Firecracker API    | https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml |
| Firecracker Serial | https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md                  |
| Firecracker Images | https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md                  |
