# Bonfire Production Dockerfile
# Multi-stage build for optimal image size

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:24-bookworm AS builder

WORKDIR /app

# Install build dependencies and runtime tools for development
# (iproute2/iptables/procps needed when using builder stage for development)
# Playwright dependencies for browser automation
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    iproute2 \
    iptables \
    procps \
    python3 \
    make \
    g++ \
    libnss3 \
    libatk-bridge2.0-0 \
    libxss1 \
    libgtk-3-0 \
    libgbm-dev \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatspi2.0-0 \
    libwayland-client0 \
    libwayland-egl1 \
    libwayland-cursor0 \
    && rm -rf /var/lib/apt/lists/*

# Download and install Firecracker (needed when using builder stage for development)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        ARCH_TAG="x86_64"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        ARCH_TAG="aarch64"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases" && \
    LATEST_VERSION=$(curl -fsSLI -o /dev/null -w %{url_effective} ${RELEASE_URL}/latest | grep -oP 'v\K[0-9]+\.[0-9]+\.[0-9]+') && \
    curl -L ${RELEASE_URL}/download/v${LATEST_VERSION}/firecracker-v${LATEST_VERSION}-${ARCH_TAG}.tgz | \
    tar -xz -C /tmp && \
    cp /tmp/release-v${LATEST_VERSION}-${ARCH_TAG}/firecracker-v${LATEST_VERSION}-${ARCH_TAG} /usr/local/bin/firecracker && \
    chmod +x /usr/local/bin/firecracker && \
    rm -rf /tmp/release-v${LATEST_VERSION}-${ARCH_TAG}

# Create bonfire directories (needed for development)
RUN mkdir -p /var/lib/bonfire/images /var/lib/bonfire/vms

# Copy manifests first for better build caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json

# Install all dependencies
RUN corepack enable
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo (sources)
COPY . .

# Install agent-browser for browser E2E tests
RUN npm install -g agent-browser

# Install Playwright browser needed by agent-browser
RUN npx playwright install chromium

# Build all packages
RUN pnpm -r build

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:24-bookworm-slim AS runtime

# Install runtime dependencies for Firecracker and networking
RUN apt-get update && apt-get install -y \
    iproute2 \
    iptables \
    procps \
    curl \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download and install Firecracker
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        ARCH_TAG="x86_64"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        ARCH_TAG="aarch64"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases" && \
    LATEST_VERSION=$(curl -fsSLI -o /dev/null -w %{url_effective} ${RELEASE_URL}/latest | grep -oP 'v\K[0-9]+\.[0-9]+\.[0-9]+') && \
    curl -L ${RELEASE_URL}/download/v${LATEST_VERSION}/firecracker-v${LATEST_VERSION}-${ARCH_TAG}.tgz | \
    tar -xz -C /tmp && \
    cp /tmp/release-v${LATEST_VERSION}-${ARCH_TAG}/firecracker-v${LATEST_VERSION}-${ARCH_TAG} /usr/local/bin/firecracker && \
    chmod +x /usr/local/bin/firecracker && \
    rm -rf /tmp/release-v${LATEST_VERSION}-${ARCH_TAG}

# Create bonfire user and directories
RUN groupadd -r bonfire && useradd -r -g bonfire bonfire \
    && mkdir -p /var/lib/bonfire/images /var/lib/bonfire/vms \
    && chown -R bonfire:bonfire /var/lib/bonfire

WORKDIR /app

# Copy manifests for production dependency install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json

# Install production dependencies (--ignore-scripts skips husky prepare hook)
RUN corepack enable \
  && pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder /app/packages/api/dist /app/packages/api/dist
COPY --from=builder /app/packages/web/dist /app/packages/web/dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=/var/lib/bonfire/bonfire.db
ENV WEB_DIST_PATH=/app/packages/web/dist

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Switch to non-root user
USER bonfire

# Start the API server
CMD ["node", "/app/packages/api/dist/index.js"]
