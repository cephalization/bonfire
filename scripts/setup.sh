#!/bin/bash
# Bonfire Host Setup Script
#
# This script prepares a Linux host to run Bonfire Firecracker microVMs.
# It performs the following setup tasks:
#   1. Verifies KVM support (/dev/kvm must exist)
#   2. Installs Firecracker binary if not present
#   3. Creates a bridge network (bonfire0) for VM networking
#   4. Enables IP forwarding for VM internet access
#   5. Configures NAT rules for the VM network
#   6. Creates required directories (/var/lib/bonfire/)
#   7. Creates a default .env file for API configuration
#
# Must be run as root. Idempotent - safe to run multiple times.
#
# Usage: sudo ./scripts/setup.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run as root"
fi

# Configuration
FC_VERSION="${FC_VERSION:-v1.14.1}"
BRIDGE="bonfire0"
SUBNET="10.0.100.1/24"
NETWORK="10.0.100.0/24"
BONFIRE_DIR="/var/lib/bonfire"

# 1. Check for KVM support
info "Checking KVM support..."
if [ ! -e /dev/kvm ]; then
    error "/dev/kvm not found. KVM is required for Firecracker VMs."
fi
info "KVM support found"

# 2. Install Firecracker
info "Checking Firecracker installation..."
if command -v firecracker &> /dev/null; then
    CURRENT_VERSION=$(firecracker --version 2>/dev/null | head -1 || echo "unknown")
    info "Firecracker already installed: $CURRENT_VERSION"
else
    info "Installing Firecracker ${FC_VERSION}..."
    
    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
        FC_ARCH="x86_64"
    elif [ "$ARCH" = "aarch64" ]; then
        FC_ARCH="aarch64"
    else
        error "Unsupported architecture: $ARCH"
    fi
    
    # Download and extract Firecracker
    RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${FC_ARCH}.tgz"
    
    TMP_DIR=$(mktemp -d)
    trap "rm -rf $TMP_DIR" EXIT
    
    info "Downloading from ${RELEASE_URL}..."
    curl -fsSL "$RELEASE_URL" -o "$TMP_DIR/firecracker.tgz"
    
    info "Extracting..."
    tar -xzf "$TMP_DIR/firecracker.tgz" -C "$TMP_DIR"
    
    # Find and install binaries
    FC_BIN=$(find "$TMP_DIR" -name "firecracker-${FC_VERSION}-${FC_ARCH}" -type f | head -1)
    JAILER_BIN=$(find "$TMP_DIR" -name "jailer-${FC_VERSION}-${FC_ARCH}" -type f | head -1)
    
    if [ -z "$FC_BIN" ]; then
        error "Could not find firecracker binary in release archive"
    fi
    
    cp "$FC_BIN" /usr/local/bin/firecracker
    chmod +x /usr/local/bin/firecracker
    
    if [ -n "$JAILER_BIN" ]; then
        cp "$JAILER_BIN" /usr/local/bin/jailer
        chmod +x /usr/local/bin/jailer
        info "Installed jailer to /usr/local/bin/jailer"
    fi
    
    info "Installed firecracker to /usr/local/bin/firecracker"
fi

# Verify firecracker is executable
if ! firecracker --version &> /dev/null; then
    error "Firecracker installation verification failed"
fi

# 3. Create bridge network (idempotent)
info "Setting up bridge network ${BRIDGE}..."

# Check if bridge exists, create if not
if ! ip link show "$BRIDGE" &> /dev/null; then
    ip link add name "$BRIDGE" type bridge
    info "Created bridge ${BRIDGE}"
else
    info "Bridge ${BRIDGE} already exists"
fi

# Check if IP is assigned, assign if not
if ! ip addr show dev "$BRIDGE" | grep -q "${SUBNET}"; then
    ip addr add "$SUBNET" dev "$BRIDGE" || true
    info "Assigned ${SUBNET} to ${BRIDGE}"
else
    info "IP ${SUBNET} already assigned to ${BRIDGE}"
fi

# Bring bridge up
ip link set dev "$BRIDGE" up
info "Bridge ${BRIDGE} is up"

# 4. Enable IP forwarding (idempotent)
info "Enabling IP forwarding..."
CURRENT_FORWARD=$(sysctl -n net.ipv4.ip_forward)
if [ "$CURRENT_FORWARD" -eq 1 ]; then
    info "IP forwarding already enabled"
else
    sysctl -w net.ipv4.ip_forward=1
    info "IP forwarding enabled"
fi

# Make persistent (if sysctl.d exists)
if [ -d /etc/sysctl.d ]; then
    SYSCTL_CONF="/etc/sysctl.d/99-bonfire.conf"
    if [ ! -f "$SYSCTL_CONF" ] || ! grep -q "net.ipv4.ip_forward=1" "$SYSCTL_CONF"; then
        echo "net.ipv4.ip_forward=1" > "$SYSCTL_CONF"
        info "Made IP forwarding persistent in ${SYSCTL_CONF}"
    fi
fi

# 5. NAT for internet access (idempotent)
info "Setting up NAT rules..."

# Check if rule already exists
if iptables -t nat -C POSTROUTING -s "$NETWORK" ! -o "$BRIDGE" -j MASQUERADE 2>/dev/null; then
    info "NAT rule already exists"
else
    iptables -t nat -A POSTROUTING -s "$NETWORK" ! -o "$BRIDGE" -j MASQUERADE
    info "Added NAT rule for ${NETWORK}"
fi

# 6. Create directories
info "Creating Bonfire directories..."
mkdir -p "${BONFIRE_DIR}/images"
mkdir -p "${BONFIRE_DIR}/vms"
chmod 755 "${BONFIRE_DIR}"
chmod 755 "${BONFIRE_DIR}/images"
chmod 755 "${BONFIRE_DIR}/vms"
info "Created ${BONFIRE_DIR}/{images,vms}"

# 7. Build agent VM images if not present
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGES_DIR="${PROJECT_ROOT}/images"

info "Checking agent VM images..."
if [ -f "${IMAGES_DIR}/agent-rootfs.ext4" ] && [ -f "${IMAGES_DIR}/agent-kernel" ]; then
    info "Agent VM images already exist at ${IMAGES_DIR}"
else
    info "Building agent VM images (this may take a few minutes)..."
    if [ -f "${SCRIPT_DIR}/build-agent-image-docker.sh" ]; then
        # Use Docker-based build (no additional sudo needed)
        bash "${SCRIPT_DIR}/build-agent-image-docker.sh" "${IMAGES_DIR}"
        info "Agent VM images built successfully"
    else
        warn "build-agent-image-docker.sh not found, skipping image build"
        warn "Run ./scripts/build-agent-image-docker.sh manually to build images"
    fi
fi

# 8. Create default .env file
API_DIR="$(cd "$(dirname "$0")/../packages/api" && pwd)"
ENV_FILE="${API_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
    info "Creating default .env file..."
    cat > "$ENV_FILE" << 'EOF'
# Bonfire API Configuration
#
# IMPORTANT: Change these values before deploying to production!

# SQLite database path
DB_PATH=/var/lib/bonfire/bonfire.db

# Better Auth configuration
# Change this to a secure random string (min 32 characters) for production
BETTER_AUTH_SECRET=change-me-in-production-32-chars-min

# API URL for auth callbacks
BETTER_AUTH_URL=http://localhost:3000

# Server port
PORT=3000

# Environment
NODE_ENV=development

# Initial Admin User Configuration
# These credentials will be used to create the first admin user on startup
# IMPORTANT: Change these before deploying to production!
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=admin123
INITIAL_ADMIN_NAME=Admin
EOF
    info "Created ${ENV_FILE}"
    warn "Please review and update the values in ${ENV_FILE}"
else
    info ".env file already exists at ${ENV_FILE}"
fi

# Summary
echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Bonfire host setup complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Configuration:"
echo "  - Firecracker: $(firecracker --version 2>/dev/null | head -1)"
echo "  - Bridge: ${BRIDGE} (${SUBNET})"
echo "  - VM Network: ${NETWORK}"
echo "  - Data Directory: ${BONFIRE_DIR}"
echo ""
echo "Next steps:"
echo "  1. Review the .env file: cat packages/api/.env"
echo "  2. Update any values as needed for your environment"
echo "  3. Start the development servers: pnpm run dev"
echo ""
echo "To verify setup:"
echo "  - Check bridge: ip addr show ${BRIDGE}"
echo "  - Check NAT: iptables -t nat -L POSTROUTING -n -v"
echo "  - Check directories: ls -la ${BONFIRE_DIR}"
