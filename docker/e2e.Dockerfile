FROM node:24-bookworm

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    iproute2 \
    iptables \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Firecracker binary
ARG FC_VERSION=v1.14.1
RUN curl -fsSL \
    "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-x86_64.tgz" \
    | tar -xz -C /tmp \
    && mkdir -p /usr/local/bin \
    && find /tmp -name "firecracker-*" -type f -executable | head -1 | xargs -I {} mv {} /usr/local/bin/firecracker \
    && chmod +x /usr/local/bin/firecracker \
    && rm -rf /tmp/release-*

# Verify installations
RUN node --version && corepack --version && firecracker --version

WORKDIR /app

# The codebase will be mounted at runtime
# This container requires:
#   - privileged mode
#   - /dev/kvm device access
#   - NET_ADMIN capability
#   - SYS_ADMIN capability

CMD ["./scripts/run-e2e.sh"]
