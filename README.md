# Bonfire

> **Warning**: This is an experimental project intended for learning and exploration. It is not production-ready and may have security vulnerabilities, bugs, or breaking changes. Use at your own risk.

A self-hosted platform for ephemeral Firecracker microVMs, optimized for remote code development and execution.

## Features

- **Web UI** - Manage VMs from your browser (mobile-responsive)
- **Terminal Access** - Connect to VMs via ghostty-web terminal in the browser
- **TypeScript SDK** - Programmatic control of your VMs
- **CLI** - Full-featured command-line interface
- **Ephemeral VMs** - Spin up and tear down VMs in seconds

## Tech Stack

- **Runtime**: Node.js 24+
- **Backend**: Hono
- **Frontend**: React + Vite + shadcn/ui
- **Database**: SQLite + Drizzle
- **Auth**: Better Auth
- **Terminal**: ghostty-web
- **CLI**: Clack
- **VMs**: Firecracker microVMs

## Quick Start (Docker - Recommended)

Get from zero to a running VM in under 5 minutes with Docker.

### Prerequisites

- Linux host with KVM support (`/dev/kvm` must exist)
- Docker and Docker Compose

### Installation

1. **Clone and start**:

```bash
git clone https://github.com/cephalization/bonfire.git
cd bonfire
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d --remove-orphans
```

2. **Build the VM image** (one-time setup):

```bash
# This creates the kernel and rootfs needed to run VMs
./scripts/build-agent-image-docker.sh
```

Creates:

- `images/agent-kernel` (~10 MB)
- `images/agent-rootfs.ext4` (~4 GB sparse file)

3. **Register the image** with Bonfire:

```bash
# Copy images into the container's volume
docker cp images/agent-kernel bonfire-api-1:/var/lib/bonfire/images/
docker cp images/agent-rootfs.ext4 bonfire-api-1:/var/lib/bonfire/images/

# Register via API
curl -X POST http://localhost:3000/api/images/local \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "local:agent-ready",
    "kernelPath": "/var/lib/bonfire/images/agent-kernel",
    "rootfsPath": "/var/lib/bonfire/images/agent-rootfs.ext4"
  }'
```

4. **Open the Web UI** at http://localhost:5173

5. **Log in** with default credentials:
   - Email: `admin@example.com`
   - Password: `admin123`

6. **Create your first VM**:
   - Click "New VM"
   - Name: `my-first-vm`
   - Image: Select `local:agent-ready`
   - Click "Create"

7. **Start and connect**:
   - Click the play button to start the VM
   - Wait for status to show "running" with an IP address
   - Click "SSH" to open a terminal session

That's it! You're now connected to your Firecracker microVM.

### Alternative: Using the CLI

After building and registering the image:

```bash
# Install CLI locally
npm install -g @bonfire/cli

# Login (if needed)
bonfire login

# Create and start a VM
bonfire vm create my-first-vm --image=local:agent-ready
bonfire vm start my-first-vm

# Connect via SSH
bonfire vm ssh my-first-vm
```

### Production Compose

For a production-like setup (static web served by nginx with `/api` reverse-proxied to the API):

```bash
BETTER_AUTH_SECRET="change-me" \
BETTER_AUTH_URL="https://your-hostname" \
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up
```

- Web UI: http://localhost
- API: http://localhost:3000

### Alternative: Bare Metal Installation

> **Warning**: Running directly on bare metal modifies system networking configuration, installs system packages, and requires root access. This approach carries more risk and is only recommended for advanced users who understand the implications.

**Prerequisites:**

- Linux host with KVM support (`/dev/kvm` must exist)
- Node.js 24+ (use corepack + pnpm)
- Root access (for network/VM management)

**Steps:**

1. **Clone and setup**:

```bash
git clone https://github.com/cephalization/bonfire.git
cd bonfire
corepack enable && pnpm install
```

2. **System setup** (installs Firecracker, configures bridge/NAT):

```bash
sudo ./scripts/setup.sh
```

3. **Build the VM image**:

```bash
./scripts/build-agent-image-docker.sh
```

4. **Start servers**:

```bash
pnpm run dev
```

5. **Register the image** (in another terminal):

```bash
curl -X POST http://localhost:3000/api/images/local \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "local:agent-ready",
    "kernelPath": "/var/lib/bonfire/images/agent-kernel",
    "rootfsPath": "/var/lib/bonfire/images/agent-rootfs.ext4"
  }'
```

6. **Open Web UI** at http://localhost:5173

7. **Log in** and create your first VM:
   - Email: `admin@example.com` (from `.env`)
   - Password: `admin123` (from `.env`)
   - Click "New VM", select the `local:agent-ready` image
   - Start and connect!

## System Impact

Understanding what Bonfire does to your system helps you make informed decisions about deployment and cleanup.

### System Changes Overview

When you run Bonfire (especially on bare metal), it makes several types of system modifications:

#### Network Configuration

**Bridge Interface**: Creates a Linux bridge (`bonfire0` by default) that persists until manually removed

- Acts as the gateway for all VMs (10.0.100.1)
- Visible in `ip link` and `bridge link` outputs
- Provides the network backbone for VM communication

**TAP Devices**: Creates virtual network interfaces for each running VM

- Naming pattern: `tap-bf-{first-8-chars-of-vm-id}`
- Automatically cleaned up when VMs stop
- Requires elevated privileges (root or CAP_NET_ADMIN)

**IP Tables Rules**: Adds NAT rules for internet access

- One rule in `nat/POSTROUTING` chain for the VM subnet
- Enables VMs to reach the internet through the host
- Persists until removed or system reboots

**IP Forwarding**: Enables kernel-level packet forwarding

- Required for NAT to function
- May create `/etc/sysctl.d/99-bonfire.conf` for persistence
- Affects the entire system, not just Bonfire

#### File System Modifications

**Data Directories**: Creates the following persistent directories:

| Directory                 | Purpose                          | Typical Size                 |
| ------------------------- | -------------------------------- | ---------------------------- |
| `/var/lib/bonfire`        | Main data directory              | ~10 MB (database + metadata) |
| `/var/lib/bonfire/images` | Base VM images (kernel + rootfs) | ~4 GB per image              |
| `/var/lib/bonfire/vms`    | Per-VM runtime files             | Up to 4 GB per VM            |
| `/var/lib/bonfire/keys`   | SSH key storage                  | ~1 KB per VM                 |
| `~/.bonfire` (CLI)        | User configuration               | ~1 KB                        |
| `~/.bonfire/keys` (CLI)   | Downloaded SSH keys              | ~1 KB per VM                 |

**Per-VM Files**: Each VM creates:

- Writable rootfs copy (`{vmId}.rootfs.ext4`) - sparse file, up to 4 GB
- Firecracker socket (`{vmId}.sock`)
- Stderr log file (`{vmId}.firecracker.stderr.log`)
- SSH key pair (`vm-{vmId}` and `vm-{vmId}.pub`)

**Temporary Files**:

- Mount points for SSH key injection (`/tmp/bonfire-mount-{vmId}`)
- Temporary SSH key generation directories
- Test databases (during development/testing)

#### Process Management

**External Processes Spawned**:

- **Firecracker**: One process per running VM (the actual microVM)
- **ip commands**: For TAP device and bridge management
- **ssh-keygen**: For VM SSH key generation
- **mount/umount**: For rootfs modification during SSH key injection
- **cp**: For creating writable rootfs copies (with sparse file support)
- **SSH client**: When using `bonfire vm ssh` command

**Resource Requirements**:

| Resource | Per VM                              | Host Requirements            |
| -------- | ----------------------------------- | ---------------------------- |
| Memory   | 128 MiB - 64 GiB (default: 512 MiB) | +~30 MB Firecracker overhead |
| vCPUs    | 1-32 (default: 1)                   | Shared with host             |
| Disk     | Up to 4 GB per VM                   | Plus base images             |
| Network  | 1 IP from 10.0.100.0/24             | Bridge + TAP overhead        |

**Maximum Capacity**: Up to 253 concurrent VMs (limited by IP pool size)

#### Privilege Requirements

**Required Capabilities**:

- `CAP_NET_ADMIN` - Network interface management (TAP devices, bridges, iptables)
- `CAP_SYS_ADMIN` - Mount operations, system administration
- `/dev/kvm` access - Hardware virtualization

**Root Access Needed For**:

- Initial setup (bridge creation, iptables rules, sysctl changes)
- TAP device creation and management
- Mounting loop devices for rootfs modification
- Installing Firecracker binary to `/usr/local/bin`

### Cleanup Procedures

#### Full System Cleanup (Bare Metal)

If you want to completely remove Bonfire's system changes:

```bash
# 1. Stop all VMs
pkill -f firecracker

# 2. Remove all TAP devices
for tap in $(ip link show | grep -oE 'tap-bf-[a-z0-9]+' | sort -u); do
    ip link delete "$tap" 2>/dev/null || true
done

# 3. Remove bridge
ip link delete bonfire0 2>/dev/null || true

# 4. Remove NAT rule
iptables -t nat -D POSTROUTING -s 10.0.100.0/24 ! -o bonfire0 -j MASQUERADE

# 5. Disable IP forwarding
sysctl -w net.ipv4.ip_forward=0
rm -f /etc/sysctl.d/99-bonfire.conf

# 6. Remove data directories (WARNING: destroys all VM data)
rm -rf /var/lib/bonfire
rm -rf ~/.bonfire

# 7. Remove Firecracker binary
rm -f /usr/local/bin/firecracker
```

#### Docker Cleanup

Much simpler - just remove the containers and volumes:

```bash
# Stop and remove containers
docker compose -f docker/docker-compose.yml down

# Remove volumes (destroys all data)
docker volume rm bonfire_bonfire-data
```

### Bare Metal vs Docker: Impact Comparison

| Aspect                 | Bare Metal                      | Docker                              |
| ---------------------- | ------------------------------- | ----------------------------------- |
| **Network Changes**    | Direct on host                  | Inside container namespace          |
| **Cleanup**            | Manual steps required           | Simple container/volume removal     |
| **Bridge Persistence** | Persists until manually removed | Removed with container              |
| **IPT Persistence**    | Persists until manually removed | Removed with container              |
| **Privileges**         | Root required                   | Can use capabilities                |
| **Isolation**          | Minimal                         | Better process/filesystem isolation |
| **Performance**        | Native                          | Minimal overhead                    |
| **Complexity**         | Higher                          | Lower                               |

### Recommendation

**Use Docker for development workstations** where you want:

- Easy cleanup and no persistent system changes
- Protection against accidentally leaving bridges/TAP devices
- Isolation from your main network stack
- Simple "reset" capability

**Use bare metal for dedicated VM hosts** where:

- Performance is critical
- You're already managing the infrastructure
- You want VMs to persist across container restarts
- You accept the manual cleanup responsibility

## Development Setup

### Monorepo Structure

```
bonfire/
├── packages/
│   ├── api/           # Hono API server
│   ├── web/           # React + Vite frontend
│   ├── sdk/           # TypeScript SDK (auto-generated)
│   └── cli/           # CLI with Clack
├── docker/            # Docker configurations
├── scripts/           # Setup and utility scripts
└── e2e/              # End-to-end tests
```

### Environment Variables

For Docker Compose, put environment variables in a repo-root `.env` file (Docker Compose reads it automatically).

For bare metal (running `packages/api` directly), you can also put them in `packages/api/.env`.

Review and update the values as needed:

```env
DATABASE_URL=/var/lib/bonfire/bonfire.db
BETTER_AUTH_SECRET=<generate-a-secure-random-string>
BETTER_AUTH_URL=http://localhost:3000
PORT=3000
NODE_ENV=development

# Initial admin user (required for first login)
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<choose-a-strong-password>
INITIAL_ADMIN_NAME=Admin
```

#### Authentication Setup

Bonfire uses Better Auth for authentication with email/password. On first startup, if `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are configured, an admin user will be automatically created.

### Agent Sessions (Bootstrap)

Agent sessions currently rely on a guest bootstrap process to become `ready`.

- Historical approach: SSH-based bootstrap.
- Planned approach: serial-console bootstrap (no SSH). See `docs/AGENT_SERIAL_BOOTSTRAP.md`.

> **Security Note**: The default credentials (`admin@example.com` / `admin123`) are for local development only. Always change these values in your `.env` file before exposing the service to any network.

- Users can have either `admin` or `member` role
- Admin users have full permissions (all API endpoints)
- Member users have limited access (can be restricted per-endpoint)
- The initial admin user can create additional users through the API

### Running Tests

```bash
# Unit tests (run anywhere)
pnpm -r test

# Integration tests (requires Docker)
pnpm run test:int

# E2E tests (requires KVM, Linux only)
pnpm run test:e2e

# All tests
pnpm run test:all
```

### Building

```bash
# Build all packages
pnpm run build

# Build specific package
pnpm run build -- --filter=@bonfire/api
```

## Architecture Overview

### System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Browser   │────▶│   Web UI (Vite) │────▶│  API (Hono)     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                              ┌──────────────────────────┼──────────────────────────┐
                              │                          │                          │
                              ▼                          ▼                          ▼
                    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
                    │  Firecracker    │        │  Network (TAP)  │        │   SQLite DB     │
                    │   microVMs      │        │   + Bridge      │        │   (Drizzle)     │
                    └─────────────────┘        └─────────────────┘        └─────────────────┘
```

### Key Components

1. **API Server** (`packages/api`)
   - Hono web framework with OpenAPI spec
   - RESTful endpoints for VM lifecycle
   - WebSocket proxy for terminal access
   - Better Auth integration

2. **Web UI** (`packages/web`)
   - React with TypeScript
   - Tailwind CSS + shadcn/ui components
   - ghostty-web for terminal emulation
   - Mobile-responsive design

3. **SDK** (`packages/sdk`)
   - Auto-generated from OpenAPI spec
   - TypeScript client with full type safety

4. **CLI** (`packages/cli`)
   - Clack for interactive prompts
   - Commands: vm, image, config, login

### VM Lifecycle

1. **Create** - VM record created in DB with `creating` status
2. **Start** - Network resources allocated, Firecracker process spawned with serial console pipes
3. **Running** - VM boots, serial console available via WebSocket terminal
4. **Stop** - Firecracker process stopped, network resources and pipes released
5. **Delete** - VM record removed from DB

### Network Architecture

- Bridge: `bonfire0` (10.0.100.1/24)
- Each VM gets:
  - TAP device attached to bridge
  - Unique MAC address
  - IP from pool (10.0.100.2 - 10.0.100.254)
- NAT for internet access via host

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

## Documentation

- [PLAN.md](./PLAN.md) - Full implementation plan and technical details
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

## Status

This is an experimental learning project under active development. Expect breaking changes, incomplete features, and potential security issues. See [PLAN.md](./PLAN.md) for implementation status.

## License

MIT
