#!/usr/bin/env bash
#
# Bring up Bonfire on a fresh Linux host, from nothing to a running stack.
#
# Bonfire needs /dev/kvm, so this must run on bare metal or on a VM with
# nested virtualization enabled — see docs/SELF_HOSTING.md for hosts that
# qualify. Targets Ubuntu 24.04 on x86_64; other distributions need the
# package step adapted.
#
# Usage:
#   sudo ./scripts/bootstrap-host.sh
#
# Environment:
#   BONFIRE_URL         URL the browser will use. Defaults to the SSH-tunnel
#                       address, http://localhost:8080.
#   SKIP_AGENT_IMAGE=1  Do not build the agent VM image (saves ~20 minutes and
#                       3GB; VMs cannot boot without it).
#
# Idempotent: safe to re-run to pick up a new commit or restart the stack.

set -euo pipefail

RED=$'\033[0;31m' GREEN=$'\033[0;32m' YELLOW=$'\033[1;33m' BOLD=$'\033[1m' NC=$'\033[0m'
step() { echo "${GREEN}==>${NC} ${BOLD}$1${NC}"; }
info() { echo "    $1"; }
warn() { echo "${YELLOW}[warn]${NC} $1"; }
die() {
  echo "${RED}[error]${NC} $1" >&2
  exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILES=(
  -f docker/docker-compose.yml
  -f docker/docker-compose.prod.yml
  -f docker/docker-compose.host.yml
)

# --- 1. Preflight -----------------------------------------------------------
# Checked before anything is installed, so a host that cannot run Bonfire
# fails in seconds rather than after a long build.

step "Checking the host"

[ "$(id -u)" -eq 0 ] || die "Run this with sudo; it installs packages and needs Docker."

case "$(uname -m)" in
  x86_64) ;;
  *) die "Bonfire's agent kernel and rootfs are built for x86_64; this host is $(uname -m)." ;;
esac

if [ ! -e /dev/kvm ]; then
  die "/dev/kvm is missing, so Firecracker cannot start a VM.

    This host is either not bare metal or has nested virtualization off.
    Ordinary cloud VMs (Hetzner Cloud, DigitalOcean, Linode, Vultr cloud,
    EC2 except .metal) cannot run Bonfire. See docs/SELF_HOSTING.md."
fi

if ! { [ -r /dev/kvm ] && [ -w /dev/kvm ]; }; then
  die "/dev/kvm exists but is not readable and writable by root."
fi
info "/dev/kvm present and usable"

# --- 2. Packages ------------------------------------------------------------

step "Installing packages"

MISSING=()
command -v docker > /dev/null || MISSING+=(docker.io)
docker compose version > /dev/null 2>&1 || MISSING+=(docker-compose-v2)
command -v git > /dev/null || MISSING+=(git)
command -v openssl > /dev/null || MISSING+=(openssl)
command -v curl > /dev/null || MISSING+=(curl)

if [ ${#MISSING[@]} -gt 0 ]; then
  info "installing: ${MISSING[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${MISSING[@]}"
else
  info "everything already installed"
fi

systemctl enable --now docker > /dev/null 2>&1 || true
docker compose version > /dev/null 2>&1 \
  || die "docker compose is still unavailable. Install Compose v2.24 or newer."

# --- 3. Configuration -------------------------------------------------------
# The secret encrypts organizations' provider keys as well as signing session
# cookies, so an existing one is never replaced: rotating it would make the
# stored keys unreadable and force every agent to be re-attached.

step "Configuring"

ENV_FILE="$REPO_ROOT/.env"
if [ -f "$ENV_FILE" ] && grep -qE '^BETTER_AUTH_SECRET=.+' "$ENV_FILE"; then
  info "keeping the BETTER_AUTH_SECRET already in .env"
else
  [ -f "$ENV_FILE" ] && warn "$ENV_FILE has no BETTER_AUTH_SECRET; appending one"
  {
    echo "# Written by scripts/bootstrap-host.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# Keep this file. Changing BETTER_AUTH_SECRET invalidates sessions and"
    echo "# makes stored provider keys unreadable."
    echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
    echo "BONFIRE_URL=${BONFIRE_URL:-http://localhost:8080}"
  } >> "$ENV_FILE"
  info "wrote $ENV_FILE"
fi

CONFIGURED_URL="$(grep -E '^BONFIRE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
info "BONFIRE_URL is ${CONFIGURED_URL:-unset} (must match the browser's address bar)"

# --- 4. Agent VM image ------------------------------------------------------
# docker/docker-compose.host.yml bind-mounts this directory into the API
# container, where the API registers the default image at startup.

step "Preparing the agent VM image"

if [ -f images/agent-kernel ] && [ -f images/agent-rootfs.ext4 ]; then
  info "images/agent-kernel and images/agent-rootfs.ext4 already built"
elif [ "${SKIP_AGENT_IMAGE:-}" = "1" ]; then
  warn "skipping the image build; VMs cannot boot until it is built"
  mkdir -p images
else
  info "building it (~20 minutes and ~3GB the first time)"
  ./scripts/build-agent-image-docker.sh
fi

# --- 5. Start ---------------------------------------------------------------

step "Building and starting the stack"
info "ports are published on 127.0.0.1 only; nothing is exposed to the internet"
docker compose "${COMPOSE_FILES[@]}" up -d --build

step "Waiting for the API"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null 2>&1; then
    info "healthy"
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ -z "${HEALTHY:-}" ]; then
  echo
  die "the API did not become healthy. Logs:
$(docker compose "${COMPOSE_FILES[@]}" logs --tail 40 api 2>&1)"
fi

# --- 6. What to do next ----------------------------------------------------

PUBLIC_HOST="$(hostname -f 2>/dev/null || hostname)"
cat <<EOF

${GREEN}${BOLD}Bonfire is running.${NC}

Nothing is reachable from the internet: both ports are bound to this host's
loopback interface. To use it, open a tunnel from your own machine:

    ${BOLD}ssh -N -L 8080:127.0.0.1:80 root@${PUBLIC_HOST}${NC}

then go to ${BOLD}${CONFIGURED_URL:-http://localhost:8080}${NC} and sign up. The first
account becomes the admin; everyone after that needs an invitation, and
invitation links appear in the API log because there is no email service.

    docker compose ${COMPOSE_FILES[*]} logs -f api
    docker compose ${COMPOSE_FILES[*]} restart

To deploy a new commit: git pull, then re-run this script.
EOF
