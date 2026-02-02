#!/bin/bash
#
# Build Agent-Ready VM Image
#
# Creates a Firecracker-compatible ext4 rootfs image with OpenCode and dependencies.
#
# Usage:
#   ./scripts/build-agent-image.sh [output-path]
#
# Requirements:
#   - Docker (for building)
#   - qemu-img or mkfs.ext4 (for creating ext4 image)
#   - root privileges (for mounting/ext4 operations)
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
IMAGE_SIZE_MB="4096"  # 4GB should be plenty for development
KERNEL_VERSION="5.10.242"
CI_BUILD_ID="v1.14-itazur"
KERNEL_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/${CI_BUILD_ID}/x86_64/vmlinux-${KERNEL_VERSION}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup_partial_outputs() {
    # If the build fails partway through, avoid leaving behind a valid-but-empty ext4.
    local rootfs_path="${OUTPUT_DIR}/agent-rootfs.ext4"
    if [[ -f "${rootfs_path}" ]]; then
        rm -f "${rootfs_path}" || true
    fi
}

trap cleanup_partial_outputs ERR

delete_existing_outputs() {
    local rootfs_path="${OUTPUT_DIR}/agent-rootfs.ext4"
    local kernel_path="${OUTPUT_DIR}/agent-kernel"

    mkdir -p "${OUTPUT_DIR}"

    if [[ -f "${rootfs_path}" ]]; then
        log_warn "Deleting existing rootfs: ${rootfs_path}"
        rm -f "${rootfs_path}"
    fi

    if [[ -f "${kernel_path}" ]]; then
        log_warn "Deleting existing kernel: ${kernel_path}"
        rm -f "${kernel_path}"
    fi
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

# Create ext4 image from tar
create_ext4_image() {
    local tar_path="$1"
    local output_path="${OUTPUT_DIR}/agent-rootfs.ext4"
    
    log_info "Creating ext4 image (${IMAGE_SIZE_MB}MB)..."
    
    # Remove existing image
    rm -f "${output_path}"
    
    # Create empty ext4 image
    truncate -s "${IMAGE_SIZE_MB}M" "${output_path}"
    mkfs.ext4 -F "${output_path}"
    
    # Mount and extract
    local mount_point
    mount_point=$(mktemp -d)
    
    log_info "Mounting image and extracting filesystem..."
    sudo mount -o loop "${output_path}" "${mount_point}"
    
    # Extract tar to mount point
    sudo tar -xf "${tar_path}" -C "${mount_point}"
    
    # Set up proper permissions for agent user
    sudo chown -R 1000:1000 "${mount_point}/home/agent"
    
    # Ensure proper device files (Docker export doesn't include these)
    sudo mkdir -p "${mount_point}/dev"
    sudo mknod -m 622 "${mount_point}/dev/console" c 5 1 2>/dev/null || true
    sudo mknod -m 666 "${mount_point}/dev/null" c 1 3 2>/dev/null || true
    sudo mknod -m 666 "${mount_point}/dev/zero" c 1 5 2>/dev/null || true
    sudo mknod -m 666 "${mount_point}/dev/random" c 1 8 2>/dev/null || true
    sudo mknod -m 666 "${mount_point}/dev/urandom" c 1 9 2>/dev/null || true
    
    # Ensure systemd can run
    sudo mkdir -p "${mount_point}/run" "${mount_point}/run/lock" "${mount_point}/run/user"
    sudo chmod 755 "${mount_point}/run"
    
    # Unmount
    sudo umount "${mount_point}"
    rmdir "${mount_point}"
    
    # Clean up temp tar
    rm -f "${tar_path}"
    rm -rf "$(dirname "$tar_path")"
    
    log_info "ext4 image created at ${output_path}"
}

# Verify the image contents
verify_image() {
    log_info "Verifying image contents..."
    
    local rootfs_path="${OUTPUT_DIR}/agent-rootfs.ext4"
    local mount_point
    mount_point=$(mktemp -d)
    
    sudo mount -o loop,ro "${rootfs_path}" "${mount_point}"
    
    local failed=0
    
    # Check required files
    log_info "Checking required files..."
    
    if [[ ! -f "${mount_point}/usr/sbin/sshd" ]]; then
        log_error "SSH server (sshd) not found"
        failed=1
    else
        log_info "✓ SSH server found"
    fi
    
    if [[ ! -f "${mount_point}/usr/bin/git" ]]; then
        log_error "Git not found"
        failed=1
    else
        log_info "✓ Git found"
    fi
    
    if [[ ! -f "${mount_point}/home/agent/.local/bin/opencode" ]]; then
        log_error "OpenCode not found"
        failed=1
    else
        log_info "✓ OpenCode found"
    fi
    
    if [[ ! -f "${mount_point}/home/agent/.config/systemd/user/opencode@.service" ]]; then
        log_error "OpenCode systemd service template not found"
        failed=1
    else
        log_info "✓ OpenCode systemd service template found"
    fi
    
    if [[ ! -d "${mount_point}/home/agent/.ssh" ]]; then
        log_error "Agent SSH directory not found"
        failed=1
    else
        log_info "✓ Agent SSH directory found"
    fi
    
    if ! id -u agent &>/dev/null && [[ ! -f "${mount_point}/etc/passwd" ]]; then
        log_error "Agent user not configured"
        failed=1
    else
        log_info "✓ Agent user configured"
    fi
    
    sudo umount "${mount_point}"
    rmdir "${mount_point}"
    
    if [[ $failed -eq 1 ]]; then
        log_error "Image verification failed"
        exit 1
    fi
    
    log_info "Image verification passed!"
}

# Print usage instructions
print_usage() {
    cat << EOF

${GREEN}Build complete!${NC}

Output files:
  - Kernel: ${OUTPUT_DIR}/agent-kernel
  - Rootfs: ${OUTPUT_DIR}/agent-rootfs.ext4

To use with Bonfire:
  1. Import the image into Bonfire:
     bonfire image import agent-ready \
       --kernel ${OUTPUT_DIR}/agent-kernel \
       --rootfs ${OUTPUT_DIR}/agent-rootfs.ext4

  2. Or manually register in database:
     - Copy files to /var/lib/bonfire/images/<id>/
     - Add entry to images table

To test the image with Firecracker directly:
  # See AGENT_UI_PLAN.md for testing instructions

Image details:
  - Base: Ubuntu 24.04
  - User: agent (uid 1000)
  - SSH: Enabled, key-based auth only
  - OpenCode: Installed at /home/agent/.local/bin/opencode
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

    # Always rebuild from scratch to avoid stale/partial artifacts.
    delete_existing_outputs

    download_kernel
    build_docker_image
    
    local tar_path
    tar_path=$(export_filesystem)
    create_ext4_image "$tar_path"
    verify_image
    
    echo ""
    print_usage
}

# Run main function
main "$@"
