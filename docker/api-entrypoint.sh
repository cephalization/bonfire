#!/bin/sh

set -eu

mkdir -p /var/lib/bonfire/images /var/lib/bonfire/vms

# Container networking for Firecracker microVMs
if [ -x "/app/packages/api/scripts/init-network.sh" ]; then
  /app/packages/api/scripts/init-network.sh || true
fi

# Ensure DB schema exists before serving traffic.
node /app/packages/api/dist/migrate.js

exec node /app/packages/api/dist/index.js
