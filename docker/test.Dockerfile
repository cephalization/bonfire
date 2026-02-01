FROM node:24-bookworm

WORKDIR /app

# No KVM needed, no special privileges
# Runs with mocked services for integration tests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json

# Build tooling for native deps (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN corepack enable
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo (tests + sources)
COPY . .

# Run integration tests
CMD ["pnpm", "exec", "vitest", "run", "--config", "packages/api/vitest.integration.config.mjs"]
