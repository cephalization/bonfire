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

# The API registers the default image itself at startup if the files above
# exist, so nothing here needs credentials.
echo "🚀 Starting Bonfire API"
exec node /app/packages/api/dist/index.js
