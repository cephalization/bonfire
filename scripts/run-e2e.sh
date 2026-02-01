#!/bin/bash
set -e

# E2E Test Runner Script
# Sets up test bridge, runs E2E tests, and cleans up

# Configuration
BRIDGE_NAME="${BONFIRE_BRIDGE:-bonfire-test0}"
SUBNET="${BONFIRE_SUBNET:-10.0.200.0/24}"
GATEWAY_IP="${BONFIRE_GATEWAY:-10.0.200.1}"

echo "=== Bonfire E2E Test Runner ==="
echo "Bridge: $BRIDGE_NAME"
echo "Subnet: $SUBNET"
echo "Gateway: $GATEWAY_IP"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "=== Cleaning up ==="
    
    # Stop any running VMs (find Firecracker processes)
    pkill -f firecracker || true
    
    # Remove TAP devices created during tests
    for tap in $(ip link show | grep -oE 'tap[0-9]+' | sort -u); do
        echo "Removing TAP device: $tap"
        ip link delete "$tap" 2>/dev/null || true
    done
    
    # Remove the test bridge if we created it
    if ip link show "$BRIDGE_NAME" &>/dev/null; then
        echo "Removing bridge: $BRIDGE_NAME"
        ip link delete "$BRIDGE_NAME" 2>/dev/null || true
    fi
    
    # Clean up temporary files
    rm -rf /tmp/bonfire-e2e/*
    
    echo "Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Setup function
setup() {
    echo "=== Setting up test environment ==="
    
    # Check for KVM support
    if [ ! -e /dev/kvm ]; then
        echo "Error: /dev/kvm not found. KVM is required for E2E tests."
        exit 1
    fi
    
    echo "KVM device found ✓"
    
    # Create test bridge if it doesn't exist
    if ! ip link show "$BRIDGE_NAME" &>/dev/null; then
        echo "Creating bridge: $BRIDGE_NAME"
        ip link add name "$BRIDGE_NAME" type bridge
        ip addr add "$GATEWAY_IP/24" dev "$BRIDGE_NAME"
        ip link set dev "$BRIDGE_NAME" up
        echo "Bridge created ✓"
    else
        echo "Bridge $BRIDGE_NAME already exists"
    fi
    
    # Enable IP forwarding
    sysctl -w net.ipv4.ip_forward=1 >/dev/null
    echo "IP forwarding enabled ✓"
    
    # Set up NAT for internet access in the test subnet
    if ! iptables -t nat -C POSTROUTING -s "$SUBNET" ! -o "$BRIDGE_NAME" -j MASQUERADE 2>/dev/null; then
        iptables -t nat -A POSTROUTING -s "$SUBNET" ! -o "$BRIDGE_NAME" -j MASQUERADE
        echo "NAT rule added ✓"
    fi
    
    # Create test directories
    mkdir -p /var/lib/bonfire/{images,vms}
    chmod 755 /var/lib/bonfire
    echo "Test directories created ✓"
    
    echo ""
    echo "Setup complete!"
    echo ""
}

# Run tests
run_tests() {
    echo "=== Running E2E tests ==="
    
    # Install dependencies if node_modules doesn't exist
    if [ ! -d "/app/node_modules" ]; then
        echo "Installing dependencies..."
        cd /app && corepack enable && pnpm install
    fi
    
    # Run E2E tests
    cd /app && pnpm exec vitest run --config e2e/vitest.config.ts
    
    echo ""
    echo "=== E2E tests completed ==="
}

# Main execution
main() {
    setup
    run_tests
}

main "$@"
