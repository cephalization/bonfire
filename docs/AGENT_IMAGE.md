# Agent-Ready VM Image

This directory contains the build system for creating the agent-ready VM image used by Bonfire's Agent Sessions feature.

## Overview

The agent-ready VM image is a Firecracker-compatible rootfs that includes:

- **Base OS**: Ubuntu 24.04 LTS
- **SSH Server**: OpenSSH with key-based authentication
- **Build Tools**: git, build-essential, python3, pkg-config
- **Runtime**: Node.js 22+ LTS, pnpm
- **Agent Software**: OpenCode CLI
- **User**: `agent` (uid 1000) with passwordless sudo
- **Process Management**: systemd user service template for OpenCode

## Files

| File | Description |
|------|-------------|
| `Dockerfile.agent` | Docker build definition for the agent environment |
| `scripts/build-agent-image.sh` | Build script using sudo mount (traditional) |
| `scripts/build-agent-image-docker.sh` | Build script using Docker (no sudo required) |
| `scripts/verify-agent-image.sh` | Verification script using sudo mount |
| `scripts/verify-agent-image-docker.sh` | Verification script using Docker (no sudo required) |

## Quick Start

### Build the Image

**Option 1: Docker-based (recommended, no sudo required)**

```bash
# Build the agent-ready VM image using Docker
./scripts/build-agent-image-docker.sh

# Or specify custom output directory
./scripts/build-agent-image-docker.sh /path/to/output
```

**Option 2: Traditional (requires sudo for mount)**

```bash
# Build the agent-ready VM image
sudo ./scripts/build-agent-image.sh

# Or specify custom output directory
sudo ./scripts/build-agent-image.sh /path/to/output
```

This will create:
- `images/agent-kernel` - Firecracker kernel (downloaded from CI)
- `images/agent-rootfs.ext4` - ext4 rootfs image (2GB)

### Verify the Image

**Docker-based (recommended, no sudo required):**

```bash
# Verify image contents without booting (no KVM required)
./scripts/verify-agent-image-docker.sh

# Or specify custom image path
./scripts/verify-agent-image-docker.sh /path/to/agent-rootfs.ext4
```

**Traditional (requires sudo for mount):**

```bash
# Verify image contents without booting (no KVM required)
sudo ./scripts/verify-agent-image.sh images/agent-rootfs.ext4
```

### Clean Build

```bash
# Remove cached Docker images and rebuild
docker rmi bonfire-agent-build
rm -rf images/
./scripts/build-agent-image.sh
```

## Requirements

### Build Requirements

- Docker (for containerized build)
- sudo/root access (for mounting ext4 images)
- ~3GB free disk space
- Internet connection (for downloading packages and kernel)

### Runtime Requirements

- Linux host with KVM support
- Firecracker binary
- Bonfire API configured with agent image path

## Image Contents

### System Packages

- `openssh-server` - SSH daemon for remote access
- `git` - Version control
- `curl`, `wget` - HTTP clients
- `ca-certificates` - SSL certificates
- `build-essential` - GCC, make, etc.
- `python3`, `python3-pip` - Python runtime
- `pkg-config` - Build configuration
- `libssl-dev`, `zlib1g-dev` - Common libraries
- `iproute2`, `iptables` - Networking tools
- `systemd`, `systemd-sysv` - Init system

### User Setup

The `agent` user is configured with:
- **UID**: 1000
- **Home**: `/home/agent`
- **Shell**: `/bin/bash`
- **SSH**: Key-based authentication only (password auth disabled)
- **Sudo**: Passwordless sudo access
- **Services**: systemd user services enabled with linger

### Installed Software

**Node.js & pnpm**:
```bash
node --version    # v22.x.x
pnpm --version    # Latest
```

**OpenCode**:
```bash
# Installed at
/home/agent/.local/bin/opencode

# Version check
opencode --version
```

### systemd Service Template

The OpenCode service template is installed at:
```
/home/agent/.config/systemd/user/opencode@.service
```

Usage:
```bash
# Start OpenCode for a specific session
systemctl --user start opencode@<session-id>

# Stop OpenCode
systemctl --user stop opencode@<session-id>

# Check status
systemctl --user status opencode@<session-id>
```

Service configuration:
- **Port**: 4096 (hardcoded for MVP)
- **Bind**: 0.0.0.0 (all interfaces)
- **Working Directory**: `/home/agent/workspaces/%i`
- **Environment**: Session ID used as password
- **Restart**: on-failure with 5s delay

## SSH Access

### Baking Keys into the Image (MVP)

For the MVP, SSH keys are baked into the image:

1. Generate a keypair:
```bash
ssh-keygen -t ed25519 -f bonfire-agent-key -N ""
```

2. Add public key to image (before building):
Modify `docker/Dockerfile.agent` to add:
```dockerfile
COPY bonfire-agent-key.pub /home/agent/.ssh/authorized_keys
RUN chown agent:agent /home/agent/.ssh/authorized_keys \
    && chmod 600 /home/agent/.ssh/authorized_keys
```

3. Store private key in Bonfire config for SSH access.

### Security Considerations

⚠️ **MVP Warning**: Using baked keys means all VMs share the same SSH keypair. This is acceptable for:
- Single-tenant deployments
- Ephemeral VMs
- Development environments

**Post-MVP**: Implement per-VM key injection via Firecracker MMDS or cloud-init.

## Integration with Bonfire

### Registering the Image

After building, register the image with Bonfire:

```bash
# Via CLI
bonfire image import agent-ready \
  --kernel ./images/agent-kernel \
  --rootfs ./images/agent-rootfs.ext4

# Or via API
curl -X POST http://localhost:3000/api/images/pull \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "bonfire-agent:local",
    "kernelPath": "/var/lib/bonfire/images/agent-kernel",
    "rootfsPath": "/var/lib/bonfire/images/agent-rootfs.ext4"
  }'
```

### Using with Agent Sessions

When creating an agent session, specify the agent-ready image:

```bash
curl -X POST http://localhost:3000/api/agent/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "repoUrl": "https://github.com/user/repo",
    "branch": "main",
    "imageRef": "bonfire-agent:local"
  }'
```

## Testing

### Automated Verification (No KVM)

```bash
# Run verification script
./scripts/verify-agent-image.sh

# Expected output:
# [PASS] SSH server (sshd) is installed
# [PASS] Git is installed
# [PASS] Node.js is installed
# [PASS] OpenCode binary is installed
# [PASS] Agent user exists in /etc/passwd
# ...
```

### Manual Testing (Requires KVM)

1. **Start Firecracker VM**:
```bash
# Use Bonfire API or manual Firecracker invocation
# See Firecracker docs for manual testing
```

2. **Test SSH**:
```bash
ssh -i bonfire-agent-key agent@<vm-ip>
```

3. **Test OpenCode**:
```bash
# Inside VM
opencode --version
systemctl --user start opencode@test-session
curl http://localhost:4096/global/health
```

## Troubleshooting

### Build Issues

**Docker daemon not running**:
```bash
sudo systemctl start docker
# Or add user to docker group
sudo usermod -aG docker $USER
```

**Out of disk space**:
```bash
# Clean up Docker
docker system prune -a

# Free up space
rm -rf images/
```

**Permission denied mounting image**:
```bash
# Run with sudo
sudo ./scripts/build-agent-image.sh
```

### Runtime Issues

**SSH connection refused**:
- Verify SSH service is running: `service ssh status`
- Check firewall rules: `iptables -L`
- Verify authorized_keys file exists and has correct permissions

**OpenCode not found**:
- Check installation: `ls -la /home/agent/.local/bin/`
- Verify PATH: `echo $PATH`
- Reinstall: `curl -fsSL https://opencode.ai/install | bash`

**systemd user service fails**:
- Check logs: `journalctl --user -u opencode@<session-id>`
- Verify config: `cat /home/agent/.config/systemd/user/opencode@.service`
- Test manually: `opencode web --port 4096 --hostname 0.0.0.0`

## Customization

### Adding Packages

Edit `docker/Dockerfile.agent` and add packages to the apt-get install list:

```dockerfile
RUN apt-get update && apt-get install -y \
    your-package \
    another-package \
    && rm -rf /var/lib/apt/lists/*
```

### Changing Image Size

Edit `scripts/build-agent-image.sh` and modify:

```bash
IMAGE_SIZE_MB="4096"  # 4GB instead of 2GB
```

### Custom OpenCode Config

Edit the systemd service template in `docker/Dockerfile.agent`:

```dockerfile
Environment=OPENCODE_CONFIG_CONTENT={"share":"disabled","permission":{"bash":"ask"},"server":{"port":4096}}
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Build Agent Image

on:
  push:
    paths:
      - 'docker/Dockerfile.agent'
      - 'scripts/build-agent-image.sh'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Image
        run: |
          sudo ./scripts/build-agent-image.sh
      
      - name: Verify Image
        run: |
          sudo ./scripts/verify-agent-image.sh
      
      - name: Upload Artifact
        uses: actions/upload-artifact@v3
        with:
          name: agent-image
          path: images/
```

## References

- [Firecracker Getting Started](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- [OpenCode Documentation](https://opencode.ai)
- [Ubuntu Cloud Images](https://cloud-images.ubuntu.com/)
- [systemd User Services](https://wiki.archlinux.org/title/Systemd/User)

## License

This build system is part of the Bonfire project and follows the same license terms.
