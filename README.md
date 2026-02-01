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

Docker is the recommended way to run Bonfire as it provides isolation and a consistent environment.

### Prerequisites

- Linux host with KVM support (`/dev/kvm` must exist)
- Docker and Docker Compose

### Installation

1. Clone the repository:

```bash
git clone https://github.com/cephalization/bonfire.git
cd bonfire
```

2. Build and run with Docker Compose:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up
```

3. Open http://localhost:5173 in your browser

4. Log in with the default admin credentials:
   - Email: `admin@example.com`
   - Password: `admin123`

This starts both API and web servers with:

- Hot reload for both API and web code
- Source code mounted as volumes for live editing
- KVM device access for VM management
- Ports 3000 (API) and 5173 (Web UI) exposed

### Alternative: Bare Metal Installation

> **Warning**: Running directly on bare metal modifies system networking configuration, installs system packages, and requires root access. This approach carries more risk and is only recommended for advanced users who understand the implications.

**Prerequisites:**

- Linux host with KVM support (`/dev/kvm` must exist)
- Node.js 24+ (use corepack + pnpm)
- Root access (for network/VM management)

**Steps:**

1. Clone the repository:

```bash
git clone https://github.com/cephalization/bonfire.git
cd bonfire
```

2. Install dependencies:

```bash
corepack enable
pnpm install
```

3. Run the host setup script (requires root - installs Firecracker, configures networking):

```bash
sudo ./scripts/setup.sh  # installs Firecracker, sets up VM bridge/NAT, creates .env
```

4. Start the development servers:

```bash
pnpm run dev  # runs both API and web servers in parallel via mprocs
```

5. Open http://localhost:5173 in your browser

6. Log in with the admin credentials (configured in `.env`):
   - Email: `admin@example.com` (or your INITIAL_ADMIN_EMAIL)
   - Password: `admin123` (or your INITIAL_ADMIN_PASSWORD)

The mprocs TUI will show both processes. Use arrow keys to switch between them,
and press `q` to quit all processes.

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

The setup script creates a `.env` file in `packages/api` with sensible defaults.
Review and update the values as needed:

```env
DB_PATH=/var/lib/bonfire/bonfire.db
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
