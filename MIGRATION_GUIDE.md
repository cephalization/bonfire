# Bonfire Migration Guide

## Migrating from Pre-Refactor to New Architecture

This guide helps you migrate from the old Bonfire architecture (with Better Auth, serial console, agent sessions, and OCI registry) to the new simplified architecture.

---

## Quick Summary of Changes

| Feature            | Old Way                         | New Way                        |
| ------------------ | ------------------------------- | ------------------------------ |
| **Authentication** | Email/password with sessions    | API key (`X-API-Key` header)   |
| **VM Access**      | WebSocket terminal via browser  | SSH client (native or browser) |
| **Images**         | Pull from OCI registry          | Build locally with Docker      |
| **OpenCode**       | Auto-managed via agent sessions | Manual install via SSH         |
| **VM Identifiers** | UUID only                       | Name + UUID                    |

---

## Before You Begin

### Backup Your Data

```bash
# Backup your database
cp /var/lib/bonfire/bonfire.db ~/bonfire-backup-$(date +%Y%m%d).db

# Backup your VMs (if you want to preserve them)
tar -czf ~/bonfire-vms-backup-$(date +%Y%m%d).tar.gz /var/lib/bonfire/vms/
```

### Prerequisites

- Node.js 24+
- pnpm (with corepack enabled)
- Docker (for building images)
- SSH client

---

## Step-by-Step Migration

### Step 1: Update Environment Variables

**Before:**

```bash
# Old - Better Auth
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=...
```

**After:**

```bash
# New - API Key
BONFIRE_API_KEY=your-secure-api-key-here
PORT=3000
DATABASE_URL=/var/lib/bonfire/bonfire.db
```

**Generate a secure API key:**

```bash
openssl rand -hex 32
```

---

### Step 2: Update CLI Configuration

**Old config (`~/.bonfire/config.json`):**

```json
{
  "apiUrl": "http://localhost:3000",
  "token": "session-token-from-better-auth"
}
```

**New config (`~/.bonfire/config.json`):**

```json
{
  "apiUrl": "http://localhost:3000",
  "apiKey": "your-secure-api-key-here"
}
```

**Or set via CLI:**

```bash
bonfire config set api-key your-secure-api-key-here
```

---

### Step 3: Rebuild the Application

```bash
# Install dependencies
corepack enable && pnpm install

# Build all packages
pnpm run build

# Run database migrations
pnpm --filter @bonfire/api migrate
```

---

### Step 4: Build Default Image

Since OCI registry pulling has been removed, you must build images locally:

```bash
# Build the default agent image
./scripts/build-agent-image-docker.sh

# This creates:
# /var/lib/bonfire/images/default/kernel
# /var/lib/bonfire/images/default/rootfs.ext4
```

The image includes:

- Ubuntu 24.04
- SSH server (port 22)
- Node.js 24
- OpenCode (installed but not auto-configured)

---

### Step 5: Update Your VMs (or Recreate)

**Option A: Recreate VMs (Recommended)**

```bash
# List old VMs
bonfire vm list

# Delete old VMs (they won't work with new architecture)
bonfire vm rm <vm-name>

# Create new VM
bonfire vm create my-project --start

# SSH into VM
bonfire ssh my-project
```

**Option B: Try to Migrate Existing VMs**

Existing VMs may not work because:

- They don't have SSH keys injected
- They may have old agent software
- Serial console is no longer available

If you need to preserve VM data:

```bash
# Export VM rootfs (advanced)
# Mount the VM's rootfs and manually extract data
```

---

### Step 6: Update Your Workflow

#### Accessing VMs

**Before (Web UI):**

1. Open browser
2. Navigate to VM detail page
3. Click terminal tab
4. Use WebSocket terminal

**After (SSH):**

```bash
# Option 1: Use bonfire CLI
bonfire ssh my-project

# Option 2: Use native SSH
ssh agent@<vm-ip> -i ~/.bonfire/id_rsa

# Option 3: Use any SSH client
# IP is shown in: bonfire vm list
```

#### Installing OpenCode

**Before:**

- OpenCode auto-installed and configured
- Managed via agent sessions API

**After:**

```bash
# SSH into VM
bonfire ssh my-project

# Install OpenCode manually
curl -fsSL https://opencode.ai/install.sh | sh

# Configure as needed
opencode config set ...
```

#### Managing Images

**Before:**

```bash
# Pull from registry
bonfire image pull ubuntu:24.04
```

**After:**

```bash
# List local images
bonfire image list

# Images must be built locally via Docker
# See: scripts/build-agent-image-docker.sh
```

---

## API Changes for SDK Users

### Authentication

**Before:**

```typescript
const client = new BonfireClient({
  baseUrl: "http://localhost:3000",
});

// Sign in first
await client.auth.signIn({
  email: "user@example.com",
  password: "secret",
});
```

**After:**

```typescript
const client = new BonfireClient({
  baseUrl: "http://localhost:3000",
  apiKey: "your-api-key",
});

// No sign-in needed - API key included in all requests
```

### Terminal Access

**Before:**

```typescript
// WebSocket terminal
const ws = client.vms.createTerminalConnection(vmId);
ws.onmessage = (data) => terminal.write(data);
ws.send(command);
```

**After:**

```typescript
// SSH only - not via SDK
// Use your SSH client library of choice
// Or exec commands via SSH
```

### Image Management

**Before:**

```typescript
// Pull from registry
await client.images.pull({ reference: "ubuntu:24.04" });
```

**After:**

```typescript
// List local images only
const images = await client.images.list();

// Register a locally built image
await client.images.register({
  reference: "my-custom-image",
  kernelPath: "/path/to/kernel",
  rootfsPath: "/path/to/rootfs.ext4",
});
```

---

## Troubleshooting

### "Unauthorized - X-API-Key header required"

**Cause:** API key not configured

**Fix:**

```bash
# Set API key
export BONFIRE_API_KEY=your-key

# Or update CLI config
bonfire config set api-key your-key
```

### "Terminal access is currently unavailable"

**Cause:** Trying to use WebSocket terminal (removed)

**Fix:** Use SSH instead

```bash
bonfire ssh <vm-name>
```

### "Image not found"

**Cause:** Images must be built locally now

**Fix:**

```bash
# Build default image
./scripts/build-agent-image-docker.sh

# Verify image exists
bonfire image list
```

### VMs Won't Start

**Check:**

1. Is KVM available? `ls -la /dev/kvm`
2. Is the bridge configured? `ip link show bonfire0`
3. Is the image registered? `bonfire image list`

### SSH Connection Refused

**Check:**

1. Is VM running? `bonfire vm list`
2. Is SSH key injected? (happens automatically on start)
3. Try: `ssh -v agent@<ip> -i ~/.bonfire/id_rsa`

---

## FAQ

### Q: Can I still use the web UI?

**A:** Yes, but the terminal is currently unavailable. Use a native SSH client instead. A browser-based SSH client is planned for future release.

### Q: What happened to the registry?

**A:** OCI registry pulling was removed to simplify the architecture. Build images locally using the provided Docker script.

### Q: Do I need to reinstall OpenCode?

**A:** If you had VMs with OpenCode, you'll need to SSH into new VMs and install it manually. It's no longer auto-managed.

### Q: Can I go back to the old version?

**A:** We recommend staying with the new version. If you must revert:

1. Restore your database backup
2. Checkout the pre-refactor git tag
3. Rebuild with old configuration

### Q: Where are my old VMs?

**A:** VM data is preserved in `/var/lib/bonfire/vms/`, but old VMs may not work with the new architecture due to missing SSH keys. We recommend recreating VMs.

### Q: How do I build custom images?

**A:** See `docker/Dockerfile.agent` and `scripts/build-agent-image-docker.sh`. Modify the Dockerfile to add packages, then rebuild.

---

## New Features to Try

### SSH Access

```bash
# Direct SSH into VMs
bonfire ssh my-project

# Execute commands
bonfire vm exec my-project -- ls -la

# Copy files (via SSH)
scp -i ~/.bonfire/id_rsa ./local-file agent@<vm-ip>:/home/agent/
```

### Simplified CLI

```bash
# One-liner to create and start
bonfire vm create my-project --start

# Use VM names instead of UUIDs
bonfire vm stop my-project
bonfire vm start my-project
bonfire vm rm my-project
```

### API Key Simplicity

```bash
# No more login/logout
# Just set API key once
bonfire config set api-key <key>
# Works forever
```

---

## Getting Help

If you encounter issues:

1. Check logs: `pnpm --filter @bonfire/api logs`
2. Run tests: `pnpm -r test`
3. Review REFACTOR_SUMMARY.md for architecture details
4. File an issue with:
   - Error message
   - `bonfire --version` output
   - Steps to reproduce

---

## Summary

The new Bonfire architecture is:

- **Simpler:** No complex auth, sessions, or serial console
- **More reliable:** SSH instead of custom protocols
- **Faster:** Local image builds instead of registry pulls
- **Maintained:** Easier to debug and extend

**Migration effort:** ~30 minutes  
**Time saved long-term:** Hours of debugging complex auth and serial console issues

---

_Migration Guide Version: 1.0_  
_Last Updated: February 2026_
