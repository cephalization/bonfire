# Bonfire Web Development Service
FROM node:24-bookworm

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json ./

# Expose Vite dev server port
EXPOSE 5173

# Install dependencies and start (done at runtime for dev with volume mounts)
CMD ["sh", "-c", "corepack enable && pnpm install && pnpm run dev -- --host --clearScreen false"]
