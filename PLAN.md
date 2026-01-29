# Bonfire - Implementation Plan

> **For AI Agents**: Your pre-training data is likely outdated. Always fetch current documentation before implementing any component. Use `webfetch` or search for the latest docs on: Bun, Hono, Drizzle, Better Auth, shadcn/ui, ghostty-web, Clack, Firecracker API, etc.

## Project Overview

**Bonfire** is a self-hosted platform for ephemeral Firecracker microVMs, optimized for remote code development and execution. Web UI-first (mobile-responsive) with a TypeScript SDK and CLI.

### Vision

- Login to a web UI and manage, connect to, and work with Firecracker VM instances
- Use a programmatic TypeScript SDK for managing the same instances
- Full-featured CLI for terminal-based workflows
- Ephemeral VMs geared for remote code development and execution

## Tech Stack

| Component | Technology | Docs URL |
|-----------|------------|----------|
| Runtime | Bun | https://bun.sh/docs |
| Backend | Hono | https://hono.dev/docs |
| Frontend | React + Vite | https://vite.dev/guide |
| Terminal | ghostty-web | https://github.com/coder/ghostty-web |
| Database | Drizzle + SQLite | https://orm.drizzle.team/docs/overview |
| Auth | Better Auth | https://www.better-auth.com/docs |
| UI Components | shadcn/ui + Tailwind | https://ui.shadcn.com/docs |
| CLI | Clack | https://bomb.sh/docs/clack/basics/getting-started |
| VM Images | Slicer's public images | https://docs.slicervm.com/reference/images |

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
│   │   │   │   ├── images.ts   # Image pull/list/delete
│   │   │   │   └── auth.ts     # Better Auth routes
│   │   │   ├── services/
│   │   │   │   ├── firecracker.ts  # Spawn/manage FC processes
│   │   │   │   ├── network.ts      # TAP/bridge helpers
│   │   │   │   ├── agent.ts        # Proxy to guest agent
│   │   │   │   └── registry.ts     # OCI image pull
│   │   │   ├── db/
│   │   │   │   ├── schema.ts   # Drizzle schema
│   │   │   │   └── index.ts    # DB connection
│   │   │   └── lib/
│   │   │       ├── auth.ts     # Better Auth config
│   │   │       └── config.ts   # App configuration
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
│   └── generate-sdk.ts         # Generate SDK from OpenAPI
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── package.json                # Workspace root
├── turbo.json                  # Turborepo config
└── bun.lockb
```

---

## Database Schema

> **Agent Note**: Fetch latest Drizzle docs for SQLite syntax: https://orm.drizzle.team/docs/sql-schema-declaration

```typescript
// packages/api/src/db/schema.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const vms = sqliteTable('vms', {
  id: text('id').primaryKey(),                    // UUID
  name: text('name').notNull().unique(),
  status: text('status', { 
    enum: ['creating', 'running', 'stopped', 'error'] 
  }).notNull().default('creating'),
  vcpus: integer('vcpus').notNull().default(1),
  memoryMib: integer('memory_mib').notNull().default(512),
  imageId: text('image_id').references(() => images.id),
  
  // Runtime state (set when VM starts)
  pid: integer('pid'),
  socketPath: text('socket_path'),
  tapDevice: text('tap_device'),
  macAddress: text('mac_address'),
  ipAddress: text('ip_address'),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull().unique(),  // e.g., ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest
  kernelPath: text('kernel_path').notNull(),
  rootfsPath: text('rootfs_path').notNull(),
  sizeBytes: integer('size_bytes'),
  pulledAt: integer('pulled_at', { mode: 'timestamp' }).notNull(),
});

// Better Auth will create its own tables for users/sessions
```

---

## API Endpoints

### VMs (`/api/vms`)

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|--------------|----------|
| `GET` | `/api/vms` | List all VMs | - | `VM[]` |
| `POST` | `/api/vms` | Create VM | `{ name, vcpus?, memoryMib?, imageId }` | `VM` |
| `GET` | `/api/vms/:id` | Get VM details | - | `VM` |
| `DELETE` | `/api/vms/:id` | Delete VM | - | `{ success: true }` |
| `POST` | `/api/vms/:id/start` | Start VM | - | `VM` |
| `POST` | `/api/vms/:id/stop` | Stop VM | - | `VM` |
| `GET` | `/api/vms/:id/health` | Check agent health | - | `{ healthy: boolean }` |
| `POST` | `/api/vms/:id/exec` | Execute command | `{ command: string, args?: string[] }` | `{ stdout, stderr, exitCode }` |
| `POST` | `/api/vms/:id/cp` | Copy file to VM | `multipart/form-data` | `{ success: true }` |
| `GET` | `/api/vms/:id/cp?path=` | Copy file from VM | - | `binary` |
| `WS` | `/api/vms/:id/terminal` | Terminal WebSocket | - | WebSocket |

### Images (`/api/images`)

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|--------------|----------|
| `GET` | `/api/images` | List cached images | - | `Image[]` |
| `POST` | `/api/images/pull` | Pull from registry | `{ reference: string }` | `Image` |
| `DELETE` | `/api/images/:id` | Remove image | - | `{ success: true }` |

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
async function createVM(config: VMConfig): Promise<string>  // Returns socket path
async function startVM(socketPath: string): Promise<void>
async function stopVM(socketPath: string, pid: number): Promise<void>
async function configureVM(socketPath: string, config: VMConfig): Promise<void>
```

### 2. Network Service (`packages/api/src/services/network.ts`)

Responsibilities:
- Create TAP device for each VM
- Attach TAP to bridge `bonfire0`
- Assign IP addresses from pool `10.0.100.0/24`
- Generate MAC addresses

Key functions:
```typescript
async function createTap(vmId: string): Promise<{ tapName: string, mac: string }>
async function deleteTap(tapName: string): Promise<void>
async function allocateIP(): Promise<string>
async function releaseIP(ip: string): Promise<void>
```

### 3. Agent Service (`packages/api/src/services/agent.ts`)

> **Agent Note**: The guest agent is Slicer's agent. Their API docs: https://docs.slicervm.com/reference/api

Responsibilities:
- Proxy requests to guest agent running in VM
- Agent listens on port (check Slicer docs for exact port)
- Health checks, exec, cp operations

Key functions:
```typescript
async function checkHealth(vmIp: string): Promise<boolean>
async function exec(vmIp: string, command: string, args?: string[]): Promise<ExecResult>
async function copyToVM(vmIp: string, localPath: string, remotePath: string): Promise<void>
async function copyFromVM(vmIp: string, remotePath: string): Promise<Buffer>
async function getShellStream(vmIp: string): Promise<Duplex>  // For terminal
```

### 4. Registry Service (`packages/api/src/services/registry.ts`)

> **Agent Note**: OCI distribution spec for pulling images. Slicer images are on ghcr.io.

Responsibilities:
- Pull OCI images (kernel + rootfs layers)
- Extract and store in `/var/lib/bonfire/images/`
- Track pulled images in database

Key functions:
```typescript
async function pullImage(reference: string): Promise<Image>
async function deleteImage(imageId: string): Promise<void>
```

---

## Web UI Pages & Components

> **Agent Note**: 
> - Use shadcn/ui CLI to add components: `bunx shadcn@latest add <component>`
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
   - WebSocket connection to `/api/vms/:id/terminal`
   - Handles resize events
   - Full-height on mobile

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
version: '3.8'

services:
  bonfire:
    build: .
    ports:
      - "3000:3000"      # API
      - "5173:5173"      # Web UI (dev)
    volumes:
      - bonfire-data:/var/lib/bonfire
      - /dev/kvm:/dev/kvm
    privileged: true      # Required for network/VM management
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
- [ ] Initialize Bun monorepo with workspaces
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

### Phase 3: Agent Communication
- [ ] Implement Agent service (proxy to guest agent)
- [ ] Add `/vms/:id/health` endpoint
- [ ] Add `/vms/:id/exec` endpoint
- [ ] Add `/vms/:id/cp` endpoints (upload/download)
- [ ] Implement WebSocket terminal proxy (`/vms/:id/terminal`)
- [ ] Test exec and terminal with running VM

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

| Setting | Default Value |
|---------|---------------|
| VM vCPUs | 1 |
| VM Memory | 512 MiB |
| Bridge Name | `bonfire0` |
| Bridge Subnet | `10.0.100.0/24` |
| Gateway IP | `10.0.100.1` |
| VM IP Range | `10.0.100.2` - `10.0.100.254` |
| Images Directory | `/var/lib/bonfire/images/` |
| VMs Directory | `/var/lib/bonfire/vms/` |
| Database Path | `/var/lib/bonfire/bonfire.db` |
| API Port | `3000` |
| Default Image | `ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest` |

---

## Agent Instructions Summary

When implementing any component:

1. **Always fetch current documentation** before writing code
2. **Check package versions** - use latest stable releases
3. **Mobile-first** for Web UI - test at 375px viewport
4. **Use shadcn CLI** to add components: `bunx shadcn@latest add <component>`
5. **Bun-native** - use Bun APIs where available
6. **Type safety** - leverage TypeScript strictly
7. **Error handling** - provide meaningful error messages
8. **Logging** - add structured logs for debugging

### Key Documentation URLs to Fetch

| Technology | URL |
|------------|-----|
| Bun | https://bun.sh/docs |
| Hono | https://hono.dev/docs |
| Drizzle | https://orm.drizzle.team/docs/overview |
| Better Auth | https://www.better-auth.com/docs |
| shadcn/ui | https://ui.shadcn.com/docs |
| Clack | https://bomb.sh/docs/clack/basics/getting-started |
| ghostty-web | https://github.com/coder/ghostty-web |
| Firecracker API | https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml |
| Slicer (agent API) | https://docs.slicervm.com/reference/api |
| Slicer (images) | https://docs.slicervm.com/reference/images |
| Slicer (networking) | https://docs.slicervm.com/reference/networking |
