#!/bin/bash
# Database migration and startup script for Bonfire API
# This ensures database tables are created before starting the server

set -e

# Install dependencies if node_modules is missing (common with Docker volume mounts)
if [ ! -d "/app/node_modules" ]; then
  echo "📦 Installing dependencies (pnpm)..."
  (cd /app && corepack enable && pnpm install)
fi

# Initialize network (creates bridge, enables IP forwarding, sets up NAT)
echo "🔧 Initializing network..."
bash scripts/init-network.sh

echo "🔧 Running database migrations..."

# Run migrations
pnpm run migrate

echo "✅ Database migrations complete"

# Start the API server
echo "🚀 Starting API server..."
exec pnpm run dev
