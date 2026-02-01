#!/bin/bash
#
# Verify Agent-Ready VM Image Contents
#
# This script verifies the contents of an agent-ready VM rootfs image
# without actually booting it (no KVM required).
#
# Usage:
#   ./scripts/verify-agent-image.sh [path-to-rootfs.ext4]
#
# Returns:
#   0 if all checks pass
#   1 if any check fails
#

set -euo pipefail

# Configuration
ROOTFS="${1:-./images/agent-rootfs.ext4}"
MOUNT_POINT="${2:-/tmp/agent-rootfs-verify}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((CHECKS_PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((CHECKS_FAILED++))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if running as root (required for mount)
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_warn "This script requires root privileges to mount the image"
        log_info "Re-running with sudo..."
        exec sudo "$0" "$@"
    fi
}

# Mount the rootfs image
mount_image() {
    log_info "Mounting ${ROOTFS}..."
    
    if [[ ! -f "$ROOTFS" ]]; then
        log_fail "Rootfs image not found: ${ROOTFS}"
        exit 1
    fi
    
    mkdir -p "${MOUNT_POINT}"
    
    # Check if already mounted
    if mountpoint -q "${MOUNT_POINT}"; then
        umount "${MOUNT_POINT}" 2>/dev/null || true
    fi
    
    mount -o loop,ro "${ROOTFS}" "${MOUNT_POINT}"
    log_info "Image mounted at ${MOUNT_POINT}"
}

# Unmount and cleanup
cleanup() {
    log_info "Cleaning up..."
    if mountpoint -q "${MOUNT_POINT}"; then
        umount "${MOUNT_POINT}" 2>/dev/null || true
    fi
    rmdir "${MOUNT_POINT}" 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Verify system packages
verify_system_packages() {
    log_info "Checking system packages..."
    
    # SSH server
    if [[ -f "${MOUNT_POINT}/usr/sbin/sshd" ]] || [[ -f "${MOUNT_POINT}/usr/bin/sshd" ]]; then
        log_pass "SSH server (sshd) is installed"
    else
        log_fail "SSH server (sshd) is NOT installed"
    fi
    
    # Git
    if [[ -f "${MOUNT_POINT}/usr/bin/git" ]]; then
        log_pass "Git is installed"
    else
        log_fail "Git is NOT installed"
    fi
    
    # curl
    if [[ -f "${MOUNT_POINT}/usr/bin/curl" ]]; then
        log_pass "curl is installed"
    else
        log_fail "curl is NOT installed"
    fi
    
    # wget
    if [[ -f "${MOUNT_POINT}/usr/bin/wget" ]]; then
        log_pass "wget is installed"
    else
        log_fail "wget is NOT installed"
    fi
    
    # build-essential (gcc)
    if [[ -f "${MOUNT_POINT}/usr/bin/gcc" ]]; then
        log_pass "build-essential (gcc) is installed"
    else
        log_fail "build-essential (gcc) is NOT installed"
    fi
    
    # Python3
    if [[ -f "${MOUNT_POINT}/usr/bin/python3" ]]; then
        log_pass "Python3 is installed"
    else
        log_fail "Python3 is NOT installed"
    fi
}

# Verify Node.js and pnpm
verify_node_runtime() {
    log_info "Checking Node.js runtime..."
    
    # Node.js
    if [[ -f "${MOUNT_POINT}/usr/bin/node" ]]; then
        log_pass "Node.js is installed"
        # Try to get version
        if [[ -x "${MOUNT_POINT}/usr/bin/node" ]]; then
            local version
            version=$(chroot "${MOUNT_POINT}" /usr/bin/node --version 2>/dev/null || echo "unknown")
            log_info "  Node.js version: ${version}"
        fi
    else
        log_fail "Node.js is NOT installed"
    fi
    
    # pnpm (via corepack)
    if [[ -f "${MOUNT_POINT}/usr/bin/pnpm" ]] || [[ -f "${MOUNT_POINT}/usr/local/bin/pnpm" ]]; then
        log_pass "pnpm is installed"
    else
        log_fail "pnpm is NOT installed"
    fi
}

# Verify OpenCode installation
verify_opencode() {
    log_info "Checking OpenCode installation..."
    
    if [[ -f "${MOUNT_POINT}/home/agent/.local/bin/opencode" ]]; then
        log_pass "OpenCode binary is installed"
        
        # Check if it's executable
        if [[ -x "${MOUNT_POINT}/home/agent/.local/bin/opencode" ]]; then
            log_pass "OpenCode binary is executable"
        else
            log_warn "OpenCode binary may not be executable"
        fi
    else
        log_fail "OpenCode binary is NOT installed at /home/agent/.local/bin/opencode"
    fi
}

# Verify user setup
verify_user_setup() {
    log_info "Checking user setup..."
    
    # Check /etc/passwd for agent user
    if grep -q "^agent:" "${MOUNT_POINT}/etc/passwd"; then
        log_pass "Agent user exists in /etc/passwd"
        local uid
        uid=$(grep "^agent:" "${MOUNT_POINT}/etc/passwd" | cut -d: -f3)
        if [[ "$uid" == "1000" ]]; then
            log_pass "Agent user has correct UID (1000)"
        else
            log_fail "Agent user has incorrect UID (${uid}, expected 1000)"
        fi
    else
        log_fail "Agent user does NOT exist in /etc/passwd"
    fi
    
    # Check home directory
    if [[ -d "${MOUNT_POINT}/home/agent" ]]; then
        log_pass "Agent home directory exists"
    else
        log_fail "Agent home directory does NOT exist"
    fi
    
    # Check SSH directory
    if [[ -d "${MOUNT_POINT}/home/agent/.ssh" ]]; then
        log_pass "Agent SSH directory exists"
    else
        log_fail "Agent SSH directory does NOT exist"
    fi
    
    # Check sudoers
    if [[ -f "${MOUNT_POINT}/etc/sudoers.d/agent" ]]; then
        log_pass "Agent sudoers configuration exists"
        if grep -q "NOPASSWD" "${MOUNT_POINT}/etc/sudoers.d/agent"; then
            log_pass "Agent has passwordless sudo"
        else
            log_warn "Agent may not have passwordless sudo"
        fi
    else
        log_warn "Agent sudoers configuration not found"
    fi
}

# Verify SSH configuration
verify_ssh_config() {
    log_info "Checking SSH configuration..."
    
    # Check SSH config
    if [[ -f "${MOUNT_POINT}/etc/ssh/sshd_config" ]]; then
        log_pass "SSH configuration file exists"
        
        if grep -q "PasswordAuthentication no" "${MOUNT_POINT}/etc/ssh/sshd_config"; then
            log_pass "Password authentication is disabled"
        else
            log_warn "Password authentication may be enabled"
        fi
        
        if grep -q "PubkeyAuthentication yes" "${MOUNT_POINT}/etc/ssh/sshd_config"; then
            log_pass "Public key authentication is enabled"
        else
            log_warn "Public key authentication may not be enabled"
        fi
    else
        log_fail "SSH configuration file does NOT exist"
    fi
    
    # Check SSH service
    if [[ -f "${MOUNT_POINT}/etc/init.d/ssh" ]] || [[ -f "${MOUNT_POINT}/lib/systemd/system/ssh.service" ]]; then
        log_pass "SSH service is configured"
    else
        log_warn "SSH service configuration not found"
    fi
}

# Verify systemd service
verify_systemd_service() {
    log_info "Checking systemd service template..."
    
    local service_path="${MOUNT_POINT}/home/agent/.config/systemd/user/opencode@.service"
    
    if [[ -f "$service_path" ]]; then
        log_pass "OpenCode systemd service template exists"
        
        # Check service content
        if grep -q "ExecStart=" "$service_path"; then
            log_pass "Service has ExecStart directive"
        else
            log_fail "Service missing ExecStart directive"
        fi
        
        if grep -q "Environment=OPENCODE_SERVER_PASSWORD" "$service_path"; then
            log_pass "Service has OPENCODE_SERVER_PASSWORD environment variable"
        else
            log_fail "Service missing OPENCODE_SERVER_PASSWORD"
        fi
        
        if grep -q "Environment=OPENCODE_CONFIG_CONTENT" "$service_path"; then
            log_pass "Service has OPENCODE_CONFIG_CONTENT environment variable"
        else
            log_fail "Service missing OPENCODE_CONFIG_CONTENT"
        fi
    else
        log_fail "OpenCode systemd service template does NOT exist"
    fi
}

# Verify workspace directory
verify_workspace() {
    log_info "Checking workspace directory..."
    
    if [[ -d "${MOUNT_POINT}/home/agent/workspaces" ]]; then
        log_pass "Workspaces directory exists"
    else
        log_fail "Workspaces directory does NOT exist"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo "========================================"
    echo "  Verification Summary"
    echo "========================================"
    echo -e "  ${GREEN}Passed: ${CHECKS_PASSED}${NC}"
    echo -e "  ${RED}Failed: ${CHECKS_FAILED}${NC}"
    echo ""
    
    if [[ $CHECKS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}All checks passed!${NC}"
        return 0
    else
        echo -e "${RED}Some checks failed.${NC}"
        return 1
    fi
}

# Main execution
main() {
    echo "========================================"
    echo "  Agent Image Verification"
    echo "========================================"
    echo ""
    
    check_root
    mount_image
    
    verify_system_packages
    verify_node_runtime
    verify_opencode
    verify_user_setup
    verify_ssh_config
    verify_systemd_service
    verify_workspace
    
    print_summary
}

# Run main function
main "$@"
