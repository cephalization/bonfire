#!/bin/bash
# Development entrypoint script for Bonfire
# Starts both API and Web services with proper log handling

set -e

echo "🚀 Starting Bonfire development environment..."

corepack enable

# Create necessary directories
mkdir -p /var/lib/bonfire/images /var/lib/bonfire/vms

# Function to cleanup processes on exit
cleanup() {
    echo "🛑 Shutting down services..."
    if [ -n "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
    fi
    if [ -n "$WEB_PID" ]; then
        kill $WEB_PID 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT

# Start API server in background
echo "🔧 Starting API server..."
cd /app/packages/api
chmod +x start.sh
./start.sh &
API_PID=$!
echo "✅ API server started (PID: $API_PID)"

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ API is ready"
        break
    fi
    if ! kill -0 $API_PID 2>/dev/null; then
        echo "❌ API server failed to start"
        exit 1
    fi
    sleep 1
done

# Start Web dev server in background
echo "🌐 Starting Web dev server..."
cd /app/packages/web
pnpm run dev -- --host --clearScreen false &
WEB_PID=$!
echo "✅ Web server started (PID: $WEB_PID)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Bonfire is running!"
echo "   API:  http://localhost:3000"
echo "   Web:  http://localhost:5173"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for either process to exit
wait -n $API_PID $WEB_PID

# If we get here, one of the processes exited
if ! kill -0 $API_PID 2>/dev/null; then
    echo "❌ API server exited unexpectedly"
    exit 1
fi

if ! kill -0 $WEB_PID 2>/dev/null; then
    echo "❌ Web server exited unexpectedly"
    exit 1
fi
