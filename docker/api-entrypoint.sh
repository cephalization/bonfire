#!/bin/sh

set -eu

mkdir -p /var/lib/bonfire/images /var/lib/bonfire/vms

# Copy agent images from build directory if they exist
if [ -d "/app/images" ]; then
  echo "📦 Copying agent images to data directory..."
  cp -v /app/images/agent-kernel /var/lib/bonfire/images/ 2>/dev/null || true
  cp -v /app/images/agent-rootfs.ext4 /var/lib/bonfire/images/ 2>/dev/null || true
fi

# Container networking for Firecracker microVMs
if [ -x "/app/packages/api/scripts/init-network.sh" ]; then
  /app/packages/api/scripts/init-network.sh || true
fi

# Ensure DB schema exists before serving traffic.
node /app/packages/api/dist/migrate.js

# Start API in background for auto-registration
node /app/packages/api/dist/index.js &
API_PID=$!

# Wait for API to be ready (max 30 seconds)
echo "⏳ Waiting for API to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ API is ready"
    break
  fi
  if ! kill -0 $API_PID 2>/dev/null; then
    echo "❌ API failed to start"
    exit 1
  fi
  sleep 1
done

# Auto-register default image if kernel and rootfs exist
if [ -f "/var/lib/bonfire/images/agent-kernel" ] && [ -f "/var/lib/bonfire/images/agent-rootfs.ext4" ]; then
  echo "🖼️  Checking if default image is registered..."

  # Check if image already exists via API
  if ! curl -sf http://localhost:3000/api/images | grep -q "local:agent-ready"; then
    echo "📝 Registering default image (local:agent-ready)..."
    if curl -sf -X POST http://localhost:3000/api/images/local \
      -H "Content-Type: application/json" \
      -d '{
        "reference": "local:agent-ready",
        "kernelPath": "/var/lib/bonfire/images/agent-kernel",
        "rootfsPath": "/var/lib/bonfire/images/agent-rootfs.ext4"
      }'; then
      echo ""
      echo "✅ Image registered successfully"
    else
      echo "⚠️  Image registration failed"
    fi
  else
    echo "✅ Default image already registered"
  fi
fi

# Bring API to foreground
echo "🚀 Bonfire API is running"
wait $API_PID
