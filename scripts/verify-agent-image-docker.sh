#!/bin/bash
#
# Verify Agent-Ready VM Image Contents
#
# Usage:
#   ./scripts/verify-agent-image.sh [path-to-rootfs.ext4]
#
# Returns:
#   0 if all checks pass
#   1 if any check fails
#

set -eo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOTFS="${1:-${PROJECT_ROOT}/images/agent-rootfs.ext4}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

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
    ((WARNINGS++))
}

# Check prerequisites
check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        echo "Docker is required but not installed"
        exit 1
    fi
    
    if [[ ! -f "$ROOTFS" ]]; then
        echo "Rootfs image not found: ${ROOTFS}"
        exit 1
    fi
}

# Create temporary verification script
create_verify_script() {
    local temp_dir
    temp_dir=$(mktemp -d)
    
    # Note: NO set -e in the inner script to prevent exit on grep failures
    cat > "${temp_dir}/verify.sh" << 'VERIFY_SCRIPT'
#!/bin/bash

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq e2fsprogs > /dev/null 2>&1

passed=0
failed=0
warnings=0

check_file_or_link() {
    local path="$1"
    local name="$2"
    local result
    result=$(debugfs -R "stat $path" /rootfs.ext4 2>&1) || true
    if echo "$result" | grep -qE "Type: (regular|symlink)"; then
        echo "PASS: $name"
        ((passed++))
        return 0
    else
        echo "FAIL: $name"
        ((failed++))
        return 1
    fi
}

check_file() {
    local path="$1"
    local name="$2"
    local result
    result=$(debugfs -R "stat $path" /rootfs.ext4 2>&1) || true
    if echo "$result" | grep -q "Type: regular"; then
        echo "PASS: $name"
        ((passed++))
    else
        echo "FAIL: $name"
        ((failed++))
    fi
}

check_dir() {
    local path="$1"
    local name="$2"
    if debugfs -R "stat $path" /rootfs.ext4 2>&1 | grep -q "Type: directory"; then
        echo "PASS: $name"
        ((passed++))
    else
        echo "FAIL: $name"
        ((failed++))
    fi
}

echo "=== System Packages ==="
check_file_or_link "/usr/sbin/sshd" "SSH server (sshd) is installed"
check_file_or_link "/usr/bin/git" "Git is installed"
check_file_or_link "/usr/bin/sudo" "sudo is installed"
check_dir "/var/lib/apt/lists/partial" "apt lists partial directory exists"
check_file_or_link "/usr/bin/curl" "curl is installed"
check_file_or_link "/usr/bin/wget" "wget is installed"
check_file_or_link "/usr/bin/gcc" "build-essential (gcc) is installed"
check_file_or_link "/usr/bin/python3" "Python3 is installed"

echo "=== Node.js Runtime ==="
check_file_or_link "/usr/bin/node" "Node.js is installed"
check_file_or_link "/usr/bin/corepack" "corepack is installed (pnpm via corepack)"

echo "=== OpenCode ==="
if debugfs -R "stat /home/agent/.opencode/bin/opencode" /rootfs.ext4 2>&1 | grep -q "Type: regular" || debugfs -R "stat /home/agent/.local/bin/opencode" /rootfs.ext4 2>&1 | grep -q "Type: regular"; then
    echo "PASS: OpenCode binary is installed"
    ((passed++))
    
    if debugfs -R "cat /home/agent/.bashrc" /rootfs.ext4 2>/dev/null | grep -q ".opencode/bin"; then
        echo "PASS: OpenCode PATH configured in .bashrc"
        ((passed++))
    else
        echo "WARN: OpenCode PATH not configured in .bashrc"
        ((warnings++))
    fi
else
    echo "FAIL: OpenCode binary is NOT installed"
    ((failed++))
    ((failed++))
fi

echo "=== User Setup ==="
if debugfs -R "cat /etc/passwd" /rootfs.ext4 2>/dev/null | grep -q "^agent:"; then
    echo "PASS: Agent user exists in /etc/passwd"
    ((passed++))
    uid=$(debugfs -R "cat /etc/passwd" /rootfs.ext4 2>/dev/null | grep "^agent:" | cut -d: -f3)
    if [[ "$uid" == "1000" ]]; then
        echo "PASS: Agent user has correct UID (1000)"
        ((passed++))
    else
        echo "FAIL: Agent user has incorrect UID (${uid}, expected 1000)"
        ((failed++))
    fi
else
    echo "FAIL: Agent user does NOT exist in /etc/passwd"
    ((failed++))
    ((failed++))
fi

check_dir "/home/agent" "Agent home directory exists"
check_dir "/home/agent/.ssh" "Agent SSH directory exists"
check_file_or_link "/etc/sudoers.d/agent" "Agent sudoers configuration exists"

echo "=== SSH Configuration ==="
check_file "/etc/ssh/sshd_config" "SSH configuration file exists"
if debugfs -R "stat /lib/systemd/system/ssh.service" /rootfs.ext4 2>&1 | grep -qE "Type: (regular|symlink)" || debugfs -R "stat /etc/init.d/ssh" /rootfs.ext4 2>&1 | grep -qE "Type: (regular|symlink)"; then
    echo "PASS: SSH service is configured"
    ((passed++))
else
    echo "WARN: SSH service configuration not found"
    ((warnings++))
fi

echo "=== systemd Service ==="
service_path="/home/agent/.config/systemd/user/opencode@.service"
if debugfs -R "stat $service_path" /rootfs.ext4 2>&1 | grep -q "Type: regular"; then
    size=$(debugfs -R "stat $service_path" /rootfs.ext4 2>&1 | grep "Size:" | head -1 | sed 's/.*Size:[[:space:]]*//' | awk '{print $1}')
    if [[ -n "$size" && "$size" -gt 0 ]]; then
        echo "PASS: OpenCode systemd service template exists with content (${size} bytes)"
        ((passed++))
        
        service_content=$(debugfs -R "cat $service_path" /rootfs.ext4 2>/dev/null)
        if echo "$service_content" | grep -q "ExecStart="; then
            echo "PASS: Service has ExecStart directive"
            ((passed++))
        else
            echo "FAIL: Service missing ExecStart directive"
            ((failed++))
        fi
        
        if echo "$service_content" | grep -q "Environment=OPENCODE_SERVER_PASSWORD"; then
            echo "PASS: Service has OPENCODE_SERVER_PASSWORD environment variable"
            ((passed++))
        else
            echo "FAIL: Service missing OPENCODE_SERVER_PASSWORD"
            ((failed++))
        fi

        if echo "$service_content" | grep -q "OPENCODE_CONFIG_CONTENT"; then
            echo "PASS: Service references OPENCODE_CONFIG_CONTENT"
            ((passed++))
        else
            echo "WARN: Service does not reference OPENCODE_CONFIG_CONTENT"
            ((warnings++))
        fi
    else
        echo "FAIL: OpenCode systemd service template exists but is EMPTY"
        ((failed++))
        ((failed++))
        ((failed++))
    fi
else
    echo "FAIL: OpenCode systemd service template does NOT exist"
    ((failed++))
    ((failed++))
    ((failed++))
fi

echo "=== Workspace ==="
check_dir "/home/agent/workspaces" "Workspaces directory exists"

echo "=== Serial Autologin ==="
check_file_or_link "/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf" "serial-getty@ttyS0 autologin drop-in exists"

echo ""
echo "========================================"
echo "SUMMARY: Passed: $passed, Failed: $failed, Warnings: $warnings"
echo "========================================"

if [[ $failed -eq 0 ]]; then
    exit 0
else
    exit 1
fi
VERIFY_SCRIPT

    chmod +x "${temp_dir}/verify.sh"
    echo "$temp_dir"
}

# Main execution
main() {
    echo "========================================"
    echo "  Agent Image Verification"
    echo "========================================"
    echo ""
    
    check_prerequisites
    
    log_info "Preparing verification script..."
    local temp_dir
    temp_dir=$(create_verify_script)
    
    log_info "Running verification (this may take a minute)..."
    echo ""
    
    if docker run --rm -v "${ROOTFS}:/rootfs.ext4:ro" -v "${temp_dir}/verify.sh:/verify.sh:ro" ubuntu:24.04 bash /verify.sh; then
        echo ""
        echo -e "${GREEN}All checks passed!${NC}"
        rm -rf "$temp_dir"
        exit 0
    else
        echo ""
        echo -e "${RED}Some checks failed.${NC}"
        rm -rf "$temp_dir"
        exit 1
    fi
}

# Run main function
main "$@"
