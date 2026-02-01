#!/bin/bash
# Bonfire Network Initialization Script for Containers
#
# This script sets up the bridge network inside a privileged container
# for Firecracker microVMs. It performs the following tasks:
#   1. Creates the bonfire0 bridge network
#   2. Configures it with IP 10.0.100.1/24
#   3. Enables IP forwarding for VM internet access
#   4. Sets up NAT rules for the VM network
#
# Must be run as root. Idempotent - safe to run multiple times.
#
# Usage: ./init-network.sh

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
BRIDGE="bonfire0"
SUBNET="10.0.100.1/24"
NETWORK="10.0.100.0/24"

# 1. Create bridge network (idempotent)
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

# 2. Enable IP forwarding (idempotent)
info "Enabling IP forwarding..."
CURRENT_FORWARD=$(sysctl -n net.ipv4.ip_forward)
if [ "$CURRENT_FORWARD" -eq 1 ]; then
    info "IP forwarding already enabled"
else
    sysctl -w net.ipv4.ip_forward=1
    info "IP forwarding enabled"
fi

# 3. NAT for internet access (idempotent)
info "Setting up NAT rules..."

# Check if rule already exists
if iptables -t nat -C POSTROUTING -s "$NETWORK" ! -o "$BRIDGE" -j MASQUERADE 2>/dev/null; then
    info "NAT rule already exists"
else
    iptables -t nat -A POSTROUTING -s "$NETWORK" ! -o "$BRIDGE" -j MASQUERADE
    info "Added NAT rule for ${NETWORK}"
fi

# Summary
info "Network initialization complete!"
echo ""
echo "Configuration:"
echo "  - Bridge: ${BRIDGE} (${SUBNET})"
echo "  - VM Network: ${NETWORK}"
echo ""
echo "To verify setup:"
echo "  - Check bridge: ip addr show ${BRIDGE}"
echo "  - Check NAT: iptables -t nat -L POSTROUTING -n -v"
