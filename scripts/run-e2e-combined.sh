#!/bin/bash
set -e

# Combined API and E2E Test Runner
# Runs both the API server and E2E tests in the same container

# Configuration
API_PORT=3000
BRIDGE_NAME="${BONFIRE_BRIDGE:-bonfire-test0}"
SUBNET="${BONFIRE_SUBNET:-10.0.200.0/24}"
GATEWAY_IP="${BONFIRE_GATEWAY:-10.0.200.1}"
DB_PATH="${DATABASE_URL:-/var/lib/bonfire/bonfire.db}"

echo "=== Bonfire Combined API + E2E Test Runner ==="
echo "Bridge: $BRIDGE_NAME"
echo "Subnet: $SUBNET"
echo "Gateway: $GATEWAY_IP"
echo ""

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

# Install dependencies
install_deps() {
    echo "=== Installing dependencies ==="
    cd /app
    corepack enable
    pnpm install
    echo "Dependencies installed ✓"
    echo ""
}

# Run migrations
run_migrations() {
    echo "=== Running database migrations ==="
    cd /app/packages/api && pnpm run migrate
    echo "Migrations complete ✓"
    echo ""
}

# Build packages
build_packages() {
    echo "=== Building packages ==="
    cd /app
    pnpm -r build
    echo "Build complete ✓"
    echo ""
}

# Start API server in background
start_api() {
    echo "=== Starting API server ==="
    cd /app/packages/api
    
    # Start the API server in the background
    pnpm run start &
    API_PID=$!
    
    # Wait for API to be ready
    echo "Waiting for API to be ready..."
    for i in {1..30}; do
        if curl -sf http://localhost:$API_PORT/health >/dev/null 2>&1; then
            echo "API server ready ✓"
            echo ""
            return 0
        fi
        sleep 1
    done
    
    echo "Error: API server failed to start"
    kill $API_PID 2>/dev/null || true
    exit 1
}

# Start Web UI server in background
start_web() {
    echo "=== Starting Web UI server ==="
    cd /app/packages/web

    # Start the web preview server in the background
    pnpm run preview --port 5173 --host &
    WEB_PID=$!
    
    # Wait for web server to be ready
    echo "Waiting for Web UI to be ready..."
    for i in {1..30}; do
        if curl -sf http://localhost:5173 >/dev/null 2>&1; then
            echo "Web UI server ready ✓"
            echo ""
            return 0
        fi
        sleep 1
    done
    
    echo "Error: Web UI server failed to start"
    kill $WEB_PID 2>/dev/null || true
    exit 1
}

# Run E2E tests
run_tests() {
    echo "=== Running E2E tests ==="
    export BONFIRE_API_URL="http://localhost:$API_PORT"
    cd /app && pnpm exec vitest run --config e2e/vitest.config.ts
    TEST_EXIT_CODE=$?
    echo ""
    echo "=== E2E tests completed ==="
    return $TEST_EXIT_CODE
}

# Cleanup function
cleanup() {
    echo ""
    echo "=== Cleaning up ==="
    
    # Stop Web UI server
    if [ -n "$WEB_PID" ]; then
        kill $WEB_PID 2>/dev/null || true
        wait $WEB_PID 2>/dev/null || true
    fi
    
    # Stop API server
    if [ -n "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
        wait $API_PID 2>/dev/null || true
    fi
    
    # Stop any running VMs
    pkill -f firecracker 2>/dev/null || true
    
    # Remove TAP devices
    for tap in $(ip link show 2>/dev/null | grep -oE 'tap[0-9]+' | sort -u); do
        echo "Removing TAP device: $tap"
        ip link delete "$tap" 2>/dev/null || true
    done
    
    # Remove bridge
    if ip link show "$BRIDGE_NAME" &>/dev/null; then
        echo "Removing bridge: $BRIDGE_NAME"
        ip link delete "$BRIDGE_NAME" 2>/dev/null || true
    fi
    
    echo "Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Main execution
main() {
    setup
    install_deps
    run_migrations
    build_packages
    start_api
    start_web
    run_tests
}

main "$@"
