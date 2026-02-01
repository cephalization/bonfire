#!/bin/bash
#
# Build Agent-Ready VM Image (Docker-based)
#
# Creates a Firecracker-compatible ext4 rootfs image with OpenCode and dependencies.
# This version uses Docker for all operations, no sudo required.
#
# Usage:
#   ./scripts/build-agent-image-docker.sh [output-path]
#
# Requirements:
#   - Docker (for building)
#   - ~3GB free disk space
#   - Internet connection
#
# Output:
#   - agent-rootfs.ext4: The VM rootfs image
#   - agent-kernel: The kernel (downloaded from Firecracker CI)
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${1:-${PROJECT_ROOT}/images}"
IMAGE_NAME="bonfire-agent-build"
IMAGE_SIZE_MB="2048"  # 2GB
KERNEL_VERSION="5.10.242"
CI_BUILD_ID="v1.14-itazur"
KERNEL_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/${CI_BUILD_ID}/x86_64/vmlinux-${KERNEL_VERSION}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required but not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running or user lacks permissions"
        exit 1
    fi
    
    log_info "Prerequisites OK"
}

# Download kernel from Firecracker CI
download_kernel() {
    log_info "Downloading kernel from Firecracker CI..."
    
    local kernel_path="${OUTPUT_DIR}/agent-kernel"
    
    if [[ -f "$kernel_path" ]]; then
        log_warn "Kernel already exists at ${kernel_path}, skipping download"
        return
    fi
    
    mkdir -p "${OUTPUT_DIR}"
    curl -fsSL "${KERNEL_URL}" -o "${kernel_path}"
    chmod +x "${kernel_path}"
    
    log_info "Kernel downloaded to ${kernel_path}"
}

# Build Docker image with agent environment
build_docker_image() {
    log_info "Building Docker image with agent environment..."
    
    docker build -f "${PROJECT_ROOT}/docker/Dockerfile.agent" \
        -t "${IMAGE_NAME}" \
        "${PROJECT_ROOT}"
    
    log_info "Docker image built successfully"
}

# Export Docker filesystem to tar
export_filesystem() {
    log_info "Exporting filesystem from Docker container..."
    
    local container_id
    container_id=$(docker create "${IMAGE_NAME}")
    
    local temp_dir
    temp_dir=$(mktemp -d)
    
    docker export "${container_id}" -o "${temp_dir}/rootfs.tar"
    docker rm "${container_id}" > /dev/null
    
    echo "${temp_dir}/rootfs.tar"
}

# Create ext4 image from tar using Docker (no sudo required)
create_ext4_image() {
    local tar_path="$1"
    local output_path="${OUTPUT_DIR}/agent-rootfs.ext4"
    local temp_tar_dir
    temp_tar_dir=$(dirname "$tar_path")
    
    log_info "Creating ext4 image (${IMAGE_SIZE_MB}MB) using Docker..."
    
    # Remove existing image
    rm -f "${output_path}"
    
    # Create ext4 image using privileged Docker container
    docker run --rm --privileged \
        -v "${temp_tar_dir}:/input:ro" \
        -v "${OUTPUT_DIR}:/output" \
        ubuntu:24.04 bash -c "
            set -e
            apt-get update -qq
            apt-get install -y -qq e2fsprogs
            
            # Create empty ext4 image
            truncate -s ${IMAGE_SIZE_MB}M /output/agent-rootfs.ext4
            mkfs.ext4 -F /output/agent-rootfs.ext4
            
            # Mount and extract
            mkdir -p /mnt/rootfs
            mount -o loop /output/agent-rootfs.ext4 /mnt/rootfs
            
            # Extract tar
            tar -xf /input/rootfs.tar -C /mnt/rootfs
            
            # Set up proper permissions for agent user
            chown -R 1000:1000 /mnt/rootfs/home/agent
            
            # Ensure proper device files
            mkdir -p /mnt/rootfs/dev
            mknod -m 622 /mnt/rootfs/dev/console c 5 1 2>/dev/null || true
            mknod -m 666 /mnt/rootfs/dev/null c 1 3 2>/dev/null || true
            mknod -m 666 /mnt/rootfs/dev/zero c 1 5 2>/dev/null || true
            mknod -m 666 /mnt/rootfs/dev/random c 1 8 2>/dev/null || true
            mknod -m 666 /mnt/rootfs/dev/urandom c 1 9 2>/dev/null || true
            
            # Ensure systemd can run
            mkdir -p /mnt/rootfs/run /mnt/rootfs/run/lock /mnt/rootfs/run/user
            chmod 755 /mnt/rootfs/run
            
            # Unmount
            umount /mnt/rootfs
            
            echo 'ext4 image created successfully'
        "
    
    # Clean up temp tar
    rm -rf "${temp_tar_dir}"
    
    log_info "ext4 image created at ${output_path}"
}

# Print usage instructions
print_usage() {
    cat << EOF

${GREEN}Build complete!${NC}

Output files:
  - Kernel: ${OUTPUT_DIR}/agent-kernel
  - Rootfs: ${OUTPUT_DIR}/agent-rootfs.ext4

To verify the image:
  ./scripts/verify-agent-image-docker.sh

To use with Bonfire:
  1. Import the image into Bonfire:
     bonfire image import agent-ready \\
       --kernel ${OUTPUT_DIR}/agent-kernel \\
       --rootfs ${OUTPUT_DIR}/agent-rootfs.ext4

Image details:
  - Base: Ubuntu 24.04
  - User: agent (uid 1000)
  - SSH: Enabled, key-based auth only
  - OpenCode: Installed at /home/agent/.opencode/bin/opencode
  - Node.js: v22.x LTS
  - pnpm: Latest via corepack
  - Size: ${IMAGE_SIZE_MB}MB

EOF
}

# Main execution
main() {
    echo "========================================"
    echo "  Building Agent-Ready VM Image"
    echo "========================================"
    echo ""
    
    check_prerequisites
    download_kernel
    build_docker_image
    
    local tar_path
    tar_path=$(export_filesystem)
    create_ext4_image "$tar_path"
    
    echo ""
    print_usage
}

# Run main function
main "$@"
