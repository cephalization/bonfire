# Bonfire

> [!WARNING]
> Just use https://github.com/sahil-shubham/bhatti instead

> **Warning**: This is an experimental project intended for learning and exploration. It is not production-ready and may have security vulnerabilities, bugs, or breaking changes. Use at your own risk.

A self-hosted platform for ephemeral Firecracker microVMs, optimized for remote code development and execution.

## Features

- **Web UI** - Manage VMs from your browser (mobile-responsive)
- **Terminal Access** - Full interactive terminal in the browser, backed by an SSH pty on the VM
- **SSH Access** - Per-VM keypairs, injected at boot; connect with `bonfire vm ssh`
- **Conversations** - Group chats per organization, live for everyone in them
- **Agents** - Add an [opencode](https://opencode.ai) agent to any conversation; it runs inside one of your VMs with the LLM provider keys your organization admins configured
- **TypeScript SDK** - Programmatic control of your VMs
- **CLI** - Full-featured command-line interface
- **Ephemeral VMs** - Spin up and tear down VMs in seconds

## Tech Stack

- **Runtime**: Node.js 24+
- **Backend**: Hono
- **Frontend**: React + Vite + shadcn/ui
- **Database**: SQLite + Drizzle
- **Auth**: Better Auth — accounts, organizations, invitations, API keys (see Authentication below)
- **Terminal**: ghostty-web in the browser, over a WebSocket bridged to SSH
- **Chat**: shadcn/ui chat components (MessageScroller, Message, Bubble, Marker), server-sent events for realtime
- **Agents**: opencode's HTTP API, served from inside the VM
- **CLI**: Clack
- **VMs**: Firecracker microVMs

## Quick Start (Docker - Recommended)

Get from zero to a running VM in under 5 minutes with Docker and the CLI.

### Prerequisites

- Linux host with KVM support (`/dev/kvm` must exist)
- Docker and Docker Compose

### Installation

1. **Clone and build the VM image**:

```bash
git clone https://github.com/cephalization/bonfire.git
cd bonfire
./scripts/build-agent-image-docker.sh
```

This creates the kernel and rootfs needed to run VMs:

- `images/agent-kernel` (~10 MB)
- `images/agent-rootfs.ext4` (~4 GB sparse file)

2. **Start Bonfire** (auto-registers the image on startup):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d --remove-orphans
```

3. **Install the CLI**:

```bash
npm install -g @bonfire/cli

# Or use npx (no install)
npx @bonfire/cli
```

4. **Create your account and an API key**:

Open http://localhost:5173, click "Sign up" and create the first account (the
first user of a server may always sign up; after that people need an
invitation). Create an organization, then go to **Settings → API keys** and
create a key.

5. **Login with the CLI**:

```bash
bonfire login
# API URL: http://localhost:3000
# API Key: paste the key you just created
```

6. **Create and connect to your first VM**:

```bash
# Create, start, and connect
bonfire vm create my-first-vm --image=local:agent-ready
bonfire vm start my-first-vm
bonfire vm ssh my-first-vm
```

That's it! You're now connected to your Firecracker microVM via SSH.

### Alternative: Using the Web UI

If you prefer a graphical interface:

1. Open http://localhost:5173 in your browser
2. Sign up (or sign in) and pick your organization
3. Click "New VM", select `local:agent-ready` image
4. Start the VM and click "SSH" to connect

### Production Compose

For a production-like setup (static web served by nginx with `/api` reverse-proxied to the API):

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
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

4. **Start servers** (in one terminal):

```bash
pnpm run dev
```

5. **Register the image**: the API registers `local:agent-ready` on startup
   when it finds `agent-kernel` and `agent-rootfs.ext4` in its images
   directory. Point it at the build output with `IMAGES_DIR=$PWD/images` before
   `pnpm run dev`, or register any kernel/rootfs pair from the web UI's Images
   page.

6. **Install CLI and login**:

Open http://localhost:5173, sign up, create an organization and an API key
under **Settings → API keys**, then:

```bash
npm install -g @bonfire/cli
bonfire login
# API URL: http://localhost:3000
# API Key: the key you just created
```

7. **Create and connect to your first VM**:

```bash
bonfire vm create my-first-vm --image=local:agent-ready
bonfire vm start my-first-vm
bonfire vm ssh my-first-vm
```

Or use the Web UI at http://localhost:5173

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
BETTER_AUTH_SECRET=<generate with: openssl rand -base64 32>
BONFIRE_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
```

See [.env.example](./.env.example) for the annotated version.

#### Authentication

Bonfire has user accounts, organizations and API keys, built on
[Better Auth](https://better-auth.com).

- **Accounts** are email + password. The **first user** of a server may sign up
  freely; after that sign-up is **invitation only** unless you set
  `BONFIRE_OPEN_SIGNUP=true`.
- **Organizations** own VMs. A user can belong to several and switches between
  them in the sidebar. Roles are `owner`, `admin` and `member`; owners and
  admins can invite and remove people.
- **Invitations** are links. There is no email service yet, so the inviter
  copies the link from **Settings → Invitations** (it is also written to the API
  log) and sends it themselves. The invitee signs up with the invited address
  and accepts.
- **API keys** are created under **Settings → API keys**. A key acts as the user
  who made it, in the organization it was made for, and is sent as the
  `X-API-Key` header. This is what the CLI and SDK use.

`BETTER_AUTH_SECRET` signs sessions and is required in production. `BONFIRE_URL`
must be the URL the browser reaches Bonfire at, because cookies and origin
checks are tied to it (behind the Docker nginx that is the web URL).

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
   - Firecracker, network (TAP/bridge) and SSH services
   - WebSocket terminal bridged to an SSH pty
   - Better Auth: accounts, organizations, invitations, API keys

2. **Web UI** (`packages/web`)
   - React with TypeScript
   - Tailwind CSS + shadcn/ui components
   - ghostty-web terminal component
   - Mobile-responsive design

3. **SDK** (`packages/sdk`)
   - Hand-written TypeScript client
   - The API serves `/api/openapi.json`; generating the SDK from it is planned

4. **CLI** (`packages/cli`)
   - Clack for interactive prompts
   - Commands: vm, image, config, login

### VM Lifecycle

1. **Create** - VM record created in DB with `creating` status
2. **Start** - Network resources allocated, Firecracker process spawned, a per-VM
   SSH keypair generated and injected into the rootfs
3. **Running** - VM boots and is reachable over SSH (`bonfire vm ssh <name>`)
   or from the browser terminal on the VM's detail page
4. **Stop** - Firecracker process stopped, network resources released
5. **Delete** - VM record removed from DB

A watchdog (`services/vm-watchdog.ts`) reconciles VMs marked `running` in the
DB against their actual Firecracker processes every 20s.

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

- [CLAUDE.md](./CLAUDE.md) - Architecture, conventions, and what is deliberately
  missing. Start here if you (or an agent) are working on the code.
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [docs/](./docs/) - Agent image and bootstrap notes
- [docs/history/](./docs/history/) - Superseded plans and migration notes, kept
  for reference. These describe past intentions, not the current code.

## Status

Experimental. VM lifecycle, networking, SSH access, the browser terminal,
accounts, organizations and invitations work. See [CLAUDE.md](./CLAUDE.md) for
the current state and what is planned next.

## License

MIT
